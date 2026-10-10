-- The sentence builder: the crank wheel over the view's chip tree (the spec's The runtime >
-- The view: a reading is offered as verb, fillers, the options of each value role, given per
-- role in the order the verb declares them). The visitor picks a verb, then what fills each of
-- its roles, then a word or a number for each value role, then confirms; A picks, B steps
-- back, the crank or the d-pad moves the wheel.
--
-- A leaf the consent pass refuses is drawn greyed with its reason and cannot be confirmed. A
-- set role is joined from the singletons the view offers: after the first member the wheel
-- offers the others and `that's all`; the roles after it are offered under the first member.
-- The view carries no intents, and the tree keeps no position for a value role, so a finished
-- reading lists its picked roles in the tree's order and then its value roles.
--
-- Nothing here touches the graphics API; `entries` and `phrase` are what the screen draws.

local Sentence = {}
Sentence.__index = Sentence

-- Degrees of crank for one step of the wheel.
Sentence.DEGREES_PER_STEP = 24
-- Numbers a d-pad left or right moves a number role by.
Sentence.BIG_STEP = 10

-- ---- what the wheel shows ----

local function verbLabel(qualified)
  local name = qualified:match("([^.]+)$") or qualified
  return (name:gsub("_", " "))
end

local function fillerLabel(filler)
  if filler.binds == "object" then return filler.name end
  if filler.binds == "set" then return table.concat(filler.names, ", ") end
  if filler.binds == "exit" then return filler.direction or filler.label end
  return filler.role
end

-- Whether nothing at or below `node` can be done: its reading and every choice are refused.
local function refusedAll(node)
  if node.leaf ~= nil and node.leaf.refused == nil then return false end
  for _, choice in ipairs(node.choices) do
    if not refusedAll(choice.next) then return false end
  end
  return true
end

-- The reason a leaf is refused, as one line.
local function reasonOf(leaf)
  if leaf.refused == nil then return nil end
  return table.concat(leaf.refused, " ")
end

-- ---- numbers ----

-- The nearest number a role takes at or beyond `from` in direction `dir` (1 or -1), or nil.
local function stepNumber(ranges, from, dir)
  local best = nil
  for _, range in ipairs(ranges) do
    local candidate
    if dir > 0 then
      candidate = math.max(from, range.min)
      if candidate <= range.max and (best == nil or candidate < best) then best = candidate end
    else
      candidate = math.min(from, range.max)
      if candidate >= range.min and (best == nil or candidate > best) then best = candidate end
    end
  end
  return best
end

-- ---- state ----

-- `view` is the decoded sprout.view(): its `chips` are the tree.
function Sentence.new(view)
  local self = setmetatable({ tree = view.chips or {}, history = {}, crank = 0 }, Sentence)
  self.state = { stage = "verb", picks = {}, values = {} }
  self.selected = 1
  return self
end

local function copyState(state)
  local picks, values = {}, {}
  for i, pick in ipairs(state.picks) do picks[i] = pick end
  for i, value in ipairs(state.values) do values[i] = value end
  local copy = {}
  for key, value in pairs(state) do copy[key] = value end
  copy.picks, copy.values = picks, values
  if state.members then
    copy.members = {}
    for i, member in ipairs(state.members) do copy.members[i] = member end
  end
  return copy
end

-- The wheel: a list of { kind, label, greyed, reason } for the stage the builder is at.
function Sentence:entries()
  local state = self.state
  local out = {}
  if state.stage == "verb" then
    for i, verb in ipairs(self.tree) do
      out[#out + 1] = { kind = "verb", label = verbLabel(verb.verb), greyed = refusedAll(verb.next), index = i }
    end
  elseif state.stage == "filler" then
    for i, choice in ipairs(state.node.choices) do
      out[#out + 1] = {
        kind = "filler", label = fillerLabel(choice.filler), greyed = refusedAll(choice.next), index = i,
      }
    end
    if state.node.leaf ~= nil then
      out[#out + 1] = { kind = "done", label = "that's all", greyed = state.node.leaf.refused ~= nil }
    end
  elseif state.stage == "more" then
    for i, choice in ipairs(state.node.choices) do
      local filler = choice.filler
      local fresh = filler.binds == "set" and not state.chosen[filler.ids[1]]
      if fresh then
        out[#out + 1] = { kind = "member", label = "and " .. fillerLabel(filler), greyed = false, index = i }
      end
    end
    out[#out + 1] = { kind = "done", label = "that's all", greyed = false }
  elseif state.stage == "option" then
    local role = state.leaf.options[state.role]
    if role.takes == "symbol" then
      for i, option in ipairs(role.options) do
        out[#out + 1] = { kind = "option", label = option.words, greyed = false, index = i }
      end
      if #role.options == 0 then
        out[#out + 1] = { kind = "none", label = "nothing to say", greyed = true,
          reason = "Nothing here can be said about that." }
      end
    else
      if state.number == nil then
        out[#out + 1] = { kind = "none", label = "no number", greyed = true,
          reason = "No number fits here." }
      else
        out[#out + 1] = { kind = "number", label = tostring(state.number), greyed = false }
      end
    end
  else
    local reason = reasonOf(state.leaf)
    out[#out + 1] = { kind = "confirm", label = self:phrase(), greyed = reason ~= nil, reason = reason }
  end
  return out
end

-- The sentence so far: the verb and what has been chosen, joined by arrows.
function Sentence:phrase()
  local state = self.state
  local parts = {}
  if state.verb ~= nil then parts[1] = verbLabel(state.verb.verb) end
  for _, pick in ipairs(state.picks) do parts[#parts + 1] = pick.label end
  if state.members ~= nil and #state.members > 0 then
    local names = {}
    for _, member in ipairs(state.members) do names[#names + 1] = member.name end
    parts[#parts + 1] = table.concat(names, ", ")
  end
  for _, value in ipairs(state.values) do parts[#parts + 1] = value.label end
  return table.concat(parts, " -> ")
end

-- ---- moving the wheel ----

function Sentence:count() return #self:entries() end

-- Moves the wheel by `steps` (wrapping).
function Sentence:move(steps)
  local n = self:count()
  if n == 0 then return end
  self.selected = (self.selected - 1 + steps) % n + 1
end

-- Turns the crank by `degrees`: a number role is stepped by it, any other wheel is moved a step
-- for each DEGREES_PER_STEP.
function Sentence:turn(degrees)
  self.crank = self.crank + degrees
  local steps = 0
  while self.crank >= Sentence.DEGREES_PER_STEP do
    self.crank = self.crank - Sentence.DEGREES_PER_STEP
    steps = steps + 1
  end
  while self.crank <= -Sentence.DEGREES_PER_STEP do
    self.crank = self.crank + Sentence.DEGREES_PER_STEP
    steps = steps - 1
  end
  if steps ~= 0 then self:nudge(steps) end
end

-- A step of the wheel: a number role changes its number by `steps`, other wheels move.
function Sentence:nudge(steps)
  local state = self.state
  if state.stage == "option" and state.leaf.options[state.role].takes == "integer" then
    self:addNumber(steps)
  else
    self:move(steps)
  end
end

-- The first or last number a role takes (`dir` 1 for the last, -1 for the first).
local function edge(ranges, dir)
  local found = nil
  for _, range in ipairs(ranges) do
    local value = dir > 0 and range.max or range.min
    if found == nil or (dir > 0 and value > found) or (dir < 0 and value < found) then found = value end
  end
  return found
end

-- Moves the number by `steps` (each a step of 1, or BIG_STEP when `big`, and a big step past the
-- end goes to the end).
function Sentence:addNumber(steps, big)
  local state = self.state
  local ranges = state.leaf.options[state.role].ranges
  if state.number == nil then return end
  local unit = big and Sentence.BIG_STEP or 1
  local dir = steps > 0 and 1 or -1
  for _ = 1, math.abs(steps) do
    local next = stepNumber(ranges, state.number + dir * unit, dir)
    if next == nil and big then next = edge(ranges, dir) end
    if next ~= nil then state.number = next end
  end
end

-- ---- picking ----

local function arrive(self, node, state)
  state.node = node
  if #node.choices > 0 then
    state.stage = "filler"
  else
    self:atLeaf(state, node.leaf)
  end
end

-- The builder reaches the end of the tree: the value roles of the leaf come next.
function Sentence:atLeaf(state, leaf)
  state.leaf = leaf
  state.role = 1
  self:startRole(state)
end

-- Begins the value role `state.role`, or the confirmation when there are none left.
function Sentence:startRole(state)
  local options = state.leaf.options
  if state.role > #options then
    state.stage = "confirm"
    return
  end
  state.stage = "option"
  local role = options[state.role]
  if role.takes == "integer" then
    state.number = stepNumber(role.ranges, -math.huge, 1)
  end
end

local function fillerOf(filler)
  local out = { role = filler.role, binds = filler.binds }
  if filler.binds == "object" then
    out.id = filler.id
  elseif filler.binds == "set" then
    out.ids = filler.ids
  elseif filler.binds == "exit" then
    out.direction, out.label, out.to = filler.direction, filler.label, filler.to
  end
  return out
end

-- Picks the selected entry. Returns "done" with the reading when the visitor confirms one, "refused"
-- with the reason when the reading cannot be confirmed, and nothing while the sentence goes on.
function Sentence:pick()
  local entries = self:entries()
  local entry = entries[self.selected]
  if entry == nil then return nil end
  local state = self.state
  if entry.kind == "none" or (entry.kind == "confirm" and entry.greyed) then
    return "refused", entry.reason
  end
  if entry.kind == "confirm" then return "done", self:reading() end
  self.history[#self.history + 1] = { state = copyState(state), selected = self.selected }
  local next = copyState(state)
  self.state = next
  if entry.kind == "verb" then
    local verb = self.tree[entry.index]
    next.verb = verb
    arrive(self, verb.next, next)
  elseif entry.kind == "filler" then
    local choice = state.node.choices[entry.index]
    if choice.filler.binds == "set" then
      next.setRole = choice.filler.role
      next.members = {}
      next.chosen = {}
      for i, id in ipairs(choice.filler.ids) do
        next.members[i] = { id = id, name = choice.filler.names[i] }
        next.chosen[id] = true
      end
      next.setNode = state.node
      next.setStart = choice
      next.stage = "more"
      next.node = state.node
    else
      next.picks[#next.picks + 1] = { filler = choice.filler, label = fillerLabel(choice.filler) }
      arrive(self, choice.next, next)
    end
  elseif entry.kind == "member" then
    local choice = state.node.choices[entry.index]
    for i, id in ipairs(choice.filler.ids) do
      next.members[#next.members + 1] = { id = id, name = choice.filler.names[i] }
      next.chosen[id] = true
    end
  elseif entry.kind == "done" and state.stage == "more" then
    local ids, names = {}, {}
    for i, member in ipairs(next.members) do ids[i], names[i] = member.id, member.name end
    next.picks[#next.picks + 1] = {
      filler = { role = next.setRole, binds = "set", ids = ids, names = names },
      label = table.concat(names, ", "),
    }
    next.members, next.chosen = nil, nil
    arrive(self, next.setStart.next, next)
  elseif entry.kind == "done" then
    self:atLeaf(next, state.node.leaf)
  elseif entry.kind == "option" then
    local role = state.leaf.options[state.role]
    local option = role.options[entry.index]
    next.values[#next.values + 1] = { role = role.role, value = option.value, label = option.words }
    next.role = state.role + 1
    self:startRole(next)
  elseif entry.kind == "number" then
    local role = state.leaf.options[state.role]
    next.values[#next.values + 1] = { role = role.role, value = state.number, label = tostring(state.number) }
    next.number = nil
    next.role = state.role + 1
    self:startRole(next)
  end
  self.selected = 1
  return nil
end

-- Steps back one pick. False when the builder is already at the first wheel.
function Sentence:back()
  local last = table.remove(self.history)
  if last == nil then return false end
  self.state = last.state
  self.selected = last.selected
  return true
end

-- Whether the builder is back at the verbs with nothing chosen.
function Sentence:atStart() return #self.history == 0 end

-- The reading the visitor has built, for the engine: the verb and a filler for each role filled.
function Sentence:reading()
  local state = self.state
  local fillers = {}
  for _, pick in ipairs(state.picks) do fillers[#fillers + 1] = fillerOf(pick.filler) end
  for _, value in ipairs(state.values) do
    fillers[#fillers + 1] = { role = value.role, binds = "value", value = value.value }
  end
  return { verb = state.verb.verb, fillers = fillers }
end

return Sentence
