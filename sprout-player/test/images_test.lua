local Images = module("images")
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

test("every picture a view's effects or a turn's lines ask for is listed, in order", function()
  local all = Images.allAsked(view.effects)
  same({ all[1].image, all[2].image }, { "cellar.png", "pictures/cabinet.png" })
  equal(#Images.allAsked({ { kind = "said", text = "x" }, view.effects[1] }), 1)
  equal(#Images.allAsked({}), 0)
  equal(#Images.allAsked(nil), 0)
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

test("a picture is scaled to fit the screen above the caption's line, and a small one is not", function()
  local s = stage({ ["w.sproutworld.assets/a"] = true })
  local images = Images.new(s.gfx, s.files, "w.sproutworld")
  local small = images:picture({ image = "a.png", caption = "words" }, 14)
  same({ small.scale, small.width, small.shown, small.caption }, { 1, 100, 60, "words" })
  equal(images:picture({ image = "a.png", caption = "" }, 14).caption, nil, "an empty caption is none")
  equal(images:picture({ image = "missing.png" }, 14), nil)
  s.gfx.image.new = function() return s.image("big", 800, 400) end
  local big = Images.new(s.gfx, s.files, "w.sproutworld"):picture({ image = "a.png" }, 14)
  equal(big.scale, 0.5, "the width is the bound")
  equal(big.width, 400)
  equal(big.shown, 200)
  s.gfx.image.new = function() return s.image("tall", 200, 444) end
  local tall = Images.new(s.gfx, s.files, "w.sproutworld"):picture({ image = "a.png" }, 14)
  equal(tall.scale, 0.5, "the height above the caption line, 240 - 14 - 4, is the bound")
end)

test("a picture is drawn centred across the screen at the top it is given", function()
  local s = stage({ ["w.sproutworld.assets/a"] = true })
  local images = Images.new(s.gfx, s.files, "w.sproutworld")
  Images.draw(images:picture({ image = "a.png", caption = "words" }, 14), s.gfx, 20)
  same(s.drawn[1], { "draw", "w.sproutworld.assets/a", 150, 20 })
  equal(#s.drawn, 1, "the caption is the screen's to draw")
  s.gfx.image.new = function() return s.image("big", 800, 400) end
  Images.draw(Images.new(s.gfx, s.files, "w.sproutworld"):picture({ image = "a.png" }, 14), s.gfx, 30)
  same(s.drawn[2], { "scaled", "big", 0, 30, 0.5 })
end)

test("a picture let go is loaded again when next drawn, and none is held after releaseAll", function()
  local s = stage({ ["w.sproutworld.assets/a"] = true, ["w.sproutworld.assets/b"] = true })
  local images = Images.new(s.gfx, s.files, "w.sproutworld")
  images:load("a.png")
  images:load("b.png")
  images:load("a.png")
  equal(#s.made, 2, "each once while held")
  images:release("a.png")
  images:load("a.png")
  equal(#s.made, 3, "loaded again once let go")
  images:releaseAll()
  images:load("a.png")
  images:load("b.png")
  equal(#s.made, 5)
end)
