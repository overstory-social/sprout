-- The download screen: fetches the signed index of published worlds, lists what it holds, and
-- downloads the one chosen into the Data folder's `worlds/`, where the shelf finds it.
--
-- Nothing listed is trusted until the index's signature verifies (index.lua). A cartridge, and each
-- asset file beside it, is written as `<name>.part`, checked against the size and SHA-256 the
-- signed index gives, and only then renamed into place; the cartridge is renamed last, after the
-- engine has been asked whether it can be shelved and, if it can, whether its bundle hash is the
-- one the index lists (the spec's The compiler > What compiling produces: the hash is the world's
-- identity). A cartridge the engine refuses (a newer level, caps over this app's budgets, an
-- extension it lacks) is kept and shelved, greyed with the engine's reason.
--
-- The screen is polled from `update()`: `open` and `choose` start requests, and `update` moves the
-- running transfer on. It reaches the network through `deps.net` (net.lua) and the engine through
-- `deps.engine`; neither is imported here.

local Downloads = {}
Downloads.__index = Downloads

local FOLDER = "worlds"
local PART = ".part"
local SUFFIX = ".sproutworld"

-- A file-name stem from a title: lower case letters and digits, joined by hyphens, at most 24 long.
local function slug(title)
  local stem = title:lower():gsub("[^%w]+", "-"):gsub("^%-+", ""):gsub("%-+$", "")
  stem = stem:sub(1, 24):gsub("%-+$", "")
  return stem ~= "" and stem or "world"
end

-- `deps`: net, files (playdate.file), engine, json, canonical, index, config ({ indexUrl, reason }),
-- publicKey (hexadecimal), installed (a function returning the set of bundle hashes on the shelf).
function Downloads.new(deps)
  return setmetatable({
    deps = deps, phase = "idle", worlds = {}, selected = 1, crank = 0,
    status = "", failure = nil, notice = nil, transfer = nil, arrived = nil, plan = nil,
  }, Downloads)
end

-- Whether a transfer is running.
function Downloads:busy() return self.phase == "index" or self.phase == "world" end

-- ---- the index ----

local function failIndex(self, reason)
  self.phase, self.failure, self.status, self.transfer, self.chunks = "failed", reason, "", nil, nil
  self.deps.net:finish()
end

-- Begins fetching the index. Called from `update()`, since the first request to a server asks the
-- person's permission.
function Downloads:open(now)
  self:cancel()
  self.worlds, self.selected, self.failure, self.notice, self.arrived = {}, 1, nil, nil, nil
  local deps = self.deps
  local ready, reason = deps.net:ready()
  if not ready then return failIndex(self, reason) end
  self.phase, self.status = "index", "Asking for the list of worlds..."
  self.chunks, self.size = {}, 0
  local transfer, why = deps.net:get(deps.config.indexUrl, deps.config.reason, function(chunk)
    self.size = self.size + #chunk
    if self.size <= deps.index.MAX_BYTES then self.chunks[#self.chunks + 1] = chunk end
  end, now)
  if transfer == nil then return failIndex(self, why) end
  self.transfer = transfer
end

local function statusWords(status, what)
  if status == 404 then return "There is no " .. what .. " at that address (the server answered 404)." end
  return "The server answered " .. tostring(status) .. " for the " .. what .. "."
end

local function indexArrived(self, result)
  local deps = self.deps
  if not result.ok then return failIndex(self, result.reason) end
  if result.status ~= 200 then return failIndex(self, statusWords(result.status, "list of worlds")) end
  if self.size > deps.index.MAX_BYTES then
    return failIndex(self, "The list of worlds is larger than this app reads, so it was not used.")
  end
  local text = table.concat(self.chunks)
  local read = deps.index.read(text, {
    json = deps.json,
    canonical = deps.canonical,
    verify = function(signed, signature) return deps.engine:verify(signed, signature, deps.publicKey).ok end,
  })
  if not read.ok then return failIndex(self, read.reason) end
  self.worlds, self.phase, self.status, self.transfer, self.chunks = read.worlds, "list", "", nil, nil
end

-- ---- the list ----

function Downloads:move(steps)
  local n = #self.worlds
  if n > 0 then self.selected = (self.selected - 1 + steps) % n + 1 end
end

function Downloads:turn(change, degreesPerStep)
  self.crank = self.crank + change
  while self.crank >= degreesPerStep do
    self.crank = self.crank - degreesPerStep
    self:move(1)
  end
  while self.crank <= -degreesPerStep do
    self.crank = self.crank + degreesPerStep
    self:move(-1)
  end
end

function Downloads:current() return self.worlds[self.selected] end

-- One line for each listed world: { text, onShelf }.
function Downloads:rows()
  local on = self.deps.installed()
  local rows = {}
  for _, world in ipairs(self.worlds) do
    local onShelf = on[world.hash] == true
    rows[#rows + 1] = {
      text = world.title .. "  " .. world.version .. "  " .. self.deps.index.size(world.bytes) .. (onShelf and "  (on your shelf)" or ""),
      onShelf = onShelf,
    }
  end
  return rows
end

-- The words for the panel under the list: what is happening, what went wrong, what happened, or
-- what the selected world is.
function Downloads:panel()
  if self:busy() then return self.status end
  if self.failure ~= nil then return self.failure end
  if self.notice ~= nil then return self.notice end
  local world = self:current()
  if world == nil then return "" end
  local on = self.deps.installed()
  local line = "by " .. world.author .. ", version " .. world.version .. ", " .. self.deps.index.size(world.bytes)
  if on[world.hash] then return line .. ". It is on your shelf." end
  return line .. ". A downloads it."
end

-- ---- one world ----

-- Makes the folders `path` is in, one level at a time.
local function ensureFolders(files, path)
  local folder = ""
  for part in path:gmatch("([^/]+)/") do
    folder = folder == "" and part or (folder .. "/" .. part)
    files.mkdir(folder)
  end
end

local function buildPlan(self, world)
  local net, base = self.deps.net, self.deps.config.indexUrl
  local stem = slug(world.title) .. "-" .. world.hash:sub(1, 8)
  local final = FOLDER .. "/" .. stem .. SUFFIX
  local steps = {
    { kind = "cartridge", label = world.title, url = net.resolve(base, world.url), bytes = world.bytes,
      sha256 = world.sha256, final = final, part = final .. PART },
  }
  for _, asset in ipairs(world.assets or {}) do
    local path = final .. ".assets/" .. asset.path
    steps[#steps + 1] = { kind = "asset", label = asset.path, url = net.resolve(base, asset.url),
      bytes = asset.bytes, sha256 = asset.sha256, final = path, part = path .. PART }
  end
  return { world = world, final = final, steps = steps, at = 0 }
end

-- Removes what a world that did not arrive left: its parts, and its assets if the cartridge never
-- came to be.
local function cleanup(self)
  local plan, files = self.plan, self.deps.files
  if plan == nil then return end
  for _, step in ipairs(plan.steps) do
    if step.handle ~= nil then
      step.handle:close()
      step.handle = nil
    end
    if files.exists(step.part) then files.delete(step.part) end
  end
  if not files.exists(plan.final) and files.exists(plan.final .. ".assets") then
    files.delete(plan.final .. ".assets", true)
  end
  self.plan = nil
end

local function failWorld(self, reason)
  local title = self.plan and self.plan.world.title or "that world"
  if self.transfer ~= nil then self.transfer:cancel() end
  cleanup(self)
  self.phase, self.transfer, self.overrun, self.writeFailed = "list", nil, false, false
  self.failure = "Could not download " .. title .. ". " .. reason
  self.notice = nil
end

-- Starts the next file of the plan, or finishes the world.
local finishWorld

local function startStep(self, now)
  local plan = self.plan
  plan.at = plan.at + 1
  local step = plan.steps[plan.at]
  if step == nil then return finishWorld(self) end
  local deps = self.deps
  ensureFolders(deps.files, step.part)
  local handle = deps.files.open(step.part, deps.files.kFileWrite)
  if handle == nil then
    return failWorld(self, "The file " .. step.part .. " could not be made. Is the Playdate out of room?")
  end
  step.handle, step.written = handle, 0
  self.overrun, self.writeFailed = false, false
  self.status = "Downloading " .. plan.world.title .. ": file " .. plan.at .. " of " .. #plan.steps .. " ("
    .. step.label .. ", " .. deps.index.size(step.bytes) .. ")..."
  local transfer, why = deps.net:get(step.url, deps.config.reason, function(chunk)
    if self.overrun or self.writeFailed then return end
    if step.written + #chunk > step.bytes then
      self.overrun = true
      return
    end
    local wrote = handle:write(chunk)
    if wrote == nil or wrote < #chunk then
      self.writeFailed = true
      return
    end
    step.written = step.written + #chunk
  end, now)
  if transfer == nil then return failWorld(self, why) end
  self.transfer = transfer
end

-- Moves a finished file of the index into place, replacing one of the same name.
local function place(self, step)
  local files = self.deps.files
  if files.exists(step.final) then files.delete(step.final) end
  return files.rename(step.part, step.final) ~= false
end

finishWorld = function(self)
  local deps, plan = self.deps, self.plan
  local cartridge = plan.steps[1]
  local verdict = deps.engine:inspect(cartridge.part)
  if verdict.ok and verdict.hash ~= plan.world.hash then
    return failWorld(self, "The cartridge that arrived is not the build the list describes (its bundle hash differs), so it was thrown away.")
  end
  if not place(self, cartridge) then
    return failWorld(self, "The finished file could not be put on the shelf. Is the Playdate out of room?")
  end
  self.arrived = { path = plan.final, title = plan.world.title, ok = verdict.ok, reason = verdict.reason }
  self.phase, self.plan, self.transfer, self.failure = "list", nil, nil, nil
  if verdict.ok then
    self.notice = plan.world.title .. " is on your shelf."
  else
    self.notice = plan.world.title .. " is on your shelf, greyed: " .. (verdict.reason or "this app cannot play it.")
  end
end

local function stepArrived(self, result, now)
  local plan, deps = self.plan, self.deps
  local step = plan.steps[plan.at]
  step.handle:close()
  step.handle = nil
  if self.overrun then
    return failWorld(self, step.label .. " is longer than the list says it is, so it was thrown away.")
  end
  if self.writeFailed then
    return failWorld(self, "The file " .. step.part .. " could not be written. Is the Playdate out of room?")
  end
  if not result.ok then return failWorld(self, result.reason) end
  if result.status ~= 200 then return failWorld(self, statusWords(result.status, step.label)) end
  if step.written ~= step.bytes then
    return failWorld(self, step.label .. " arrived as " .. step.written .. " bytes, and the list says " .. step.bytes .. ".")
  end
  local digest = deps.engine:digest(step.part)
  if not digest.ok or digest.sha256 ~= step.sha256 then
    return failWorld(self, step.label .. " does not match the checksum in the list, so it was thrown away.")
  end
  self.transfer = nil
  if step.kind == "asset" and not place(self, step) then
    return failWorld(self, "The file " .. step.label .. " could not be put in place. Is the Playdate out of room?")
  end
  return startStep(self, now)
end

-- Downloads the selected world. Called from `update()`.
function Downloads:choose(now)
  if self.phase ~= "list" then return end
  local world = self:current()
  if world == nil then return end
  self.failure, self.notice, self.arrived = nil, nil, nil
  if self.deps.installed()[world.hash] then
    self.notice = world.title .. " is already on your shelf."
    return
  end
  self.plan = buildPlan(self, world)
  self.phase = "world"
  startStep(self, now)
end

-- ---- the loop ----

-- Moves the running transfer on at time `now` (seconds).
function Downloads:update(now)
  if self.transfer == nil then return end
  local result = self.transfer:poll(now)
  if self.phase == "world" and (self.overrun or self.writeFailed) then
    self.transfer:cancel()
    result = result or { ok = true, status = 200 }
  end
  if result == nil then return end
  if self.phase == "index" then
    indexArrived(self, result)
  elseif self.phase == "world" then
    stepArrived(self, result, now)
  end
end

-- The cartridge just put on the shelf, once: { path, title, ok, reason }, or nil.
function Downloads:takeArrived()
  local arrived = self.arrived
  self.arrived = nil
  return arrived
end

-- Stops what is running and leaves nothing half written.
function Downloads:cancel()
  if self.transfer ~= nil then self.transfer:cancel() end
  cleanup(self)
  self.transfer, self.chunks = nil, nil
  if self.phase == "index" or self.phase == "world" then self.phase = self.phase == "index" and "failed" or "list" end
end

-- The screen is left: stop, and let the Wi-Fi sleep.
function Downloads:close()
  self:cancel()
  self.deps.net:finish()
  self.phase, self.status = "idle", ""
end

-- The reason the last try at the index failed, or nil: the shelf says it under "more worlds".
function Downloads:indexFailure()
  return self.phase == "failed" and self.failure or nil
end

return Downloads
