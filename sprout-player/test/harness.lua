-- A small test harness for the Lua modules, run by a desktop Lua 5.4 (`lua5.4 test/run.lua`):
-- no device and no Simulator. `harness.test(name, fn)` runs `fn` and records a failure with the
-- message of the assertion that broke; `harness.finish()` prints the count and exits non-zero if
-- any test failed.

local harness = { passed = 0, failed = 0 }

function harness.test(name, fn)
  local ok, err = pcall(fn)
  if ok then
    harness.passed = harness.passed + 1
  else
    harness.failed = harness.failed + 1
    print("FAIL " .. name .. "\n  " .. tostring(err))
  end
end

function harness.equal(actual, expected, what)
  if actual ~= expected then
    error((what or "values") .. ": expected " .. tostring(expected) .. ", got " .. tostring(actual), 2)
  end
end

local function show(value)
  if type(value) ~= "table" then return tostring(value) end
  local parts = {}
  for i, one in ipairs(value) do parts[i] = show(one) end
  return "{" .. table.concat(parts, ", ") .. "}"
end

-- Two lists are equal when they hold equal items in order.
function harness.same(actual, expected, what)
  if show(actual) ~= show(expected) then
    error((what or "lists") .. ": expected " .. show(expected) .. ", got " .. show(actual), 2)
  end
end

function harness.finish()
  print(string.format("lua: %d passed, %d failed", harness.passed, harness.failed))
  os.exit(harness.failed == 0 and 0 or 1)
end

return harness
