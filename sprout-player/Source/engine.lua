-- The engine as the UI sees it: the functions the C side registers under `sprout` (a JSON string
-- in, a JSON string out, since a registered function has no way to build a table), decoded into
-- tables. Nothing else in the Lua code reads the engine; everything crosses here.

local Engine = {}
Engine.__index = Engine

-- `api` is the `sprout` table the C side registers; `json` is the decoder (the system's).
function Engine.new(api, json)
  return setmetatable({ api = api, json = json }, Engine)
end

function Engine:decode(text)
  return self.json.decode(text)
end

-- Whether the cartridge at `path` can be shelved: { ok, name, reason }.
function Engine:inspect(path) return self:decode(self.api.inspect(path)) end

-- Loads the cartridge: { ok, name, hash, words, reason }.
function Engine:open(path) return self:decode(self.api.open(path)) end

-- Reads the save for the open world: { ok, fresh, nickname, present, last, lines }.
function Engine:load() return self:decode(self.api.load()) end

-- Admits the visitor: { admitted, words, lines }. Catch-up runs first and tells nothing.
function Engine:admit(nickname) return self:decode(self.api.admit(nickname)) end

-- The visitor's view: { place, description, exits, occupants, carried, chips }.
function Engine:view() return self:decode(self.api.view()) end

-- One command turn from a reading the sentence builder made: { committed, lines }.
function Engine:turn(reading) return self:decode(self.api.turn(self.json.encode(reading))) end

-- One tick turn: { ran, lines }.
function Engine:tick() return self:decode(self.api.tick()) end

-- Writes the save: { ok, words }.
function Engine:save() return self:decode(self.api.save()) end

-- The visitor leaves and the world is released: { lines }.
function Engine:close() return self:decode(self.api.close()) end

return Engine
