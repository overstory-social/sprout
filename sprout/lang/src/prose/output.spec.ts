import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { BRASS_KEY, proseTurn } from '../fixtures/prose.js';
import { BudgetExhausted } from '../runtime/budget.js';
import { charged } from './output.js';

describe('what a reader may still be told', () => {
  const tight = () => proseTurn({ ...DEFAULT_LIMITS.budgets, output: 10 });

  it('faults the turn where the actor’s own output passes the host’s figure', () => {
    const turn = tight();
    expect(charged(turn.context, turn.marta, 10)).toBe(true);
    expect(() => charged(turn.context, turn.marta, 1)).toThrow(BudgetExhausted);
  });

  it('cuts anyone else short instead, and the turn goes on', () => {
    // The brass key stands in for someone else in the place.
    const turn = tight();
    expect(charged(turn.context, BRASS_KEY, 8)).toBe(true);
    expect(charged(turn.context, BRASS_KEY, 3)).toBe(false);
    expect(charged(turn.context, BRASS_KEY, 1)).toBe(false);
    expect(turn.context.budget.cutShort).toEqual([BRASS_KEY]);
    // The actor is still told what fits them.
    expect(charged(turn.context, turn.marta, 10)).toBe(true);
  });

  it('cuts everyone short, and faults nothing, where nobody acted', () => {
    const turn = tight();
    const nobody = { ...turn.context, actor: null };
    expect(charged(nobody, turn.marta, 11)).toBe(false);
    expect(nobody.budget.cutShort).toEqual([turn.marta]);
  });
});
