-- The app's sounds: each cue a short note on a synth of the SDK's (`playdate.sound.synth`), made
-- once when the app starts. `Sound.new(playdate.sound)`; given nothing, as a desktop test gives,
-- every cue is silent.

local Sound = {}
Sound.__index = Sound

-- Each cue: the synth's waveform, the note's pitch in hertz, its volume, its length in seconds,
-- and its envelope (attack, decay, sustain, release).
Sound.CUES = {
  -- a slat of the wheel passing the window
  tick = { wave = "kWaveNoise", pitch = 3000, volume = 0.2, length = 0.015, envelope = { 0, 0.015, 0, 0.01 } },
  -- the drum settling on a slat
  clack = { wave = "kWaveSquare", pitch = 160, volume = 0.35, length = 0.03, envelope = { 0, 0.03, 0, 0.02 } },
  -- a word picked
  pick = { wave = "kWaveTriangle", pitch = 660, volume = 0.4, length = 0.07, envelope = { 0, 0.05, 0.3, 0.05 } },
  -- a step back
  back = { wave = "kWaveTriangle", pitch = 392, volume = 0.4, length = 0.07, envelope = { 0, 0.05, 0.3, 0.05 } },
  -- a reading that cannot be confirmed
  refused = { wave = "kWaveSawtooth", pitch = 110, volume = 0.35, length = 0.15, envelope = { 0, 0.1, 0.4, 0.05 } },
}

function Sound.new(sound)
  local self = setmetatable({ synths = {} }, Sound)
  if sound == nil or sound.synth == nil then return self end
  for name, cue in pairs(Sound.CUES) do
    local synth = sound.synth.new(sound[cue.wave])
    synth:setADSR(table.unpack(cue.envelope))
    self.synths[name] = synth
  end
  return self
end

-- Plays the cue named; true where a note was played, false where there is no sound.
function Sound:play(name)
  local synth = self.synths[name]
  if synth == nil then return false end
  local cue = Sound.CUES[name]
  synth:playNote(cue.pitch, cue.volume, cue.length)
  return true
end

return Sound
