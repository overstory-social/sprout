import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { WORLD_PASSES_ANYTHING } from '../declare/world.js';
import { compiledWorld } from '../fixtures/bundle.js';
import { chooser } from '../fixtures/parse.js';
import { Budget } from './budget.js';
import { catalogueOf, type Catalogue } from './catalogue.js';
import { Draft } from './draft.js';
import type { Refusal } from './guards.js';
import { declaredId, type InstanceId } from './ids.js';
import { boundObject, IntegerOverflow } from './evaluate.js';
import { destroyInstance } from './lifecycle.js';
import { initialState, saveWorld } from './load.js';
import {
  MoveFault,
  moveInstance,
  type MoveContext,
  type MoveFaultReason,
  type Moved,
  type Refused,
} from './move.js';
import { reaches, type PassRule } from './range.js';
import { liveTree } from './live.js';
import { newInstance, type WorldState } from './state.js';

const CAPS = DEFAULT_LIMITS.caps;

/**
 * A keep whose hall holds places, containers, people and things, each
 * kind answering one question a move asks. `Tripwire`'s `release` and
 * `accept` fault if they are ever asked, which is how a test proves a
 * party was not.
 */
const KEEP = {
  'world.sprout': [
    'world keep: sprout.World { contains visitors are Creature visitors arrive at hall }',
    'kind Creature: sprout.Actor {',
    '  :capacity 2',
    '  passage hands_full { {self} has no hand free. }',
    '}',
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
    'object hall: sprout.Place in keep',
    'object alcove: sprout.Place in hall { passage arrives { {item} squeezes in. } }',
    'object cellar: Room in hall',
    'object yard: sprout.Place in keep',
    'object marta: Creature in hall',
    'object basket: Basket in hall',
    'object tray: Basket in hall',
    'object stone: Plain in hall',
    'object twig: Plain in hall',
    'object leaf: Plain in hall',
    'object chest: Chest in hall',
    'object coin: Plain in hall.chest',
    'object pouch: Basket in hall.chest',
    'object purse: Basket in hall.chest.pouch',
    'object safe: Sealed in hall',
    'object pebble: Plain in hall.safe',
    'object trap: Tripwire in hall',
    'object pot: Heavy in hall.trap',
    'object dish: Heavy in hall.tray',
    'object urn: Heavy, Fragile in hall',
    'object bell: Easy, Heavy in hall',
    'object lump: Heavy in hall',
    'object vase: Fragile in hall { depart (to) { refuse "Not by that hand." } }',
    '',
  ].join('\n'),
};
const catalogue = catalogueOf(compiledWorld('keep', KEEP), CAPS);

const id = (...path: string[]): InstanceId => declaredId('keep', path);
const WORLD_ID = id();
const HALL = id('hall');
const ALCOVE = id('hall', 'alcove');
const CELLAR = id('hall', 'cellar');
const YARD = id('yard');
const MARTA = id('hall', 'marta');
const TRAY = id('hall', 'tray');
const STONE = id('hall', 'stone');
const TWIG = id('hall', 'twig');
const LEAF = id('hall', 'leaf');
const CHEST = id('hall', 'chest');
const COIN = id('hall', 'chest', 'coin');
const PURSE = id('hall', 'chest', 'pouch', 'purse');
const SAFE = id('hall', 'safe');
const PEBBLE = id('hall', 'safe', 'pebble');
const TRAP = id('hall', 'trap');
const POT = id('hall', 'trap', 'pot');
const DISH = id('hall', 'tray', 'dish');
const URN = id('hall', 'urn');
const BELL = id('hall', 'bell');
const LUMP = id('hall', 'lump');
const VASE = id('hall', 'vase');

/** The world refuses, as its unwritten rule does; the ids in `shut` refuse; everything else relays. */
const passing =
  (...shut: InstanceId[]): PassRule<InstanceId> =>
  (container) =>
    container === WORLD_ID ? WORLD_PASSES_ANYTHING : !shut.includes(container);

function context(draft: Draft, over: Partial<Omit<MoveContext, 'draft'>> = {}): MoveContext {
  return {
    draft,
    catalogue,
    passes: passing(),
    budget: new Budget(DEFAULT_LIMITS.budgets),
    ...over,
  };
}

/** A visitor standing in `container`, as arrival will add one; null for one who is away. */
function visitorIn(draft: Draft, container: InstanceId | null, from: Catalogue = catalogue) {
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
function turn(): { draft: Draft; visitor: InstanceId } {
  const draft = new Draft(initialState(catalogue));
  return { draft, visitor: visitorIn(draft, HALL) };
}

function moved(outcome: Moved | Refused): Moved {
  if (!('sends' in outcome))
    throw new Error(`expected a move, and it was refused: ${said(outcome)}`);
  return outcome;
}

/** What a refusal said, and who said it: the passage's origin and name, or the words quoted. */
function said(outcome: Moved | Refused): string {
  if ('sends' in outcome) return 'moved';
  if ('engine' in outcome) return `engine ${outcome.engine}: ${outcome.text}`;
  const { refusal } = outcome;
  const words =
    'text' in refusal.said
      ? `"${refusal.said.text}"`
      : `${refusal.said.passage.origin} ${refusal.said.passage.name}`;
  return `${refusal.guard} by ${refusal.by}: ${words}`;
}

function refusalOf(outcome: Moved | Refused): Refusal {
  if (!('refusal' in outcome)) throw new Error(`expected a guard's refusal: ${said(outcome)}`);
  return outcome.refusal;
}

/** The tree around every id named, as a fault or a refusal must leave it. */
function snapshot(draft: Draft): string {
  const ids = [WORLD_ID, ...catalogue.declared.keys()];
  return JSON.stringify(
    ids.map((one) => [one, draft.instance(one)?.container, draft.children(one)]),
  );
}

function faultOf(run: () => unknown): MoveFault {
  try {
    run();
  } catch (error) {
    if (error instanceof MoveFault) return error;
    throw error;
  }
  throw new Error('expected a fault, and nothing faulted.');
}

/** Run `run` over a draft of `base`, expect the fault named, and prove nothing was written. */
function faultsWritingNothing(
  base: WorldState,
  run: (draft: Draft) => unknown,
  reason: MoveFaultReason,
): MoveFault {
  const draft = new Draft(base);
  const fault = faultOf(() => run(draft));
  expect(fault.reason).toBe(reason);
  const { state, changes } = draft.commit();
  expect(changes).toEqual({ serial: base.serial, written: [], removed: [], visitors: [] });
  expect(JSON.stringify(saveWorld(state))).toBe(JSON.stringify(saveWorld(base)));
  return fault;
}

describe('a move asks the thing, then where it is, then where it goes', () => {
  it('stops at the thing’s refusal, and never asks the container it is in', () => {
    // The trap's `release` faults if it is asked.
    const { draft, visitor } = turn();
    const before = snapshot(draft);
    expect(said(moveInstance(context(draft), visitor, POT, TRAY))).toBe(
      `depart by ${POT}: "It is too heavy."`,
    );
    expect(snapshot(draft)).toBe(before);
  });

  it('charges only the thing’s guard when it refuses: the source’s is never run', () => {
    // The pot sits in the trap and the dish in the tray, at the same
    // depth, both `Heavy`; only the trap writes a `release`.
    const steps = (item: InstanceId, to: InstanceId): number => {
      const { draft, visitor } = turn();
      const budget = new Budget(DEFAULT_LIMITS.budgets);
      moveInstance(context(draft, { budget }), visitor, item, to);
      return budget.spentSteps;
    };
    expect(steps(POT, CHEST)).toBe(steps(DISH, CHEST));
  });

  it('stops at the source’s refusal, and never asks where the thing was going', () => {
    // The trap's `accept` faults if it is asked.
    const { draft, visitor } = turn();
    expect(said(moveInstance(context(draft), visitor, PEBBLE, TRAP))).toBe(
      `release by ${SAFE}: "It is sealed."`,
    );
  });

  it('asks where the thing goes last, and its refusal decides', () => {
    const { draft, visitor } = turn();
    for (const thing of [STONE, TWIG]) moved(moveInstance(context(draft), visitor, thing, visitor));
    const refusal = refusalOf(moveInstance(context(draft), visitor, LEAF, visitor));
    expect(refusal).toMatchObject({ guard: 'accept', by: visitor, origin: 'sprout.Actor' });
  });

  it('allows where no party writes a guard, and charges nothing beyond finding both in range', () => {
    const { draft, visitor } = turn();
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    moved(moveInstance(context(draft, { budget }), visitor, STONE, TRAY));
    const fresh = turn();
    const ranged = new Budget(DEFAULT_LIMITS.budgets);
    const walk = { tree: liveTree(fresh.draft), passes: passing(), budget: ranged };
    reaches(walk, fresh.visitor, STONE, 'any');
    reaches(walk, fresh.visitor, TRAY, 'any');
    // The statement that proposed it is its body's step, not the move's.
    expect(budget.spentSteps).toBe(ranged.spentSteps);
  });
});

describe('guards composed into one kind', () => {
  it('speak in run order: the first composed kind’s refusal is the one read', () => {
    const { draft, visitor } = turn();
    const refusal = refusalOf(moveInstance(context(draft), visitor, URN, TRAY));
    expect(refusal).toEqual({
      guard: 'depart',
      by: URN,
      origin: 'keep.Heavy',
      said: { text: 'It is too heavy.' },
      bindings: new Map([
        ['mover', boundObject(visitor)],
        ['to', boundObject(TRAY)],
      ]),
    });
  });

  it('all run until one refuses: an allowing guard before a refusing one still runs', () => {
    const steps = (item: InstanceId): { budget: number; said: string } => {
      const { draft, visitor } = turn();
      const budget = new Budget(DEFAULT_LIMITS.budgets);
      const outcome = moveInstance(context(draft, { budget }), visitor, item, TRAY);
      return { budget: budget.spentSteps, said: said(outcome) };
    };
    const bell = steps(BELL);
    const lump = steps(LUMP);
    expect(bell.said).toBe(`depart by ${BELL}: "It is too heavy."`);
    expect(lump.said).toBe(`depart by ${LUMP}: "It is too heavy."`);
    // `Easy`'s `allow` is one statement, run before `Heavy` refuses.
    expect(bell.budget).toBe(lump.budget + 1);
  });

  it('put the object’s own guard last, after what its kind composes', () => {
    const { draft, visitor } = turn();
    expect(said(moveInstance(context(draft), visitor, VASE, TRAY))).toBe(
      `depart by ${VASE}: "It would break."`,
    );
  });
});

describe('the engine’s own refusals', () => {
  it('refuse a thing going into itself or into what it holds, before any guard is asked', () => {
    // The chest's own `depart` would refuse, and is not what speaks.
    const { draft, visitor } = turn();
    const before = snapshot(draft);
    for (const into of [CHEST, PURSE]) {
      expect(moveInstance(context(draft), visitor, CHEST, into)).toEqual({
        engine: 'inside-itself',
        text: 'chest cannot go inside itself.',
      });
    }
    expect(snapshot(draft)).toBe(before);
  });

  it('refuse an actor going into something that does not hold actors, before any guard is asked', () => {
    // Marta's own `depart` refuses a mover other than her, and is not what speaks.
    const { draft, visitor } = turn();
    const before = snapshot(draft);
    expect(moveInstance(context(draft), visitor, MARTA, TRAY)).toEqual({
      engine: 'not-a-place',
      text: 'marta cannot stand in tray.',
    });
    // The world holds things and not people.
    expect(moveInstance(context(draft), visitor, MARTA, WORLD_ID)).toEqual({
      engine: 'not-a-place',
      text: 'marta cannot stand in keep.',
    });
    // Nor does another actor: a person is not carried.
    expect(said(moveInstance(context(draft), visitor, MARTA, visitor))).toBe(
      'engine not-a-place: marta cannot stand in Creature.',
    );
    expect(snapshot(draft)).toBe(before);
  });
});

describe('a move that cannot be asked about', () => {
  const base = (): { state: WorldState; visitor: InstanceId; away: InstanceId } => {
    const draft = new Draft(initialState(catalogue));
    const visitor = visitorIn(draft, HALL);
    const away = visitorIn(draft, null);
    return { state: draft.commit().state, visitor, away };
  };

  it('faults for the world, writing nothing', () => {
    const { state, visitor } = base();
    const fault = faultsWritingNothing(
      state,
      (draft) => moveInstance(context(draft), visitor, WORLD_ID, HALL),
      'world',
    );
    expect(fault.object).toBe(WORLD_ID);
    expect(fault.message).toBe('the world is the root of the tree, and goes nowhere.');
  });

  it('faults for a visitor who is away, writing nothing', () => {
    const { state, visitor, away } = base();
    const fault = faultsWritingNothing(
      state,
      (draft) => moveInstance(context(draft), visitor, away, HALL),
      'away',
    );
    expect(fault.message).toBe(
      `\`${away}\` is a visitor who is away, and is nowhere to be moved from.`,
    );
  });

  it('faults for a thing out of the mover’s range, or no longer live, writing nothing', () => {
    const { state, visitor } = base();
    const shut = faultsWritingNothing(
      state,
      (draft) => moveInstance(context(draft, { passes: passing(CHEST) }), visitor, COIN, TRAY),
      'out-of-range',
    );
    expect(shut.object).toBe(COIN);
    expect(shut.message).toBe(
      `\`${COIN}\` is out of range of \`${visitor}\`, so it could not be moved.`,
    );
    const draft = new Draft(state);
    destroyInstance(draft, STONE);
    expect(faultOf(() => moveInstance(context(draft), visitor, STONE, TRAY)).reason).toBe(
      'out-of-range',
    );
  });

  it('faults for a destination out of the mover’s range, writing nothing', () => {
    const { state, visitor } = base();
    // Places are out of range of one another while the world refuses.
    const fault = faultsWritingNothing(
      state,
      (draft) => moveInstance(context(draft), visitor, STONE, YARD),
      'out-of-range',
    );
    expect(fault.object).toBe(YARD);
    expect(fault.message).toBe(
      `\`${YARD}\` is out of range of \`${visitor}\`, so nothing could be moved into it.`,
    );
  });

  it('faults for a destination that holds nothing, writing nothing', () => {
    const { state, visitor } = base();
    const fault = faultsWritingNothing(
      state,
      (draft) => moveInstance(context(draft), visitor, STONE, URN),
      'holds-nothing',
    );
    expect(fault.object).toBe(URN);
    expect(fault.message).toBe(
      `\`${URN}\` holds nothing, so \`${STONE}\` could not be moved into it.`,
    );
  });
});

describe('a move made', () => {
  it('is one write: the thing, last in its new container under a new arrival', () => {
    const { draft, visitor } = turn();
    const base = draft.commit().state;
    const next = new Draft(base);
    const outcome = moved(moveInstance(context(next), visitor, STONE, TRAY));
    expect([outcome.item, outcome.from, outcome.to]).toEqual([STONE, HALL, TRAY]);
    expect(next.children(TRAY)).toEqual([DISH, STONE]);
    expect(next.children(HALL)).not.toContain(STONE);
    expect(next.instance(STONE)!.arrival).toBe(base.serial + 1);
    const { changes } = next.commit();
    expect(changes.written).toEqual([STONE]);
    expect(changes.removed).toEqual([]);
  });

  it('sends `:left` to where it was, `:entered` to where it is, `:moved` to itself, in that order', () => {
    const { draft, visitor } = turn();
    expect(moved(moveInstance(context(draft), visitor, STONE, TRAY)).sends).toEqual([
      { message: 'left', recipient: HALL, item: STONE, to: TRAY },
      { message: 'entered', recipient: TRAY, item: STONE, from: HALL },
      { message: 'moved', recipient: STONE, from: HALL, to: TRAY },
    ]);
  });

  it('into the container it is already in, is a move like any other: last, and all three sent', () => {
    const { draft, visitor } = turn();
    moved(moveInstance(context(draft), visitor, STONE, TRAY));
    moved(moveInstance(context(draft), visitor, TWIG, TRAY));
    const again = moved(moveInstance(context(draft), visitor, STONE, TRAY));
    expect(draft.children(TRAY)).toEqual([DISH, TWIG, STONE]);
    expect(again.sends.map((send) => [send.message, send.recipient])).toEqual([
      ['left', TRAY],
      ['entered', TRAY],
      ['moved', STONE],
    ]);
  });

  it('speaks nothing for a thing that is not an actor, even between places', () => {
    const { draft, visitor } = turn();
    expect(moved(moveInstance(context(draft), visitor, STONE, ALCOVE)).notices).toEqual([]);
  });
});

describe('an actor moved between places', () => {
  it('has the old place’s `leaves` told to those left behind, NPCs included', () => {
    const { draft, visitor } = turn();
    const { notices } = moved(moveInstance(context(draft), visitor, visitor, ALCOVE));
    const leaves = notices.find((notice) => notice.notice === 'leaves')!;
    // Directly in the hall: Marta, and not any thing.
    expect(leaves).toMatchObject({ place: HALL, bindings: { item: visitor }, audience: [MARTA] });
    expect('passage' in leaves && [leaves.passage.origin, leaves.passage.name]).toEqual([
      'sprout.Place',
      'leaves',
    ]);
  });

  it('has the new place’s own `arrives` told to those already there, the one arriving left out', () => {
    const { draft, visitor } = turn();
    const other = visitorIn(draft, ALCOVE);
    const { notices } = moved(moveInstance(context(draft), visitor, visitor, ALCOVE));
    expect(notices.map((notice) => notice.notice)).toEqual(['leaves', 'arrives', 'described']);
    const arrives = notices[1]!;
    expect(arrives).toMatchObject({
      place: ALCOVE,
      bindings: { item: visitor },
      audience: [other],
    });
    // The alcove writes its own line, which replaces the library's default.
    expect('passage' in arrives && arrives.passage.body.text.trim()).toBe('{item} squeezes in.');
    expect('passage' in arrives && arrives.passage.yields).toBe(false);
  });

  it('describes the new place to the one who moved, with no words until the description is written', () => {
    const { draft, visitor } = turn();
    const { notices } = moved(moveInstance(context(draft), visitor, visitor, ALCOVE));
    expect(notices.at(-1)).toEqual({ notice: 'described', place: ALCOVE, audience: [visitor] });
  });

  it('says nothing for a place whose kind has no such passage, and still describes it', () => {
    const { draft, visitor } = turn();
    const { notices } = moved(moveInstance(context(draft), visitor, visitor, CELLAR));
    expect(notices.map((notice) => [notice.notice, notice.place])).toEqual([
      ['leaves', HALL],
      ['described', CELLAR],
    ]);
  });

  it('is moved by another the same way, the mover hearing as anyone there would', () => {
    // Marta walks herself: the visitor beside her hears her leave.
    const { draft, visitor } = turn();
    const { notices } = moved(moveInstance(context(draft), MARTA, MARTA, CELLAR));
    expect(notices[0]).toMatchObject({ notice: 'leaves', place: HALL, audience: [visitor] });
  });
});

describe('`sprout.Actor`’s guards, through a world whose visitors compose it', () => {
  it('keep a stranger from carrying a person off', () => {
    const { draft, visitor } = turn();
    const refusal = refusalOf(moveInstance(context(draft), MARTA, visitor, ALCOVE));
    expect(refusal).toMatchObject({ guard: 'depart', by: visitor, origin: 'sprout.Actor' });
    expect('passage' in refusal.said && refusal.said.passage).toMatchObject({
      name: 'held_fast',
      origin: 'sprout.Actor',
    });
    // A person moves themselves.
    moved(moveInstance(context(draft), visitor, visitor, ALCOVE));
  });

  it('keep a stranger from taking what a person holds', () => {
    const { draft, visitor } = turn();
    moved(moveInstance(context(draft), visitor, STONE, visitor));
    const refusal = refusalOf(moveInstance(context(draft), MARTA, STONE, MARTA));
    expect(refusal).toMatchObject({ guard: 'release', by: visitor, origin: 'sprout.Actor' });
    expect('passage' in refusal.said && refusal.said.passage.name).toBe('not_yours');
    expect(draft.instance(STONE)!.container).toBe(visitor);
    // What a person puts down, they put down.
    moved(moveInstance(context(draft), visitor, STONE, TRAY));
  });

  it('refuse what does not fit, in the world’s own words where it writes them', () => {
    const { draft, visitor } = turn();
    moved(moveInstance(context(draft), visitor, STONE, visitor));
    moved(moveInstance(context(draft), visitor, TWIG, visitor));
    const refusal = refusalOf(moveInstance(context(draft), MARTA, LEAF, visitor));
    expect(refusal).toMatchObject({ guard: 'accept', by: visitor, origin: 'sprout.Actor' });
    expect('passage' in refusal.said && refusal.said.passage).toMatchObject({
      name: 'hands_full',
      origin: 'keep.Creature',
    });
    expect(draft.children(visitor)).toEqual([STONE, TWIG]);
  });

  it('let a gift arrive where there is room', () => {
    const { draft, visitor } = turn();
    moved(moveInstance(context(draft), MARTA, STONE, visitor));
    expect(draft.children(visitor)).toEqual([STONE]);
  });
});

describe('any run of moves', () => {
  /** How many moves were made, refused and faulted. */
  function run(seed: number): { made: number; refused: number; faulted: number } {
    const counted = { made: 0, refused: 0, faulted: 0 };
    const choose = chooser(seed);
    const { draft, visitor } = turn();
    const everything = [WORLD_ID, visitor, ...catalogue.declared.keys()];
    const budget = new Budget({ ...DEFAULT_LIMITS.budgets, steps: 10_000_000 });
    const lenient = context(draft, { budget, passes: (container) => container !== CHEST });
    for (let step = 0; step < 80; step++) {
      const mover = choose.one(everything);
      const item = choose.one(everything);
      const to = choose.one(everything);
      const before = snapshot(draft);
      const where = `seed ${seed}, step ${step}: ${mover} moves ${item} to ${to}`;
      let outcome: Moved | Refused;
      try {
        outcome = moveInstance(lenient, mover, item, to);
      } catch (error) {
        // Only a fault escapes, the move's or a guard's arithmetic: the
        // draft's own invariants are never what refuses.
        expect(error instanceof MoveFault || error instanceof IntegerOverflow, where).toBe(true);
        expect(snapshot(draft), where).toBe(before);
        counted.faulted += 1;
        continue;
      }
      if (!('sends' in outcome)) {
        expect(snapshot(draft), where).toBe(before);
        counted.refused += 1;
        continue;
      }
      expect(draft.instance(item)!.container, where).toBe(to);
      expect(draft.children(to).at(-1), where).toBe(item);
      counted.made += 1;
    }
    return counted;
  }

  for (const seed of [1, 2, 3, 5, 8, 13, 21, 34]) {
    it(`moves the thing last into where it went, or writes nothing and says why (seed ${seed})`, () => {
      const counted = run(seed);
      expect(counted.made).toBeGreaterThan(0);
      expect(counted.refused).toBeGreaterThan(0);
    });
  }
});
