-- JSON for the tests, shaped like the Playdate's `json` global (decode, encode), so the modules
-- that call `json` run unchanged on a desktop Lua. Objects decode to tables, arrays to lists, and
-- null to nil.

local json = {}

local escapes = { ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }

local function skip(text, at)
  return text:find("%S", at) or #text + 1
end

local decode_value

local function decode_string(text, at)
  local out, i = {}, at + 1
  while true do
    local char = text:sub(i, i)
    if char == "" then error("unterminated string") end
    if char == '"' then return table.concat(out), i + 1 end
    if char == "\\" then
      local next = text:sub(i + 1, i + 1)
      if next == "u" then
        out[#out + 1] = utf8.char(tonumber(text:sub(i + 2, i + 5), 16))
        i = i + 6
      else
        out[#out + 1] = escapes[next] or error("bad escape")
        i = i + 2
      end
    else
      out[#out + 1] = char
      i = i + 1
    end
  end
end

function decode_value(text, at)
  at = skip(text, at)
  local char = text:sub(at, at)
  if char == "{" then
    local object = {}
    at = skip(text, at + 1)
    if text:sub(at, at) == "}" then return object, at + 1 end
    while true do
      local key
      key, at = decode_string(text, skip(text, at))
      at = skip(text, at)
      assert(text:sub(at, at) == ":", "expected a colon")
      object[key], at = decode_value(text, at + 1)
      at = skip(text, at)
      local after = text:sub(at, at)
      at = at + 1
      if after == "}" then return object, at end
      assert(after == ",", "expected a comma")
    end
  elseif char == "[" then
    local list, n = {}, 0
    at = skip(text, at + 1)
    if text:sub(at, at) == "]" then return list, at + 1 end
    while true do
      local item
      item, at = decode_value(text, at)
      n = n + 1
      list[n] = item
      at = skip(text, at)
      local after = text:sub(at, at)
      at = at + 1
      if after == "]" then return list, at end
      assert(after == ",", "expected a comma")
    end
  elseif char == '"' then
    return decode_string(text, at)
  elseif text:sub(at, at + 3) == "true" then
    return true, at + 4
  elseif text:sub(at, at + 4) == "false" then
    return false, at + 5
  elseif text:sub(at, at + 3) == "null" then
    return nil, at + 4
  end
  local number = text:match("^-?%d+%.?%d*[eE]?[+-]?%d*", at)
  assert(number and #number > 0, "unexpected " .. char)
  return tonumber(number), at + #number
end

function json.decode(text)
  local value = decode_value(text, 1)
  return value
end

local function quote(text)
  return '"' .. text:gsub('[%c"\\]', function(c)
    return ({ ['"'] = '\\"', ["\\"] = "\\\\", ["\n"] = "\\n", ["\t"] = "\\t", ["\r"] = "\\r" })[c]
      or string.format("\\u%04x", c:byte())
  end) .. '"'
end

-- Encodes tables with string keys as objects (keys sorted) and sequences as arrays.
function json.encode(value)
  local kind = type(value)
  if kind == "string" then return quote(value) end
  if kind == "number" or kind == "boolean" then return tostring(value) end
  if value == nil then return "null" end
  if #value > 0 or next(value) == nil then
    local parts = {}
    for i, item in ipairs(value) do parts[i] = json.encode(item) end
    return "[" .. table.concat(parts, ",") .. "]"
  end
  local keys = {}
  for key in pairs(value) do keys[#keys + 1] = key end
  table.sort(keys)
  local parts = {}
  for _, key in ipairs(keys) do parts[#parts + 1] = quote(key) .. ":" .. json.encode(value[key]) end
  return "{" .. table.concat(parts, ",") .. "}"
end

return json
