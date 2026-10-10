local Downloads = module("downloads")
local Index = module("index")
local Canonical = module("canonical")
local Net = module("net")
local test, equal = harness.test, harness.equal

local INDEX_URL = "https://worlds.example/sprout/index.json"
local KEY = "k"
local CONFIG = { indexUrl = INDEX_URL, reason = "To fetch worlds." }

-- A 64 digit stand-in for a SHA-256, different for different content.
local function sha(content)
  local a, b, c, d = 7, 11, 13, 17
  for i = 1, #content do
    local byte = content:byte(i)
    a, b, c, d = (a * 31 + byte) % 2 ^ 40, (b * 37 + byte * i) % 2 ^ 40, (c * 41 + byte) % 2 ^ 40, (d * 43 + a) % 2 ^ 40
  end
  return string.format("%016x%016x%016x%016x", a // 1, b // 1, c // 1, d // 1)
end

-- ---- the fakes ----

local function newFiles(options)
  options = options or {}
  local files = { store = {}, folders = {}, kFileWrite = "w", denyOpen = options.denyOpen }
  function files.open(path, mode)
    if files.denyOpen and path:find(files.denyOpen, 1, true) then return nil, "full" end
    files.store[path] = ""
    return {
      write = function(_, chunk) files.store[path] = files.store[path] .. chunk; return #chunk end,
      close = function() end,
    }
  end
  function files.exists(path)
    if files.store[path] ~= nil then return true end
    for name in pairs(files.store) do
      if name:sub(1, #path + 1) == path .. "/" then return true end
    end
    return false
  end
  function files.delete(path, recursive)
    files.store[path] = nil
    if recursive then
      for name in pairs(files.store) do
        if name:sub(1, #path + 1) == path .. "/" then files.store[name] = nil end
      end
    end
  end
  function files.rename(from, to) files.store[to], files.store[from] = files.store[from], nil end
  function files.mkdir(path) files.folders[path] = true end
  function files.names()
    local names = {}
    for name in pairs(files.store) do names[#names + 1] = name end
    table.sort(names)
    return names
  end
  return files
end

-- Routes: url -> { status, body, fail }. A transfer delivers its body four bytes to a poll, or `options.chunk`.
local function newNet(routes, options)
  options = options or {}
  local net = { asked = {}, finished = 0, resolve = Net.resolve, cancelled = 0 }
  function net:ready() if options.offline then return false, options.offline end return true end
  function net:finish() self.finished = self.finished + 1 end
  function net:get(url, reason, onChunk)
    self.asked[#self.asked + 1] = { url = url, reason = reason }
    if options.denied then return nil, options.denied end
    local route = routes[url] or { status = 404, body = "" }
    local at = 0
    local transfer = {}
    function transfer:poll()
      if route.fail then return { ok = false, reason = route.fail } end
      if at < #route.body then
        local size = options.chunk or 4
        onChunk(route.body:sub(at + 1, at + size))
        at = at + size
        return nil
      end
      return { ok = true, status = route.status }
    end
    function transfer.cancel() net.cancelled = net.cancelled + 1 end
    return transfer
  end
  return net
end

local function newEngine(files, verdicts)
  local engine = { verdicts = verdicts or {} }
  function engine:verify(text, signature, key)
    return { ok = key == KEY and signature == "sig:" .. text }
  end
  function engine:digest(path)
    local content = files.store[path]
    if content == nil then return { ok = false, reason = "The file cannot be read." } end
    return { ok = true, sha256 = sha(content), bytes = #content }
  end
  function engine:inspect(path)
    local content = files.store[path]
    return self.verdicts[content] or { ok = true, name = "world", hash = content and content:match("^hash=(%x+)") or "" }
  end
  return engine
end

-- ---- a published world ----

local function bundleHash(letter) return letter:rep(64) end

-- A cartridge's content is "hash=<its bundle hash>;..." so the fake engine reads its hash from it.
local function cartridge(letter, filler) return "hash=" .. bundleHash(letter) .. ";" .. (filler or "cartridge") end

local CELLAR = "PNG-cellar"
local CABINET = "PNG-cabinet"

local function world(letter, title, extra)
  local content = cartridge(letter)
  local entry = {
    title = title, author = "Ada", version = "1.2.0", bytes = #content, hash = bundleHash(letter), sha256 = sha(content),
    url = "https://worlds.example/sprout/" .. title:lower() .. ".sproutworld",
  }
  for key, value in pairs(extra or {}) do entry[key] = value end
  return entry, content
end

local function publish(worlds) return json.encode({ worlds = worlds, signed = "sig:" .. Canonical.text(worlds) }) end

-- A screen over fakes. `bodies` are the files the server holds by address.
local function screen(worlds, bodies, options)
  options = options or {}
  local files = newFiles(options)
  local routes = {}
  routes[INDEX_URL] = { status = 200, body = options.index or publish(worlds) }
  for url, body in pairs(bodies or {}) do routes[url] = type(body) == "table" and body or { status = 200, body = body } end
  local net = newNet(routes, options)
  local engine = newEngine(files, options.verdicts)
  local on = options.installed or {}
  local downloads = Downloads.new({
    net = net, files = files, engine = engine, json = json, canonical = Canonical, index = Index,
    config = CONFIG, publicKey = KEY, installed = function() return on end,
  })
  return downloads, net, files, engine
end

-- Runs the screen's loop until nothing is running.
local function settle(downloads)
  for tick = 1, 400 do
    if not downloads:busy() then return tick end
    downloads:update(tick)
  end
  error("the screen never settled")
end

local function opened(downloads)
  downloads:open(0)
  settle(downloads)
end

-- ---- the index ----

test("the signed index is fetched with the purpose string, verified, and listed with title, version and size", function()
  local entry = world("a", "Moss")
  local downloads, net = screen({ entry })
  opened(downloads)
  equal(downloads.phase, "list")
  equal(net.asked[1].url, INDEX_URL)
  equal(net.asked[1].reason, "To fetch worlds.")
  local rows = downloads:rows()
  equal(#rows, 1)
  equal(rows[1].text, "Moss  1.2.0  " .. Index.size(entry.bytes))
  equal(rows[1].onShelf, false)
  equal(downloads:panel(), "by Ada, version 1.2.0, " .. Index.size(entry.bytes) .. ". A downloads it.")
end)

test("an index tampered with on the way is refused with words, lists nothing, and lets the Wi-Fi sleep", function()
  local entry = world("a", "Moss")
  local text = publish({ entry }):gsub('"Ada"', '"Eve"')
  local downloads, net = screen({ entry }, nil, { index = text })
  opened(downloads)
  equal(downloads.phase, "failed")
  equal(#downloads:rows(), 0)
  equal(downloads:indexFailure(), "The list of worlds did not pass its signature check, so nothing in it was used. "
    .. "It was changed on the way, or it was not signed by the publisher this app trusts.")
  equal(net.finished, 1)
  -- choosing does nothing when there is nothing listed
  downloads:choose(0)
  equal(#net.asked, 1)
end)

test("an index signed by another key is refused the same way", function()
  local entry = world("a", "Moss")
  local downloads = screen({ entry }, nil, { index = json.encode({ worlds = { entry }, signed = "sig:other" }) })
  opened(downloads)
  equal(downloads.phase, "failed")
  assert(downloads:indexFailure():find("signature check", 1, true))
end)

test("no network is said at once, and nothing is requested", function()
  local downloads, net = screen({}, nil, { offline = "No Wi-Fi network is set up on this Playdate." })
  downloads:open(0)
  equal(downloads.phase, "failed")
  equal(downloads:indexFailure(), "No Wi-Fi network is set up on this Playdate.")
  equal(#net.asked, 0)
end)

test("permission refused for the server is said, and the screen can try again", function()
  local downloads = screen({}, nil, { denied = "This app was not allowed to use the network for worlds.example." })
  downloads:open(0)
  equal(downloads.phase, "failed")
  equal(downloads:indexFailure(), "This app was not allowed to use the network for worlds.example.")
  downloads:open(1)
  equal(downloads.phase, "failed")
end)

test("a missing index and a server error are told with the status", function()
  local downloads = screen({}, { [INDEX_URL] = { status = 404, body = "nope" } })
  opened(downloads)
  equal(downloads:indexFailure(), "There is no list of worlds at that address (the server answered 404).")
  downloads = screen({}, { [INDEX_URL] = { status = 503, body = "busy" } })
  opened(downloads)
  equal(downloads:indexFailure(), "The server answered 503 for the list of worlds.")
  downloads = screen({}, { [INDEX_URL] = { fail = "The connection to worlds.example failed: reset" } })
  opened(downloads)
  equal(downloads:indexFailure(), "The connection to worlds.example failed: reset")
end)

test("an index larger than the app reads is refused whole", function()
  local downloads = screen({}, nil, { index = string.rep("x", Index.MAX_BYTES + 1), chunk = 70000 })
  opened(downloads)
  equal(downloads:indexFailure(), "The list of worlds is larger than this app reads, so it was not used.")
end)

-- ---- a download ----

test("a chosen world is downloaded with its assets, checked, put on the shelf, and reported once", function()
  local entry, content = world("a", "Moss", {
    assets = {
      { path = "cellar.png", bytes = #CELLAR, sha256 = sha(CELLAR), url = "assets/cellar.png" },
      { path = "pictures/cabinet.png", bytes = #CABINET, sha256 = sha(CABINET), url = "https://cdn.example/cabinet.png" },
    },
  })
  local downloads, net, files = screen({ entry }, {
    [entry.url] = content,
    ["https://worlds.example/sprout/assets/cellar.png"] = CELLAR,
    ["https://cdn.example/cabinet.png"] = CABINET,
  })
  opened(downloads)
  downloads:choose(0)
  equal(downloads.phase, "world")
  equal(downloads:busy(), true)
  assert(downloads:panel():find("Downloading Moss: file 1 of 3", 1, true), downloads:panel())
  settle(downloads)
  local final = "worlds/moss-aaaaaaaa.sproutworld"
  equal(files.store[final], content)
  equal(files.store[final .. ".assets/cellar.png"], CELLAR)
  equal(files.store[final .. ".assets/pictures/cabinet.png"], CABINET)
  equal(#files.names(), 3, "no .part file is left")
  equal(files.folders["worlds"], true)
  equal(files.folders[final .. ".assets"], true)
  equal(files.folders[final .. ".assets/pictures"], true)
  equal(net.asked[2].url, entry.url)
  equal(net.asked[2].reason, "To fetch worlds.")
  equal(net.asked[3].url, "https://worlds.example/sprout/assets/cellar.png")
  equal(net.asked[4].url, "https://cdn.example/cabinet.png")
  local arrived = downloads:takeArrived()
  equal(arrived.path, final)
  equal(arrived.title, "Moss")
  equal(arrived.ok, true)
  equal(downloads:takeArrived(), nil)
  equal(downloads:panel(), "Moss is on your shelf.")
  equal(downloads.phase, "list")
end)

test("a world already on the shelf is not downloaded again", function()
  local entry = world("a", "Moss")
  local downloads, net = screen({ entry }, nil, { installed = { [entry.hash] = true } })
  opened(downloads)
  equal(downloads:rows()[1].onShelf, true)
  downloads:choose(0)
  equal(downloads.phase, "list")
  equal(downloads:panel(), "Moss is already on your shelf.")
  equal(#net.asked, 1)
end)

test("a cartridge that does not match the index's checksum is thrown away, with nothing left behind", function()
  local entry, content = world("a", "Moss", {
    assets = { { path = "cellar.png", bytes = #CELLAR, sha256 = sha(CELLAR), url = "assets/cellar.png" } },
  })
  local tampered = content:sub(1, -2) .. "!"
  local downloads, _, files = screen({ entry }, { [entry.url] = tampered })
  opened(downloads)
  downloads:choose(0)
  settle(downloads)
  equal(downloads.phase, "list")
  equal(downloads:panel(), "Could not download Moss. Moss does not match the checksum in the list, so it was thrown away.")
  equal(#files.names(), 0)
  equal(downloads:takeArrived(), nil)
end)

test("a cartridge of the right bytes but another build is refused with words", function()
  local entry, content = world("a", "Moss")
  entry.hash = bundleHash("b")
  local downloads, _, files = screen({ entry }, { [entry.url] = content })
  opened(downloads)
  downloads:choose(0)
  settle(downloads)
  equal(downloads:panel(), "Could not download Moss. The cartridge that arrived is not the build the list describes "
    .. "(its bundle hash differs), so it was thrown away.")
  equal(#files.names(), 0)
end)

test("a file shorter or longer than the index says is refused, and a longer one is cut off", function()
  local entry, content = world("a", "Moss")
  local downloads, _, files = screen({ entry }, { [entry.url] = content:sub(1, -3) })
  opened(downloads)
  downloads:choose(0)
  settle(downloads)
  equal(downloads:panel(), "Could not download Moss. Moss arrived as " .. (#content - 2) .. " bytes, and the list says "
    .. #content .. ".")
  equal(#files.names(), 0)

  downloads, _, files = screen({ entry }, { [entry.url] = content .. string.rep("x", 40) })
  local net = nil
  opened(downloads)
  net = downloads.deps.net
  downloads:choose(0)
  settle(downloads)
  equal(downloads:panel(), "Could not download Moss. Moss is longer than the list says it is, so it was thrown away.")
  assert(net.cancelled >= 1, "the transfer was stopped")
  equal(#files.names(), 0)
end)

test("a world the app cannot play is kept and shelved, and the screen says it is greyed with the engine's reason", function()
  local entry, content = world("a", "Moss")
  local reason = "This cartridge was made for language level 9, and this runtime reads up to level 1. Update the runtime, or pack the world again with this one."
  local downloads, _, files = screen({ entry }, { [entry.url] = content }, {
    verdicts = { [content] = { ok = false, reason = reason } },
  })
  opened(downloads)
  downloads:choose(0)
  settle(downloads)
  equal(files.store["worlds/moss-aaaaaaaa.sproutworld"], content)
  local arrived = downloads:takeArrived()
  equal(arrived.ok, false)
  equal(arrived.reason, reason)
  equal(downloads:panel(), "Moss is on your shelf, greyed: " .. reason)
end)

test("a connection that breaks part way through the assets removes the parts and the assets already placed", function()
  local entry, content = world("a", "Moss", {
    assets = {
      { path = "cellar.png", bytes = #CELLAR, sha256 = sha(CELLAR), url = "assets/cellar.png" },
      { path = "cabinet.png", bytes = #CABINET, sha256 = sha(CABINET), url = "assets/cabinet.png" },
    },
  })
  local downloads, _, files = screen({ entry }, {
    [entry.url] = content,
    ["https://worlds.example/sprout/assets/cellar.png"] = CELLAR,
    ["https://worlds.example/sprout/assets/cabinet.png"] = { fail = "The connection to worlds.example failed: reset" },
  })
  opened(downloads)
  downloads:choose(0)
  settle(downloads)
  equal(downloads:panel(), "Could not download Moss. The connection to worlds.example failed: reset")
  equal(#files.names(), 0, "nothing is left of a world that did not arrive")
  equal(downloads:takeArrived(), nil)
end)

test("an asset the server does not have stops the world with the status", function()
  local entry, content = world("a", "Moss", {
    assets = { { path = "cellar.png", bytes = 4, sha256 = sha("PNG!"), url = "assets/cellar.png" } },
  })
  local downloads, _, files = screen({ entry }, { [entry.url] = content })
  opened(downloads)
  downloads:choose(0)
  settle(downloads)
  equal(downloads:panel(), "Could not download Moss. There is no cellar.png at that address (the server answered 404).")
  equal(#files.names(), 0)
end)

test("a file that cannot be made says the Playdate may be out of room", function()
  local entry, content = world("a", "Moss")
  local downloads, _, files = screen({ entry }, { [entry.url] = content }, { denyOpen = ".part" })
  opened(downloads)
  downloads:choose(0)
  equal(downloads.phase, "list")
  equal(downloads:panel(), "Could not download Moss. The file worlds/moss-aaaaaaaa.sproutworld.part could not be made. "
    .. "Is the Playdate out of room?")
  equal(#files.names(), 0)
end)

test("leaving mid-download stops it and leaves nothing half written, and the Wi-Fi is let go", function()
  local entry, content = world("a", "Moss")
  local downloads, net, files = screen({ entry }, { [entry.url] = content })
  opened(downloads)
  downloads:choose(0)
  downloads:update(1)
  equal(downloads:busy(), true)
  assert(#files.names() > 0, "a part exists while it downloads")
  downloads:close()
  equal(downloads.phase, "idle")
  equal(#files.names(), 0)
  assert(net.cancelled >= 1)
  assert(net.finished >= 1)
end)

test("the file name is made from the title and the bundle hash", function()
  local entry, content = world("c", "Café Moss — Tea! ")
  entry.url = "https://worlds.example/sprout/x.sproutworld"
  local downloads, _, files = screen({ entry }, { [entry.url] = content })
  opened(downloads)
  downloads:choose(0)
  settle(downloads)
  equal(files.store["worlds/caf-moss-tea-cccccccc.sproutworld"], content)
end)

test("the list moves with the wheel and wraps", function()
  local a, b = world("a", "Ant"), world("b", "Bee")
  local downloads = screen({ a, b })
  opened(downloads)
  equal(downloads:current().title, "Ant")
  downloads:turn(30, 24)
  equal(downloads:current().title, "Bee")
  downloads:move(1)
  equal(downloads:current().title, "Ant")
  downloads:move(-1)
  equal(downloads:current().title, "Bee")
end)
