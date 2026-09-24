import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import {
  BEACON,
  CATALOGUE,
  LADDER,
  LAMP,
  LOFT,
  MEADOW,
  MOUTH,
  SHED,
  SHOP,
  ways,
  YARD,
} from '../fixtures/exits.js';
import { Budget, BudgetExhausted } from './budget.js';
import { Draft } from './draft.js';
import { exitsFrom } from './exits.js';
import type { InstanceId } from './ids.js';
import { passRules } from './passes.js';
import type { StateReader, WorldState } from './state.js';
import type { Value } from './values.js';

/** The exits that apply on `place` in `state`, as direction, label and where each leads. */
function applying(
  state: WorldState | Draft,
  place: InstanceId,
  budget = new Budget(DEFAULT_LIMITS.budgets),
) {
  const reader: StateReader = state instanceof Draft ? state : new Draft(state);
  const passes = passRules({
    state: reader,
    kinds: CATALOGUE.lookup,
    caps: CATALOGUE.caps,
    budget,
    names: CATALOGUE.names,
  });
  return exitsFrom(place, { state: reader, catalogue: CATALOGUE, budget, passes }).map((exit) => [
    exit.direction,
    exit.label,
    exit.to,
  ]);
}

const set = (id: InstanceId, name: string, value: Value) => [id, name, value] as const;

describe('the exits that apply on a place', () => {
  it('are one for each direction, the first whose guard holds, in the order its kind answers them', () => {
    expect(applying(ways(), YARD)).toEqual([
      ['in', 'into the shop', SHOP],
      ['north', 'deeper into the dark', MOUTH],
      ['up', 'up to the loft', LOFT],
      ['east', 'into the shed', SHED],
    ]);
    // Lit, the first way north no longer holds and the one after it applies.
    expect(applying(ways(undefined, [set(LAMP, 'lit', true)]), YARD)[1]).toEqual([
      'north',
      'toward a grey light',
      MEADOW,
    ]);
  });

  it('leave out an exit whose guard does not hold, until it does', () => {
    expect(applying(ways(), SHOP).map(([direction]) => direction)).toEqual(['out']);
    expect(applying(ways(undefined, [set(LADDER, 'down', true)]), SHOP)).toEqual([
      ['out', 'back to the yard', YARD],
      ['up', 'up the ladder', LOFT],
    ]);
  });

  it('leave out an exit whose guard reads through a name out of the place’s range, and never fault', () => {
    // The beacon sits in the world, which lets nothing through to the yard.
    const lit = ways(undefined, [set(BEACON, 'lit', true)]);
    expect(applying(lit, YARD).some(([direction]) => direction === 'south')).toBe(false);
  });

  it('leave out an exit to a declared place destroyed, as an unset link is left out', () => {
    const draft = new Draft(ways());
    draft.remove(SHED);
    expect(draft.tombstoned(SHED)).toBe(true);
    expect(applying(draft, YARD).map(([direction]) => direction)).toEqual(['in', 'north', 'up']);
  });

  it('leave out an unset link, and offer it once it is connected, until its place is gone', () => {
    // An object's own way up replaces its kind's.
    expect(applying(ways(), MOUTH)).toEqual([['up', 'up into the daylight', YARD]]);
    const draft = new Draft(ways());
    const mouth = draft.instance(MOUTH)!;
    const cell = draft.mint();
    draft.add({
      ...mouth,
      id: cell,
      made: { from: 'spawned', kind: 'ways.MazeCell' },
      container: MOUTH,
      arrival: draft.nextSerial(),
      kind: CATALOGUE.kinds.get('ways.MazeCell')!,
      links: new Map(),
    });
    draft.write({ ...draft.instance(MOUTH)!, links: new Map([['north', cell]]) });
    expect(applying(draft, MOUTH)).toEqual([
      ['north', 'deeper into the dark', cell],
      ['up', 'up into the daylight', YARD],
    ]);
    draft.remove(cell);
    expect(applying(draft, MOUTH).map(([direction]) => direction)).toEqual(['up']);
  });

  it('are none where the place is not decoded', () => {
    expect(applying(ways(), 'ways/nowhere' as InstanceId)).toEqual([]);
  });

  it('charge a step for each exit asked, so asking too many faults', () => {
    expect(() =>
      applying(ways(), YARD, new Budget({ ...DEFAULT_LIMITS.budgets, steps: 3 })),
    ).toThrow(BudgetExhausted);
  });
});
