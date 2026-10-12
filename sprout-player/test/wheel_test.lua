local Wheel = module("wheel")
local Sentence = module("sentence")
local test, equal, same = harness.test, harness.equal, harness.same

-- The view the engine gave a visitor in the chip_tree world's hall, for a builder with words on it.
local levels = helper("levels")
local function view() return levels(json.decode(fixture("chip-tree.view.json")).chips) end

local function words(n)
  local out = {}
  for i = 1, n do out[i] = { label = "word" .. i } end
  return out
end

local function labels(rows)
  local out = {}
  for i, row in ipairs(rows) do out[i] = row.entry.label end
  return out
end

test("the selected word is at the front, its neighbours above and below, far to near", function()
  local rows = Wheel.rows(words(12), 3, 0)
  same(labels(rows), { "word1", "word5", "word2", "word4", "word3" })
  local front = rows[#rows]
  equal(front.tier, "front")
  equal(front.y, 0)
  equal(rows[4].tier, "near")
  equal(rows[4].y, 41, "a slat a step below sits lower by the drum's sine")
  equal(rows[3].y, -41)
  equal(rows[1].tier, "far")
  equal(rows[1].y, -67)
end)

test("the drum wraps, so the last word sits above the first", function()
  same(labels(Wheel.rows(words(5), 1, 0)), { "word4", "word3", "word5", "word2", "word1" })
end)

test("a word is placed once, where it is nearest, and alone where it is the only one", function()
  same(labels(Wheel.rows(words(2), 1, 0)), { "word2", "word1" })
  same(labels(Wheel.rows(words(3), 2, 0)), { "word1", "word3", "word2" })
  same(labels(Wheel.rows(words(1), 1, 0)), { "word1" })
  same(labels(Wheel.rows({}, 1, 0)), {})
end)

test("turning the drum carries the words up: the next word nears the window and the far one leaves", function()
  local rows = Wheel.rows(words(12), 3, 0.4)
  equal(rows[#rows].entry.label, "word3", "under half a step on, the selected word is still nearest the front")
  equal(rows[#rows].angle, -14.4)
  equal(rows[#rows].tier, "front")
  equal(rows[#rows].y, -17, "and has risen")
  equal(rows[#rows - 1].entry.label, "word4")
  equal(rows[#rows - 1].tier, "near")
  local past = Wheel.rows(words(12), 3, 0.6)
  equal(past[#past].entry.label, "word4", "past half a step, the next word is in the window")
  equal(past[#past].tier, "front")
  local far = Wheel.rows(words(12), 3, 0.9)
  same(labels(far), { "word2", "word5", "word3", "word4" }, "a slat past the drum's edge is left out")
end)

test("a lone word slides with the crank, as any slat does, and keeps the window", function()
  local rows = Wheel.rows(words(1), 1, 0.3)
  equal(#rows, 1)
  equal(math.floor(rows[1].angle * 10 + 0.5) / 10, -10.8)
  equal(rows[1].y, -13)
  equal(rows[1].tier, "front")
end)

test("the drum settles on the slat once the crank has rested, and says so once", function()
  local builder = Sentence.new(function() return { choices = {} } end)
  builder.crank = 8
  local wheel = Wheel.new()
  equal(wheel:update(builder, true), nil, "turning: nothing settles")
  for _ = 1, Wheel.REST_FRAMES - 1 do equal(wheel:update(builder, false), nil) end
  equal(math.floor(builder:fraction() * 3 + 0.5), 1, "the drum is still between slats while the crank rests briefly")
  local settled = 0
  for _ = 1, 20 do
    local rest, steps = wheel:update(builder, false)
    if rest == "settled" then settled = settled + 1 end
    equal(steps, 0, "short of half a step, the selection stays")
  end
  equal(settled, 1)
  equal(builder:fraction(), 0)
  equal(wheel:update(builder, false), nil, "at rest, nothing more")
end)

test("a drum left with the next word in the window settles on it: the step completes, once, before the clack", function()
  local builder = Sentence.new(view())
  builder.crank = 16
  local wheel = Wheel.new()
  for _ = 1, Wheel.REST_FRAMES - 1 do equal(wheel:update(builder, false), nil) end
  equal(builder.selected, 1)
  local rest, steps = wheel:update(builder, false)
  equal(steps, 1, "the frame the drum settles, the step the crank had taken past halfway completes")
  equal(rest, nil, "and the drum is not yet at rest")
  equal(builder.selected, 2)
  equal(builder:fraction() < 0, true, "what is left is on the other side of the new slat")
  local settled, moved = 0, 0
  for _ = 1, 20 do
    rest, steps = wheel:update(builder, false)
    if rest == "settled" then settled = settled + 1 end
    moved = moved + steps
  end
  equal(settled, 1)
  equal(moved, 0)
  equal(builder.selected, 2)
  equal(builder:fraction(), 0)
end)
