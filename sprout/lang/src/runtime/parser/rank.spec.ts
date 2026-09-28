import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../../bundle/limits.js';
import { BRASS_KEY, GONG, IRON_KEY, PEBBLE_A, PEBBLE_B, STUDY } from '../../fixtures/parser.js';
import { Budget } from '../budget.js';
import { Draws } from '../draws.js';
import type { InstanceId } from '../ids.js';
import type { Reading } from '../reading.js';
import { chooseReading, compareRanked, type Ranked } from './rank.js';

const TAKE = STUDY.verbs.qualified('sprout', 'take')!;
const ACTOR = 'study#1' as InstanceId;

/** Taking `target`, ranked as a case says. */
function taking(target: InstanceId, rank: Partial<Omit<Ranked, 'reading'>> = {}): Ranked {
  const reading: Reading = {
    verb: TAKE,
    actor: ACTOR,
    bindings: new Map([['target', { object: target }]]),
  };
  return { reading, allowed: true, literal: 2, near: [1], ...rank };
}

/** How the engine writes each thing: the pebbles alike, everything else apart. */
const written = (id: InstanceId): string => (id === PEBBLE_A || id === PEBBLE_B ? 'a pebble' : id);

const choose = (
  readings: readonly Ranked[],
  seed = 7,
  budget = new Budget(DEFAULT_LIMITS.budgets),
) => chooseReading(readings, written, new Draws(seed), budget);

describe('readings, ranked whole', () => {
  it('put one its consent pass allows first, then more words matched, then nearer things', () => {
    expect(compareRanked(taking(GONG), taking(GONG, { allowed: false }))).toBeLessThan(0);
    // Allowed outranks everything else a refused reading has.
    expect(
      compareRanked(
        taking(GONG, { literal: 1, near: [9] }),
        taking(GONG, { allowed: false, literal: 5, near: [0] }),
      ),
    ).toBeLessThan(0);
    expect(compareRanked(taking(GONG, { literal: 3 }), taking(GONG, { literal: 2 }))).toBeLessThan(
      0,
    );
    expect(
      compareRanked(taking(GONG, { near: [1, 5] }), taking(GONG, { near: [1, 6] })),
    ).toBeLessThan(0);
    expect(
      compareRanked(taking(GONG, { near: [2, 0] }), taking(GONG, { near: [1, 9] })),
    ).toBeGreaterThan(0);
    expect(compareRanked(taking(GONG), taking(BRASS_KEY))).toBe(0);
  });

  it('give the best alone, drawing nothing and spending nothing', () => {
    const budget = new Budget(DEFAULT_LIMITS.budgets);
    const chosen = choose([taking(BRASS_KEY, { near: [3] }), taking(IRON_KEY)], 7, budget);
    expect(chosen.reading.bindings.get('target')).toEqual({ object: IRON_KEY });
    expect(chosen.drawn).toBeNull();
    expect(budget.spentSteps).toBe(0);
  });

  it('draw among those still tied, a step, and name the thing where words tell it apart', () => {
    const picked = new Set<string>();
    for (let seed = 0; seed < 32; seed++) {
      const budget = new Budget(DEFAULT_LIMITS.budgets);
      const chosen = choose(
        [taking(BRASS_KEY), taking(IRON_KEY), taking(GONG, { literal: 1 })],
        seed,
        budget,
      );
      const target = chosen.reading.bindings.get('target') as { object: InstanceId };
      expect(chosen.drawn).toEqual({ among: 2, meant: target.object });
      expect(budget.spentSteps).toBe(1);
      picked.add(target.object);
    }
    expect([...picked].sort()).toEqual([BRASS_KEY, IRON_KEY].sort());
  });

  it('draw among things written alike without naming one, since no word could tell them apart', () => {
    const chosen = choose([taking(PEBBLE_A), taking(PEBBLE_B)]);
    expect(chosen.drawn).toEqual({ among: 2, meant: null });
  });
});
