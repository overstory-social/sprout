local Net = module("net")
local test, equal, same = harness.test, harness.equal, harness.same

-- A scripted playdate.network. `script[n]` describes the nth connection made: its status, headers,
-- the body in the pieces it arrives in, whether it ever completes, an error, or `denied`.
local function network(script, options)
  options = options or {}
  local made, enabled = {}, {}
  local net = {
    kStatusNotAvailable = "n/a", kStatusConnected = "yes", kStatusNotConnected = "no",
    made = made, enabled = enabled,
    getStatus = function() return options.status or "no" end,
    setEnabled = function(flag, callback) enabled[#enabled + 1] = flag; if callback then callback(options.wifiError) end end,
  }
  net.http = {
    new = function(server, port, ssl, reason)
      local plan = script[#made + 1] or {}
      local conn = { server = server, port = port, ssl = ssl, reason = reason, closed = false, plan = plan, pieces = {}, sent = false }
      made[#made + 1] = conn
      if plan.denied then return nil end
      for i, piece in ipairs(plan.body or {}) do conn.pieces[i] = piece end
      function conn:setConnectTimeout(seconds) self.timeout = seconds end
      function conn:setRequestCompleteCallback(fn) self.onComplete = fn end
      function conn:setConnectionClosedCallback(fn) self.onClosed = fn end
      function conn:get(path, headers)
        self.path, self.headers = path, headers
        if plan.refuse then return false, plan.refuse end
        self.sent = true
        return true
      end
      function conn:getResponseStatus() return self.sent and plan.status or nil end
      function conn:getResponseHeaders() return plan.headers end
      function conn:getBytesAvailable() return self.pieces[1] and #self.pieces[1] or 0 end
      function conn:read(n)
        local piece = table.remove(self.pieces, 1)
        self.delivered = (self.delivered or 0) + 1
        if #self.pieces == 0 and not plan.stall and self.onComplete then self.complete = true end
        return piece and piece:sub(1, n)
      end
      function conn:getError() return plan.error end
      function conn:close() self.closed = true end
      return conn
    end,
  }
  return net
end

-- Polls until the transfer ends, returning what it collected and how it ended.
local function drain(transfer, limit)
  local result
  for tick = 1, limit or 20 do
    result = transfer:poll(tick)
    -- the scripted connection completes once its body has been read
    local conn = transfer.conn
    if conn.complete and conn.onComplete then conn.onComplete() end
    if result ~= nil then return result, tick end
  end
  return nil
end

test("an address is split into its parts, with the port its scheme implies", function()
  same({ Net.parseUrl("https://worlds.example/sprout/index.json").host }, { "worlds.example" })
  local parts = Net.parseUrl("https://worlds.example/sprout/index.json?x=1")
  equal(parts.ssl, true)
  equal(parts.port, 443)
  equal(parts.path, "/sprout/index.json?x=1")
  parts = Net.parseUrl("http://localhost:8080")
  equal(parts.ssl, false)
  equal(parts.port, 8080)
  equal(parts.path, "/")
  local none, reason = Net.parseUrl("ftp://example.com/a")
  equal(none, nil)
  equal(reason, "The address ftp://example.com/a is not an http or https address.")
  none, reason = Net.parseUrl("https:///a")
  equal(reason, "The address https:///a names no server.")
end)

test("an address found in a page is resolved against the page's", function()
  local base = "https://worlds.example/sprout/index.json"
  equal(Net.resolve(base, "https://cdn.example/a.sproutworld"), "https://cdn.example/a.sproutworld")
  equal(Net.resolve(base, "/other/a.sproutworld"), "https://worlds.example/other/a.sproutworld")
  equal(Net.resolve(base, "a.sproutworld"), "https://worlds.example/sprout/a.sproutworld")
  equal(Net.resolve("http://localhost:8080/x/index.json", "a/b.png"), "http://localhost:8080/x/a/b.png")
end)

test("a fetch asks for permission with its purpose, gets the body in pieces, and reports the status", function()
  local pd = network({ { status = 200, body = { "hel", "lo ", "world" } } })
  local net = Net.new(pd)
  local body = {}
  local transfer = net:get("https://worlds.example/sprout/index.json", "To fetch worlds.", function(chunk) body[#body + 1] = chunk end, 0)
  equal(pd.made[1].server, "worlds.example")
  equal(pd.made[1].port, 443)
  equal(pd.made[1].ssl, true)
  equal(pd.made[1].reason, "To fetch worlds.")
  equal(pd.made[1].path, "/sprout/index.json")
  local result = drain(transfer)
  equal(result.ok, true)
  equal(result.status, 200)
  equal(table.concat(body), "hello world")
  equal(pd.made[1].closed, true)
end)

test("permission refused for a server says so and starts nothing", function()
  local pd = network({ { denied = true } })
  local transfer, reason = Net.new(pd):get("https://worlds.example/index.json", "why", function() end, 0)
  equal(transfer, nil)
  equal(reason, "This app was not allowed to use the network for worlds.example. "
    .. "Choose \"more worlds\" again and allow it, or leave the shelf as it is.")
end)

test("a request that cannot be queued says why", function()
  local pd = network({ { refuse = "no route" } })
  local transfer, reason = Net.new(pd):get("https://worlds.example/index.json", "why", function() end, 0)
  equal(transfer, nil)
  equal(reason, "The request to worlds.example could not be made: no route")
  equal(pd.made[1].closed, true)
end)

test("a connection error ends the transfer with the server's name, and the Wi-Fi's own words if it gave any", function()
  local pd = network({ { status = 200, body = { "ab" }, error = "connection reset", stall = true } }, { wifiError = "no AP" })
  local net = Net.new(pd)
  net:ready()
  local transfer = net:get("https://worlds.example/index.json", "why", function() end, 0)
  local result = drain(transfer)
  equal(result.ok, false)
  equal(result.reason, "The connection to worlds.example failed: connection reset (no AP)")
end)

test("a transfer that stops delivering is given up on", function()
  local pd = network({ { status = 200, body = {}, stall = true } })
  local transfer = Net.new(pd):get("https://worlds.example/index.json", "why", function() end, 0)
  local result, tick = drain(transfer, 40)
  equal(result.ok, false)
  equal(result.reason, "worlds.example stopped answering. Check the Wi-Fi and try again.")
  assert(tick > 20, "gave up after " .. tick)
end)

test("a redirect is followed, its body is not delivered, and a loop ends", function()
  local pd = network({
    { status = 302, headers = { Location = "https://cdn.example/files/a.sproutworld" }, body = { "moved" } },
    { status = 200, body = { "the", " cartridge" } },
  })
  local body = {}
  local transfer = Net.new(pd):get("https://worlds.example/a.sproutworld", "why", function(chunk) body[#body + 1] = chunk end, 0)
  local result = drain(transfer)
  equal(result.ok, true)
  equal(table.concat(body), "the cartridge")
  equal(pd.made[2].server, "cdn.example")
  equal(pd.made[2].path, "/files/a.sproutworld")
  equal(pd.made[1].closed, true)

  local loop = {}
  for i = 1, 6 do loop[i] = { status = 301, headers = { Location = "/again" }, body = { "x" } } end
  transfer = Net.new(network(loop)):get("https://worlds.example/a", "why", function() end, 0)
  result = drain(transfer, 60)
  equal(result.ok, false)
  equal(result.reason, "worlds.example sent the app on to another address too many times, or to none.")
end)

test("no Wi-Fi network is said before any request, and the radio is asked up and let go", function()
  local pd = network({}, { status = "n/a" })
  local ready, reason = Net.new(pd):ready()
  equal(ready, false)
  equal(reason, "No Wi-Fi network is set up on this Playdate, so there is no way to reach the list of worlds. "
    .. "Add one in the Playdate's Settings, then try again.")
  local fine = network({})
  local net = Net.new(fine)
  equal(net:ready(), true)
  net:finish()
  same(fine.enabled, { true, false })
  local older, why = Net.new({}):ready()
  equal(older, false)
  equal(why, "This Playdate's system software has no network support. Update it to OS 2.7 or later.")
end)
