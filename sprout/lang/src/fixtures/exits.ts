// The ways the exit specs are written about, one kind per file, and what
// they run a turn with. The yard leads in to the shop, north into the
// maze while the lamp is out and to the meadow once it is lit, up to the
// shop's loft by its path, east to a shed, and south to the meadow only
// while a beacon it cannot see is lit. The shop's ladder must be down for
// its way up. The meadow's gate refuses whoever comes while it is shut. A
// turning of the maze has its way on dug and its way back connected by the
// turning dug, and every turning leads up to the yard. A person too
// tired refuses to go anywhere, and counts every way they go.
// `runtime/exits.spec.ts`, `runtime/links.spec.ts` and the go cases of
// `runtime/command.spec.ts` share it. Spec support: the package build
// leaves it out.

import type { Bundle } from '../bundle/bundle.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { compiledWorld } from './bundle.js';
import { catalogueOf } from '../runtime/catalogue.js';
import type { CommandHost } from '../runtime/command.js';
import { Draft } from '../runtime/draft.js';
import { declaredId, visitKey, type InstanceId, type VisitKey } from '../runtime/ids.js';
import { initialState } from '../runtime/load.js';
import { parseCommand } from '../runtime/parser.js';
import { newInstance, type WorldState } from '../runtime/state.js';
import type { Value } from '../runtime/values.js';
import { renderEffects } from '../prose/effects.js';

export const WAYS: Bundle = compiledWorld('ways', {
  'world.sprout': `world ways is sprout.World {
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

  object shed is sprout.Place { }

  object maze_mouth is MazeCell {
    grammar { exit up "up into the daylight" -> yard }
  }
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
    link north "deeper into the dark"
    link south "the way you came"
    exit up    "up to the yard" -> yard
  }
  on :spawned (from) { connect south to from }
  as target for dig {
    permit { if (self.get(:dug)) { refuse "This wall is already broken through." } }
    do {
      self.set(:dug, true)
      let cell = spawn MazeCell in self
      connect north to cell
      say "The stones give, and a gap opens into more dark."
    }
  }
}
`,
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

const at = (...path: string[]): InstanceId => declaredId('ways', path);
export const WORLD = at();
export const BEACON = at('beacon');
export const YARD = at('yard');
export const LAMP = at('yard', 'lamp');
export const SHOP = at('shop');
export const LADDER = at('shop', 'ladder');
export const LOFT = at('shop', 'loft');
export const MEADOW = at('meadow');
export const SHED = at('shed');
export const MOUTH = at('maze_mouth');

export const CATALOGUE = catalogueOf(WAYS, DEFAULT_LIMITS.caps);

/** The host, reading commands with the command parser. */
export const waysHost = (): CommandHost => ({
  catalogue: CATALOGUE,
  budgets: DEFAULT_LIMITS.budgets,
  parse: parseCommand,
  render: renderEffects,
});

export const MARTA: VisitKey = visitKey('v-marta');
export const INES: VisitKey = visitKey('v-ines');

/** The ways as committed, a visitor standing where each visit is given, and `set` written first. */
export function ways(
  standing: readonly (readonly [VisitKey, InstanceId])[] = [[MARTA, YARD]],
  set: readonly (readonly [InstanceId, string, Value])[] = [],
): WorldState {
  const draft = new Draft(initialState(CATALOGUE));
  for (const [visit, where] of standing) {
    const id = draft.mint();
    draft.add(
      newInstance(
        id,
        { from: 'visitor' },
        CATALOGUE.visitorKind!,
        where,
        draft.nextSerial(),
        CATALOGUE.caps,
      ),
    );
    draft.putVisitor({ visit, nickname: visit, instance: id, lastPlace: where });
  }
  for (const [id, name, value] of set) {
    const instance = draft.instance(id)!;
    draft.write({ ...instance, properties: new Map(instance.properties).set(name, value) });
  }
  return draft.commit().state;
}
