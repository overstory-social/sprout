-- main.lua driven frame by frame over a stand-in `playdate` and a stand-in engine: the shelf, the
-- nickname picker, the reader and the sentence builder wired together as they run on the
-- device, with what each frame draws captured. It finds the errors the pieces' own tests cannot:
-- a name the wiring got wrong, a mode that does not lead to the next.

local test, equal, same = harness.test, harness.equal, harness.same

local function run(scenario, options)
  options = options or {}
  -- the Playdate
  local drawn, pressed, calls, seconds = {}, {}, {}, 1000
  local played, crank = {}, 0
  -- the sounds: synths that record the pitch of each note
  local sound = { kWaveNoise = 1, kWaveSquare = 2, kWaveTriangle = 3, kWaveSawtooth = 4 }
  sound.synth = { new = function() return {
    setADSR = function() end,
    playNote = function(_, pitch) played[#played + 1] = pitch end,
  } end }
  local failing = false
  local menu = {}
  local font = {
    getHeight = function() return 14 end,
    getTextWidth = function(_, text) return utf8.len(text) * 6 end,
  }
  local gfx = {
    getSystemFont = function() return font end,
    font = { new = function() return font end },
    setFont = function() end,
    clear = function() drawn = {} end,
    drawText = function(text) drawn[#drawn + 1] = text end,
    drawLine = function() end,
    fillTriangle = function() end,
    setDitherPattern = function() end,
    image = { new = function(name)
      if options.pictures == nil or options.pictures[name] == nil then return nil end
      return {
        getSize = function() return 100, 60 end,
        draw = function() drawn[#drawn + 1] = "[picture " .. name .. "]" end,
        drawScaled = function() drawn[#drawn + 1] = "[picture " .. name .. "]" end,
      }
    end },
  }
  local buttons = { kButtonA = "A", kButtonB = "B", kButtonUp = "Up", kButtonDown = "Down", kButtonLeft = "Left", kButtonRight = "Right" }
  _G.playdate = {
    graphics = gfx,
    display = { setRefreshRate = function() end },
    file = {
      listFiles = function(path) return path == "/" and (options.files or { "chip-tree.sproutworld" }) or nil end,
      exists = function(path) return options.pictures ~= nil and options.pictures[path] ~= nil end,
    },
    network = options.network,
    getSecondsSinceEpoch = function() return seconds end,
    sound = sound,
    isCrankDocked = function() return false end,
    getCrankChange = function() local change = crank; crank = 0; return change end,
    buttonJustPressed = function(button) return pressed[button] == true end,
    getSystemMenu = function() return { addMenuItem = function(_, title, fn) menu[title] = fn end } end,
  }
  for key, value in pairs(buttons) do playdate[key] = value end

  -- the engine
  local view = fixture(options.view or "chip-tree.view.json")
  _G.sprout = {
    inspect = function(path) calls[#calls + 1] = "inspect " .. path; return '{"ok":true,"name":"chip_tree","reason":null}' end,
    open = function() return '{"ok":true,"name":"chip_tree","hash":"abc","words":["guard","hall"]}' end,
    load = function() return '{"ok":true,"fresh":true,"nickname":null,"present":[],"last":0,"recovered":false,"words":""}' end,
    admit = function(name)
      calls[#calls + 1] = "admit " .. name
      return '{"admitted":true,"words":"","visit":"visit:player","lines":[{"reader":"visit:player","kind":"described","text":"There is nothing special about a hall."}]}'
    end,
    view = function() return view end,
    turn = function(reading)
      calls[#calls + 1] = "turn " .. reading
      return '{"committed":true,"result":"done","words":null,"saved":' .. tostring(not failing)
        .. ',"lines":[{"reader":"visit:player","kind":"said","text":"The guard nods."}]}'
    end,
    tick = function() calls[#calls + 1] = "tick"; return '{"ran":true,"lines":[{"reader":"visit:player","kind":"told","text":"A gust."}]}' end,
    save = function()
      calls[#calls + 1] = "save"
      return failing and '{"ok":false,"words":"No room."}' or '{"ok":true,"words":""}'
    end,
    close = function() calls[#calls + 1] = "close"; return '{"lines":[]}' end,
  }

  local imported = {}
  _G.import = function(name)
    if imported[name] then return nil end
    imported[name] = true
    -- the public key is written by the build, not kept in the source
    if name == "publickey" then return string.rep("0", 64) end
    return dofile(arg[0]:match("^(.*)/[^/]*$") .. "/../Source/" .. name .. ".lua")
  end
  dofile(arg[0]:match("^(.*)/[^/]*$") .. "/../Source/main.lua")

  local session = {}
  function session.frame(...)
    pressed = {}
    for _, button in ipairs({ ... }) do pressed[button] = true end
    playdate.update()
  end
  function session.shows(text)
    for _, one in ipairs(drawn) do
      if one:find(text, 1, true) then return true end
    end
    return false
  end
  function session.failSaves(value) failing = value end
  function session.crank(degrees) crank = degrees end
  function session.played() return played end
  function session.at(seconds_) seconds = seconds_ end
  function session.calls() return calls end
  function session.menu() return menu end
  scenario(session)
end

local function count(calls, prefix)
  local n = 0
  for _, one in ipairs(calls) do
    if one:sub(1, #prefix) == prefix then n = n + 1 end
  end
  return n
end

test("the shelf lists the cartridge, A opens it, a name is picked, and the reader opens", function()
  run(function(play)
    play.frame()
    equal(play.shows("Chip Tree"), true, "the shelf lists the world")
    play.frame("A")
    equal(play.shows("Who are you in Chip Tree?"), true, "the nickname picker")
    play.frame("A")
    equal(count(play.calls(), "admit "), 1)
    equal(play.shows("There is nothing special about a hall."), true, "the arrival is in the transcript")
    equal(play.shows("a hall - exits: north"), true, "the status line names the place as the visitor reads it")
  end)
end)

test("more worlds is the last row of the shelf; with no Wi-Fi it says so, and B returns to a shelf that says what happened", function()
  run(function(play)
    play.frame()
    play.frame("Down")
    equal(play.shows("more worlds..."), true, "the row is listed")
    equal(play.shows("A looks for more worlds to download."), true, "and says what A does")
    play.frame("A")
    equal(play.shows("More worlds"), true, "the download screen")
    equal(play.shows("No Wi-Fi network is set up"), true, "says why nothing can be fetched")
    play.frame("B")
    equal(play.shows("Chip Tree"), true, "the shelf still lists what it has")
    equal(play.shows("More worlds could not be fetched. No Wi-Fi network is set up"), true, "and what happened")
    play.frame("Up")
    play.frame("A")
    equal(play.shows("Who are you in Chip Tree?"), true, "a world still opens")
  end, { network = { kStatusNotAvailable = "n/a", getStatus = function() return "n/a" end, http = {} } })
end)

test("a Playdate with no network support says to update it, and an empty shelf still offers more worlds", function()
  run(function(play)
    play.frame()
    equal(play.shows("more worlds..."), true)
    play.frame("A")
    equal(play.shows("This Playdate's system software has no network support."), true)
  end, { files = {} })
end)

test("a picture the place's description records is drawn above the transcript, with its caption", function()
  run(function(play)
    play.frame()
    play.frame("A")
    play.frame("A")
    equal(play.shows("[picture chip-tree.sproutworld.assets/pictures/cabinet]"), true, "the newest picture is drawn")
    equal(play.shows("an oak cabinet, its doors shut"), true, "with its caption under it")
    equal(play.shows("There is nothing special about a hall."), true, "and the transcript still reads")
  end, {
    view = "media-room.view.json",
    pictures = {
      ["chip-tree.sproutworld.assets/cellar"] = true,
      ["chip-tree.sproutworld.assets/pictures/cabinet"] = true,
    },
  })
end)

test("a world whose picture is not there reads as text alone", function()
  run(function(play)
    play.frame()
    play.frame("A")
    play.frame("A")
    equal(play.shows("[picture"), false)
    equal(play.shows("There is nothing special about a hall."), true)
  end, { view = "media-room.view.json", pictures = {} })
end)

test("ask, the guard, the weather is built on the wheel and sent to the engine", function()
  run(function(play)
    play.frame()
    play.frame("A")
    play.frame("A")
    play.frame("A") -- build a sentence
    equal(play.shows("juggle"), true, "the first verb")
    for _ = 1, 11 do play.frame("Down") end
    equal(play.shows("ask"), true)
    play.frame("A")
    play.frame("Down")
    equal(play.shows("a guard"), true)
    play.frame("A")
    play.frame("Down")
    play.frame("Down")
    equal(play.shows("weather"), true)
    play.frame("A")
    equal(play.shows("ask -> a guard -> weather"), true, "the sentence to confirm")
    play.frame("A")
    local sent = nil
    for _, one in ipairs(play.calls()) do
      if one:sub(1, 5) == "turn " then sent = json.decode(one:sub(6)) end
    end
    assert(sent ~= nil, "no turn was sent")
    equal(sent.verb, "sprout.ask")
    equal(sent.fillers[1].id, "chip_tree.hall.guard")
    equal(sent.fillers[2].value, "weather")
    equal(play.shows("The guard nods."), true, "what the engine told")
    equal(play.shows("> ask -> a guard -> weather"), true, "what was chosen")
  end)
end)

test("a poll that faulted offers nothing, and A shows what it said instead of a blank wheel", function()
  run(function(play)
    play.frame()
    play.frame("A") -- open the world
    play.frame("A") -- take the name
    play.frame("A") -- build a sentence
    equal(play.shows("Something here is too much to take in."), true, "the fault is told")
    equal(play.shows("A to go on"), true, "as a message")
    play.frame("A")
    equal(play.shows("A: build a sentence"), true, "back in the reader")
  end, { view = "faulted.view.json" })
end)

test("the wheel shows the words around the selected one, ticks as the crank turns it, and clacks as it settles", function()
  run(function(play)
    play.frame()
    play.frame("A")
    play.frame("A")
    play.frame("A") -- build a sentence
    equal(play.shows("juggle"), true, "the selected verb, in the window")
    equal(play.shows("turn"), true, "the next one below")
    equal(play.shows("ask"), true, "the last one above, since the drum wraps")
    equal(play.shows("examine"), false, "the fourth is beyond the drum's edge")
    equal(play.shows("the crank turns the wheel"), true, "the keys")
    play.crank(30)
    play.frame()
    same(play.played(), { 3000 }, "a step of the crank ticks")
    for _ = 1, 20 do play.frame() end
    same(play.played(), { 3000, 160 }, "the drum settles with a clack once the crank rests")
    play.frame("Down")
    play.frame("A")
    play.frame("B")
    same(play.played(), { 3000, 160, 3000, 660, 392 }, "the d-pad ticks, a pick and a step back each sound")
  end)
end)

test("B steps back out of the builder to the reader", function()
  run(function(play)
    play.frame()
    play.frame("A")
    play.frame("A")
    play.frame("A")
    play.frame("A") -- the first verb
    play.frame("B")
    play.frame("B")
    equal(play.shows("A: build a sentence"), true, "the reader's hint")
    equal(count(play.calls(), "turn "), 0)
  end)
end)

test("a tick is asked for only while the reader is open", function()
  run(function(play)
    play.at(1000)
    play.frame()
    play.at(1500)
    play.frame()
    equal(count(play.calls(), "tick"), 0, "never on the shelf")
    play.frame("A")
    play.frame("A")
    play.at(1500 + 9)
    play.frame()
    equal(count(play.calls(), "tick"), 0, "not yet")
    play.at(1500 + 10)
    play.frame()
    equal(count(play.calls(), "tick"), 1, "when it is due")
    equal(play.shows("A gust."), true, "what the tick told")
    play.at(1500 + 5)
    play.frame()
    equal(count(play.calls(), "tick"), 1, "a clock set back owes nothing")
  end)
end)

test("leaving the world from the menu closes it and shows the shelf", function()
  run(function(play)
    play.frame()
    play.frame("A")
    play.frame("A")
    play.menu()["leave world"]()
    play.frame()
    equal(count(play.calls(), "close"), 1)
    equal(play.shows("Shelf"), true)
  end)
end)

test("a save that cannot be written stops play, says so, and greys the world until it can be", function()
  run(function(play)
    play.frame()
    play.frame("A")
    play.frame("A")
    play.frame("A") -- build a sentence
    play.frame("Down")
    play.frame("Down")
    play.frame("Down") -- look
    play.frame("A")
    play.failSaves(true)
    play.frame("A") -- confirm
    equal(play.shows("The save could not be written"), true, "the words are on the screen")
    equal(count(play.calls(), "close"), 1, "the world is let go")
    play.frame("A")
    equal(play.shows("Shelf"), true)
    equal(play.shows("stays greyed"), true, "the shelf says why the world is greyed")
    play.frame("A") -- try to open it: the save still cannot be written
    equal(play.shows("The save could not be written"), true)
    play.frame("A")
    equal(play.shows("Who are you"), false)
    play.failSaves(false)
    play.frame("A") -- now it can
    equal(play.shows("Who are you in Chip Tree?"), true)
  end)
end)
