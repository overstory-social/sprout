local Sentence = module("sentence")
local test, equal, same = harness.test, harness.equal, harness.same

-- The view the engine gave a visitor standing in the chip_tree world's hall: the tree the builder walks.
local function view() return json.decode(fixture("chip-tree.view.json")) end

local function labels(builder)
  local out = {}
  for i, entry in ipairs(builder:entries()) do out[i] = entry.label end
  return out
end

-- Moves the wheel to the entry labelled `label` and picks it.
local function choose(builder, label)
  for i, entry in ipairs(builder:entries()) do
    if entry.label == label then
      builder.selected = i
      return builder:pick()
    end
  end
  error("no entry labelled " .. label .. " among " .. table.concat(labels(builder), ", "))
end

test("the verbs come first, as the view offers them, with their library left off", function()
  local builder = Sentence.new(view())
  same(labels(builder), { "juggle", "turn", "go", "look", "examine", "inventory", "wait", "help", "take", "drop", "give", "ask" })
  equal(builder:atStart(), true)
end)

test("ask, the guard, the weather builds the reading the engine takes", function()
  local builder = Sentence.new(view())
  choose(builder, "ask")
  same(labels(builder), { "a hall", "a guard", "a dial", "a pebble", "a shell" })
  choose(builder, "a guard")
  same(labels(builder), { "bridge", "toll", "weather" }, "the words the guard hears")
  choose(builder, "weather")
  equal(builder:phrase(), "ask -> a guard -> weather")
  local done, reading = choose(builder, "ask -> a guard -> weather")
  equal(done, "done")
  equal(reading.verb, "sprout.ask")
  same({ #reading.fillers }, { 2 })
  equal(reading.fillers[1].role, "target")
  equal(reading.fillers[1].binds, "object")
  equal(reading.fillers[1].id, "chip_tree.hall.guard")
  equal(reading.fillers[2].role, "topic")
  equal(reading.fillers[2].binds, "value")
  equal(reading.fillers[2].value, "weather")
end)

test("B steps back one pick at a time, to the verbs, and no further", function()
  local builder = Sentence.new(view())
  choose(builder, "ask")
  choose(builder, "a guard")
  choose(builder, "weather")
  equal(builder:back(), true)
  same(labels(builder), { "bridge", "toll", "weather" })
  equal(builder:back(), true)
  equal(labels(builder)[2], "a guard")
  equal(builder:back(), true)
  equal(labels(builder)[1], "juggle")
  equal(builder:atStart(), true)
  equal(builder:back(), false)
end)

test("going back puts the wheel where it was", function()
  local builder = Sentence.new(view())
  builder:move(3)
  local at = builder.selected
  builder:pick()
  equal(builder.selected, 1)
  builder:back()
  equal(builder.selected, at)
end)

test("a refused leaf is greyed with its reason and cannot be confirmed", function()
  local builder = Sentence.new(view())
  choose(builder, "give")
  choose(builder, "a dial")
  choose(builder, "a guard")
  local entry = builder:entries()[1]
  equal(entry.kind, "confirm")
  equal(entry.greyed, true)
  equal(entry.reason, "You are not holding a dial.")
  local done, reason = builder:pick()
  equal(done, "refused")
  equal(reason, "You are not holding a dial.")
  equal(builder:back(), true, "B steps back")
end)

test("a verb nothing under which can be done is greyed on the wheel", function()
  local builder = Sentence.new(view())
  local greyed = {}
  for _, entry in ipairs(builder:entries()) do
    if entry.greyed then greyed[#greyed + 1] = entry.label end
  end
  same(greyed, { "drop", "give" }, "nothing is carried, so nothing can be dropped or given")
end)

test("a set role is joined from the singletons the view offers", function()
  local builder = Sentence.new(view())
  choose(builder, "juggle")
  equal(choose(builder, "a guard"), nil)
  same(labels(builder), { "and a hall", "and a dial", "and a pebble", "and a shell", "that's all" },
    "the others, and not the guard again")
  choose(builder, "and a dial")
  same(labels(builder), { "and a hall", "and a pebble", "and a shell", "that's all" })
  equal(builder:phrase(), "juggle -> a guard, a dial")
  choose(builder, "that's all")
  local done, reading = choose(builder, "juggle -> a guard, a dial")
  equal(done, "done")
  equal(reading.verb, "chip_tree.juggle")
  equal(reading.fillers[1].role, "things")
  equal(reading.fillers[1].binds, "set")
  same(reading.fillers[1].ids, { "chip_tree.hall.guard", "chip_tree.hall.dial" })
end)

test("a set of one is a set", function()
  local builder = Sentence.new(view())
  choose(builder, "juggle")
  choose(builder, "a pebble")
  choose(builder, "that's all")
  local _, reading = choose(builder, "juggle -> a pebble")
  same(reading.fillers[1].ids, { "chip_tree.hall.pebble" })
end)

test("a number role is turned on the crank within the range", function()
  local builder = Sentence.new(view())
  choose(builder, "turn")
  choose(builder, "a dial")
  equal(builder:entries()[1].kind, "number")
  equal(builder:entries()[1].label, "0")
  builder:turn(Sentence.DEGREES_PER_STEP * 3)
  equal(builder:entries()[1].label, "3")
  builder:turn(-Sentence.DEGREES_PER_STEP * 100)
  equal(builder:entries()[1].label, "0", "the lowest")
  builder:nudge(100)
  equal(builder:entries()[1].label, "9", "the highest")
  builder:addNumber(-1, true)
  equal(builder:entries()[1].label, "0", "a big step past the end goes to the end")
  builder:nudge(4)
  choose(builder, "4")
  local done, reading = choose(builder, "turn -> a dial -> 4")
  equal(done, "done")
  equal(reading.fillers[2].role, "notch")
  equal(reading.fillers[2].binds, "value")
  equal(reading.fillers[2].value, 4)
end)

test("a number role of several ranges skips what it does not take", function()
  local tree = {
    chips = { { verb = "x.count", next = { choices = {}, leaf = { typed = "count", options = {
      { role = "n", takes = "integer", ranges = { { min = 0, max = 2 }, { min = 10, max = 12 } } } } } } } },
  }
  local builder = Sentence.new(tree)
  choose(builder, "count")
  builder:nudge(3)
  equal(builder:entries()[1].label, "10")
  builder:nudge(-1)
  equal(builder:entries()[1].label, "2")
end)

test("a value role nothing hears is greyed and says so", function()
  local builder = Sentence.new(view())
  choose(builder, "ask")
  choose(builder, "a dial")
  local entry = builder:entries()[1]
  equal(entry.greyed, true)
  equal(entry.kind, "none")
  local done, reason = builder:pick()
  equal(done, "refused")
  assert(#reason > 0)
end)

test("a way out is offered by its direction and sent whole", function()
  local builder = Sentence.new(view())
  choose(builder, "go")
  same(labels(builder), { "north" })
  choose(builder, "north")
  local _, reading = choose(builder, "go -> north")
  equal(reading.fillers[1].binds, "exit")
  equal(reading.fillers[1].direction, "north")
  equal(reading.fillers[1].to, "chip_tree.yard")
end)

test("a verb with no roles confirms at once", function()
  local builder = Sentence.new(view())
  choose(builder, "look")
  local done, reading = choose(builder, "look")
  equal(done, "done")
  equal(reading.verb, "sprout.look")
  same(reading.fillers, {})
end)

test("the crank moves the wheel a step for each stretch of degrees and wraps", function()
  local builder = Sentence.new(view())
  builder:turn(Sentence.DEGREES_PER_STEP - 1)
  equal(builder.selected, 1)
  builder:turn(2)
  equal(builder.selected, 2)
  builder.crank = 0
  builder:turn(-Sentence.DEGREES_PER_STEP * 2)
  equal(builder.selected, #builder:entries())
  builder:move(1)
  equal(builder.selected, 1)
end)

test("the reading built is the same whichever way the visitor got there", function()
  local first = Sentence.new(view())
  choose(first, "take")
  choose(first, "a pebble")
  local _, a = choose(first, "take -> a pebble")
  local second = Sentence.new(view())
  choose(second, "take")
  choose(second, "a dial")
  second:back()
  choose(second, "a pebble")
  local _, b = choose(second, "take -> a pebble")
  equal(json.encode(a), json.encode(b))
end)

test("a member of a set whose own reading is refused is greyed, with its reason, and refuses the set", function()
  local function node(typed, refused)
    return { choices = {}, leaf = { typed = typed, refused = refused, options = {} } }
  end
  local function single(id, name, refused)
    return {
      filler = { role = "things", binds = "set", ids = { id }, names = { name } },
      next = node("juggle " .. name, refused),
    }
  end
  local builder = Sentence.new({
    chips = { { verb = "x.juggle", next = { choices = {
      single("a", "a pebble"), single("b", "a stove", { "It is too hot to touch." }), single("c", "a shell") },
      leaf = nil } } },
  })
  choose(builder, "juggle")
  choose(builder, "a pebble")
  local greyed
  for _, entry in ipairs(builder:entries()) do
    if entry.label == "and a stove" then greyed = entry end
  end
  equal(greyed.greyed, true)
  equal(greyed.reason, "It is too hot to touch.")
  choose(builder, "and a stove")
  choose(builder, "that's all")
  local confirm = builder:entries()[1]
  equal(confirm.greyed, true)
  equal(confirm.reason, "a stove: It is too hot to touch.")
  local done, reason = builder:pick()
  equal(done, "refused")
  equal(reason, "a stove: It is too hot to touch.")
  -- Without the stove the set is fine.
  builder:back()
  builder:back()
  choose(builder, "and a shell")
  choose(builder, "that's all")
  equal(builder:entries()[1].greyed, false)
end)

test("going back out of a set forgets the members picked since", function()
  local builder = Sentence.new(view())
  choose(builder, "juggle")
  choose(builder, "a guard")
  choose(builder, "and a dial")
  builder:back()
  same(labels(builder), { "and a hall", "and a dial", "and a pebble", "and a shell", "that's all" })
  equal(builder:phrase(), "juggle -> a guard")
end)

test("a reading binds the roles a thing fills first and its value roles after, as a parsed line does", function()
  local tree = {
    chips = { { verb = "x.tune", next = { choices = { {
      filler = { role = "knob", binds = "object", id = "w.dial", name = "a dial" },
      next = { choices = {}, leaf = { typed = "tune … on dial", options = {
        { role = "notch", takes = "integer", ranges = { { min = 0, max = 9 } } } } } },
    } } } } },
  }
  local builder = Sentence.new(tree)
  choose(builder, "tune")
  choose(builder, "a dial")
  builder:nudge(4)
  choose(builder, "4")
  local done, reading = choose(builder, "tune -> a dial -> 4")
  equal(done, "done")
  equal(reading.fillers[1].role, "knob")
  equal(reading.fillers[1].id, "w.dial")
  equal(reading.fillers[2].role, "notch")
  equal(reading.fillers[2].value, 4)
end)
