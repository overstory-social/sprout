local Images = module("images")
local test, equal = harness.test, harness.equal

test("this player draws no pictures yet, and says so", function()
  equal(Images.draw({ kind = "image" }, {}), false)
end)
