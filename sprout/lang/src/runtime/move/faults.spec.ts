// What `moveInstance` faults for rather than asks about: the world, a
// visitor who is away, a thing or a destination out of the mover's range
// or no longer live, and a destination that holds nothing. Each fault
// writes nothing. The keep is `fixtures/move.ts`.

import { describe, expect, it } from 'vitest';

import {
  catalogue,
  CHEST,
  COIN,
  context,
  HALL,
  passing,
  STONE,
  TRAY,
  URN,
  visitorIn,
  WORLD_ID,
  YARD,
} from '../../fixtures/move.js';
import { Draft } from '../draft.js';
import type { InstanceId } from '../ids.js';
import { destroyInstance } from '../lifecycle.js';
import { initialState, saveWorld } from '../load.js';
import { MoveFault, moveInstance, type MoveFaultReason } from '../move.js';
import type { WorldState } from '../state.js';

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
  expect(changes).toEqual({
    serial: base.serial,
    written: [],
    removed: [],
    tombstoned: [],
    visitors: [],
  });
  expect(JSON.stringify(saveWorld(state))).toBe(JSON.stringify(saveWorld(base)));
  return fault;
}

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

  it('asks no range of a destination reached through an exit, and still faults for one not live', () => {
    const { state, visitor } = base();
    const draft = new Draft(state);
    const moved = moveInstance(context(draft), visitor, visitor, YARD, 'exit');
    expect('item' in moved && [moved.from, moved.to]).toEqual([HALL, YARD]);
    expect(draft.instance(visitor)!.container).toBe(YARD);
    const gone = new Draft(state);
    destroyInstance(gone, URN);
    expect(faultOf(() => moveInstance(context(gone), visitor, visitor, URN, 'exit')).reason).toBe(
      'out-of-range',
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
