local Shelf = module("shelf")
local test, equal, same = harness.test, harness.equal, harness.same

-- A file system with the listings a Playdate gives: the bundle's and the Data folder's together.
local function files(listings)
  return { listFiles = function(path) return listings[path] end }
end

-- An engine that inspects by a table, and counts the questions.
local function engine(verdicts)
  local asked = {}
  return {
    asked = asked,
    inspect = function(_, path)
      asked[#asked + 1] = path
      return verdicts[path] or { ok = false, name = nil, reason = "No verdict." }
    end,
  }
end

test("cartridges in the root and in worlds/ are listed, once each, by name", function()
  local shelf = Shelf.new(files({
    ["/"] = { "b.sproutworld", "notes.txt", "worlds/" },
    ["worlds/"] = { "a.sproutworld", "b.sproutworld" },
  }), engine({
    ["b.sproutworld"] = { ok = true, name = "bee" },
    ["worlds/a.sproutworld"] = { ok = true, name = "ay" },
    ["worlds/b.sproutworld"] = { ok = true, name = "bee too" },
  }))
  shelf:refresh()
  local paths = {}
  for i, entry in ipairs(shelf.entries) do paths[i] = entry.path end
  same(paths, { "b.sproutworld", "worlds/a.sproutworld", "worlds/b.sproutworld" })
end)

test("a cartridge the engine refuses is greyed with the engine's reason", function()
  local shelf = Shelf.new(files({ ["worlds/"] = { "big.sproutworld" } }), engine({
    ["worlds/big.sproutworld"] = { ok = false, name = "big", reason = "This world was published allowing 12 exits on one place." },
  }))
  shelf:refresh()
  local entry = shelf:current()
  equal(entry.ok, false)
  equal(entry.title, "big")
  equal(entry.reason, "This world was published allowing 12 exits on one place.")
end)

test("a cartridge the engine cannot even read is titled by its file", function()
  local shelf = Shelf.new(files({ ["worlds/"] = { "broken.sproutworld" } }), engine({
    ["worlds/broken.sproutworld"] = { ok = false, reason = "This is not a Sprout cartridge." },
  }))
  shelf:refresh()
  equal(shelf:current().title, "broken")
end)

test("a cartridge is inspected once until the shelf forgets", function()
  local inspector = engine({ ["worlds/a.sproutworld"] = { ok = true, name = "ay" } })
  local shelf = Shelf.new(files({ ["worlds/"] = { "a.sproutworld" } }), inspector)
  shelf:refresh()
  shelf:refresh()
  equal(#inspector.asked, 1)
  shelf:forget()
  shelf:refresh()
  equal(#inspector.asked, 2)
end)

test("an empty shelf has nothing to open and the wheel does not fail", function()
  local shelf = Shelf.new(files({}), engine({}))
  shelf:refresh()
  equal(shelf:current(), nil)
  shelf:move(1)
  shelf:turn(100, 24)
  equal(shelf:current(), nil)
end)

test("the crank moves down the shelf and wraps", function()
  local shelf = Shelf.new(files({ ["worlds/"] = { "a.sproutworld", "b.sproutworld" } }), engine({
    ["worlds/a.sproutworld"] = { ok = true, name = "a" },
    ["worlds/b.sproutworld"] = { ok = true, name = "b" },
  }))
  shelf:refresh()
  equal(shelf:current().title, "a")
  shelf:turn(30, 24)
  equal(shelf:current().title, "b")
  shelf:turn(30, 24)
  equal(shelf:current().title, "a")
end)
