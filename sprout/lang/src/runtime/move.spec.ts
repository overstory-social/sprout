// `moveInstance` asking a move's parties in order, the guards composed
// into one kind, the engine's own refusals, the one write a move makes,
// and the invariant that any run of moves either moves the thing or writes
// nothing. Faults, what an actor's move tells, and `sprout.Actor`'s
// guards are in `move/`; the keep is `fixtures/move.ts`.

import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { compiledWorld } from '../fixtures/bundle.js';
import {
  ALCOVE,
  BELL,
  CAPS,
  catalogue,
  CHEST,
  context,
  DISH,
  HALL,
  LEAF,
  LUMP,
  MARTA,
  moved,
  passing,
  PEBBLE,
  POT,
  PURSE,
  refusalOf,
  SAFE,
  said,
  snapshot,
  STONE,
  TRAP,
  TRAY,
  turn,
  TWIG,
  URN,
  VASE,
  visitorIn,
  WORLD_ID,
} from '../fixtures/move.js';
import { chooser } from '../fixtures/parse.js';
import { Budget } from './budget.js';
import { catalogueOf } from './catalogue.js';
import { Draft } from './draft.js';
import { declaredId, type InstanceId } from './ids.js';
import { boundObject, IntegerOverflow } from './evaluate.js';
import { initialState } from './load.js';
import { MoveFault, moveInstance, type Moved, type Refused } from './move.js';
import { reaches } from './range.js';
import { liveTree } from './live.js';

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
    expect(refusal).toMatchObject({
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
      const refused = moveInstance(context(draft), visitor, CHEST, into);
      expect(said(refused)).toBe(
        'engine inside-itself: sprout.World inside_itself: {item} cannot go inside itself.',
      );
      // The line names the thing moved, which is what its `{item}` renders.
      expect('engine' in refused && refused.bindings).toEqual(
        new Map([['item', boundObject(CHEST)]]),
      );
    }
    expect(snapshot(draft)).toBe(before);
  });

  it('refuse a thing going into itself in the world’s own words, where it writes them', () => {
    const own = catalogueOf(
      compiledWorld('den', {
        'world.sprout': [
          'world den is sprout.World { contains visitors are Pup visitors arrive at lair',
          '  passage inside_itself { {item} will not fold into itself. }',
          '  object lair is sprout.Place {',
          '    object sack is Sack',
          '  }',
          '}',
          'kind Pup is sprout.Visitor { }',
          'kind Sack { contains }',
          '',
        ].join('\n'),
      }),
      CAPS,
    );
    const draft = new Draft(initialState(own));
    const visitor = visitorIn(draft, declaredId('den', ['lair']), own);
    const sack = declaredId('den', ['lair', 'sack']);
    const refused = moveInstance(context(draft, { catalogue: own }), visitor, sack, sack);
    expect(said(refused)).toBe(
      'engine inside-itself: den.den inside_itself: {item} will not fold into itself.',
    );
  });

  it('refuse an actor going into something that does not hold actors, before any guard is asked', () => {
    // Marta's own `depart` refuses a mover other than her, and is not what speaks.
    const { draft, visitor } = turn();
    const before = snapshot(draft);
    // The engine's fixed words name the actor and where it was to go.
    expect(moveInstance(context(draft), visitor, MARTA, TRAY)).toMatchObject({
      engine: 'not-a-place',
      said: { text: '{item} cannot stand in {to}.' },
      bindings: new Map([
        ['item', boundObject(MARTA)],
        ['to', boundObject(TRAY)],
      ]),
    });
    // The world holds things and not people.
    expect(said(moveInstance(context(draft), visitor, MARTA, WORLD_ID))).toBe(
      'engine not-a-place: "{item} cannot stand in {to}."',
    );
    // Nor does another actor: a person is not carried.
    expect(said(moveInstance(context(draft), visitor, MARTA, visitor))).toBe(
      'engine not-a-place: "{item} cannot stand in {to}."',
    );
    expect(snapshot(draft)).toBe(before);
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
