-- The index of published worlds (sprout-player/index.schema.json): `{ worlds, signed }`, where
-- `signed` is the hexadecimal Ed25519 signature, made by the publisher's key, over the canonical
-- text of `worlds` (canonical.lua). An index is used only if that signature verifies against the
-- public key baked into the app; nothing in it is read before then, and a world's bytes are
-- checked against the index's size and SHA-256 after they arrive. Which worlds an index may list
-- is the host's act (the spec's The host contract > Moderation and takedown): a world the
-- publisher withdraws is one the next index no longer lists.

local Index = {}

-- The largest index text the app reads, in bytes.
Index.MAX_BYTES = 262144

local function isText(value) return type(value) == "string" and value ~= "" end

-- A whole number of bytes; the decoder may hand an integer over as a float.
local function isCount(value) return type(value) == "number" and value >= 0 and value == math.floor(value) end

local function isDigest(value) return type(value) == "string" and #value == 64 and not value:find("[^0-9a-f]") end

-- A path inside a cartridge's assets folder: relative, with no `..`, no empty part and no backslash.
local function isAssetPath(value)
  if not isText(value) or value:find("[%c\\:]") or value:sub(1, 1) == "/" then return false end
  for part in (value .. "/"):gmatch("(.-)/") do
    if part == "" or part == ".." or part == "." then return false end
  end
  return true
end

-- What is wrong with a listed asset, as a field name, or nil.
local function assetFault(asset)
  if type(asset) ~= "table" then return "assets" end
  if not isAssetPath(asset.path) then return "assets path" end
  if not isCount(asset.bytes) then return "assets bytes" end
  if not isDigest(asset.sha256) then return "assets sha256" end
  if not isText(asset.url) then return "assets url" end
  return nil
end

-- What is wrong with a listed world, as a field name, or nil.
local function worldFault(world)
  if type(world) ~= "table" then return "the entry" end
  for _, field in ipairs({ "title", "author", "version", "url" }) do
    if not isText(world[field]) then return field end
  end
  if not isCount(world.bytes) then return "bytes" end
  if not isDigest(world.hash) then return "hash" end
  if not isDigest(world.sha256) then return "sha256" end
  if world.assets ~= nil then
    if type(world.assets) ~= "table" then return "assets" end
    for _, asset in ipairs(world.assets) do
      local fault = assetFault(asset)
      if fault ~= nil then return fault end
    end
  end
  return nil
end

-- Reads `text` as an index. `deps.json` decodes JSON text; `deps.canonical` is canonical.lua;
-- `deps.verify(text, signature)` returns whether the signature is the trusted key's over `text`. The reply is { ok = true, worlds } or
-- { ok = false, reason }, the reason in words for the person holding the device.
function Index.read(text, deps)
  if #text > Index.MAX_BYTES then
    return { ok = false, reason = "The list of worlds is larger than this app reads, so it was not used." }
  end
  local decoded = nil
  pcall(function() decoded = deps.json.decode(text) end)
  if type(decoded) ~= "table" or type(decoded.worlds) ~= "table" then
    return { ok = false, reason = "The list of worlds could not be read, so it was not used." }
  end
  if not isText(decoded.signed) then
    return { ok = false, reason = "The list of worlds is not signed, so it was not used." }
  end
  local canonical = deps.canonical.text(decoded.worlds)
  if canonical == nil or not deps.verify(canonical, decoded.signed) then
    return {
      ok = false,
      reason = "The list of worlds did not pass its signature check, so nothing in it was used. "
        .. "It was changed on the way, or it was not signed by the publisher this app trusts.",
    }
  end
  for i, world in ipairs(decoded.worlds) do
    local fault = worldFault(world)
    if fault ~= nil then
      return { ok = false, reason = "World " .. i .. " in the list of worlds has no usable " .. fault .. ", so the list was not used." }
    end
  end
  return { ok = true, worlds = decoded.worlds }
end

-- A size for the person: "812 bytes", "12.4 KB", "1.2 MB".
function Index.size(bytes)
  if bytes < 1024 then return string.format("%d bytes", bytes) end
  if bytes < 1024 * 1024 then return string.format("%.1f KB", bytes / 1024) end
  return string.format("%.1f MB", bytes / (1024 * 1024))
end

return Index
