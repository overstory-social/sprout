-- The canonical JSON text of a value, the text an index's signature is made over: no spaces,
-- object keys in byte order, strings escaped as JavaScript's JSON.stringify escapes them (quote,
-- backslash, \b \f \n \r \t, other controls as \u00xx in lower case), integers in decimal. Only
-- strings, integers, arrays and objects have a canonical text; scripts/index-signing.mjs writes
-- the same text, so a signature made there verifies here. An empty table is an empty array.

local Canonical = {}

local ESCAPES = {
  ['"'] = '\\"', ["\\"] = "\\\\", ["\b"] = "\\b", ["\f"] = "\\f", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t",
}

local function quote(text)
  local escaped = text:gsub('[\0-\31"\\]', function(c)
    return ESCAPES[c] or string.format("\\u%04x", c:byte())
  end)
  return '"' .. escaped .. '"'
end

local function isArray(value)
  local count = 0
  for _ in pairs(value) do count = count + 1 end
  return count == #value
end

local function write(value, out)
  local kind = type(value)
  if kind == "string" then
    out[#out + 1] = quote(value)
  elseif kind == "number" then
    if value ~= value or value == math.huge or value == -math.huge or value ~= math.floor(value) then
      error("a number that is not an integer has no canonical text", 0)
    end
    out[#out + 1] = string.format("%d", value)
  elseif kind == "table" and isArray(value) then
    out[#out + 1] = "["
    for i, item in ipairs(value) do
      if i > 1 then out[#out + 1] = "," end
      write(item, out)
    end
    out[#out + 1] = "]"
  elseif kind == "table" then
    local keys = {}
    for key in pairs(value) do
      if type(key) ~= "string" then error("an object key that is not text has no canonical text", 0) end
      keys[#keys + 1] = key
    end
    table.sort(keys)
    out[#out + 1] = "{"
    for i, key in ipairs(keys) do
      if i > 1 then out[#out + 1] = "," end
      out[#out + 1] = quote(key) .. ":"
      write(value[key], out)
    end
    out[#out + 1] = "}"
  else
    error("a " .. kind .. " has no canonical text", 0)
  end
end

-- The canonical text of `value`, or nil and the reason there is none.
function Canonical.text(value)
  local out = {}
  local ok, err = pcall(write, value, out)
  if not ok then return nil, err end
  return table.concat(out)
end

return Canonical
