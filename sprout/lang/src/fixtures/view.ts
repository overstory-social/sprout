// The gatehouse the view specs poll, one kind per file, and the committed
// state they poll it in. The yard is described by whether its gate is
// open, which is also whether its north exit applies; up the ladder is the
// tower, always. Two guards stand in the yard and hear the topics they
// know when asked, and one refuses to witness a vouching; a keypad hears
// a code from 1 to 12, and a dial hears a notch within its own property's
// range. A pebble lies in the yard and a coin in a purse there, for a
// visitor to be handed. The world's own `unseen` costs a step to say.
// `runtime/options.spec.ts`, `runtime/view.spec.ts`
// and `prose/view.spec.ts` share it. Spec support: the package build
// leaves it out.

import type { Bundle } from '../bundle/bundle.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { WORLD_PASSES_ANYTHING } from '../declare/world.js';
import { Budget } from '../runtime/budget.js';
import { catalogueOf } from '../runtime/catalogue.js';
import { Draft } from '../runtime/draft.js';
import { declaredId, visitKey, type InstanceId, type VisitKey } from '../runtime/ids.js';
import { initialState } from '../runtime/load.js';
import type { OfferContext } from '../runtime/offers.js';
import { newInstance, nicknamesIn, readerOf, type WorldState } from '../runtime/state.js';
import type { TurnHost } from '../runtime/turn.js';
import type { Value } from '../runtime/values.js';
import { compiledWorld } from './bundle.js';

export const GATEHOUSE: Bundle = compiledWorld('gatehouse', {
  'world.sprout': `world gatehouse is sprout.World {
  visitors are Person
  visitors arrive at yard
  passage unseen { Too much {if true}happens{/if} here to take in. }

  object yard is Yard {
    grammar {
      exit north "through the gate" -> tower when (self.get(:gate_open))
      exit up    "up the ladder"    -> tower
    }
    object guard is Guard
    object sentry is Guard
    object keypad is Keypad
    object dial is Dial
    object pebble is Pebble
    object purse is Purse { object coin is Pebble }
  }
  object tower is sprout.Place {
    describe { text "Wind, and a long view." }
  }
}

verb vouch { role target  role witness  role topic: symbol  "vouch to [target] before [witness] for [topic]" }
verb punch { role pad  role code: integer  "punch [code] on [pad]" }
verb turn  { role knob  role notch: integer  "turn [knob] to [notch]" }
enum Topic { bridge, toll, weather, old_road }
`,
  'yard.sprout': `kind Yard is sprout.Place {
  :gate_open false
  describe {
    text "A cobbled yard."
    if (self.get(:gate_open)) { text "The gate stands open." }
  }
}
`,
  'guard.sprout': `kind Guard is sprout.Actor {
  :knows [Topic] default [bridge, toll]
  as target for ask {
    topic from :knows
    do { say "The guard nods." }
  }
  as target for vouch {
    topic from :knows
    do { say "Heard." }
  }
  as witness for vouch {
    topic from :knows
    permit { refuse "Not before me." }
  }
}
`,
  'keypad.sprout': `kind Keypad {
  as pad for punch {
    code from 1 to 12
    do { say "Beep." }
  }
}
`,
  'dial.sprout': `kind Dial {
  :notch 0 min 0 max 9
  as knob for turn {
    notch from :notch
    do { say "Click." }
  }
}
`,
  'pebble.sprout': 'kind Pebble { }\n',
  'purse.sprout': 'kind Purse { contains }\n',
  'person.sprout': 'kind Person is sprout.Visitor { }\n',
});

const at = (...path: string[]): InstanceId => declaredId('gatehouse', path);
export const YARD = at('yard');
export const TOWER = at('tower');
export const GUARD = at('yard', 'guard');
export const SENTRY = at('yard', 'sentry');
export const KEYPAD = at('yard', 'keypad');
export const DIAL = at('yard', 'dial');
export const PEBBLE = at('yard', 'pebble');
export const PURSE = at('yard', 'purse');
export const COIN = at('yard', 'purse', 'coin');

export const GATE_CATALOGUE = catalogueOf(GATEHOUSE, DEFAULT_LIMITS.caps);

/** The host the gatehouse is polled under, with `pollSteps` as given. */
export const gateHost = (pollSteps = DEFAULT_LIMITS.budgets.pollSteps): TurnHost => ({
  catalogue: GATE_CATALOGUE,
  budgets: { ...DEFAULT_LIMITS.budgets, pollSteps },
});

export const MARTA: VisitKey = visitKey('v-marta');
export const INES: VisitKey = visitKey('v-ines');

/** Who stands where, by visit, nickname and place; null for a visitor who is away. */
export type Standing = readonly (readonly [VisitKey, string, InstanceId | null])[];

/**
 * The gatehouse as committed: each visitor standing where given, then
 * each thing in `handed` moved into Marta's hands, then `set` written.
 */
export function gatehouse(
  standing: Standing = [[MARTA, 'Marta', YARD]],
  handed: readonly InstanceId[] = [],
  set: readonly (readonly [InstanceId, string, Value])[] = [],
): WorldState {
  const draft = new Draft(initialState(GATE_CATALOGUE));
  for (const [visit, nickname, where] of standing) {
    const id = draft.mint();
    draft.add(
      newInstance(
        id,
        { from: 'visitor' },
        GATE_CATALOGUE.visitorKind!,
        where ?? YARD,
        draft.nextSerial(),
        GATE_CATALOGUE.caps,
      ),
    );
    draft.putVisitor({ visit, nickname, instance: id, lastPlace: where ?? YARD });
    if (where === null) draft.place(id, null);
  }
  const marta = draft.visitor(MARTA)?.instance;
  for (const thing of handed) if (marta !== undefined) draft.place(thing, marta);
  for (const [id, name, value] of set) {
    const instance = draft.instance(id)!;
    draft.write({ ...instance, properties: new Map(instance.properties).set(name, value) });
  }
  return draft.commit().state;
}

/** The instance a visit is in `state`. */
export const actorOf = (state: WorldState, visit: VisitKey): InstanceId =>
  state.visitors.get(visit)!.instance;

/** What deriving a view reads over the committed `state`, under a fresh poll budget. */
export function pollingIn(state: WorldState, pollSteps?: number): OfferContext {
  return {
    state: readerOf(state),
    catalogue: GATE_CATALOGUE,
    budget: new Budget(gateHost(pollSteps).budgets, 'poll'),
    passes: (container) => (container === state.world ? WORLD_PASSES_ANYTHING : true),
    nicknames: nicknamesIn(state),
  };
}
