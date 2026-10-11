-- The pictures a turn showed, seen one at a time on the whole screen: the queue of what
-- `media.show` asked for, which one is on screen, and the slat-clack motion the crank gives
-- them. A turn of the crank (or left and right) takes the next picture: the one on screen is
-- held for an elastic moment, stretched a little the way it will go, then whizzes out while the
-- next whizzes in behind it and lands with a clack. The pictures are names; the screen loads the
-- one it draws and lets it go afterwards, so a gallery costs no memory of its own.
--
-- Nothing here touches the graphics API; `frame` is what the screen draws.

local Gallery = {}
Gallery.__index = Gallery

-- Degrees of crank for one picture.
Gallery.DEGREES_PER_STEP = 36
-- Frames a picture is held, stretched, before it whizzes out.
Gallery.HOLD_FRAMES = 6
-- How far the held picture is stretched the way it will go, in pixels.
Gallery.STRETCH = 8
-- The share of the way left that a whizzing picture moves each frame.
Gallery.WHIZ = 0.4
-- The height a picture travels: the screen's.
Gallery.TRAVEL = 240

-- A gallery of the pictures `asked` ({ image, caption } each), each image once, in the order asked.
function Gallery.new(asked)
  local pictures, seen = {}, {}
  for _, one in ipairs(asked or {}) do
    if not seen[one.image] then
      seen[one.image] = true
      pictures[#pictures + 1] = { image = one.image, caption = one.caption }
    end
  end
  return setmetatable({ pictures = pictures, selected = 1, crank = 0, phase = nil, held = 0, y = 0, direction = 0, leaving = nil }, Gallery)
end

function Gallery:count() return #self.pictures end

-- The picture on screen (or landing), or nil for an empty gallery.
function Gallery:current() return self.pictures[self.selected] end

-- Moves on by `steps` pictures (wrapping), the one on screen leaving the way the steps go.
function Gallery:nudge(steps)
  local n = #self.pictures
  if n < 2 or steps == 0 then return end
  self.leaving = self.pictures[self.selected]
  self.selected = (self.selected - 1 + steps) % n + 1
  self.direction = steps > 0 and 1 or -1
  self.phase, self.held, self.y = "hold", 0, 0
end

-- Turns the crank by `degrees`: a picture for each DEGREES_PER_STEP; what is left over is kept.
function Gallery:turn(degrees)
  self.crank = self.crank + degrees
  local steps = 0
  while self.crank >= Gallery.DEGREES_PER_STEP do self.crank = self.crank - Gallery.DEGREES_PER_STEP; steps = steps + 1 end
  while self.crank <= -Gallery.DEGREES_PER_STEP do self.crank = self.crank + Gallery.DEGREES_PER_STEP; steps = steps - 1 end
  if steps ~= 0 then self:nudge(steps) end
  return steps
end

-- One frame of the motion: "clack" the frame the next picture lands, nil otherwise.
function Gallery:update()
  if self.phase == "hold" then
    self.held = self.held + 1
    -- stretched the way it will go, a little more each frame, like something pulled back
    self.y = -self.direction * math.floor(Gallery.STRETCH * self.held / Gallery.HOLD_FRAMES)
    if self.held >= Gallery.HOLD_FRAMES then self.phase = "whiz" end
    return nil
  end
  if self.phase == "whiz" then
    local goal = self.direction * Gallery.TRAVEL
    self.y = self.y + (goal - self.y) * Gallery.WHIZ
    if math.abs(goal - self.y) < 2 then
      self.phase, self.leaving, self.y, self.direction = nil, nil, 0, 0
      return "clack"
    end
    return nil
  end
  return nil
end

-- What to draw this frame: { picture, y } for the picture landing (or at rest) and, while one
-- leaves, `leaving` = { picture, y } too; y is the vertical offset in pixels, 0 at rest. The
-- leaving picture goes out the way the steps went (up for the next), the new one follows it in.
function Gallery:frame()
  local current = self:current()
  if current == nil then return { current = nil } end
  if self.leaving == nil then return { current = { picture = current, y = 0 } } end
  local y = math.floor(self.y + 0.5)
  return {
    current = { picture = current, y = y + self.direction * Gallery.TRAVEL },
    leaving = { picture = self.leaving, y = y },
  }
end

return Gallery
