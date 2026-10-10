-- The shelf: the cartridges the player can open. It lists `.sproutworld` files at the root of
-- the app and its Data folder and in each one's `worlds/` folder (`listFiles` reads both the
-- bundle and the Data folder; a copy in Data shadows the app's), and asks the engine whether
-- each can be shelved. One it refuses is listed greyed with the engine's reason, and cannot be
-- opened. Results are kept by file name and size, so a cartridge is inspected once. After the
-- last cartridge comes one more row, "more worlds", which opens the download screen; when the last
-- try at the network failed, `moreNote` says why and the shelf shows it under that row.

local Shelf = {}
Shelf.__index = Shelf

local SUFFIX = ".sproutworld"

local function isCartridge(name)
  return name:sub(-#SUFFIX) == SUFFIX
end

-- `files` has `listFiles(path)` as `playdate.file` does; `engine` has `inspect(path)`.
function Shelf.new(files, engine)
  return setmetatable({
    files = files, engine = engine, entries = {}, verdicts = {}, blocked = {}, selected = 1, crank = 0,
    moreNote = nil,
  }, Shelf)
end

-- The cartridge paths found, each once, in name order.
function Shelf:paths()
  local seen, out = {}, {}
  for _, folder in ipairs({ "", "worlds/" }) do
    for _, name in ipairs(self.files.listFiles(folder == "" and "/" or folder) or {}) do
      local path = folder .. name
      if isCartridge(name) and not seen[path] then
        seen[path] = true
        out[#out + 1] = path
      end
    end
  end
  table.sort(out)
  return out
end

-- Lists the shelf again. An entry is { path, title, hash, ok, reason }.
function Shelf:refresh()
  local entries = {}
  for _, path in ipairs(self:paths()) do
    local verdict = self.verdicts[path]
    if verdict == nil then
      verdict = self.engine:inspect(path)
      self.verdicts[path] = verdict
    end
    local title = verdict.name or path:match("([^/]+)$"):sub(1, -#SUFFIX - 1)
    local entry = { path = path, title = title, hash = verdict.hash, ok = verdict.ok, reason = verdict.reason }
    if verdict.ok and self.blocked[path] ~= nil then
      entry.ok, entry.reason, entry.blocked = false, self.blocked[path], true
    end
    entries[#entries + 1] = entry
  end
  self.entries = entries
  if self.selected > #entries + 1 then self.selected = #entries + 1 end
end

-- A world whose save could not be written is greyed with `reason` until a save succeeds (`unblock`).
function Shelf:block(path, reason) self.blocked[path] = reason end

function Shelf:unblock(path) self.blocked[path] = nil end

-- Forgets what was learned of the cartridges, for a shelf whose files have changed.
function Shelf:forget() self.verdicts = {} end

-- The selected cartridge, or nil where "more worlds" is selected.
function Shelf:current() return self.entries[self.selected] end

-- Whether the "more worlds" row is selected.
function Shelf:onMore() return self.selected == #self.entries + 1 end

-- Says why the last try at the network failed (nil clears it).
function Shelf:noteMore(reason) self.moreNote = reason end

function Shelf:move(steps)
  local n = #self.entries + 1
  self.selected = (self.selected - 1 + steps) % n + 1
end

function Shelf:turn(change, degreesPerStep)
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

return Shelf
