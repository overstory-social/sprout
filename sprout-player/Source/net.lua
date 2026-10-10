-- Fetching over `playdate.network.http` (Playdate OS 2.7), driven by polling from `update()`.
-- `http.new` asks the person's permission for a server, with the purpose string given here, by
-- pausing the runtime, so a request is started from `update()` and never from a callback.
-- A transfer hands each chunk of the body to a function as it arrives and is polled until it
-- finishes; a redirect is followed up to MAX_REDIRECTS times. Wi-Fi sleeps 30 seconds after the
-- last request, and `finish` turns it off sooner. Every refusal is a sentence for the person.

local Net = {}
Net.__index = Net

local CONNECT_SECONDS = 10
local STALL_SECONDS = 20
local MAX_REDIRECTS = 3
local MAX_READ = 65536
local REDIRECTS = { [301] = true, [302] = true, [303] = true, [307] = true, [308] = true }

-- The parts of an http or https address: { ssl, host, port, path }, or nil and the reason.
function Net.parseUrl(url)
  local scheme, rest = url:match("^(%a+)://(.*)$")
  if scheme == nil or (scheme ~= "http" and scheme ~= "https") then
    return nil, "The address " .. url .. " is not an http or https address."
  end
  local authority, path = rest:match("^([^/?#]*)(.*)$")
  local host, port = authority:match("^([^:]+):(%d+)$")
  if host == nil then host = authority end
  if host == "" or host:find("[@%s]") then return nil, "The address " .. url .. " names no server." end
  local ssl = scheme == "https"
  if path == "" or path:sub(1, 1) ~= "/" then path = "/" .. path end
  return { ssl = ssl, host = host, port = tonumber(port) or (ssl and 443 or 80), path = path }
end

-- `address` resolved against the address `base` it was found in.
function Net.resolve(base, address)
  if address:match("^%a+://") then return address end
  local parts = Net.parseUrl(base)
  if parts == nil then return address end
  local origin = (parts.ssl and "https://" or "http://") .. parts.host
  if (parts.ssl and parts.port ~= 443) or (not parts.ssl and parts.port ~= 80) then
    origin = origin .. ":" .. parts.port
  end
  if address:sub(1, 1) == "/" then return origin .. address end
  return origin .. parts.path:gsub("[?#].*$", ""):gsub("[^/]*$", "") .. address
end

-- `network` is playdate.network.
function Net.new(network)
  return setmetatable({ network = network, wifiError = nil }, Net)
end

-- Whether a request can be tried: true, or false and why not. Asks for the Wi-Fi to come up now,
-- since joining the access point can take ten seconds.
function Net:ready()
  local network = self.network
  if network == nil or network.http == nil then
    return false, "This Playdate's system software has no network support. Update it to OS 2.7 or later."
  end
  if network.getStatus ~= nil and network.getStatus() == network.kStatusNotAvailable then
    return false, "No Wi-Fi network is set up on this Playdate, so there is no way to reach the list of worlds. "
      .. "Add one in the Playdate's Settings, then try again."
  end
  self.wifiError = nil
  if network.setEnabled ~= nil then
    network.setEnabled(true, function(err) self.wifiError = err end)
  end
  return true
end

-- Wi-Fi is no longer needed.
function Net:finish()
  if self.network ~= nil and self.network.setEnabled ~= nil then self.network.setEnabled(false) end
end

local Transfer = {}
Transfer.__index = Transfer

-- Opens a connection for `transfer` to `url` and queues the request; true, or nil and the reason.
-- The connection's callbacks count only while it is the transfer's current one.
local function connect(transfer, url)
  local parts, why = Net.parseUrl(url)
  if parts == nil then return nil, why end
  local conn = transfer.net.network.http.new(parts.host, parts.port, parts.ssl, transfer.reason)
  if conn == nil then
    return nil, "This app was not allowed to use the network for " .. parts.host .. ". "
      .. "Choose \"more worlds\" again and allow it, or leave the shelf as it is."
  end
  transfer.conn, transfer.url, transfer.host, transfer.finished = conn, url, parts.host, false
  local function done() if transfer.conn == conn then transfer.finished = true end end
  if conn.setConnectTimeout ~= nil then conn:setConnectTimeout(CONNECT_SECONDS) end
  conn:setRequestCompleteCallback(done)
  conn:setConnectionClosedCallback(done)
  local queued, err = conn:get(parts.path, { ["User-Agent"] = "sprout-player" })
  if not queued then
    conn:close()
    return nil, "The request to " .. parts.host .. " could not be made" .. (err and (": " .. err) or ".")
  end
  return true
end

-- Starts fetching `url`, passing each chunk of the body to `onChunk`. Returns a transfer, or nil
-- and the reason there is none (no permission, a bad address).
function Net:get(url, reason, onChunk, now)
  local transfer = setmetatable({ net = self, reason = reason, onChunk = onChunk, hops = 0, lastProgress = now or 0 }, Transfer)
  local ok, why = connect(transfer, url)
  if not ok then return nil, why end
  return transfer
end

local function failed(self, reason)
  self.conn:close()
  return { ok = false, reason = reason }
end

-- Moves the transfer on at time `now` (seconds). Returns nil while it runs, then once { ok, status }
-- when it has finished or { ok = false, reason } when it cannot.
function Transfer:poll(now)
  local conn = self.conn
  local finished = self.finished
  local status = conn:getResponseStatus()
  local redirecting = status ~= nil and REDIRECTS[status] == true
  local available = conn:getBytesAvailable() or 0
  while available > 0 do
    local data = conn:read(math.min(available, MAX_READ))
    if data == nil or #data == 0 then break end
    self.lastProgress = now
    if not redirecting then self.onChunk(data) end
    available = conn:getBytesAvailable() or 0
  end
  local err = conn:getError()
  if err ~= nil then
    local detail = self.net.wifiError and (" (" .. self.net.wifiError .. ")") or ""
    return failed(self, "The connection to " .. self.host .. " failed: " .. err .. detail)
  end
  if finished then
    if status == nil then
      return failed(self, self.host .. " sent no answer.")
    end
    if redirecting then return self:follow() end
    conn:close()
    return { ok = true, status = status }
  end
  if now - self.lastProgress > STALL_SECONDS then
    return failed(self, self.host .. " stopped answering. Check the Wi-Fi and try again.")
  end
  return nil
end

-- Moves to the address a redirect names; the transfer carries on there.
function Transfer:follow()
  local headers = self.conn:getResponseHeaders() or {}
  local location = headers["Location"] or headers["location"]
  self.conn:close()
  if location == nil or self.hops >= MAX_REDIRECTS then
    return { ok = false, reason = self.host .. " sent the app on to another address too many times, or to none." }
  end
  self.hops = self.hops + 1
  local ok, why = connect(self, Net.resolve(self.url, location))
  if not ok then return { ok = false, reason = why } end
  return nil
end

-- Stops the transfer.
function Transfer:cancel() self.conn:close() end

return Net
