local Sound = module("sound")
local test, equal, same = harness.test, harness.equal, harness.same

-- A stand-in for playdate.sound: synths that record the notes they play.
local function fakeSound()
  local played, made = {}, {}
  local sound = { kWaveNoise = "noise", kWaveSquare = "square", kWaveTriangle = "triangle", kWaveSawtooth = "sawtooth" }
  sound.synth = { new = function(wave)
    made[#made + 1] = wave
    return {
      setADSR = function() end,
      playNote = function(_, pitch, volume, length) played[#played + 1] = { pitch, volume, length } end,
    }
  end }
  return sound, played, made
end

test("each cue is a synth of its waveform, made once, playing its note", function()
  local fake, played, made = fakeSound()
  local sound = Sound.new(fake)
  equal(#made, 5)
  equal(sound:play("tick"), true)
  equal(sound:play("pick"), true)
  same(played[1], { 3000, 0.2, 0.015 })
  same(played[2], { 660, 0.4, 0.07 })
  equal(sound:play("nothing"), false)
end)

test("with no sound to play on, every cue is silent", function()
  local sound = Sound.new(nil)
  equal(sound:play("tick"), false)
  equal(Sound.new({}):play("clack"), false)
end)
