-- main.lua driven frame by frame over a stand-in `playdate` and a stand-in engine: the shelf, the
-- nickname picker, the reader and the sentence builder wired together as they run on the
-- device, with what each frame draws captured. It finds the errors the pieces' own tests cannot:
-- a name the wiring got wrong, a mode that does not lead to the next.

local test, equal = harness.test, harness.equal

local function run(scenario)
  -- the Playdate
  local drawn, pressed, calls, seconds = {}, {}, {}, 1000
  local menu = {}
  local font = {
    getHeight = function() return 14 end,
    getTextWidth = function(_, text) return utf8.len(text) * 6 end,
  }
  local gfx = {
    getSystemFont = function() return font end,
    setFont = function() end,
    clear = function() drawn = {} end,
    drawText = function(text) drawn[#drawn + 1] = text end,
    drawLine = function() end,
    setDitherPattern = function() end,
  }
  local buttons = { kButtonA = "A", kButtonB = "B", kButtonUp = "Up", kButtonDown = "Down", kButtonLeft = "Left", kButtonRight = "Right" }
  _G.playdate = {
    graphics = gfx,
    display = { setRefreshRate = function() end },
    file = { listFiles = function(path) return path == "/" and { "chip-tree.sproutworld" } or nil end },
    getSecondsSinceEpoch = function() return seconds end,
    isCrankDocked = function() return true end,
    getCrankChange = function() return 0 end,
    buttonJustPressed = function(button) return pressed[button] == true end,
    getSystemMenu = function() return { addMenuItem = function(_, title, fn) menu[title] = fn end } end,
  }
  for key, value in pairs(buttons) do playdate[key] = value end

  -- the engine
  local view = fixture("chip-tree.view.json")
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
      return '{"committed":true,"result":"done","words":null,"lines":[{"reader":"visit:player","kind":"said","text":"The guard nods."}]}'
    end,
    tick = function() calls[#calls + 1] = "tick"; return '{"ran":true,"lines":[{"reader":"visit:player","kind":"told","text":"A gust."}]}' end,
    save = function() return '{"ok":true,"words":""}' end,
    close = function() calls[#calls + 1] = "close"; return '{"lines":[]}' end,
  }

  local imported = {}
  _G.import = function(name)
    if imported[name] then return nil end
    imported[name] = true
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
    equal(play.shows("chip_tree"), true, "the shelf lists the world")
    play.frame("A")
    equal(play.shows("Who are you in chip_tree?"), true, "the nickname picker")
    play.frame("A")
    equal(count(play.calls(), "admit "), 1)
    equal(play.shows("There is nothing special about a hall."), true, "the arrival is in the transcript")
    equal(play.shows("chip_tree.hall - exits: north"), true, "the status line")
  end)
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
