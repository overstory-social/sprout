-- sprout-player: the shelf, the download screen, the nickname picker, the reader and the
-- sentence builder, drawn at 30 frames a second on the 400 x 240 screen. The engine is the C code
-- registered as `sprout`; every call to it goes through `engine.lua`. Ticks are asked for only
-- while the reader is open, never on the shelf, and not while the device sleeps. The network is
-- reached only from the download screen, and only from `update()`, where the system may pause
-- the game to ask permission.

local Wrap <const> = import "wrap"
local Clock <const> = import "clock"
local Reader <const> = import "reader"
local Sentence <const> = import "sentence"
local Nickname <const> = import "nickname"
local Shelf <const> = import "shelf"
local Engine <const> = import "engine"
local Images <const> = import "images"
local Canonical <const> = import "canonical"
local Index <const> = import "index"
local Net <const> = import "net"
local Config <const> = import "config"
local Downloads <const> = import "downloads"
local PublicKey <const> = import "publickey"
local Markup <const> = import "markup"

local pd <const> = playdate
-- The screen is the SDK's graphics with one difference: text is drawn plain, since nothing drawn
-- here is markup and `drawText` would read a world's underscores as italics.
local gfx <const> = setmetatable({
  drawText = function(text, x, y) pd.graphics.drawText(Markup.plain(text), x, y) end,
}, { __index = pd.graphics })

pd.display.setRefreshRate(30)

local font <const> = gfx.getSystemFont()
gfx.setFont(font)
local lineHeight <const> = font:getHeight()
local function measure(text) return font:getTextWidth(text) end

local MARGIN <const> = 4
local HEADER <const> = lineHeight + 4
local PANEL <const> = lineHeight * 3 + 8
local ROWS <const> = math.floor((240 - HEADER - PANEL) / lineHeight)
local DEGREES_PER_STEP <const> = 24

local engine = Engine.new(sprout, json)
local shelf = Shelf.new(pd.file, engine)
local clock = Clock.new(0)
local reader = nil
local builder = nil
local picker = nil
local opened = nil -- the entry of the cartridge being read
local images = nil -- its pictures
local notice = nil -- what opening the world has to tell the visitor before they come in
local downloads = nil -- the download screen, made the first time it is opened
local mode = "shelf" -- shelf, downloads, nickname, reader, sentence, message
local message = nil
local backTo = "shelf"

local function seconds() return (pd.getSecondsSinceEpoch()) end

local function showMessage(text, to)
  message, backTo, mode = text, to, "message"
end

local function newReader()
  return Reader.new({
    wrap = Wrap, measure = measure, width = 400 - 2 * MARGIN, rows = ROWS,
  })
end

-- Shows the picture a turn's lines ask for, or else the one the place's description does: the
-- newest of each. `images` is the open cartridge's.
local function showPicture(lines, view)
  local asked = Images.newest(lines) or Images.newest(view.effects)
  local picture = asked ~= nil and images ~= nil and images:picture(asked, lineHeight) or nil
  if picture ~= nil then
    local shown = picture
    shown.draw = function(g, y) Images.draw(shown, g, y) end
  end
  reader:setPicture(picture, lineHeight)
end

local function refreshStatus(lines)
  local view = engine:view()
  local here = {}
  for _, one in ipairs(view.occupants) do here[#here + 1] = one.name end
  local exits = {}
  for _, one in ipairs(view.exits) do exits[#exits + 1] = one.direction or one.label end
  reader:setStatus(view.place, here, exits)
  if lines ~= nil then showPicture(lines, view) end
  return view
end

local function told(lines)
  for _, line in ipairs(lines or {}) do reader:push(line.kind, line.text) end
end

-- The bundle hashes of the worlds on the shelf, which the download screen marks.
local function onShelf()
  local hashes = {}
  for _, entry in ipairs(shelf.entries) do
    if entry.hash ~= nil then hashes[entry.hash] = true end
  end
  return hashes
end

local function openDownloads()
  if downloads == nil then
    downloads = Downloads.new({
      net = Net.new(pd.network), files = pd.file, engine = engine, json = json, canonical = Canonical,
      index = Index, config = Config.effective(pd.datastore), publicKey = PublicKey, installed = onShelf,
    })
  end
  mode = "downloads"
  downloads:open(seconds())
  shelf:noteMore(downloads:indexFailure())
end

local function leaveDownloads()
  local failure = downloads:indexFailure()
  downloads:close()
  shelf:noteMore(failure)
  mode = "shelf"
  shelf:refresh()
end

local function toShelf()
  shelf:refresh()
  mode, opened, images, reader, builder, picker = "shelf", nil, nil, nil, nil, nil
  clock:stop()
end

-- What is said when a save could not be written: play stops, since a move that is not kept is not played.
local SAVE_FAILED = "The save could not be written, so play has stopped and your last move was not kept. "
  .. "Free some room on the console. This world stays greyed until its save can be written."

-- Leaves the world after a save failed: the world is greyed on the shelf and the words are shown.
local function stopForSave(path)
  shelf:block(path, SAVE_FAILED)
  toShelf()
  showMessage(SAVE_FAILED, "shelf")
end

local function openWorld(entry)
  local opening = engine:open(entry.path)
  if not opening.ok then
    entry.ok, entry.reason = false, opening.reason
    showMessage(opening.reason, "shelf")
    return
  end
  local loaded = engine:load()
  if not loaded.ok then
    engine:close()
    showMessage(loaded.words, "shelf")
    return
  end
  if entry.blocked then
    -- A world greyed for its save is opened again only once a save of it succeeds.
    if not engine:save().ok then
      engine:close()
      showMessage(SAVE_FAILED, "shelf")
      return
    end
    shelf:unblock(entry.path)
  end
  opened = entry
  images = Images.new(gfx, pd.file, entry.path)
  notice = loaded.words ~= "" and loaded.words or nil
  clock = Clock.new(loaded.last)
  local candidates = Nickname.available(Nickname.POOL, opening.words, loaded.present)
  picker = Nickname.new(candidates, loaded.nickname)
  mode = "nickname"
end

local function admit()
  local name = picker:current()
  if name == nil then
    showMessage("Every name this world allows is taken.", "shelf")
    engine:close()
    return
  end
  local admission = engine:admit(name)
  if admission.saved == false then
    local path = opened.path
    engine:close()
    stopForSave(path)
    return
  end
  if not admission.admitted then
    showMessage(admission.words, "nickname")
    return
  end
  reader = newReader()
  reader:push("client", "You are in " .. opened.title .. " as " .. name .. ".")
  if notice ~= nil then reader:push("notice", notice) end
  told(admission.lines)
  refreshStatus(admission.lines)
  clock:start(seconds())
  mode = "reader"
end

local function leave()
  local path = opened.path
  local left = engine:close()
  if reader ~= nil then told(left.lines) end
  toShelf()
  if left.saved == false then stopForSave(path) end
end

local function buildSentence()
  local view = refreshStatus()
  if view.faulted or #view.chips == 0 then
    -- A poll that faulted offers nothing, and its description is the fault told; a blank wheel
    -- would say nothing.
    showMessage(table.concat(view.description, " "), "reader")
    return
  end
  builder = Sentence.new(view)
  mode = "sentence"
end

local function confirm()
  local done, reading = builder:pick()
  if done == "refused" then
    showMessage(reading or "That cannot be done.", "sentence")
    return
  end
  if done ~= "done" then return end
  reader:push("typed", builder:phrase())
  local result = engine:turn(reading)
  if result.saved == false then
    local path = opened.path
    engine:close()
    stopForSave(path)
    return
  end
  told(result.lines)
  refreshStatus(result.lines)
  reader:toNewest()
  builder = nil
  mode = "reader"
end

-- ---- input ----

local function crankChange()
  if pd.isCrankDocked() then return 0 end
  return (pd.getCrankChange())
end

local function updateShelf()
  shelf:turn(crankChange(), DEGREES_PER_STEP)
  if pd.buttonJustPressed(pd.kButtonDown) then shelf:move(1) end
  if pd.buttonJustPressed(pd.kButtonUp) then shelf:move(-1) end
  if pd.buttonJustPressed(pd.kButtonA) then
    if shelf:onMore() then return openDownloads() end
    local entry = shelf:current()
    if entry == nil then return end
    if not entry.ok and not entry.blocked then
      showMessage(entry.reason, "shelf")
    else
      openWorld(entry)
    end
  end
end

local function updateDownloads()
  local now = seconds()
  downloads:update(now)
  local arrived = downloads:takeArrived()
  if arrived ~= nil then
    shelf:forget()
    shelf:refresh()
  end
  if downloads:busy() then
    if pd.buttonJustPressed(pd.kButtonB) then leaveDownloads() end
    return
  end
  downloads:turn(crankChange(), DEGREES_PER_STEP)
  if pd.buttonJustPressed(pd.kButtonDown) then downloads:move(1) end
  if pd.buttonJustPressed(pd.kButtonUp) then downloads:move(-1) end
  if pd.buttonJustPressed(pd.kButtonA) then
    if downloads.phase == "failed" then openDownloads() else downloads:choose(now) end
  end
  if pd.buttonJustPressed(pd.kButtonB) then leaveDownloads() end
end

local function updateNickname()
  picker:turn(crankChange(), DEGREES_PER_STEP)
  if pd.buttonJustPressed(pd.kButtonDown) then picker:move(1) end
  if pd.buttonJustPressed(pd.kButtonUp) then picker:move(-1) end
  if pd.buttonJustPressed(pd.kButtonA) then admit() end
  if pd.buttonJustPressed(pd.kButtonB) then
    engine:close()
    toShelf()
  end
end

local function updateReader()
  local change = crankChange()
  if change ~= 0 then reader:scroll(math.floor(change / 12 + 0.5)) end
  if pd.buttonJustPressed(pd.kButtonUp) then reader:scroll(1) end
  if pd.buttonJustPressed(pd.kButtonDown) then reader:scroll(-1) end
  if pd.buttonJustPressed(pd.kButtonA) then buildSentence() end
  if clock:tickDue(seconds()) then
    local ticked = engine:tick()
    if ticked.saved == false then
      local path = opened.path
      engine:close()
      stopForSave(path)
      return
    end
    if #(ticked.lines or {}) > 0 then
      told(ticked.lines)
      refreshStatus(ticked.lines)
    end
  end
end

local function updateSentence()
  builder:turn(crankChange())
  local state = builder.state
  local numbered = state.stage == "option" and state.leaf.options[state.role].takes == "integer"
  -- Down moves to the next entry; on a number it takes the number down, as up takes it up.
  local down = numbered and -1 or 1
  if pd.buttonJustPressed(pd.kButtonDown) then builder:nudge(down) end
  if pd.buttonJustPressed(pd.kButtonUp) then builder:nudge(-down) end
  if numbered and pd.buttonJustPressed(pd.kButtonRight) then builder:addNumber(1, true) end
  if numbered and pd.buttonJustPressed(pd.kButtonLeft) then builder:addNumber(-1, true) end
  if pd.buttonJustPressed(pd.kButtonA) then confirm() end
  if pd.buttonJustPressed(pd.kButtonB) then
    if not builder:back() then
      builder = nil
      mode = "reader"
    end
  end
end

local function updateMessage()
  if pd.buttonJustPressed(pd.kButtonA) or pd.buttonJustPressed(pd.kButtonB) then
    mode = backTo
    if mode == "shelf" then toShelf() end
  end
end

-- ---- drawing ----

local function drawLines(lines, x, y)
  for _, line in ipairs(lines) do
    gfx.drawText(line, x, y)
    y = y + lineHeight
  end
end

local function drawWheel(entries, selected, y)
  local entry = entries[selected]
  if entry == nil then return end
  local label = entry.label
  if entry.greyed then
    gfx.setDitherPattern(0.5)
  end
  gfx.drawText("< " .. label .. " >", MARGIN, y)
  gfx.setDitherPattern(0)
  if entry.reason ~= nil then
    drawLines(Wrap.lines(entry.reason, 400 - 2 * MARGIN, measure), MARGIN, y + lineHeight)
  end
end

local function drawShelf()
  gfx.drawText("Shelf", MARGIN, 0)
  gfx.drawLine(0, HEADER - 1, 400, HEADER - 1)
  local total = #shelf.entries + 1
  local first = math.max(1, math.min(shelf.selected - 3, total - ROWS + 1))
  local y = HEADER + 2
  for i = first, math.min(total, first + ROWS - 1) do
    local entry = shelf.entries[i]
    if entry ~= nil and not entry.ok then gfx.setDitherPattern(0.5) end
    gfx.drawText((i == shelf.selected and "> " or "  ") .. (entry ~= nil and entry.title or "more worlds..."), MARGIN, y)
    gfx.setDitherPattern(0)
    y = y + lineHeight
  end
  gfx.drawLine(0, 240 - PANEL, 400, 240 - PANEL)
  local entry = shelf:current()
  local words = "A opens it"
  if entry ~= nil and not entry.ok then
    words = entry.reason or ""
  elseif shelf:onMore() then
    words = "A looks for more worlds to download."
    if shelf.moreNote ~= nil then
      words = "More worlds could not be fetched. " .. shelf.moreNote .. " Your shelf is as it was."
    elseif #shelf.entries == 0 then
      words = "No worlds are on the shelf. " .. words
    end
  end
  drawLines(Wrap.lines(words, 400 - 2 * MARGIN, measure), MARGIN, 240 - PANEL + 2)
end

local function drawDownloads()
  gfx.drawText("More worlds", MARGIN, 0)
  gfx.drawLine(0, HEADER - 1, 400, HEADER - 1)
  local rows = downloads:rows()
  local first = math.max(1, math.min(downloads.selected - 3, #rows - ROWS + 1))
  local y = HEADER + 2
  for i = first, math.min(#rows, first + ROWS - 1) do
    if rows[i].onShelf then gfx.setDitherPattern(0.5) end
    gfx.drawText((i == downloads.selected and "> " or "  ") .. rows[i].text, MARGIN, y)
    gfx.setDitherPattern(0)
    y = y + lineHeight
  end
  gfx.drawLine(0, 240 - PANEL, 400, 240 - PANEL)
  local words = downloads:panel()
  if downloads.phase == "failed" then
    words = words .. " A tries again, B goes back to the shelf."
  elseif downloads:busy() then
    words = words .. " B stops."
  end
  drawLines(Wrap.lines(words, 400 - 2 * MARGIN, measure), MARGIN, 240 - PANEL + 2)
end

local function drawNickname()
  gfx.drawText("Who are you in " .. opened.title .. "?", MARGIN, 0)
  gfx.drawLine(0, HEADER - 1, 400, HEADER - 1)
  local name = picker:current()
  gfx.drawText(name and ("< " .. name .. " >") or "No name is free.", MARGIN, 100)
  gfx.drawText("Crank or up/down to choose, A to enter, B to go back", MARGIN, 240 - lineHeight - 2)
end

local function drawReaderPanel()
  gfx.drawLine(0, 240 - PANEL, 400, 240 - PANEL)
  if mode == "sentence" then
    gfx.drawText(builder:phrase(), MARGIN, 240 - PANEL + 2)
    drawWheel(builder:entries(), builder.selected, 240 - PANEL + 2 + lineHeight)
  else
    gfx.drawText("A: build a sentence   crank: scroll back", MARGIN, 240 - PANEL + 2)
  end
end

local function drawMessage()
  drawLines(Wrap.lines(message, 400 - 2 * MARGIN, measure), MARGIN, 40)
  gfx.drawText("A to go on", MARGIN, 240 - lineHeight - 2)
end

-- ---- the loop ----

function pd.update()
  gfx.clear()
  if mode == "shelf" then
    updateShelf()
  elseif mode == "downloads" then
    updateDownloads()
  elseif mode == "nickname" then
    updateNickname()
  elseif mode == "reader" then
    updateReader()
  elseif mode == "sentence" then
    updateSentence()
  elseif mode == "message" then
    updateMessage()
  end
  if mode == "shelf" then
    drawShelf()
  elseif mode == "downloads" then
    drawDownloads()
  elseif mode == "nickname" then
    drawNickname()
  elseif mode == "reader" or mode == "sentence" then
    reader:draw(gfx, lineHeight)
    drawReaderPanel()
  elseif mode == "message" then
    drawMessage()
  end
end

-- The device sleeping or the app pausing owes no tick for the time away; the world is already
-- saved after every committed turn.
function pd.deviceWillSleep() clock:stop() end
function pd.deviceDidWake()
  if reader ~= nil then clock:start(seconds()) end
end
function pd.gameWillTerminate()
  if reader ~= nil then engine:close() end
end

pd.getSystemMenu():addMenuItem("leave world", function()
  if reader ~= nil then leave() end
end)

shelf:refresh()
