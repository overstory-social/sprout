-- Runs every Lua test: `lua5.4 sprout-player/test/run.lua`. The modules are the app's own,
-- loaded from Source/ as `import` loads them on the device; the `json` global is a stand-in for
-- the Playdate's. A test file sees `harness`, `module(name)` (a module of Source/), `helper(name)`
-- (a file of the tests' own) and `fixture(name)`.

local here = arg[0]:match("^(.*)/[^/]*$") or "."

package.path = here .. "/?.lua;" .. package.path

local harness = require("harness")
json = require("json")

local env = {
  harness = harness,
  module = function(name) return dofile(here .. "/../Source/" .. name .. ".lua") end,
  helper = function(name) return dofile(here .. "/" .. name .. ".lua") end,
  fixture = function(name)
    local file = assert(io.open(here .. "/fixtures/" .. name, "rb"))
    local text = file:read("a")
    file:close()
    return text
  end,
}
setmetatable(env, { __index = _G })

for _, name in ipairs({
  "clock", "wrap", "reader", "sentence", "nickname", "shelf", "engine", "images", "canonical", "index", "net",
  "config", "downloads", "main",
}) do
  local chunk = assert(loadfile(here .. "/" .. name .. "_test.lua", "t", env))
  chunk()
end

harness.finish()
