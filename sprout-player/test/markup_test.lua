local Markup = module("markup")
local test, equal = harness.test, harness.equal

test("plain text doubles every asterisk and underscore, and touches nothing else", function()
  equal(Markup.plain("chip_tree.hall - exits: north"), "chip__tree.hall - exits: north")
  equal(Markup.plain("*a* _b_ **"), "**a** __b__ ****")
  equal(Markup.plain("Who are you in printers_shop?"), "Who are you in printers__shop?")
  equal(Markup.plain("A opens it"), "A opens it")
  equal(Markup.plain(""), "")
end)
