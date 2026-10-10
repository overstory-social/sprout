-- Pictures a world shows. `media.show` records an effect whose payload is { image, caption? }
-- (docs/design/sprout-test-harness.md, section 8); the image is a 1-bit PNG that `sprout pack`
-- put beside the cartridge, at `<cartridge path>.assets/<image>`, and the pdx carries it under
-- `worlds/` with the cartridge. The reader draws it above the text, with the caption under it.
--
-- Nothing here touches the graphics API except through the `gfx` it is given.

local Images = {}
Images.__index = Images

-- The widest and tallest a picture is drawn, in pixels; a larger one is scaled down to fit.
Images.MAX_WIDTH = 392
Images.MAX_HEIGHT = 80

-- The payload of an effect that asks for a picture, { image, caption }, or nil. `effect` is a
-- told line or a view's effect: { extension, statement, payload }.
function Images.asked(effect)
  if type(effect) ~= "table" or effect.extension ~= "media" or effect.statement ~= "show" then return nil end
  local payload = effect.payload
  if type(payload) ~= "table" or type(payload.image) ~= "string" or payload.image == "" then return nil end
  return { image = payload.image, caption = payload.caption }
end

-- The newest picture any of `effects` asks for, or nil.
function Images.newest(effects)
  local found = nil
  for _, effect in ipairs(effects or {}) do found = Images.asked(effect) or found end
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

-- A picture to draw: { image, caption, height }, where `height` is the pixels it takes with its
-- caption under it (`lineHeight` high). nil where the image cannot be loaded.
function Images:picture(asked, lineHeight)
  local image = self:load(asked.image)
  if image == nil then return nil end
  local width, height = image:getSize()
  local scale = math.min(1, Images.MAX_WIDTH / width, Images.MAX_HEIGHT / height)
  local caption = asked.caption
  if caption == "" then caption = nil end
  local shown = math.floor(height * scale)
  return {
    image = image, caption = caption, scale = scale,
    width = math.floor(width * scale), shown = shown,
    height = shown + (caption ~= nil and lineHeight or 0) + 4,
  }
end

-- Draws `picture` centred at `y`; the caption under it, from the left margin.
function Images.draw(picture, gfx, y)
  local x = math.floor((400 - picture.width) / 2)
  if picture.scale < 1 then picture.image:drawScaled(x, y, picture.scale) else picture.image:draw(x, y) end
  if picture.caption ~= nil then gfx.drawText(picture.caption, 2, y + picture.shown + 2) end
end

return Images
