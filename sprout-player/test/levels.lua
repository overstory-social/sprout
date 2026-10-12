-- A stand-in for sprout.chips over a whole chip tree (the shape the fixtures hold): `levels(tree)`
-- is a fetch that answers one level at a time as the engine does. A verb's readings are asked for
-- only when a level under it is: at the root a verb not yet asked for has `greyed` and `reason`
-- nil, and the level under a verb carries the verb's own `greyed` and `reason`, worked out over its
-- subtree as the engine works them out. `fetched(verb)` says whether a verb has been asked for.
local function refusedAll(node)
  if node.leaf ~= nil and node.leaf.refused == nil then return false end
  for _, choice in ipairs(node.choices) do
    if not refusedAll(choice.next) then return false end
  end
  return true
end

local function reasonUnder(node)
  if node.leaf ~= nil and node.leaf.refused ~= nil then return table.concat(node.leaf.refused, " ") end
  if node.leaf == nil and node.choices[1] ~= nil then return reasonUnder(node.choices[1].next) end
  return nil
end

local function levels(tree)
  if tree.chips ~= nil then tree = tree.chips end
  local fetched = {}
  local fetch = function(path)
    if #path == 0 then
      local choices = {}
      for i, verb in ipairs(tree) do
        if fetched[i] then
          choices[i] = { verb = verb.verb, greyed = refusedAll(verb.next), reason = reasonUnder(verb.next) }
        else
          choices[i] = { verb = verb.verb }
        end
      end
      return { choices = choices, leaf = nil }
    end
    local verb = tree[path[1]]
    if verb == nil then return { ok = false, reason = "The path names no choice of the tree." } end
    fetched[path[1]] = true
    local node = verb.next
    for i = 2, #path do
      local choice = node.choices[path[i]]
      if choice == nil then return { ok = false, reason = "The path names no choice of the tree." } end
      node = choice.next
    end
    local choices = {}
    for i, choice in ipairs(node.choices) do
      choices[i] = { filler = choice.filler, greyed = refusedAll(choice.next), reason = reasonUnder(choice.next) }
    end
    local level = { choices = choices, leaf = node.leaf }
    if #path == 1 then
      level.greyed = refusedAll(verb.next)
      level.reason = reasonUnder(verb.next)
    end
    return level
  end
  return fetch, function(i) return fetched[i] == true end
end

return levels
