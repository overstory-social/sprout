-- The sentence wheel drawn as a drum seen from the side, a word on each slat: the selected word
-- sits in a window at the drum's front, the next words curve away above and below it, and the
-- drum turns with the crank, carrying the words up and down, and settles on a slat once the
-- crank rests. `sentence.lua` holds what the wheel offers and which word is selected; this is
-- only where each word sits on the drum this frame, and when the drum comes to rest.
--
-- Nothing here touches the graphics API; `rows` is what the screen draws.

local Wheel = {}
Wheel.__index = Wheel

-- Degrees of drum between neighbouring slats.
Wheel.SLAT_DEGREES = 36
-- The drum's radius, in pixels: how far from the centre line a slat a step from the front sits.
Wheel.RADIUS = 70
-- Slats shown each side of the front, where there are words enough.
Wheel.SIDE = 2
-- Frames the crank rests before the drum settles on the nearest slat.
Wheel.REST_FRAMES = 6
-- The share of the way to the slat the drum moves each settling frame.
Wheel.SETTLE = 0.45

function Wheel.new() return setmetatable({ still = 0 }, Wheel) end

-- A frame of the drum, `builder` already turned by the crank and `turned` whether the crank moved
-- this frame: "settled" the frame the drum comes to rest on a slat after being between two, nil
-- otherwise.
function Wheel:update(builder, turned)
  if turned then
    self.still = 0
    return nil
  end
  self.still = self.still + 1
  if self.still < Wheel.REST_FRAMES then return nil end
  return builder:settle(Wheel.SETTLE) and "settled" or nil
end

-- The slats nearest the front first, so each word is placed once, where it is nearest.
local ORDER <const> = { 0, -1, 1, -2, 2 }

-- The tier a slat is drawn at, by its angle from the front: the word in the window, the ones
-- beside it, and the ones curving away.
local function tierOf(angle)
  local away = math.abs(angle)
  if away < Wheel.SLAT_DEGREES / 2 then return "front" end
  if away < Wheel.SLAT_DEGREES * 1.5 then return "near" end
  return "far"
end

-- Where each word sits this frame: `entries` and `selected` as the builder gives them, `fraction`
-- how far the drum has turned past the selected slat toward the next, in slats (-1 to 1). Each
-- row is { entry, index, angle, y, tier }: the slat's angle from the front in degrees, its offset
-- from the centre line in pixels (below is positive), and its tier. A slat turned past the
-- drum's edge is left out, and each entry appears at most once. Rows come far to near, the one
-- above first of two as far, so the front one is drawn last.
function Wheel.rows(entries, selected, fraction)
  local n = #entries
  if n == 0 then return {} end
  local side = math.min(Wheel.SIDE, n - 1)
  local placed, rows = {}, {}
  for _, k in ipairs(ORDER) do
    if math.abs(k) <= side then
      local index = (selected - 1 + k) % n + 1
      local angle = (k - fraction) * Wheel.SLAT_DEGREES
      if not placed[index] and math.abs(angle) < 90 then
        placed[index] = true
        rows[#rows + 1] = {
          entry = entries[index], index = index, angle = angle,
          y = math.floor(Wheel.RADIUS * math.sin(math.rad(angle)) + 0.5), tier = tierOf(angle),
        }
      end
    end
  end
  table.sort(rows, function(a, b)
    if math.abs(a.angle) ~= math.abs(b.angle) then return math.abs(a.angle) > math.abs(b.angle) end
    return a.angle < b.angle
  end)
  return rows
end

return Wheel
