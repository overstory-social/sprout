-- Words for the screen. `playdate.graphics.drawText` reads `*bold*` and `_italic_` (Inside
-- Playdate, Styling text), and nothing the app draws is markup: a world's name is `chip_tree`, and
-- a passage may hold an asterisk. A literal is the character doubled, so plain text doubles each.

local markup = {}

-- `text` as drawText draws it character for character.
function markup.plain(text)
  return (text:gsub("[*_]", "%0%0"))
end

return markup
