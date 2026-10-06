import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../../bundle/limits.js';
import { BRASS_KEY, DOOR, GONG, GUARD, study } from '../../fixtures/parser.js';
import { Budget } from '../budget.js';
import { Draws } from '../draws.js';
import type { InstanceId } from '../ids.js';
import { addressOf } from './address.js';
import type { Filled } from './fill.js';
import { choosePartial, comparePartial, partialsOf, type Partial } from './partial.js';
import {
  BOOK as BENCH_BOOK,
  BRASS_KEY as BENCH_KEY,
  CHEST as BENCH_CHEST,
  CRATE as BENCH_CRATE,
  POUCH as BENCH_POUCH,
  SATCHEL as BENCH_SATCHEL,
  bench,
  typedAtBench,
} from '../../fixtures/bench.js';
import type { CommandOutcome } from '../parser.js';

const one = study();
const address = (id: InstanceId) =>
  addressOf(one.draft.instance(id)!, { world: one.draft.world, nicknames: one.nicknames });
/** `unlock [target] with [tool]`, its slots where the line `unlock door with gong` puts them. */
const PARTS = [{ words: ['unlock'] }, { slot: 0 }, { words: ['with'] }, { slot: 1 }];
const SPANS = [
  { role: 0, start: 1, end: 2 },
  { role: 1, start: 3, end: 4 },
];
const thing = (id: InstanceId, literal = 1) => ({
  bound: { object: id },
  near: 2,
  literal,
  byName: 0,
});
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
      { words: 'unlock the door with the brass disc', literal: 5, bound: 2, uncarried: null },
      { words: 'unlock the door with Oskar', literal: 4, bound: 2, uncarried: null },
    ]);
    expect(budget.spentSteps).toBe(2);
  });

  it('names the thing not carried where a carried role is all that is wrong, and nothing where a role also cannot take its thing', () => {
    expect(
      partials([
        { fills: 'options', options: [thing(DOOR)] },
        { fills: 'outward', things: [thing(BRASS_KEY, 2)] },
      ]),
    ).toEqual([
      { words: 'unlock the door with the brass key', literal: 5, bound: 2, uncarried: BRASS_KEY },
    ]);
    expect(
      partials([
        { fills: 'unfit', things: [thing(GONG)] },
        { fills: 'outward', things: [thing(BRASS_KEY, 2)] },
      ]),
    ).toEqual([
      { words: 'unlock the brass disc with the brass key', literal: 5, bound: 2, uncarried: null },
    ]);
  });

  it('writes a run in a role that takes one thing as its first item, the one its turn reads', () => {
    expect(
      partials([
        {
          fills: 'run',
          options: [thing(DOOR)],
          later: [{ start: 2, end: 3, filled: { fills: 'options', options: [thing(GONG)] } }],
        },
        { fills: 'unfit', things: [thing(GUARD)] },
      ]),
    ).toEqual([{ words: 'unlock the door with Oskar', literal: 4, bound: 2, uncarried: null }]);
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

describe('the partial reading the world answers', () => {
  const partial = (words: string, literal: number, bound: number): Partial => ({
    words,
    literal,
    bound,
    uncarried: null,
  });

  it('is the one that matched most words, then filled most roles, whatever order they came in', () => {
    expect(comparePartial(partial('a', 3, 1), partial('b', 2, 2))).toBeLessThan(0);
    expect(comparePartial(partial('a', 2, 1), partial('b', 2, 2))).toBeGreaterThan(0);
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    expect(
      choosePartial([partial('first', 2, 1), partial('best', 2, 2)], new Draws(7), budget).words,
    ).toBe('best');
    expect(budget.spentSteps).toBe(0);
  });

  it('is drawn among those still tied, a step, and varies with the seed', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 16; seed++) {
      const budget = new Budget(DEFAULT_LIMITS.budgets);
      seen.add(
        choosePartial([partial('brass', 2, 2), partial('iron', 2, 2)], new Draws(seed), budget)
          .words,
      );
      expect(budget.spentSteps).toBe(1);
    }
    expect([...seen].sort()).toEqual(['brass', 'iron']);
  });
});

describe('a line read in part for a carried role', () => {
  const answered = (outcome: CommandOutcome) =>
    'answer' in outcome
      ? [outcome.answer, outcome.bindings.get('thing') ?? outcome.bindings.get('reading')]
      : outcome;
  const understood = (outcome: CommandOutcome) => {
    if (!('understood' in outcome)) throw new Error(`answered: ${outcome.answer}`);
    return {
      bindings: Object.fromEntries(outcome.understood.bindings),
      drawn: outcome.drawn,
    };
  };

  it('is answered with `not_carrying`, naming the thing, where only something further out answers', () => {
    const outward = [bench(), bench([[BENCH_POUCH, null]]), bench([[BENCH_SATCHEL, null]])];
    for (const one of outward) {
      expect(answered(typedAtBench(one, 'unlock chest with brass key'))).toEqual([
        'not_carrying',
        { binds: 'object', id: BENCH_KEY },
      ]);
    }
    // In a shut satchel it is out of range altogether, and nothing is named.
    const shut = bench([
      [BENCH_SATCHEL, null],
      [BENCH_KEY, BENCH_SATCHEL],
    ]);
    expect(answered(typedAtBench(shut, 'unlock chest with brass key'))).toEqual([
      'not_here',
      undefined,
    ]);
  });

  it('reads what is carried, in the hand or an open pouch, and never draws it against what lies further out', () => {
    for (const held of [
      [[BENCH_KEY, null]],
      [
        [BENCH_POUCH, null],
        [BENCH_KEY, BENCH_POUCH],
      ],
    ] as const) {
      const one = bench(held);
      // The spare key in the crate answers to `key` as well, and does not compete.
      expect(understood(typedAtBench(one, 'unlock chest with key'))).toEqual({
        bindings: { target: { object: BENCH_CHEST }, tool: { object: BENCH_KEY } },
        drawn: null,
      });
    }
  });

  it('is answered with `cannot` where a role also cannot take what fills it', () => {
    expect(answered(typedAtBench(bench(), 'unlock book with brass key'))).toEqual([
      'cannot',
      { binds: 'value', value: 'unlock the book with the brass key' },
    ]);
  });

  it('fills an intent’s slot given to a carried role the same way', () => {
    expect(answered(typedAtBench(bench(), 'open chest with brass key'))).toEqual([
      'not_carrying',
      { binds: 'object', id: BENCH_KEY },
    ]);
    const intended = typedAtBench(bench([[BENCH_KEY, null]]), 'open chest with brass key');
    expect('understood' in intended && 'intent' in intended.understood).toBe(true);
  });

  it('leaves a role that is not carried to reach further out: `put`’s container', () => {
    const one = bench([[BENCH_BOOK, null]]);
    expect(understood(typedAtBench(one, 'put book in crate')).bindings).toEqual({
      item: { object: BENCH_BOOK },
      container: { object: BENCH_CRATE },
    });
  });
});
