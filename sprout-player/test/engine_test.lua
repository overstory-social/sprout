local Engine = module("engine")
local test, equal = harness.test, harness.equal

-- The `sprout` table as the C side registers it: strings in, JSON strings out.
local function api(replies)
  local seen = {}
  local function call(name)
    return function(argument)
      seen[#seen + 1] = { name = name, argument = argument }
      return replies[name]
    end
  end
  local table_ = { seen = seen }
  for _, name in ipairs({ "inspect", "open", "load", "admit", "view", "turn", "tick", "save", "close", "verify", "digest" }) do
    table_[name] = call(name)
  end
  return table_
end

test("each call is decoded from the JSON the C side returns", function()
  local fake = api({
    inspect = '{"ok":true,"name":"chip_tree","reason":null}',
    open = '{"ok":true,"name":"chip_tree","hash":"abc","words":["guard"]}',
    load = '{"ok":true,"fresh":true,"nickname":null,"present":[],"last":0,"recovered":false,"words":""}',
    admit = '{"admitted":true,"words":"","visit":"visit:player","lines":[{"reader":"visit:player","kind":"described","text":"A hall."}]}',
    view = '{"place":"hall","description":["A hall."],"exits":[],"occupants":[],"carried":[],"chips":[],"faulted":false}',
    tick = '{"ran":false,"lines":[]}',
    save = '{"ok":true,"words":""}',
    close = '{"lines":[]}',
  })
  local engine = Engine.new(fake, json)
  equal(engine:inspect("a.sproutworld").name, "chip_tree")
  equal(engine:open("a.sproutworld").words[1], "guard")
  equal(engine:load().fresh, true)
  equal(engine:admit("Moss").lines[1].text, "A hall.")
  equal(engine:view().place, "hall")
  equal(engine:tick().ran, false)
  equal(engine:save().ok, true)
  equal(#engine:close().lines, 0)
  equal(fake.seen[1].argument, "a.sproutworld")
  equal(fake.seen[4].argument, "Moss")
end)

test("a signature check and a file digest cross as strings and come back decoded", function()
  local fake = api({
    verify = '{"ok":false,"reason":"The signature is not the one the key makes for this text."}',
    digest = '{"ok":true,"sha256":"ab","bytes":3}',
  })
  local engine = Engine.new(fake, json)
  local verdict = engine:verify("text", "sig", "key")
  equal(verdict.ok, false)
  equal(verdict.reason, "The signature is not the one the key makes for this text.")
  local digest = engine:digest("worlds/a.sproutworld.part")
  equal(digest.sha256, "ab")
  equal(digest.bytes, 3)
  equal(fake.seen[1].argument, "text")
  equal(fake.seen[2].argument, "worlds/a.sproutworld.part")
end)

test("a reading crosses as one JSON string", function()
  local fake = api({ turn = '{"committed":true,"result":"done","words":null,"lines":[]}' })
  local engine = Engine.new(fake, json)
  local result = engine:turn({ verb = "sprout.look", fillers = {} })
  equal(result.committed, true)
  equal(fake.seen[1].argument, '{"fillers":[],"verb":"sprout.look"}')
end)
