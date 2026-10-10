-- Pictures a world's effects ask for. A world that uses images records them as effects; this
-- player draws none yet, and says so by returning false, so the reader shows the effect's words.

local Images = {}

-- Draws the picture an effect names; false when this player draws none.
function Images.draw(_effect, _gfx)
  return false
end

return Images
