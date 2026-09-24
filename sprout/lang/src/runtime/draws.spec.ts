import { describe, expect, it } from 'vitest';

import { chooser } from '../fixtures/parse.js';
import { Draws, SEED_MAX } from './draws.js';

const drawn = (seed: number, bounds: readonly number[]): number[] => {
  const draws = new Draws(seed);
  return bounds.map((n) => draws.below(n));
};

describe('a turn’s draws come from its seed alone', () => {
  it('gives the same draws for the same seed, and others for another', () => {
    const bounds = [6, 6, 2, 100, 3, 1000, 7, 7, 7, 52];
    expect(drawn(41, bounds)).toEqual(drawn(41, bounds));
    expect(drawn(41, bounds)).not.toEqual(drawn(42, bounds));
  });

  it('is a stream: what a draw gives depends on the draws before it, and the seed, and nothing else', () => {
    const one = new Draws(9);
    const first = [one.below(1000), one.below(1000)];
    const two = new Draws(9);
    expect([two.below(1000), two.below(1000)]).toEqual(first);
    expect(one.below(1000)).toBe(two.below(1000));
  });

  it('pins the stream, since a log replays against it', () => {
    expect(drawn(7, [6, 6, 2, 100, 1_000_000])).toEqual([4, 2, 0, 30, 590375]);
  });

  it('counts the draws it has made', () => {
    const draws = new Draws(3);
    expect(draws.drawn).toBe(0);
    draws.below(6);
    draws.below(1);
    expect(draws.drawn).toBe(2);
  });

  it('takes a seed from 0 to the largest, and refuses anything else as the host’s defect', () => {
    expect(() => new Draws(0)).not.toThrow();
    expect(() => new Draws(SEED_MAX)).not.toThrow();
    for (const seed of [-1, SEED_MAX + 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new Draws(seed), String(seed)).toThrow(/is not a seed/);
    }
  });

  it('refuses a bound the checker never lets through, as the engine’s defect', () => {
    const draws = new Draws(1);
    for (const n of [0, -3, 2.5, 2 ** 32 + 1]) {
      expect(() => draws.below(n), String(n)).toThrow(/which the checker refuses/);
    }
  });
});

describe('generated draws stay within their bounds', () => {
  it('every draw below n is a whole number from 0 to n − 1, for any seed and any n', () => {
    const c = chooser(71);
    for (let round = 0; round < 300; round++) {
      const seed = c.below(SEED_MAX) + c.below(2);
      const draws = new Draws(seed);
      for (let i = 0; i < 20; i++) {
        const n = c.below(3) === 0 ? 1 + c.below(10) : 1 + c.below(2_147_483_647);
        const value = draws.below(n);
        expect(Number.isInteger(value), `${seed} below ${n}`).toBe(true);
        expect(value, `${seed} below ${n}`).toBeGreaterThanOrEqual(0);
        expect(value, `${seed} below ${n}`).toBeLessThan(n);
      }
    }
  });

  it('reaches every value of a small bound, about as often as each other', () => {
    const draws = new Draws(2026);
    const seen = new Array<number>(6).fill(0);
    for (let i = 0; i < 6000; i++) seen[draws.below(6)]! += 1;
    for (const count of seen) {
      expect(count).toBeGreaterThan(850);
      expect(count).toBeLessThan(1150);
    }
  });
});
