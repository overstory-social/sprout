-- The player's clock: what the device says, clamped so time never runs backwards, and the
-- interval at which the reader asks for a tick (the spec's The host contract > Time: the host
-- chooses the interval and supplies `elapsed` truthfully; a turn's `elapsed` is never negative).
-- The engine clamps the same way on its side against the last host seconds the save recorded;
-- this module keeps the UI's own schedule from reading a clock that went back. A tick is asked
-- for only while the reader is open: `start` begins the count and `stop` ends it, so the shelf
-- and the time the device is away never owe a tick.

local Clock = {}
Clock.__index = Clock

-- Seconds between ticks while a world is being read.
Clock.TICK_SECONDS = 10

-- `last` is the greatest host seconds seen so far: the save's, on opening a world.
function Clock.new(last)
  return setmetatable({ last = last or 0, ticking = false, ticked = 0 }, Clock)
end

-- The clamp: `seconds` unless that is before the last seen, in which case the last seen.
function Clock.clamp(seconds, last)
  if seconds < last then return last end
  return seconds
end

-- The device's seconds as the host may use them; remembers the greatest.
function Clock:read(seconds)
  self.last = Clock.clamp(seconds, self.last)
  return self.last
end

-- The reader opens: ticks are owed from `seconds` on.
function Clock:start(seconds)
  self.ticking = true
  self.ticked = self:read(seconds)
end

-- The reader closes or the app sleeps: no tick is owed for the time away.
function Clock:stop()
  self.ticking = false
end

-- Whether a tick is due at `seconds`; when it is, the count restarts from there.
function Clock:tickDue(seconds)
  local now = self:read(seconds)
  if not self.ticking or now - self.ticked < Clock.TICK_SECONDS then return false end
  self.ticked = now
  return true
end

return Clock
