// The goldens the C prose layer replays (`corpus/goldens/prose.json`, with the cartridge
// they read, `prose.sproutworld`), written here with `SPROUT_WRITE_GOLDENS=1` and otherwise
// checked whole: the states the cases start from, the cartridge, and every case, area by
// area (the cases are written in `fixtures/prose-cases.ts`, the world they are said in in
// `fixtures/prose-bench.ts`).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { BENCH_CARTRIDGE, proseGoldens } from '../fixtures/prose-bench.js';
import { capitaliseGolden } from '../fixtures/prose-unicode.js';

const GOLDEN = fileURLToPath(new URL('../../../../corpus/goldens/prose.json', import.meta.url));
const CARTRIDGE = fileURLToPath(
  new URL('../../../../corpus/goldens/prose.sproutworld', import.meta.url),
);

const made = { ...proseGoldens(), capitalise: capitaliseGolden() };
if (process.env['SPROUT_WRITE_GOLDENS'] === '1') {
  writeFileSync(GOLDEN, `${JSON.stringify(made, null, 1)}\n`);
  writeFileSync(CARTRIDGE, BENCH_CARTRIDGE);
}
// The file is formatted by prettier after it is written, so it is compared as data.
const held = JSON.parse(readFileSync(GOLDEN, 'utf8')) as typeof made;

const AREAS = ['slots', 'flow', 'layout', 'names', 'readers', 'output', 'bounds', 'engine'];

describe('the prose goldens', () => {
  it('start from the states and read the cartridge the file holds', () => {
    expect(made.states).toEqual(held.states);
    expect(Buffer.from(BENCH_CARTRIDGE).equals(readFileSync(CARTRIDGE))).toBe(true);
  });

  it('hold every case in some area', () => {
    expect(held.cases.filter((one) => !AREAS.includes(one['area'] as string))).toEqual([]);
    expect(made.cases.length).toBe(held.cases.length);
  });

  for (const area of AREAS) {
    it(`render as the file says: ${area}`, () => {
      const wanted = held.cases.filter((one) => one['area'] === area);
      expect(wanted.length).toBeGreaterThan(0);
      expect(made.cases.filter((one) => one['area'] === area)).toEqual(wanted);
    });
  }

  it('capitalise every kind of opening as the file says', () => {
    expect(made.capitalise).toEqual(held.capitalise);
    expect(held.capitalise.length).toBeGreaterThan(1000);
  });
});
