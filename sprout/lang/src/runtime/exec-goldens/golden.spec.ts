// The goldens the C statements replay (`corpus/goldens/exec.json`, with the
// cartridge they read, `exec.sproutworld`), written here with
// `SPROUT_WRITE_GOLDENS=1` and otherwise checked whole: the states the cases
// start from, the walks, the bodies located but not run, the cartridge, and
// every case, area by area (the cases are written in `fixtures/exec-cases/`,
// one file for each area of the statements).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { bytes, goldenOf } from '../../fixtures/exec-bench.js';

const GOLDEN = fileURLToPath(new URL('../../../../../corpus/goldens/exec.json', import.meta.url));
const CARTRIDGE = fileURLToPath(
  new URL('../../../../../corpus/goldens/exec.sproutworld', import.meta.url),
);

/** The areas of a case, grouped as the files of `fixtures/exec-cases/` group them. */
const GROUPS: Record<string, readonly string[]> = {
  'writes to `self` and conditions': ['write', 'if'],
  'walking contents': ['each'],
  'moving things through consent': ['move'],
  'spawning, destroying and links': ['spawn', 'destroy', 'connect'],
  'sends, broadcasts and the bus': ['send', 'bus'],
  wakes: ['wake'],
  'what is said and told': ['speech'],
  'an extension’s statement': ['extension'],
};

const made = goldenOf();
if (process.env['SPROUT_WRITE_GOLDENS'] === '1') {
  const { states, cases, unrun, ranges } = made;
  writeFileSync(GOLDEN, `${JSON.stringify({ ranges, unrun, states, cases }, null, 1)}\n`);
  writeFileSync(CARTRIDGE, bytes);
}
// The file is formatted by prettier after it is written, so it is compared as data.
const held = JSON.parse(readFileSync(GOLDEN, 'utf8')) as ReturnType<typeof goldenOf>;

describe('the statement goldens', () => {
  it('start from the states, walk the ranges and read the cartridge the file holds', () => {
    expect(made.states).toEqual(held.states);
    expect(made.ranges).toEqual(held.ranges);
    expect(made.unrun).toEqual(held.unrun);
    expect(Buffer.from(bytes).equals(readFileSync(CARTRIDGE))).toBe(true);
  });

  it('hold every case in some area', () => {
    const grouped = Object.values(GROUPS).flat();
    expect(held.cases.filter((one) => !grouped.includes(one.area))).toEqual([]);
    expect(made.cases.length).toBe(held.cases.length);
  });

  for (const [title, areas] of Object.entries(GROUPS)) {
    it(`end as the file says: ${title}`, () => {
      const wanted = held.cases.filter((one) => areas.includes(one.area));
      expect(wanted.length).toBeGreaterThan(0);
      expect(made.cases.filter((one) => areas.includes(one.area))).toEqual(wanted);
    });
  }
});
