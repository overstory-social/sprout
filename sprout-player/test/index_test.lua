local Index = module("index")
local Canonical = module("canonical")
local test, equal = harness.test, harness.equal

local SIGNED = fixture("index.json")
local CANONICAL = fixture("index.canonical.txt")
local SIGNATURE = fixture("index.signature.txt"):gsub("%s+$", "")

-- A verifier that accepts exactly the signature Node made over the fixture's text, as the C side does.
local function deps()
  return {
    json = json,
    canonical = Canonical,
    verify = function(text, signature) return text == CANONICAL and signature == SIGNATURE end,
  }
end

local function replaced(text, from, to)
  local at = assert(text:find(from, 1, true), from)
  return text:sub(1, at - 1) .. to .. text:sub(at + #from)
end

test("the index the publisher signed is accepted and lists its worlds", function()
  local read = Index.read(SIGNED, deps())
  equal(read.ok, true)
  equal(#read.worlds, 2)
  equal(read.worlds[1].title, 'Café "Moss"\tTea')
  equal(read.worlds[1].assets[2].path, "pictures/the cabinet.png")
  equal(read.worlds[2].assets, nil)
end)

test("an index changed after it was signed is refused with words and lists nothing", function()
  local read = Index.read(replaced(SIGNED, '"bytes": 26989', '"bytes": 26990'), deps())
  equal(read.ok, false)
  equal(read.worlds, nil)
  equal(read.reason, "The list of worlds did not pass its signature check, so nothing in it was used. "
    .. "It was changed on the way, or it was not signed by the publisher this app trusts.")
  read = Index.read(replaced(SIGNED, "https://worlds.example/sprout/cafe-moss", "https://elsewhere.example/cafe-moss"), deps())
  equal(read.ok, false, "a changed address")
end)

test("an index signed by another key is refused the same way", function()
  local other = deps()
  other.verify = function() return false end
  local read = Index.read(SIGNED, other)
  equal(read.ok, false)
  assert(read.reason:find("signature check", 1, true), read.reason)
end)

test("an index with no signature, or that is not JSON, is refused in words", function()
  local unsigned = json.encode({ worlds = json.decode(SIGNED).worlds })
  equal(Index.read(unsigned, deps()).reason, "The list of worlds is not signed, so it was not used.")
  equal(Index.read("<html>Not found</html>", {
    json = { decode = function() error("bad json") end }, canonical = Canonical, verify = function() return true end,
  }).reason, "The list of worlds could not be read, so it was not used.")
  equal(Index.read("[]", deps()).reason, "The list of worlds could not be read, so it was not used.")
end)

test("an index larger than the app reads is refused before it is decoded", function()
  local called = false
  local read = Index.read(string.rep(" ", Index.MAX_BYTES + 1), {
    json = { decode = function() called = true end }, canonical = Canonical, verify = function() return true end,
  })
  equal(read.ok, false)
  equal(called, false)
  equal(read.reason, "The list of worlds is larger than this app reads, so it was not used.")
end)

-- An index whose entries the signer vouched for, but that are not shaped as the app reads.
local function signedWith(mutate)
  local index = json.decode(SIGNED)
  mutate(index.worlds)
  return json.encode(index), {
    json = json, canonical = Canonical, verify = function() return true end,
  }
end

test("a signed entry the app cannot use names the field, and the index is not used", function()
  local cases = {
    { function(w) w[1].title = "" end, "World 1 in the list of worlds has no usable title, so the list was not used." },
    { function(w) w[2].bytes = -1 end, "World 2 in the list of worlds has no usable bytes, so the list was not used." },
    { function(w) w[1].hash = "xyz" end, "World 1 in the list of worlds has no usable hash, so the list was not used." },
    { function(w) w[1].sha256 = w[1].sha256:upper() end, "World 1 in the list of worlds has no usable sha256, so the list was not used." },
    { function(w) w[1].url = nil end, "World 1 in the list of worlds has no usable url, so the list was not used." },
    { function(w) w[1].assets[1].path = "../cellar.png" end, "World 1 in the list of worlds has no usable assets path, so the list was not used." },
    { function(w) w[1].assets[1].path = "/etc/passwd" end, "World 1 in the list of worlds has no usable assets path, so the list was not used." },
    { function(w) w[1].assets[1].path = "a//b.png" end, "World 1 in the list of worlds has no usable assets path, so the list was not used." },
    { function(w) w[1].assets[1].path = "a\\b.png" end, "World 1 in the list of worlds has no usable assets path, so the list was not used." },
    { function(w) w[1].assets[2].sha256 = "00" end, "World 1 in the list of worlds has no usable assets sha256, so the list was not used." },
  }
  for i, case in ipairs(cases) do
    local text, with = signedWith(case[1])
    local read = Index.read(text, with)
    equal(read.ok, false, "case " .. i)
    equal(read.reason, case[2], "case " .. i)
  end
end)

test("sizes are told for a person", function()
  equal(Index.size(812), "812 bytes")
  equal(Index.size(26989), "26.4 KB")
  equal(Index.size(3 * 1024 * 1024), "3.0 MB")
end)
