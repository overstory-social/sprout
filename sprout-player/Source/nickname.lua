-- The nickname picker (the spec's The host contract > Admission and identity). The device has
-- no keyboard, so a visitor picks a name from a pool of plain words; the picker offers those
-- that collide with nothing in the cartridge's word set and are not held by anyone present.
-- Words are folded as the TypeScript host folds a typed nickname: lower case, split on white
-- space. The pool is ASCII, so Lua's lower-casing is the same fold. The engine's own admission
-- (`sprout.admit`) stays the authority: it also refuses a reserved word or a word shaped like
-- source, and its words are shown when it refuses.

local Nickname = {}
Nickname.__index = Nickname

-- A nickname's length bound in characters; the engine holds the host's figure (24).
Nickname.MAX = 24

Nickname.POOL = {
  "Alder", "Aster", "Birch", "Bramble", "Briar", "Clover", "Cricket", "Dapple", "Ember", "Fennel",
  "Fern", "Finch", "Flint", "Gorse", "Hazel", "Heron", "Ivy", "Juniper", "Kestrel", "Larch",
  "Linnet", "Lupin", "Maple", "Marten", "Moss", "Nettle", "Newt", "Olive", "Otter", "Pebble",
  "Pippin", "Plover", "Quill", "Reed", "Robin", "Rowan", "Sorrel", "Sparrow", "Tansy", "Thistle",
  "Tern", "Vetch", "Willow", "Wren", "Yarrow",
}

-- The words of `text` as the host folds them.
function Nickname.fold(text)
  local words = {}
  for word in text:lower():gmatch("%S+") do words[#words + 1] = word end
  return words
end

-- The folded word of `nickname` that is in `wordSet` (a set keyed by word), or nil.
function Nickname.collision(nickname, wordSet)
  for _, word in ipairs(Nickname.fold(nickname)) do
    if wordSet[word] then return word end
  end
  return nil
end

-- A set keyed by folded word from a list of words.
function Nickname.setOf(list)
  local set = {}
  for _, word in ipairs(list or {}) do set[word:lower()] = true end
  return set
end

-- The names of `pool` a visitor may take: none collides with the word set, none is `taken` (a list
-- of nicknames present), and none is longer than MAX.
function Nickname.available(pool, words, taken)
  local wordSet = Nickname.setOf(words)
  local held = {}
  for _, name in ipairs(taken or {}) do held[table.concat(Nickname.fold(name), " ")] = true end
  local out = {}
  for _, name in ipairs(pool) do
    local folded = table.concat(Nickname.fold(name), " ")
    if utf8.len(name) <= Nickname.MAX and Nickname.collision(name, wordSet) == nil and not held[folded] then
      out[#out + 1] = name
    end
  end
  return out
end

-- A picker over `candidates`, starting at `preferred` (a returning visitor's last name) when that
-- is among them.
function Nickname.new(candidates, preferred)
  local self = setmetatable({ candidates = candidates, selected = 1, crank = 0 }, Nickname)
  if preferred ~= nil then
    for i, name in ipairs(candidates) do
      if name:lower() == preferred:lower() then self.selected = i end
    end
  end
  return self
end

function Nickname:current() return self.candidates[self.selected] end

function Nickname:move(steps)
  local n = #self.candidates
  if n == 0 then return end
  self.selected = (self.selected - 1 + steps) % n + 1
end

-- Turns the crank: a step for each `degrees` per step.
function Nickname:turn(change, degreesPerStep)
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

return Nickname
