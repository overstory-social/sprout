local Reader = module("reader")
local wrap = module("wrap")
local test, same, equal = harness.test, harness.same, harness.equal

local function measure(text) return utf8.len(text) * 7 end

local function new(rows)
  return Reader.new({ wrap = wrap, measure = measure, width = 7 * 20, rows = rows or 4 })
end

local function texts(lines)
  local out = {}
  for i, line in ipairs(lines) do out[i] = line.text end
  return out
end

test("the newest line is at the bottom", function()
  local reader = new()
  reader:push("said", "one")
  reader:push("said", "two")
  reader:push("said", "three")
  same(texts(reader:visible()), { "one", "two", "three" })
  reader:push("said", "four")
  reader:push("said", "five")
  same(texts(reader:visible()), { "two", "three", "four", "five" })
end)

test("a paragraph is wrapped to the column", function()
  local reader = new(10)
  reader:push("told", "the quick brown fox jumps over the lazy dog")
  for _, line in ipairs(reader:visible()) do assert(measure(line.text) <= 7 * 20) end
  assert(#reader:visible() > 1)
end)

test("scrolling back shows older lines and stops at the first", function()
  local reader = new()
  for i = 1, 10 do reader:push("said", "line " .. i) end
  reader:scroll(2)
  same(texts(reader:visible()), { "line 5", "line 6", "line 7", "line 8" })
  reader:scroll(100)
  same(texts(reader:visible()), { "line 1", "line 2", "line 3", "line 4" })
  reader:scroll(-100)
  same(texts(reader:visible()), { "line 7", "line 8", "line 9", "line 10" })
  equal(reader:behind(), false)
end)

test("a reader who has scrolled back keeps their place when lines arrive", function()
  local reader = new()
  for i = 1, 10 do reader:push("said", "line " .. i) end
  reader:scroll(3)
  local before = texts(reader:visible())
  reader:push("said", "new")
  same(texts(reader:visible()), before)
  equal(reader:behind(), true)
  reader:toNewest()
  equal(texts(reader:visible())[4], "new")
end)

test("what a visitor chose and what was refused are told apart", function()
  local reader = new()
  reader:push("typed", "take -> pebble")
  reader:push("refused", "You can't.")
  same(texts(reader:visible()), { "> take -> pebble", "! You can't." })
end)

test("the oldest paragraphs fall off the top", function()
  local reader = new(2)
  for i = 1, Reader.KEEP + 5 do reader:push("said", "p" .. i) end
  equal(#reader.paragraphs, Reader.KEEP)
  equal(#reader.lines, Reader.KEEP)
  equal(reader.lines[1].text, "p6")
end)

test("the status is the place and its exits, as the TUI words it", function()
  equal(Reader.statusWords(nil), "")
  equal(Reader.statusWords({ place = "hall", here = {}, exits = {} }), "hall")
  equal(Reader.statusWords({ place = "hall", here = {}, exits = { "north", "to the yard" } }),
    "hall - exits: north, to the yard")
end)
