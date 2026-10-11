local Gallery = module("gallery")
local test, equal, same = harness.test, harness.equal, harness.same

local function asked()
  return { { image = "a.png", caption = "a" }, { image = "b.png", caption = "b" }, { image = "a.png", caption = "again" }, { image = "c.png" } }
end

test("a gallery holds each picture once, in the order asked, and starts on the first", function()
  local gallery = Gallery.new(asked())
  equal(gallery:count(), 3)
  equal(gallery:current().image, "a.png")
  equal(gallery:current().caption, "a")
  same(gallery:frame(), { current = { picture = gallery.pictures[1], y = 0 } })
  equal(Gallery.new({}):current(), nil)
  equal(Gallery.new({}):frame().current, nil)
end)

test("a step holds the picture stretched, then whizzes it out as the next comes in, and clacks once", function()
  local gallery = Gallery.new(asked())
  gallery:nudge(1)
  equal(gallery:current().image, "b.png")
  equal(gallery.phase, "hold")
  local frame = gallery:frame()
  equal(frame.leaving.picture.image, "a.png")
  equal(frame.current.y, Gallery.TRAVEL, "the next waits below the screen")
  for i = 1, Gallery.HOLD_FRAMES do
    equal(gallery:update(), nil)
    if i < Gallery.HOLD_FRAMES then equal(gallery.phase, "hold") end
  end
  equal(gallery.phase, "whiz")
  equal(gallery:frame().leaving.y, -Gallery.STRETCH, "stretched the way it will go")
  local clacks, frames = 0, 0
  while gallery.phase ~= nil and frames < 100 do
    if gallery:update() == "clack" then clacks = clacks + 1 end
    frames = frames + 1
  end
  equal(clacks, 1)
  equal(gallery.leaving, nil)
  same(gallery:frame(), { current = { picture = gallery.pictures[2], y = 0 } })
  equal(gallery:update(), nil, "at rest, nothing more")
end)

test("the crank takes a picture each stretch of degrees, wrapping either way; one picture does not move", function()
  local gallery = Gallery.new(asked())
  equal(gallery:turn(Gallery.DEGREES_PER_STEP - 1), 0)
  equal(gallery:current().image, "a.png")
  equal(gallery:turn(2), 1)
  equal(gallery:current().image, "b.png")
  gallery.crank = 0
  equal(gallery:turn(-Gallery.DEGREES_PER_STEP * 2), -2)
  equal(gallery:current().image, "c.png", "back two, wrapping")
  equal(gallery.direction, -1)
  equal(gallery:frame().current.y, -Gallery.TRAVEL, "a picture going back comes in from above")
  local one = Gallery.new({ { image = "only.png" } })
  one:nudge(1)
  equal(one.phase, nil)
  equal(one:current().image, "only.png")
end)
