-- The reader: the transcript of a world as word-wrapped lines, the newest at the bottom, with
-- the status line above it. The crank or the d-pad scrolls back through what was said. Its
-- state follows the TUI's (tui/src/state.ts): a line has a kind (what the effect was, or
-- `typed` for what the visitor chose and `client` for the app's own), and the status is the
-- place, who else is there and the ways out.
--
-- The column is sized by the caller from the font (`getTextWidth`, `getHeight`); nothing here
-- counts characters. Drawing is the one function that touches the graphics API.

local Reader = {}
Reader.__index = Reader

-- Paragraphs kept; older ones fall off the top.
Reader.KEEP = 200

-- What a kind of line is led by, so the screen needs no colours to tell them apart.
local LEAD = { typed = "> ", refused = "! ", notice = "* ", client = "- " }

-- `options`: wrap (the wrap module), measure (text -> pixels), width (the column in pixels), rows
-- (how many lines the column shows).
function Reader.new(options)
  return setmetatable({
    wrap = options.wrap,
    measure = options.measure,
    width = options.width,
    rows = options.rows,
    paragraphs = {},
    lines = {},
    offset = 0,
    status = nil,
  }, Reader)
end

local function lead(kind) return LEAD[kind] or "" end

-- The wrapped lines of one paragraph.
function Reader:wrapped(kind, text)
  local prefix = lead(kind)
  local out = {}
  for _, line in ipairs(self.wrap.lines(prefix .. text, self.width, self.measure)) do
    out[#out + 1] = { kind = kind, text = line }
  end
  return out
end

-- Adds a paragraph. A reader who has scrolled back keeps their place.
function Reader:push(kind, text)
  local added = self:wrapped(kind, text)
  self.paragraphs[#self.paragraphs + 1] = { kind = kind, text = text, count = #added }
  for _, line in ipairs(added) do self.lines[#self.lines + 1] = line end
  if self.offset > 0 then self.offset = self.offset + #added end
  while #self.paragraphs > Reader.KEEP do
    local dropped = table.remove(self.paragraphs, 1)
    for _ = 1, dropped.count do table.remove(self.lines, 1) end
  end
  self:clamp()
end

-- Adds what a turn told: `told` is a list of { kind, text }.
function Reader:pushAll(told)
  for _, line in ipairs(told) do self:push(line.kind, line.text) end
end

-- How far back the transcript can be scrolled.
function Reader:furthest()
  return math.max(0, #self.lines - self.rows)
end

function Reader:clamp()
  self.offset = math.max(0, math.min(self.offset, self:furthest()))
end

-- Scrolls `lines` back (positive) or forward (negative).
function Reader:scroll(lines)
  self.offset = self.offset + lines
  self:clamp()
end

function Reader:toNewest() self.offset = 0 end

-- Whether lines newer than the ones shown are waiting below.
function Reader:behind() return self.offset > 0 end

-- The lines shown: at most `rows`, the newest last.
function Reader:visible()
  local last = #self.lines - self.offset
  local first = math.max(1, last - self.rows + 1)
  local out = {}
  for i = first, last do out[#out + 1] = self.lines[i] end
  return out
end

-- Sets the status from the view: { place, here = {names}, exits = {labels} }.
function Reader:setStatus(place, here, exits)
  self.status = { place = place, here = here, exits = exits }
end

-- The status line as words, as the TUI's `statusWords`.
function Reader.statusWords(status)
  if status == nil then return "" end
  if #status.exits == 0 then return status.place end
  return status.place .. " - exits: " .. table.concat(status.exits, ", ")
end

-- Draws the status line and the visible transcript. `lineHeight` is the font's height.
function Reader:draw(gfx, lineHeight)
  gfx.drawText(Reader.statusWords(self.status), 2, 0)
  local y = lineHeight + 2
  gfx.drawLine(0, y - 1, 400, y - 1)
  for _, line in ipairs(self:visible()) do
    gfx.drawText(line.text, 2, y)
    y = y + lineHeight
  end
  if self:behind() then gfx.drawText("v", 390, 240 - lineHeight) end
end

return Reader
