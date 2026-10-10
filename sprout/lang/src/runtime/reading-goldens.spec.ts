// The goldens the C reading pass replays (`corpus/goldens/readings.json`, with the cartridge they
// read, `readings.sproutworld`), written here with `SPROUT_WRITE_GOLDENS=1` and otherwise checked
// whole: the states the cases start from, every reading with how it ended, the ways out of places,
// what an exit says and the steps an intent plans (the cases are written in
// `fixtures/reading-cases.ts`, the world and the oracle's run of them in `fixtures/reading-bench.ts`).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { bytes, goldenOf } from '../fixtures/reading-bench.js';

const GOLDEN = fileURLToPath(new URL('../../../../corpus/goldens/readings.json', import.meta.url));
const CARTRIDGE = fileURLToPath(
  new URL('../../../../corpus/goldens/readings.sproutworld', import.meta.url),
);

/** The areas of a case, as the golden groups them. */
const AREAS = ['carried', 'wildcards', 'engine', 'go', 'values', 'composition', 'acting'];

const made = goldenOf();
if (process.env['SPROUT_WRITE_GOLDENS'] === '1') {
  writeFileSync(GOLDEN, `${JSON.stringify(made, null, 1)}\n`);
  writeFileSync(CARTRIDGE, bytes);
}
// The file is formatted by prettier after it is written, so it is compared as data.
const held = JSON.parse(readFileSync(GOLDEN, 'utf8')) as ReturnType<typeof goldenOf>;

describe('the reading goldens', () => {
  it('start from the states the file holds and read the cartridge it names', () => {
    expect(made.states).toEqual(held.states);
    expect(Buffer.from(bytes).equals(readFileSync(CARTRIDGE))).toBe(true);
  });

  it('hold every case in some area', () => {
    expect(held.cases.filter((one) => !AREAS.includes(one.area))).toEqual([]);
    expect(made.cases.length).toBe(held.cases.length);
  });

  for (const area of AREAS) {
    it(`end as the file says: ${area}`, () => {
      const wanted = held.cases.filter((one) => one.area === area);
      expect(wanted.length).toBeGreaterThan(0);
      expect(made.cases.filter((one) => one.area === area)).toEqual(wanted);
    });
  }

  it('end each way a reading can: acted, refused, gone and faulted', () => {
    const ways = new Set(held.cases.map((one) => (one.expect as { how: string }).how));
    expect([...ways].sort()).toEqual(['acted', 'fault', 'gone', 'refused']);
  });

  it('ask after the ways out of places, what an exit says and the steps an intent plans', () => {
    expect(made.ways).toEqual(held.ways);
    expect(made.sayings).toEqual(held.sayings);
    expect(made.intents).toEqual(held.intents);
  });
});
