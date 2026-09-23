// The world the event specs are written about, and what they run it with:
// a hall holding a lamp that answers being lit and watches its own light,
// a shut chest and a glass case each with something inside, a lantern
// whose kind gives it a wick, a bell that counts answers, and a dog, an
// NPC that acts; a bubble that bursts, a match that goes once the queue
// is empty, and a tidier whose move is refused; a yard beside it that the
// world keeps apart. A fresh turn
// over it reads its containers' own pass rules. `runtime/sends.spec.ts`,
// `runtime/passes.spec.ts`, `runtime/named.spec.ts` and `runtime/bus.spec.ts`
// share it. Spec support: the package build leaves it out.

import type { Bundle } from '../bundle/bundle.js';
import { DEFAULT_LIMITS, type RuntimeBudgets } from '../bundle/limits.js';
import { compiledWorld } from './bundle.js';
import { Budget } from '../runtime/budget.js';
import { catalogueOf, type Catalogue } from '../runtime/catalogue.js';
import { Draft } from '../runtime/draft.js';
import { declaredId, type InstanceId } from '../runtime/ids.js';
import type { LifecycleContext } from '../runtime/lifecycle.js';
import { initialState } from '../runtime/load.js';
import { passRules } from '../runtime/passes.js';
import type { PassRule } from '../runtime/range.js';
import { newInstance } from '../runtime/state.js';
import type { Value } from '../runtime/values.js';

export const BUS: Bundle = compiledWorld('bus', {
  'world.sprout': `world bus is sprout.World {
  visitors are Person
  visitors arrive at hall

  object hall is sprout.Place {
    object lamp is Lamp
    object chest is Chest {
      object gem is Gem
    }
    object case is GlassCase {
      object moth is Moth
    }
    object lantern is Lantern
    object bell is Bell
    object dog is Dog
    object bubble is Bubble
    object match is Match
    object fussy is Fussy
    object tidier is Tidier
  }
  object yard is sprout.Place {
    object stray is Gem
  }
}

kind Person is sprout.Visitor { }
`,
  'kinds.sprout': `message :lit with boolean
message :rang
message :answered with integer
message :chain with integer
message :stir

verb light { role target  "light [target]" }
verb ring  { role target  "ring [target]" }
verb sniff { role target  "sniff [target]" }

// The lamp writes its own light and answers whoever lit it; its hook
// counts each change, with the light it had before.
kind Lamp {
  :lit false
  :flickers 0 min 0 max 99
  :was_lit false
  on :lit (from, value) {
    self.set(:lit, value)
    send from :answered with 1
  }
  changed :lit (was) {
    self.set(:was_lit, was)
    self.adjust(:flickers, 1)
  }
  as target for light { do { broadcast :lit with true  say "You light the lamp." } }
}

kind Chest {
  contains
  :open false
  pass any (self.get(:open))
}

// Light gets into the case; nothing else does.
kind GlassCase {
  contains
  pass :lit (true)
  pass any (false)
}

kind Gem {
  :rung false
  on :rang { self.set(:rung, true) }
}

kind Moth {
  :drawn false
  on :lit (_, value) { self.set(:drawn, value) }
}

// A lantern hands the light on to its own wick, named from the kind's body.
kind Lantern {
  contains
  on :lit (_, value) { send wick :lit with value }
  object wick is Wick
}

kind Wick {
  :burning false
  on :lit (_, value) { self.set(:burning, value) }
}

kind Bell {
  :answers 0 min 0 max 99
  :depth 0 min 0 max 99
  on :answered (_, n) { self.adjust(:answers, n) }
  on :chain (_, n) {
    self.set(:depth, n)
    send self :chain with n + 1
  }
  as target for ring { do { send self :chain with 1  broadcast :rang  say "The bell rings." } }
}

// A bubble bursts at a bell, taking with it what it sent before it went.
kind Bubble {
  on :rang {
    send hall.bell :answered with 5
    destroy self
  }
}

// A match lights the lamp and goes once everything has been handled.
kind Match {
  on :rang {
    send hall.lamp :lit with true
    finally destroy self
  }
}

// What goes into the fussy box is refused, and the tidier tries anyway.
kind Fussy {
  contains
  accept (item, from) { refuse "Not in here." }
}

kind Tidier {
  :tried false
  on :stir {
    move hall.lamp to hall.fussy
    self.set(:tried, true)
  }
}

// The dog answers a stir by sniffing the lamp, a reading of its own.
kind Dog is sprout.Actor {
  :sniffed 0 min 0 max 99
  on :stir { act sniff (target: hall.lamp) }
  as actor for sniff { do { self.adjust(:sniffed, 1) } }
}
`,
});

const at = (...path: string[]): InstanceId => declaredId('bus', path);
export const WORLD = at();
export const HALL = at('hall');
export const LAMP = at('hall', 'lamp');
export const CHEST = at('hall', 'chest');
export const GEM = at('hall', 'chest', 'gem');
export const CASE = at('hall', 'case');
export const MOTH = at('hall', 'case', 'moth');
export const LANTERN = at('hall', 'lantern');
export const WICK = at('hall', 'lantern', 'wick');
export const BELL = at('hall', 'bell');
export const DOG = at('hall', 'dog');
export const BUBBLE = at('hall', 'bubble');
export const MATCH = at('hall', 'match');
export const FUSSY = at('hall', 'fussy');
export const TIDIER = at('hall', 'tidier');
export const YARD = at('yard');
export const STRAY = at('yard', 'stray');

export interface EventTurn {
  readonly draft: Draft;
  readonly catalogue: Catalogue;
  readonly budget: Budget;
  readonly visitor: InstanceId;
  /** The rule the containers answer with, as their kinds write it, over this turn's draft. */
  readonly passes: PassRule<InstanceId>;
  readonly lifecycle: LifecycleContext;
}

/** A fresh turn over `BUS` as declared, with a visitor in the hall, under `budgets`. */
export function eventTurn(budgets: RuntimeBudgets = DEFAULT_LIMITS.budgets): EventTurn {
  const catalogue = catalogueOf(BUS, DEFAULT_LIMITS.caps);
  const draft = new Draft(initialState(catalogue));
  const visitor = draft.mint();
  draft.add(
    newInstance(
      visitor,
      { from: 'visitor' },
      catalogue.visitorKind!,
      HALL,
      draft.nextSerial(),
      DEFAULT_LIMITS.caps,
    ),
  );
  const budget = new Budget(budgets);
  const passes = passRules({
    state: draft,
    kinds: catalogue.lookup,
    caps: catalogue.caps,
    budget,
    names: catalogue.names,
  });
  return {
    draft,
    catalogue,
    budget,
    visitor,
    passes,
    lifecycle: { draft, catalogue, passes, budget, mayHold: null },
  };
}

/** Write `values` onto `id`'s properties in the turn's draft. */
export function setOn(turn: EventTurn, id: InstanceId, values: Record<string, Value>): void {
  const instance = turn.draft.instance(id)!;
  turn.draft.write({
    ...instance,
    properties: new Map([...instance.properties, ...Object.entries(values)]),
  });
}

/** A property of `id` as the turn's draft holds it. */
export const held = (turn: EventTurn, id: InstanceId, name: string): Value | undefined =>
  turn.draft.instance(id)?.properties.get(name);
