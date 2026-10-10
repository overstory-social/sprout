local Nickname = module("nickname")
local test, equal, same = harness.test, harness.equal, harness.same

test("a nickname is folded as the TypeScript host folds it: lower case, split on white space", function()
  same(Nickname.fold("  Old   MOSS\tFern "), { "old", "moss", "fern" })
end)

test("a name that is a word of the cartridge is not offered", function()
  local words = { "guard", "hall", "north", "the" }
  local available = Nickname.available({ "Guard", "Moss", "Hall", "Wren" }, words, {})
  same(available, { "Moss", "Wren" })
end)

test("the collision is found by the folded word, however the name is written", function()
  local set = Nickname.setOf({ "pebble" })
  equal(Nickname.collision("PEBBLE", set), "pebble")
  equal(Nickname.collision("Big Pebble", set), "pebble")
  equal(Nickname.collision("Moss", set), nil)
end)

test("a name held by someone present is not offered, however it was typed", function()
  local available = Nickname.available({ "Moss", "Wren", "Fern" }, {}, { "moss", "  WREN " })
  same(available, { "Fern" })
end)

test("a name longer than the host's bound is not offered", function()
  local long = string.rep("a", Nickname.MAX + 1)
  same(Nickname.available({ long, "Moss" }, {}, {}), { "Moss" })
end)

test("every name in the pool is a plain word of no more than the bound", function()
  for _, name in ipairs(Nickname.POOL) do
    assert(name:match("^%a+$"), name)
    assert(#name <= Nickname.MAX, name)
  end
end)

test("a returning visitor is offered their old name first, if it is still free", function()
  local picker = Nickname.new({ "Fern", "Moss", "Wren" }, "moss")
  equal(picker:current(), "Moss")
  local other = Nickname.new({ "Fern", "Wren" }, "Moss")
  equal(other:current(), "Fern")
end)

test("the wheel moves by the crank and wraps", function()
  local picker = Nickname.new({ "Fern", "Moss", "Wren" })
  picker:turn(10, 24)
  equal(picker:current(), "Fern")
  picker:turn(15, 24)
  equal(picker:current(), "Moss")
  picker:turn(-48, 24)
  equal(picker:current(), "Fern", "two steps back from Moss")
  picker:move(-1)
  equal(picker:current(), "Wren")
end)

test("no name free is no name", function()
  local picker = Nickname.new(Nickname.available({ "Moss" }, { "moss" }, {}))
  equal(picker:current(), nil)
  picker:move(1)
  equal(picker:current(), nil)
end)
