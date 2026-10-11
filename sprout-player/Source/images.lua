-- Pictures a world shows. `media.show` records an effect whose payload is { image, caption? }
-- (docs/design/sprout-test-harness.md, section 8); the image is a 1-bit PNG that `sprout pack`
-- put beside the cartridge, at `<cartridge path>.assets/<image>`, and the pdx carries it under
-- `worlds/` with the cartridge. The gallery (`gallery.lua`) shows each on the whole screen; a
-- picture is loaded when it is drawn and let go after, so none is held for long.
--
-- Nothing here touches the graphics API except through the `gfx` it is given.

local Images = {}
Images.__index = Images

-- The box a picture is drawn in: the screen's width, and its height less the caption's line.
Images.MAX_WIDTH = 400
Images.MAX_HEIGHT = 240

-- The payload of an effect that asks for a picture, { image, caption }, or nil. `effect` is a
-- told line or a view's effect: { extension, statement, payload }.
function Images.asked(effect)
  if type(effect) ~= "table" or effect.extension ~= "media" or effect.statement ~= "show" then return nil end
  local payload = effect.payload
  if type(payload) ~= "table" or type(payload.image) ~= "string" or payload.image == "" then return nil end
  return { image = payload.image, caption = payload.caption }
end

-- Every picture `effects` ask for, in order.
function Images.allAsked(effects)
  local found = {}
  for _, effect in ipairs(effects or {}) do
    local one = Images.asked(effect)
    if one ~= nil then found[#found + 1] = one end
  end
  return found
end

-- `gfx` is playdate.graphics; `files` has `exists(path)` as playdate.file does (it reads the
-- app and its Data folder together); `cartridge` is the path of the open cartridge.
function Images.new(gfx, files, cartridge)
  return setmetatable({ gfx = gfx, files = files, folder = cartridge .. ".assets/", loaded = {} }, Images)
end

-- The image at `path` inside the cartridge's assets, or nil where it is not there or cannot be
-- loaded. The pdx holds a compiled image under its name without `.png`.
function Images:load(path)
  if self.loaded[path] ~= nil then return self.loaded[path] or nil end
  local found = false
  local full = self.folder .. path
  for _, name in ipairs({ full:gsub("%.png$", ""), full }) do
    if self.files.exists(name) or self.files.exists(name .. ".pdi") then
      found = self.gfx.image.new(name) or false
      if found then break end
    end
  end
  self.loaded[path] = found
  return found or nil
end

-- Lets a loaded picture go, so the screen holds only what it draws.
function Images:release(path) self.loaded[path] = nil end

function Images:releaseAll() self.loaded = {} end

-- A picture to draw, scaled to fit the box above the caption's line: { image, caption, scale,
-- width, shown }, `shown` its height as drawn. nil where the image cannot be loaded.
function Images:picture(asked, lineHeight)
  local image = self:load(asked.image)
  if image == nil then return nil end
  local width, height = image:getSize()
  local scale = math.min(1, Images.MAX_WIDTH / width, (Images.MAX_HEIGHT - lineHeight - 4) / height)
  local caption = asked.caption
  if caption == "" then caption = nil end
  return {
    image = image, caption = caption, scale = scale,
    width = math.floor(width * scale), shown = math.floor(height * scale),
  }
end

-- Draws `picture` centred across the screen with its top at `y`.
function Images.draw(picture, gfx, y)
  local x = math.floor((400 - picture.width) / 2)
  if picture.scale < 1 then picture.image:drawScaled(x, y, picture.scale) else picture.image:draw(x, y) end
end

return Images
