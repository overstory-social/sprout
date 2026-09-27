// The keep the move specs are written about, and what they run a move
// with: a fresh turn with a visitor in the hall, the context
// `moveInstance` takes, what an outcome said, and the tree as a fault or
// a refusal must leave it. `runtime/move.spec.ts` and
// `runtime/move/*.spec.ts` share it. Spec support: the package build
// leaves it out.

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { playsOf } from '../declare/roles.js';
import { WORLD_PASSES_ANYTHING } from '../declare/world.js';
import { compiledWorld } from './bundle.js';
import { runBody, type ActSink, type Speech } from '../runtime/body.js';
import { Budget } from '../runtime/budget.js';
import { catalogueOf, type Catalogue } from '../runtime/catalogue.js';
import { Draft } from '../runtime/draft.js';
import { Draws } from '../runtime/draws.js';
import type { Frame } from '../runtime/evaluate.js';
import type { Refusal } from '../runtime/guards.js';
import { declaredId, type InstanceId } from '../runtime/ids.js';
import { initialState } from '../runtime/load.js';
import type { MoveContext, Moved, Refused } from '../runtime/move.js';
import type { PassRule } from '../runtime/range.js';
import { newInstance } from '../runtime/state.js';

export const CAPS = DEFAULT_LIMITS.caps;

/**
 * A keep whose hall holds places, containers, people and things, each
 * kind answering one question a move asks. `Tripwire`'s `release` and
 * `accept` fault if they are ever asked, which is how a test proves a
 * party was not. The hall's one exit leads out to the porch, out of its
 * range otherwise, so an actor's move to it proves the exit is what
 * reached it; the yard has none, and stays out of range.
 */
const KEEP = {
  'keep.sprout': [
    'world keep is sprout.World { contains visitors are Person visitors arrive at hall',
    '  object hall is sprout.Place {',
    '    grammar { exit out "out to the porch" -> porch }',
    '    object alcove is sprout.Place { passage arrives { {item} squeezes in. } }',
    '    object cellar is Room',
    '    object nook is Room {',
    '      object tom is Creature',
    '    }',
    '    object closet is Room {',
    '      object sam is Creature',
    '    }',
    '    object marta is Creature',
    '    object basket is Basket',
    '    object tray is Basket {',
    '      object dish is Heavy',
    '    }',
    '    object stone is Plain',
    '    object twig is Plain',
    '    object leaf is Plain',
    '    object chest is Chest {',
    '      object coin is Plain',
    '      object pouch is Basket {',
    '        object purse is Basket',
    '      }',
    '    }',
    '    object safe is Sealed {',
    '      object pebble is Plain',
    '    }',
    '    object trap is Tripwire {',
    '      object pot is Heavy',
    '    }',
    '    object urn is Heavy, Fragile',
    '    object bell is Easy, Heavy',
    '    object lump is Heavy',
    '    object vase is Fragile { depart (to) { refuse "Not by that hand." } }',
    '  }',
    '  object yard is sprout.Place',
    '  object porch is sprout.Place',
    '}',
    'kind Creature is sprout.Actor {',
    '  :capacity 2',
    '  passage hands_full { {self} has no hand free. }',
    '  as target for walk   { do { move self to porch } }',
    '  as target for wander { do { move self to yard } }',
    '}',
    'kind Person is Creature, sprout.Visitor { }',
    'kind Room { contains actors }',
    'kind Plain { }',
    'kind Basket { contains }',
    'kind Chest { contains depart (to) { refuse "It is nailed down." } }',
    'kind Sealed { contains release (item, to) { refuse "It is sealed." } }',
    'kind Tripwire {',
    '  contains',
    '  release (item, to) { if (2147483647 + 1 > 0) { allow } }',
    '  accept (item, from) { if (2147483647 + 1 > 0) { allow } }',
    '}',
    'kind Heavy { depart (to) { refuse "It is too heavy." } }',
    'kind Fragile { depart (to) { refuse "It would break." } }',
    'kind Easy { depart (to) { allow } }',
    'verb walk { role target "walk [target] out" }',
    'verb wander { role target "wander [target] off" }',
    '',
  ].join('\n'),
};
export const catalogue = catalogueOf(compiledWorld('keep', KEEP), CAPS);

const id = (...path: string[]): InstanceId => declaredId('keep', path);
export const WORLD_ID = id();
export const HALL = id('hall');
export const ALCOVE = id('hall', 'alcove');
export const CELLAR = id('hall', 'cellar');
export const NOOK = id('hall', 'nook');
export const TOM = id('hall', 'nook', 'tom');
export const CLOSET = id('hall', 'closet');
export const SAM = id('hall', 'closet', 'sam');
export const YARD = id('yard');
export const PORCH = id('porch');
export const MARTA = id('hall', 'marta');
export const TRAY = id('hall', 'tray');
export const STONE = id('hall', 'stone');
export const TWIG = id('hall', 'twig');
export const LEAF = id('hall', 'leaf');
export const CHEST = id('hall', 'chest');
export const COIN = id('hall', 'chest', 'coin');
export const PURSE = id('hall', 'chest', 'pouch', 'purse');
export const SAFE = id('hall', 'safe');
export const PEBBLE = id('hall', 'safe', 'pebble');
export const TRAP = id('hall', 'trap');
export const POT = id('hall', 'trap', 'pot');
export const DISH = id('hall', 'tray', 'dish');
export const URN = id('hall', 'urn');
export const BELL = id('hall', 'bell');
export const LUMP = id('hall', 'lump');
export const VASE = id('hall', 'vase');

/** The world refuses, as its unwritten rule does; the ids in `shut` refuse; everything else relays. */
export const passing =
  (...shut: InstanceId[]): PassRule<InstanceId> =>
  (container) =>
    container === WORLD_ID ? WORLD_PASSES_ANYTHING : !shut.includes(container);

export function context(draft: Draft, over: Partial<Omit<MoveContext, 'draft'>> = {}): MoveContext {
  return {
    draft,
    catalogue,
    passes: passing(),
    budget: new Budget(DEFAULT_LIMITS.budgets),
    ...over,
  };
}

/** A visitor standing in `container`, as arrival will add one; null for one who is away. */
export function visitorIn(draft: Draft, container: InstanceId | null, from: Catalogue = catalogue) {
  const visitor = newInstance(
    draft.mint(),
    { from: 'visitor' },
    from.visitorKind!,
    container,
    container === null ? null : draft.nextSerial(),
    CAPS,
  );
  draft.add(visitor);
  return visitor.id;
}

/** A fresh turn over the keep as declared, with a visitor standing in the hall. */
export function turn(): { draft: Draft; visitor: InstanceId } {
  const draft = new Draft(initialState(catalogue));
  return { draft, visitor: visitorIn(draft, HALL) };
}

/**
 * Run `self`'s `do` as the target of `verb`, restrictive `passing()`
 * throughout, so a name out of range faults as it would over the real
 * world's pass rule. Every `move` it proposed, mover, item and
 * destination in the order it ran; a `move` is not carried out, so the
 * tree is untouched.
 */
export function acted(
  draft: Draft,
  self: InstanceId,
  verb: string,
): readonly (readonly [InstanceId, InstanceId, InstanceId])[] {
  const plays = playsOf(draft.instance(self)!.kind.plays, 'keep', verb, 'target');
  const block = plays[0]?.declaration.do;
  if (block === undefined || block === null) throw new Error(`no \`do\` for ${verb}`);
  const budget = new Budget(DEFAULT_LIMITS.budgets);
  const moves: [InstanceId, InstanceId, InstanceId][] = [];
  const sink: ActSink = {
    lifecycle: {
      draft,
      catalogue,
      passes: passing(),
      budget,
      draws: new Draws(1),
      mayHold: null,
      now: 0,
    },
    say: () => {},
    tell: () => {},
    sent: () => {},
    record: () => {},
    destroyed: () => {},
    marked: () => {},
    move: (mover, item, to) => {
      moves.push([mover, item, to]);
      return 'done';
    },
    act: () => {
      throw new Error('`acted` does not run an `act`.');
    },
  };
  const frame: Frame = {
    state: draft,
    kinds: catalogue.lookup,
    library: 'keep',
    self,
    names: catalogue.names,
    passes: passing(),
    bindings: new Map(),
    budget,
    caps: CAPS,
  };
  runBody(block, frame, 'act', sink);
  return moves;
}

export function moved(outcome: Moved | Refused): Moved {
  if (!('sends' in outcome))
    throw new Error(`expected a move, and it was refused: ${said(outcome)}`);
  return outcome;
}

/** What a refusal said, and who said it: the passage's origin and name, or the words quoted. */
export function said(outcome: Moved | Refused): string {
  if ('sends' in outcome) return 'moved';
  if ('engine' in outcome) return `engine ${outcome.engine}: ${wordsOf(outcome.said)}`;
  const { refusal } = outcome;
  return `${refusal.guard} by ${refusal.by}: ${wordsOf(refusal.said)}`;
}

/** Words quoted, or a passage by its origin, its name and what it says. */
function wordsOf(said: Speech): string {
  if ('text' in said) return `"${said.text}"`;
  if ('absent' in said) return `absent ${said.absent}`;
  if ('recorded' in said) return `recorded ${said.recorded.transcript}`;
  return `${said.passage.origin} ${said.passage.name}: ${said.passage.body.text.trim()}`;
}

export function refusalOf(outcome: Moved | Refused): Refusal {
  if (!('refusal' in outcome)) throw new Error(`expected a guard's refusal: ${said(outcome)}`);
  return outcome.refusal;
}

/** The tree around every id named, as a fault or a refusal must leave it. */
export function snapshot(draft: Draft): string {
  const ids = [WORLD_ID, ...catalogue.declared.keys()];
  return JSON.stringify(
    ids.map((one) => [one, draft.instance(one)?.container, draft.children(one)]),
  );
}
