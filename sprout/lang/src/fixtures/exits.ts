// The ways, a world of exits and links, one kind per file. The yard leads in to the shop, north into the
// maze while the lamp is out and to the meadow once it is lit, up to the
// shop's loft by its path, east to a shed, whose `:entered` tells
// whoever comes in of its cobwebs, and south to the meadow only while a
// beacon it cannot see is lit. From the shed, west leads into the
// thicket while its lantern is lit and otherwise refuses, and north
// always refuses, in a passage of the shed's. Down the chimney's flue to
// the shed says you won't get back up while its soot is unlit, and
// otherwise a passage of the chimney's; south into the meadow says the
// gate is pushed, and out onto the roof says nothing. The shop's ladder
// must be down for its way up. The meadow's gate refuses whoever comes
// while it is shut. A turning of the maze has its way on dug and its way
// back connected by the turning dug, and every turning leads up to the
// yard. A dead end is a kind composing a turning, so none of a turning's
// ways out reach it, and digging it faults, since it has no way on to
// connect. A person too tired refuses to go anywhere, and counts every
// way they go.
// Spec support: the package build leaves it out.

import type { Bundle } from '../bundle/bundle.js';
import { compiledWorld } from './bundle.js';

export const WAYS: Bundle = compiledWorld('ways', {
  'ways.sprout': `world ways is sprout.World {
  visitors are Person
  visitors arrive at yard

  object beacon is Lamp

  object yard is sprout.Place {
    grammar {
      exit in    "into the shop"        -> shop
      exit north "deeper into the dark" -> maze_mouth when (!lamp.get(:lit))
      exit north "toward a grey light"  -> meadow
      exit up    "up to the loft"       -> shop.loft
      exit east  "into the shed"        -> shed
      exit south "along the lit path"   -> meadow when (beacon.get(:lit))
    }
    object lamp is Lamp
  }

  object shop is sprout.Place {
    grammar {
      exit out "back to the yard" -> yard
      exit up  "up the ladder"    -> loft when (ladder.get(:down))
    }
    object ladder is Ladder
    object loft is sprout.Place {
      grammar { exit down "down the ladder" -> shop }
    }
  }

  object meadow is Gated {
    grammar { exit south "back to the yard" -> yard }
  }

  object shed is sprout.Place {
    grammar {
      exit west  "into the thicket" -> meadow when (lantern.get(:lit))
      exit west  "west"             refuse "The brambles are too thick."
      exit north "north"            refuse boarded
    }
    passage boarded { The door is boarded, and {actor} cannot shift the boards. }
    object lantern is Lamp
    on :entered (item, from) { tell item "Cobwebs brush your face." }
  }

  object chimney is sprout.Place {
    grammar {
      exit down  "down the flue"     -> shed say "You won't be able to get back up." when (!soot.get(:lit))
      exit down  "down the flue"     -> shed say sooty
      exit south "into the meadow"   -> meadow say "You push through the gate."
      exit out   "out onto the roof" -> yard
    }
    passage sooty { Soot follows {actor} the whole way down. }
    object soot is Lamp
  }

  object maze_mouth is MazeCell {
    grammar { exit up "up into the daylight" -> yard }
  }

  object dead_end is DeepCell
}

verb dig { role target: MazeCell  "dig [target]" }
`,
  'lamp.sprout': 'kind Lamp { :lit false }\n',
  'ladder.sprout': 'kind Ladder { :down false }\n',
  'gated.sprout': `kind Gated is sprout.Place {
  :shut false
  accept (item, from) { if (self.get(:shut)) { refuse "The gate is shut." } }
}
`,
  'maze_cell.sprout': `kind MazeCell is sprout.Place {
  :dug false
  grammar {
    name "turning of the maze"
    link onward "deeper into the dark"
    link back   "the way you came"
    exit up    "up to the yard" -> yard
  }
  on :spawned (from) { connect back to from }
  as target for dig {
    permit { if (self.get(:dug)) { refuse "This wall is already broken through." } }
    do {
      self.set(:dug, true)
      let cell = spawn MazeCell in self
      connect onward to cell
      say "The stones give, and a gap opens into more dark."
    }
  }
}
`,
  'deep_cell.sprout': 'kind DeepCell is MazeCell { }\n',
  'walker.sprout': `kind Walker is sprout.Actor {
  :tired false
  :walked 0 min 0 max 99
  as actor for go {
    permit { if (self.get(:tired)) { refuse "You are too tired to walk." } }
    do { self.adjust(:walked, 1) }
  }
}
`,
  'person.sprout': 'kind Person is Walker, sprout.Visitor { }\n',
});
