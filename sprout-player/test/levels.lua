-- A stand-in for sprout.chips over a whole chip tree (the shape the view used to carry, which the
-- fixtures still hold): `levels(tree)` is a fetch that answers one level at a time, with each
-- choice's `greyed` and `reason` worked out over its subtree as the engine works them out.
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
  return function(path)
    if #path == 0 then
      local choices = {}
      for i, verb in ipairs(tree) do
        choices[i] = { verb = verb.verb, greyed = refusedAll(verb.next), reason = reasonUnder(verb.next) }
      end
      return { choices = choices, leaf = nil }
    end
    local verb = tree[path[1]]
    if verb == nil then return { ok = false, reason = "The path names no choice of the tree." } end
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
    return { choices = choices, leaf = node.leaf }
  end
end

return levels
