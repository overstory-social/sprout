// The yard the reading specs are written about, and what they run a
// reading with: a fresh turn with visitors placed, the context
// `runReading` takes, a reading built by verb name, and what an outcome
// said. `runtime/reading.spec.ts` and `runtime/reading/*.spec.ts` share
// it. Spec support: the package build leaves it out.

import type { Bundle } from '../bundle/bundle.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import type { ResolvedVerb } from '../declare/verbs.js';
import { WORLD_PASSES_ANYTHING } from '../declare/world.js';
import { compiledWorld } from './bundle.js';
import { Budget } from '../runtime/budget.js';
import { catalogueOf, type Catalogue } from '../runtime/catalogue.js';
import { Draft } from '../runtime/draft.js';
import { declaredId, type InstanceId } from '../runtime/ids.js';
import { initialState } from '../runtime/load.js';
import type {
  Acted,
  Bound,
  PermitRefusal,
  Reading,
  ReadingContext,
  ReadingOutcome,
  Said,
} from '../runtime/reading.js';
import { newInstance } from '../runtime/state.js';
import type { Value } from '../runtime/values.js';
import { Draws } from '../runtime/draws.js';

const CAPS = DEFAULT_LIMITS.caps;

/**
 * A yard whose hall holds a player of each part a reading has. `Both`
 * composes `First` and `Second`, each playing the target of `order`, and
 * adds its own; every `permit` refuses when its flag is set, and every
 * `do` says who it is. A creature waving tells the room and the one it
 * waves at. The world holds things and not actors.
 */
export const YARD = compiledWorld('yard', {
  'yard.sprout': [
    'world yard is sprout.World { contains visitors are Person visitors arrive at hall',
    '  object hall is Room {',
    '    object both is Both',
    '    object tool is Tool',
    '    object w1 is Weight',
    '    object w2 is Weight',
    '    object trip is Tripwire',
    '    object stone is Plain',
    '    object guard is Guard',
    '    object dial is Dial',
    '    object safe is Safe',
    '    object lock is Lock',
    '    object key is Key',
    '    object bubble is Bubble {',
    '      object bead is Plain',
    '    }',
    '    object glass is Glued',
    '    object cat is Creature',
    '    object dog is Creature',
    '    object basket is Basket',
    '    object wardrobe is Room',
    '    object die is Die',
    '  }',
    '}',
    'enum Topic { bridge, toll, weather }',
    'kind Room { contains actors }',
    'kind Basket { contains }',
    'kind Plain { }',
    'kind Key { }',
    'verb order {',
    '  role target  role tool  role weights many',
    '  "order [target] with [tool] using [weights]"  "order [target] using [weights]"  "order [target]"',
    '}',
    'verb nudge { role target  "nudge [target]" }',
    'verb nod { role target  "nod at [target]" }',
    'verb wave { role target  "wave at [target]" }',
    'verb unlock { role target  role tool  "unlock [target] with [tool]"  "unlock [target]" }',
    'verb dial { role target  role number: integer  "turn [target] to [number]" }',
    'verb pop { role target  role tool  "pop [target] with [tool]"  "pop [target]" }',
    'verb roll { role target  "roll [target]" }',
    'kind Creature is sprout.Actor {',
    '  :balks false',
    '  :log 0 min 0 max 99',
    '  as actor for order {',
    '    permit { if (self.get(:balks)) { refuse "The actor balks." } }',
    '    do     { self.adjust(:log, 1)  say "actor" }',
    '  }',
    '  as actor for ask { do { say "You ask." } }',
    '  as target for nudge { do { say "nudged" } }',
    '  as actor for wave { do { tell "{actor} waves at {target}."  tell target "{actor} waves at you." } }',
    '}',
    'kind Person is Creature, sprout.Visitor { }',
    'kind First  { :a false  as target for order { permit { if (self.get(:a)) { refuse "First balks." } }  do { say "first" } } }',
    'kind Second { :b false  as target for order { permit { if (self.get(:b)) { refuse "Second balks." } } do { say "second" } } }',
    'kind Both is First, Second { :c false  as target for order { permit { if (self.get(:c)) { refuse "Both balks." } }  do { say "both" } } }',
    'kind Tool { :t false  as tool for order { permit { if (self.get(:t)) { refuse "The tool balks." } } do { say "tool" } } }',
    'kind Weight { as weights for order { do { say "weight" } } }',
    'kind Tripwire { as tool for order { permit { if (2147483647 + 1 > 0) { allow } } } }',
    'kind Guard {',
    '  :knows [Topic] default [bridge, toll]',
    '  as target for ask {',
    '    topic from :knows',
    '    do { if (bound topic) { say "bound" } else { say "unbound" } }',
    '  }',
    '}',
    'kind Dial {',
    '  as target for dial { number from 1 to 12  do { if (bound number) { say "bound" } else { say "unbound" } } }',
    '}',
    'kind Safe {',
    '  :combo 0 min 0 max 99',
    '  as target for dial { number from :combo  do { if (bound number) { say "bound" } else { say "unbound" } } }',
    '}',
    'kind Lock {',
    '  as target for unlock {',
    '    permit {',
    '      if (bound tool) { if (!tool.is(Key)) { refuse "{tool} is not a key." } }',
    '      else { refuse "You need something to turn the lock with." }',
    '    }',
    '    do { say "unlocked" }',
    '  }',
    '}',
    'kind Bubble {',
    '  contains',
    '  as target for pop { do { destroy self  say "pop" } }',
    '  as tool for pop   { do { say "tool pop" } }',
    '}',
    'kind Die { :face 0 min 0 max 5  as target for roll { do { self.set(:face, random(6)) } } }',
    'kind Glued is Bubble { :n 0 min 0 max 9  as target for pop { do { self.adjust(:n, 1)  say "glued" } } }',
    '',
  ].join('\n'),
});

const at = (...path: string[]): InstanceId => declaredId('yard', path);
export const WORLD_ID = at();
export const HALL = at('hall');
export const BOTH = at('hall', 'both');
export const TOOL = at('hall', 'tool');
export const W1 = at('hall', 'w1');
export const W2 = at('hall', 'w2');
export const TRIP = at('hall', 'trip');
export const STONE = at('hall', 'stone');
export const GUARD = at('hall', 'guard');
export const DIAL = at('hall', 'dial');
export const SAFE = at('hall', 'safe');
export const LOCK = at('hall', 'lock');
export const KEY = at('hall', 'key');
export const BUBBLE = at('hall', 'bubble');
export const BEAD = at('hall', 'bubble', 'bead');
export const GLASS = at('hall', 'glass');
export const CAT = at('hall', 'cat');
export const DOG = at('hall', 'dog');
export const BASKET = at('hall', 'basket');
export const WARDROBE = at('hall', 'wardrobe');
export const DIE = at('hall', 'die');

export interface Turn {
  readonly draft: Draft;
  readonly catalogue: Catalogue;
  readonly budget: Budget;
  /** Visitors, by the order they arrived. */
  readonly people: InstanceId[];
}

/** A fresh turn over `bundle` as declared, with a visitor standing in each place given. */
export function turn(bundle: Bundle, where: readonly InstanceId[], budget?: Budget): Turn {
  const catalogue = catalogueOf(bundle, CAPS);
  const draft = new Draft(initialState(catalogue));
  const people = where.map((place) => {
    const visitor = newInstance(
      draft.mint(),
      { from: 'visitor' },
      catalogue.visitorKind!,
      place,
      draft.nextSerial(),
      CAPS,
    );
    draft.add(visitor);
    return visitor.id;
  });
  return { draft, catalogue, budget: budget ?? new Budget(DEFAULT_LIMITS.budgets), people };
}

export function contextOf(one: Turn): ReadingContext {
  return {
    draft: one.draft,
    catalogue: one.catalogue,
    passes: (container) => (container === one.draft.world ? WORLD_PASSES_ANYTHING : true),
    budget: one.budget,
    draws: new Draws(7),
    mayHold: null,
    now: 0,
  };
}

function verbOf(bundle: Bundle, library: string, name: string): ResolvedVerb {
  const verb = bundle.verbs.qualified(library, name);
  if (verb === null) throw new Error(`no verb ${library}.${name}`);
  return verb;
}

export function reading(
  bundle: Bundle,
  verb: string,
  actor: InstanceId,
  bindings: Record<string, Bound>,
  library = bundle.manifest.name,
): Reading {
  return {
    verb: verbOf(bundle, library, verb),
    actor,
    bindings: new Map(Object.entries(bindings)),
  };
}

/** Write `values` onto `id`'s properties in the turn's draft. */
export function setOn(one: Turn, id: InstanceId, values: Record<string, Value>): void {
  const instance = one.draft.instance(id)!;
  one.draft.write({
    ...instance,
    properties: new Map([...instance.properties, ...Object.entries(values)]),
  });
}

/** What a line said: the quoted words, or a passage's origin, name and words. */
export function words(said: PermitRefusal['said']): string {
  if ('text' in said) return said.text;
  if ('absent' in said) return `absent ${said.absent}`;
  return `${said.passage.origin} ${said.passage.name}: ${said.passage.body.text.trim()}`;
}

export const lines = (acted: Acted): [InstanceId, string][] =>
  acted.said.map((line: Said) => [line.by, words(line.said)]);

export function acted(outcome: ReadingOutcome): Acted {
  if ('refused' in outcome) throw new Error(`refused: ${words(outcome.refused.said)}`);
  return outcome;
}

export function refused(outcome: ReadingOutcome): PermitRefusal {
  if (!('refused' in outcome)) throw new Error('the reading was not refused');
  return outcome.refused;
}

export const NOTHING = 'sprout.World nothing_happens: Nothing much comes of that.';
