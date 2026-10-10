local Config = module("config")
local test, equal = harness.test, harness.equal

test("the default is a placeholder address that never resolves, and a purpose string for the permission dialog", function()
  local settings = Config.effective(nil)
  assert(settings.indexUrl:find("%.invalid/"), settings.indexUrl)
  assert(#settings.reason > 20, "the purpose string says why")
end)

test("the Data folder's downloads.json points the app at another index without a build", function()
  local asked
  local settings = Config.effective({ read = function(name) asked = name; return { indexUrl = "http://localhost:8000/index.json" } end })
  equal(asked, "downloads")
  equal(settings.indexUrl, "http://localhost:8000/index.json")
  equal(settings.reason, Config.reason)
end)

test("a downloads.json that says nothing usable leaves the default", function()
  equal(Config.effective({ read = function() return nil end }).indexUrl, Config.indexUrl)
  equal(Config.effective({ read = function() return { indexUrl = "" } end }).indexUrl, Config.indexUrl)
  equal(Config.effective({ read = function() return { indexUrl = 7 } end }).indexUrl, Config.indexUrl)
end)
