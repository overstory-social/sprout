// The goldens the C statements replay (`corpus/goldens/exec.json`, with the
// cartridge they read, `exec.sproutworld`), written here with
// `SPROUT_WRITE_GOLDENS=1` and otherwise checked whole: the states the cases
// start from, the walks, the bodies located but not run, and the cartridge.
// The cases themselves are checked by the area specs beside this one.

import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { bytes, CARTRIDGE, GOLDEN, goldenOf } from '../../fixtures/exec-bench.js';
import { committed } from '../../fixtures/exec-golden.js';

describe('the statement goldens', () => {
  it('writes what the oracle says, and the cartridge it was run on', () => {
    const made = goldenOf();
    if (process.env['SPROUT_WRITE_GOLDENS'] === '1') {
      const { states, cases, unrun, ranges } = made;
      writeFileSync(GOLDEN, `${JSON.stringify({ ranges, unrun, states, cases }, null, 1)}\n`);
      writeFileSync(CARTRIDGE, bytes);
    }
    // The file is formatted by prettier after it is written, so it is compared as data.
    const held = committed();
    expect(made.states).toEqual(held.states);
    expect(made.ranges).toEqual(held.ranges);
    expect(made.unrun).toEqual(held.unrun);
    expect(made.cases.length).toBe(held.cases.length);
    expect(Buffer.from(bytes).equals(readFileSync(CARTRIDGE))).toBe(true);
  }, 120_000);
});
