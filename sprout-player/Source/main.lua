-- sprout-player: the shelf, the nickname picker, the reader and the sentence builder, drawn
-- at 30 frames a second on the 400 x 240 screen. The engine is the C code registered as
-- `sprout`; every call to it goes through `engine.lua`. Ticks are asked for only while the
-- reader is open, never on the shelf, and not while the device sleeps.

local Wrap <const> = import "wrap"
local Clock <const> = import "clock"
local Reader <const> = import "reader"
local Sentence <const> = import "sentence"
local Nickname <const> = import "nickname"
local Shelf <const> = import "shelf"
local Engine <const> = import "engine"
import "images"

local pd <const> = playdate
local gfx <const> = pd.graphics

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
local notice = nil -- what opening the world has to tell the visitor before they come in
local mode = "shelf" -- shelf, nickname, reader, sentence, message
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

local function refreshStatus()
  local view = engine:view()
  local here = {}
  for _, one in ipairs(view.occupants) do here[#here + 1] = one.name end
  local exits = {}
  for _, one in ipairs(view.exits) do exits[#exits + 1] = one.direction or one.label end
  reader:setStatus(view.place, here, exits)
  return view
end

local function told(lines)
  for _, line in ipairs(lines or {}) do reader:push(line.kind, line.text) end
end

local function toShelf()
  shelf:refresh()
  mode, opened, reader, builder, picker = "shelf", nil, nil, nil, nil
  clock:stop()
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
  opened = entry
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
  if not admission.admitted then
    showMessage(admission.words, "nickname")
    return
  end
  reader = newReader()
  reader:push("client", "You are in " .. opened.title .. " as " .. name .. ".")
  if notice ~= nil then reader:push("notice", notice) end
  told(admission.lines)
  refreshStatus()
  clock:start(seconds())
  mode = "reader"
end

local function leave()
  local left = engine:close()
  if reader ~= nil then told(left.lines) end
  toShelf()
end

local function buildSentence()
  builder = Sentence.new(refreshStatus())
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
  told(result.lines)
  refreshStatus()
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
    local entry = shelf:current()
    if entry == nil then return end
    if not entry.ok then
      showMessage(entry.reason, "shelf")
    else
      openWorld(entry)
    end
  end
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
    if #(ticked.lines or {}) > 0 then
      told(ticked.lines)
      refreshStatus()
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
  if #shelf.entries == 0 then
    drawLines(Wrap.lines("No worlds. Put .sproutworld files in the app's worlds folder, or its Data folder.",
      400 - 2 * MARGIN, measure), MARGIN, HEADER + 2)
    return
  end
  local first = math.max(1, math.min(shelf.selected - 3, #shelf.entries - ROWS + 1))
  local y = HEADER + 2
  for i = first, math.min(#shelf.entries, first + ROWS - 1) do
    local entry = shelf.entries[i]
    if not entry.ok then gfx.setDitherPattern(0.5) end
    gfx.drawText((i == shelf.selected and "> " or "  ") .. entry.title, MARGIN, y)
    gfx.setDitherPattern(0)
    y = y + lineHeight
  end
  local entry = shelf:current()
  gfx.drawLine(0, 240 - PANEL, 400, 240 - PANEL)
  if entry ~= nil and not entry.ok then
    drawLines(Wrap.lines(entry.reason or "", 400 - 2 * MARGIN, measure), MARGIN, 240 - PANEL + 2)
  else
    gfx.drawText("A opens it", MARGIN, 240 - PANEL + 2)
  end
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
