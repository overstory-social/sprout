local Images = module("images")
local Reader = module("reader")
local test, equal, same = harness.test, harness.equal, harness.same

local view = json.decode(fixture("media-room.view.json"))

-- Stand-ins: files that exist by name, and images that know their size and what was done to them.
local function stage(existing)
  local made, drawn = {}, {}
  local files = { exists = function(path) return existing[path] == true end }
  local function image(name, w, h)
    return {
      name = name,
      getSize = function() return w, h end,
      draw = function(_, x, y) drawn[#drawn + 1] = { "draw", name, x, y } end,
      drawScaled = function(_, x, y, scale) drawn[#drawn + 1] = { "scaled", name, x, y, scale } end,
    }
  end
  local gfx = {
    image = { new = function(name)
      made[#made + 1] = name
      return existing[name] == true and image(name, 100, 60) or nil
    end },
    drawText = function(text, x, y) drawn[#drawn + 1] = { "text", text, x, y } end,
  }
  return { files = files, gfx = gfx, made = made, drawn = drawn, image = image }
end

test("a media show effect asks for a picture, with its caption where it has one", function()
  same(
    { Images.asked(view.effects[1]).image, Images.asked(view.effects[1]).caption == nil },
    { "cellar.png", true }
  )
  equal(Images.asked(view.effects[2]).caption, "an oak cabinet, its doors shut")
  equal(Images.asked(view.effects[2]).image, "pictures/cabinet.png")
end)

test("any other effect, or one with no image, asks for nothing", function()
  equal(Images.asked({ extension = "slides", statement = "show", payload = { image = "a.png" } }), nil)
  equal(Images.asked({ extension = "media", statement = "play", payload = { image = "a.png" } }), nil)
  equal(Images.asked({ extension = "media", statement = "show", payload = {} }), nil)
  equal(Images.asked({ extension = "media", statement = "show" }), nil)
  equal(Images.asked({ kind = "said", text = "words" }), nil)
  equal(Images.asked(nil), nil)
end)

test("the newest picture of a view's effects or a turn's lines is the one asked for", function()
  equal(Images.newest(view.effects).image, "pictures/cabinet.png")
  equal(Images.newest({ { kind = "said", text = "x" }, view.effects[1] }).image, "cellar.png")
  equal(Images.newest({}), nil)
  equal(Images.newest(nil), nil)
end)

test("an image is looked for beside the cartridge, under the name the pdx compiles it to", function()
  local s = stage({ ["worlds/media_room.sproutworld.assets/cellar.png"] = false,
                    ["worlds/media_room.sproutworld.assets/cellar"] = true })
  local images = Images.new(s.gfx, s.files, "worlds/media_room.sproutworld")
  equal(images:load("cellar.png").name, "worlds/media_room.sproutworld.assets/cellar")
  equal(images:load("cellar.png").name, "worlds/media_room.sproutworld.assets/cellar", "from the cache")
  equal(#s.made, 1)
end)

test("an image beside the cartridge in a folder keeps its path, and one not there is none", function()
  local s = stage({ ["w.sproutworld.assets/pictures/cabinet"] = true })
  local images = Images.new(s.gfx, s.files, "w.sproutworld")
  equal(images:load("pictures/cabinet.png").name, "w.sproutworld.assets/pictures/cabinet")
  equal(images:load("pictures/none.png"), nil)
  equal(images:load("pictures/none.png"), nil, "and is not looked for twice")
  equal(#s.made, 1)
end)

test("a picture with a caption takes room for the caption, and one with none does not", function()
  local s = stage({ ["w.sproutworld.assets/a"] = true })
  local images = Images.new(s.gfx, s.files, "w.sproutworld")
  local bare = images:picture({ image = "a.png" }, 14)
  local captioned = images:picture({ image = "a.png", caption = "words" }, 14)
  equal(bare.height, 60 + 4)
  equal(captioned.height, 60 + 14 + 4)
  equal(images:picture({ image = "missing.png" }, 14), nil)
end)

test("a picture larger than the column is scaled to fit it", function()
  local s = stage({ ["w.sproutworld.assets/big"] = true })
  s.gfx.image.new = function() return s.image("big", 400, 160) end
  local images = Images.new(s.gfx, s.files, "w.sproutworld")
  local picture = images:picture({ image = "big.png" }, 14)
  equal(picture.scale, 0.5)
  equal(picture.width, 200)
  equal(picture.shown, 80)
  Images.draw(picture, s.gfx, 20)
  same(s.drawn[1], { "scaled", "big", 100, 20, 0.5 })
end)

test("a picture is drawn centred, with its caption under it", function()
  local s = stage({ ["w.sproutworld.assets/a"] = true })
  local images = Images.new(s.gfx, s.files, "w.sproutworld")
  Images.draw(images:picture({ image = "a.png", caption = "words" }, 14), s.gfx, 20)
  same(s.drawn[1], { "draw", "w.sproutworld.assets/a", 150, 20 })
  same(s.drawn[2], { "text", "words", 2, 82 })
end)

test("the reader gives the transcript's rows to the picture, and takes them back", function()
  local reader = Reader.new({ wrap = module("wrap"), measure = function(t) return #t * 6 end, width = 380, rows = 10 })
  local drawn = {}
  reader:setPicture({ height = 64, draw = function(_, y) drawn[#drawn + 1] = y end }, 14)
  equal(reader.rows, 10 - 5)
  reader:push("said", "one")
  reader:draw({ drawText = function() end, drawLine = function() end }, 14)
  equal(#drawn, 1)
  reader:setPicture(nil, 14)
  equal(reader.rows, 10)
end)
