local wrap = module("wrap")
local test, same, equal = harness.test, harness.same, harness.equal

-- Seven pixels a character, as a font that is not fixed-width would not be; the column is in pixels.
local function measure(text) return utf8.len(text) * 7 end

test("a paragraph is cut at spaces so no line is wider than the column", function()
  local lines = wrap.lines("the quick brown fox jumps over the lazy dog", 7 * 15, measure)
  same(lines, { "the quick brown", "fox jumps over", "the lazy dog" })
  for _, line in ipairs(lines) do assert(measure(line) <= 7 * 15, line) end
end)

test("a line that fits stays whole", function()
  same(wrap.lines("hello there", 400, measure), { "hello there" })
end)

test("a newline starts a new line and a blank line is kept", function()
  same(wrap.lines("one\n\ntwo", 400, measure), { "one", "", "two" })
end)

test("a word wider than the column is cut between characters", function()
  local lines = wrap.lines("abcdefghijklmnop", 7 * 5, measure)
  same(lines, { "abcde", "fghij", "klmno", "p" })
end)

test("a long word after a short one starts its own line", function()
  same(wrap.lines("go abcdefghij", 7 * 5, measure), { "go", "abcde", "fghij" })
end)

test("characters are never split inside a code point", function()
  local lines = wrap.lines("aaaa\u{2026}\u{2026}\u{2026}", 7 * 5, measure)
  for _, line in ipairs(lines) do assert(utf8.len(line) ~= nil, "valid UTF-8") end
  equal(table.concat(lines), "aaaa\u{2026}\u{2026}\u{2026}")
end)

test("text with no words is one empty line", function()
  same(wrap.lines("", 100, measure), { "" })
end)
