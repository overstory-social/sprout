-- Word wrap for the reader's column. `measure(text)` is the pixel width of `text` in the font
-- the screen draws with (`font:getTextWidth`), so the column is sized from the font and never
-- from a character count. A paragraph is cut at spaces; a word wider than the column is cut
-- between characters, never inside one.

local wrap = {}

local function characters(word)
  local out = {}
  for _, code in utf8.codes(word, true) do out[#out + 1] = utf8.char(code) end
  return out
end

-- The pieces of a word that fit `width` each, the last of them the remainder.
local function cut(word, width, measure)
  local pieces, piece = {}, ""
  for _, char in ipairs(characters(word)) do
    if piece ~= "" and measure(piece .. char) > width then
      pieces[#pieces + 1] = piece
      piece = char
    else
      piece = piece .. char
    end
  end
  pieces[#pieces + 1] = piece
  return pieces
end

-- The lines `text` makes in a column `width` pixels wide. A newline starts a new line.
function wrap.lines(text, width, measure)
  local lines = {}
  for paragraph in (text .. "\n"):gmatch("(.-)\n") do
    local line = ""
    for word in paragraph:gmatch("%S+") do
      if line == "" then
        line = word
      elseif measure(line .. " " .. word) <= width then
        line = line .. " " .. word
      else
        lines[#lines + 1] = line
        line = word
      end
      if measure(line) > width then
        local pieces = cut(line, width, measure)
        for i = 1, #pieces - 1 do lines[#lines + 1] = pieces[i] end
        line = pieces[#pieces]
      end
    end
    lines[#lines + 1] = line
  end
  return lines
end

return wrap
