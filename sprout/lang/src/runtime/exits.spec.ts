import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import {
  BEACON,
  CATALOGUE,
  CHIMNEY,
  DEAD_END,
  LADDER,
  LAMP,
  LANTERN,
  LOFT,
  MEADOW,
  MOUTH,
  SHED,
  SHOP,
  SOOT,
  ways,
  YARD,
} from '../fixtures/exits.js';
import { Budget, BudgetExhausted } from './budget.js';
import { Draft } from './draft.js';
import { exitsFrom, sayingThrough, waysFrom } from './exits.js';
import type { InstanceId } from './ids.js';
import { passRules } from './passes.js';
import type { StateReader, WorldState } from './state.js';
import type { Value } from './values.js';

/** What asking `place`'s ways out in `state` reads. */
function contextOf(state: WorldState | Draft, budget: Budget) {
  const reader: StateReader = state instanceof Draft ? state : new Draft(state);
  const passes = passRules({
    state: reader,
    kinds: CATALOGUE.lookup,
    caps: CATALOGUE.caps,
    budget,
    names: CATALOGUE.names,
  });
  return { state: reader, catalogue: CATALOGUE, budget, passes };
}

/** The exits and links that apply on `place` in `state`, as direction (null for a link), label and where each leads. */
function applying(
  state: WorldState | Draft,
  place: InstanceId,
  budget = new Budget(DEFAULT_LIMITS.budgets),
) {
  return exitsFrom(place, contextOf(state, budget)).map((exit) => [
    exit.direction,
    exit.label,
    exit.to,
  ]);
}

/** Every way out that applies on `place`, as direction, label and where it leads or what it says and who says it. */
function waysOut(state: WorldState, place: InstanceId) {
  return waysFrom(place, contextOf(state, new Budget(DEFAULT_LIMITS.budgets))).map((way) => [
    way.direction,
    way.label,
    'to' in way
      ? way.to
      : [
          way.refuses.by,
          'text' in way.refuses.said
            ? way.refuses.said.text
            : 'passage' in way.refuses.said
              ? way.refuses.said.passage.name
              : null,
        ],
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
    draft.write({ ...draft.instance(MOUTH)!, links: new Map([['onward', cell]]) });
    expect(applying(draft, MOUTH)).toEqual([
      [null, 'deeper into the dark', cell],
      ['up', 'up into the daylight', YARD],
    ]);
    draft.remove(cell);
    expect(applying(draft, MOUTH).map(([direction]) => direction)).toEqual(['up']);
  });

  it('are none of a kind the place’s kind composes, since exits and links are not composed', () => {
    const draft = new Draft(ways());
    draft.write({ ...draft.instance(DEAD_END)!, links: new Map([['onward', MEADOW]]) });
    expect(applying(draft, DEAD_END)).toEqual([]);
  });

  it('take an exit that refuses into a direction’s chain, deciding it, and never as a way that leads', () => {
    expect(waysOut(ways(), SHED)).toEqual([
      ['west', 'west', [SHED, 'The brambles are too thick.']],
      ['north', 'north', [SHED, 'boarded']],
    ]);
    expect(applying(ways(), SHED)).toEqual([]);
    // Lit, the way west before the refusal applies, and the refusal no longer does.
    const lit = ways(undefined, [set(LANTERN, 'lit', true)]);
    expect(waysOut(lit, SHED)).toEqual([
      ['west', 'into the thicket', MEADOW],
      ['north', 'north', [SHED, 'boarded']],
    ]);
    expect(applying(lit, SHED)).toEqual([['west', 'into the thicket', MEADOW]]);
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

describe('what an exit says as it is taken', () => {
  /** What taking the way `label` names on `place` says, as who says it and its words or passage; null where nothing. */
  function saying(state: WorldState, place: InstanceId, label: string, budget?: Budget) {
    const context = contextOf(state, budget ?? new Budget(DEFAULT_LIMITS.budgets));
    const way = exitsFrom(place, context).find((one) => one.label === label)!;
    const said = sayingThrough(place, way, context);
    if (said === null) return null;
    return [
      said.by,
      'text' in said.said ? said.said.text : 'passage' in said.said ? said.said.passage.name : null,
    ];
  }

  it('is the words of the exit that applies in its direction, said by its place', () => {
    expect(saying(ways(), CHIMNEY, 'down the flue')).toEqual([
      CHIMNEY,
      "You won't be able to get back up.",
    ]);
    expect(saying(ways(), CHIMNEY, 'into the meadow')).toEqual([
      CHIMNEY,
      'You push through the gate.',
    ]);
    // Once the first in the chain no longer holds, the next one's passage is said.
    expect(saying(ways(undefined, [set(SOOT, 'lit', true)]), CHIMNEY, 'down the flue')).toEqual([
      CHIMNEY,
      'sooty',
    ]);
  });

  it('is nothing for an exit that says nothing, or a place none of whose exits say anything', () => {
    expect(saying(ways(), CHIMNEY, 'out onto the roof')).toBeNull();
    expect(saying(ways(), YARD, 'into the shop')).toBeNull();
    expect(
      sayingThrough(
        CHIMNEY,
        { direction: 'down', label: 'down the flue', to: SHOP },
        contextOf(ways(), new Budget(DEFAULT_LIMITS.budgets)),
      ),
    ).toBeNull();
    expect(
      sayingThrough(
        'ways/nowhere' as InstanceId,
        { direction: 'down', label: 'down the flue', to: SHED },
        contextOf(ways(), new Budget(DEFAULT_LIMITS.budgets)),
      ),
    ).toBeNull();
  });

  it('asks its direction’s exits again only where one of them says something, a step for each', () => {
    const spoken = new Budget(DEFAULT_LIMITS.budgets);
    saying(ways(), CHIMNEY, 'out onto the roof', spoken);
    const before = new Budget(DEFAULT_LIMITS.budgets);
    exitsFrom(CHIMNEY, contextOf(ways(), before));
    // Out says nothing, and no other exit out writes words: nothing is asked again.
    expect(spoken.spentSteps).toBe(before.spentSteps);
    const down = new Budget(DEFAULT_LIMITS.budgets);
    saying(ways(), CHIMNEY, 'down the flue', down);
    // The way down is asked again: its first exit, and the guard it reads.
    expect(down.spentSteps).toBeGreaterThan(before.spentSteps);
  });
});
