import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../../bundle/limits.js';
import { BRASS_KEY, DOOR, GONG, GUARD, study } from '../../fixtures/parser.js';
import { Budget } from '../budget.js';
import { Draws } from '../draws.js';
import type { InstanceId } from '../ids.js';
import { addressOf } from './address.js';
import type { Filled } from './fill.js';
import { choosePartial, comparePartial, partialsOf, type Partial } from './partial.js';

const one = study();
const address = (id: InstanceId) =>
  addressOf(one.draft.instance(id)!, { world: one.draft.world, nicknames: one.nicknames });
/** `unlock [target] with [tool]`, its slots where the line `unlock door with gong` puts them. */
const PARTS = [{ words: ['unlock'] }, { slot: 0 }, { words: ['with'] }, { slot: 1 }];
const SPANS = [
  { role: 0, start: 1, end: 2 },
  { role: 1, start: 3, end: 4 },
];
const thing = (id: InstanceId, literal = 1) => ({ bound: { object: id }, near: 2, literal });
const partials = (fills: Filled[], budget = new Budget(DEFAULT_LIMITS.budgets)) =>
  partialsOf(PARTS, SPANS, fills, address, budget);

describe('a partial reading', () => {
  it('is written as a visitor types it, a thing after `the` and a proper name alone, each a step', () => {
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    expect(
      partials(
        [
          { fills: 'options', options: [thing(DOOR)] },
          { fills: 'unfit', things: [thing(GONG, 2), thing(GUARD)] },
        ],
        budget,
      ),
    ).toEqual([
      { words: 'unlock the door with the brass disc', literal: 5, bound: 2 },
      { words: 'unlock the door with Oskar', literal: 4, bound: 2 },
    ]);
    expect(budget.spentSteps).toBe(2);
  });

  it('is none where no slot names a thing it cannot take, or one names nothing or no thing', () => {
    expect(
      partials([
        { fills: 'options', options: [thing(DOOR)] },
        { fills: 'options', options: [thing(BRASS_KEY)] },
      ]),
    ).toEqual([]);
    expect(
      partials([
        { fills: 'nothing', start: 0, end: 1 },
        { fills: 'unfit', things: [thing(GONG)] },
      ]),
    ).toEqual([]);
    expect(
      partials([
        { fills: 'options', options: [thing(DOOR)] },
        { fills: 'unfit', things: [] },
      ]),
    ).toEqual([]);
  });
});

describe('the partial reading `cannot` says', () => {
  const partial = (words: string, literal: number, bound: number): Partial => ({
    words,
    literal,
    bound,
  });

  it('is the one that matched most words, then filled most roles, whatever order they came in', () => {
    expect(comparePartial(partial('a', 3, 1), partial('b', 2, 2))).toBeLessThan(0);
    expect(comparePartial(partial('a', 2, 1), partial('b', 2, 2))).toBeGreaterThan(0);
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    expect(
      choosePartial([partial('first', 2, 1), partial('best', 2, 2)], new Draws(7), budget),
    ).toBe('best');
    expect(budget.spentSteps).toBe(0);
  });

  it('is drawn among those still tied, a step, and varies with the seed', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 16; seed++) {
      const budget = new Budget(DEFAULT_LIMITS.budgets);
      seen.add(
        choosePartial([partial('brass', 2, 2), partial('iron', 2, 2)], new Draws(seed), budget),
      );
      expect(budget.spentSteps).toBe(1);
    }
    expect([...seen].sort()).toEqual(['brass', 'iron']);
  });
});
