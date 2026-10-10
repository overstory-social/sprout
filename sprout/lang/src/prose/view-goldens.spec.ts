// The goldens the C view replays (`corpus/goldens/views.json`, with the cartridge its bench cases
// read, `views.sproutworld`), written here with `SPROUT_WRITE_GOLDENS=1` and otherwise checked
// whole: the view of a visitor arriving in every corpus world, and the bench cases for what a view
// is for (the world and the oracle's poll of it are in `fixtures/view-bench.ts`).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { BENCH_CASES, goldenText, VIEW_CARTRIDGE, viewGoldens } from '../fixtures/view-bench.js';

const GOLDEN = fileURLToPath(new URL('../../../../corpus/goldens/views.json', import.meta.url));
const CARTRIDGE = fileURLToPath(
  new URL('../../../../corpus/goldens/views.sproutworld', import.meta.url),
);

const made = viewGoldens();
if (process.env['SPROUT_WRITE_GOLDENS'] === '1') {
  writeFileSync(GOLDEN, goldenText(made));
  writeFileSync(CARTRIDGE, VIEW_CARTRIDGE);
}
const held = JSON.parse(readFileSync(GOLDEN, 'utf8')) as typeof made;

describe('the view goldens', () => {
  it('read the cartridge the file holds', () => {
    expect(Buffer.from(VIEW_CARTRIDGE).equals(readFileSync(CARTRIDGE))).toBe(true);
  });

  it('hold a case for each bench case and a view for each corpus world', () => {
    expect(held.cases.map((one) => one.name)).toEqual(BENCH_CASES.map((one) => one.name));
    expect(held.corpus.length).toBeGreaterThan(40);
  });

  it('start the bench cases from the states the file holds and end as it says', () => {
    expect(made.cases).toEqual(held.cases);
  });

  it('show each corpus world’s arrival as the file says', () => {
    expect(made.corpus).toEqual(held.corpus);
  });

  it('hold what each part of a view is for', () => {
    type Case = (typeof held.cases)[number];
    const named = (needle: string): Case => held.cases.find((one) => one.name.includes(needle))!;
    const view = (one: Case) =>
      one.expect.view as {
        description: string[];
        exits: { direction: string | null }[];
        occupants: { name: string }[];
        readings: { verb: string; typed: string; refused: string[] | null }[];
      };
    const goes = (one: Case) => view(one).readings.filter((r) => r.verb === 'sprout.go');
    // an exit and a link, each typed
    expect(goes(named('gate that stands open')).map((r) => r.typed)).toContain('go north');
    expect(goes(named('link set')).map((r) => r.typed)).toEqual(['go down the café stair']);
    expect(goes(named('link not set'))).toEqual([]);
    // a set role, a value role, a refusal and inside_itself
    expect(view(named('set role')).readings.some((r) => r.verb === 'viewbench.juggle')).toBe(true);
    expect(view(named('witness')).readings.some((r) => r.refused?.[0] === 'Not before me.')).toBe(true);
    expect(
      view(named('inside_itself')).readings.some((r) => r.refused?.[0]?.includes('inside itself')),
    ).toBe(true);
    // the dark, a displaced visitor and a poll that spent its budget
    expect(view(named('cellar is dark')).description).toEqual(['It is too dark to see.']);
    expect(view(named('not a place')).readings).toEqual([]);
    for (const one of held.cases.filter((c) => c.name.includes('spends its budget'))) {
      expect(one.expect.fault?.name).toBe('BudgetExhausted');
      expect(view(one).description).toEqual(['Too much happens here to take in.']);
    }
  });
});
