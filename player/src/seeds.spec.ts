import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { sha256, SEED_MAX } from '@overstory/sprout/lang';

import { turnSeed } from './seeds.js';

describe('the seed of a tick’s or a wake’s turn', () => {
  it('is the first 32 bits of the SHA-256 of the step’s seed, the path and the count', () => {
    expect(turnSeed(0, 'yard.kiln', 0)).toBe(
      Number.parseInt(sha256('0 yard.kiln 0').slice(0, 8), 16),
    );
  });

  it('is a seed, whatever goes in', () => {
    for (const [seed, path, nth] of [
      [0, 'yard', 0],
      [SEED_MAX, 'reach.boat', 3],
      [7, 'ü', 1],
    ] as const) {
      const out = turnSeed(seed, path, nth);
      expect(Number.isInteger(out) && out >= 0 && out <= SEED_MAX).toBe(true);
    }
  });

  it('differs for another seed, another thing, or the same thing woken again', () => {
    const seeds = new Set([
      turnSeed(0, 'yard.kiln', 0),
      turnSeed(1, 'yard.kiln', 0),
      turnSeed(0, 'yard.oven', 0),
      turnSeed(0, 'yard.kiln', 1),
    ]);
    expect(seeds.size).toBe(4);
  });

  it('is the same for the same three, as a replay needs', () => {
    expect(turnSeed(5, 'yard.kiln', 2)).toBe(turnSeed(5, 'yard.kiln', 2));
  });
});

describe('the golden the C runtime reproduces', () => {
  const golden = JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../corpus/goldens/seeds.json'),
      'utf8',
    ),
  ) as { cases: { seed: number; path: string; nth: number; turn: number }[] };

  it('holds the seed this rule gives each of its cases', () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(8);
    for (const { seed, path, nth, turn } of golden.cases) {
      expect(turnSeed(seed, path, nth)).toBe(turn);
    }
  });
});
