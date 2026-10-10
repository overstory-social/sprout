-- The shelf: the cartridges the player can open. It lists `.sproutworld` files at the root of
-- the app and its Data folder and in each one's `worlds/` folder (`listFiles` reads both the
-- bundle and the Data folder; a copy in Data shadows the app's), and asks the engine whether
-- each can be shelved. One it refuses is listed greyed with the engine's reason, and cannot be
-- opened. Results are kept by file name and size, so a cartridge is inspected once.

local Shelf = {}
Shelf.__index = Shelf

local SUFFIX = ".sproutworld"

local function isCartridge(name)
  return name:sub(-#SUFFIX) == SUFFIX
end

-- `files` has `listFiles(path)` as `playdate.file` does; `engine` has `inspect(path)`.
function Shelf.new(files, engine)
  return setmetatable({
    files = files, engine = engine, entries = {}, verdicts = {}, selected = 1, crank = 0,
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

-- Lists the shelf again. An entry is { path, title, ok, reason }.
function Shelf:refresh()
  local entries = {}
  for _, path in ipairs(self:paths()) do
    local verdict = self.verdicts[path]
    if verdict == nil then
      verdict = self.engine:inspect(path)
      self.verdicts[path] = verdict
    end
    local title = verdict.name or path:match("([^/]+)$"):sub(1, -#SUFFIX - 1)
    entries[#entries + 1] = { path = path, title = title, ok = verdict.ok, reason = verdict.reason }
  end
  self.entries = entries
  if self.selected > #entries then self.selected = math.max(1, #entries) end
end

-- Forgets what was learned of the cartridges, for a shelf whose files have changed.
function Shelf:forget() self.verdicts = {} end

function Shelf:current() return self.entries[self.selected] end

function Shelf:move(steps)
  local n = #self.entries
  if n == 0 then return end
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
