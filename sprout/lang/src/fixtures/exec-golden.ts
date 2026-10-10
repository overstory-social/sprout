// Checking a statement golden against the oracle: the committed file
// (`corpus/goldens/exec.json`) holds, for each case, what the TypeScript runtime
// ended in, and a spec of an area asks that the oracle still ends so in every
// case of that area. Spec support: the package build leaves it out.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { GOLDEN, goldenOf } from './exec-bench.js';

/** The committed golden, as data. */
export function committed(): ReturnType<typeof goldenOf> {
  return JSON.parse(readFileSync(GOLDEN, 'utf8')) as ReturnType<typeof goldenOf>;
}

/** A spec that the cases of these areas end as the committed golden says they do. */
export function areaGolden(title: string, areas: readonly string[]): void {
  describe(`the statement goldens: ${title}`, () => {
    it('ends as the committed golden says, case by case', () => {
      const held = committed().cases.filter((one) => areas.includes(one.area));
      const made = goldenOf().cases.filter((one) => areas.includes(one.area));
      expect(held.length).toBeGreaterThan(0);
      expect(made).toEqual(held);
    }, 120_000);
  });
}
