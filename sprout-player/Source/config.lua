-- Where the download screen looks for worlds. `indexUrl` is the signed index (index.lua) the
-- publisher keeps at a fixed address; the placeholder below names no server (`.invalid` never
-- resolves), so a build that has not been pointed at a real one says it cannot reach it. Point it
-- by editing this file before a build, or without a build by putting `downloads.json`,
-- `{ "indexUrl": "https://..." }`, in the app's Data folder, which `Config.effective` reads
-- (README.md, Playdate > Shipped worlds and downloads). `reason` is the purpose string the system
-- shows when it asks permission to reach a server.

local Config = {
  indexUrl = "https://worlds.example.invalid/sprout/index.json",
  reason = "Sprout fetches the list of published worlds, and the worlds you choose from it, from this server.",
}

-- The settings in force: these, with `indexUrl` taken from the Data folder's `downloads.json`
-- where that has one. `datastore` is playdate.datastore (nil where there is none).
function Config.effective(datastore)
  local settings = { indexUrl = Config.indexUrl, reason = Config.reason }
  local stored = nil
  if datastore ~= nil and datastore.read ~= nil then stored = datastore.read("downloads") end
  if type(stored) == "table" and type(stored.indexUrl) == "string" and stored.indexUrl ~= "" then
    settings.indexUrl = stored.indexUrl
  end
  return settings
end

return Config
