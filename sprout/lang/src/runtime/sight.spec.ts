import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import {
  CELLAR,
  CHEST,
  COAL,
  dark,
  darkContext,
  KITCHEN,
  LAMP,
  LANTERN,
  MARTA,
  personOf,
} from '../fixtures/darkness.js';
import { Budget, BudgetExhausted } from './budget.js';
import { rangeOf } from './range.js';
import { liveTree } from './live.js';
import { seenFrom } from './sight.js';

describe('what a place sees', () => {
  it('is what its range reaches, a shut container still a wall', () => {
    const state = dark();
    const seen = seenFrom(CELLAR, darkContext(state));
    expect(seen).toContain(COAL);
    expect(seen).toContain(CHEST);
    expect(seen).not.toContain(LANTERN);
    expect(seen).not.toContain(KITCHEN);
  });

  it('takes in what a person carries, though a person passes nothing to range', () => {
    const state = dark([[MARTA, CELLAR]], [], [[MARTA, LAMP]]);
    const context = darkContext(state);
    expect(seenFrom(CELLAR, context)).toContain(LAMP);
    // Range itself still stops at the person.
    const range = rangeOf(
      { tree: liveTree(context.state), passes: context.passes, budget: context.budget },
      CELLAR,
      'any',
    );
    expect(range.within.has(personOf(state, MARTA))).toBe(true);
    expect(range.within.has(LAMP)).toBe(false);
  });

  it('is charged to the meter, so a walk too dear faults', () => {
    const state = dark();
    const context = {
      ...darkContext(state),
      budget: new Budget({ ...DEFAULT_LIMITS.budgets, steps: 2 }),
    };
    expect(() => seenFrom(CELLAR, context)).toThrow(BudgetExhausted);
  });
});
