local Canonical = module("canonical")
local test, equal = harness.test, harness.equal

test("objects are written with sorted keys, no spaces, and strings escaped as JSON.stringify escapes them", function()
  equal(Canonical.text({ b = 1, a = { "x", 2 }, c = "q\"b\\n\n\t\1é" }),
    '{"a":["x",2],"b":1,"c":"q\\"b\\\\n\\n\\t\\u0001é"}')
end)

test("a whole number held as a float is written as an integer", function()
  equal(Canonical.text({ n = 3.0, big = 26989 }), '{"big":26989,"n":3}')
end)

test("an empty table is an empty array", function()
  equal(Canonical.text({}), "[]")
  equal(Canonical.text({ list = {} }), '{"list":[]}')
end)

test("a value with no canonical text is refused with a reason", function()
  local text, reason = Canonical.text({ n = 1.5 })
  equal(text, nil)
  equal(reason, "a number that is not an integer has no canonical text")
  text, reason = Canonical.text({ f = print })
  equal(text, nil)
  equal(reason, "a function has no canonical text")
  text, reason = Canonical.text({ [1] = "a", x = "b" })
  equal(text, nil)
  equal(reason, "an object key that is not text has no canonical text")
end)

test("the text Lua writes for the signed index is the text Node signed", function()
  local index = json.decode(fixture("index.json"))
  equal(Canonical.text(index.worlds), fixture("index.canonical.txt"))
end)
