// The caps a load checks against (the spec's Limits): a world recorded
// against a cap larger than the host's is refused at load, once per cap,
// naming the cap and by how much, unless the host has made an exception
// for it, when it runs under the larger of the two. A publish reads
// nothing recorded.

import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS, limitsFrom, type StaticCaps } from '../limits.js';
import { locationOf } from '../../source/source.js';
import { compileBundle } from './compile.js';
import { capsToCheck, type RecordedCaps } from './recorded.js';
import { Report } from './report.js';
import { file, refusals, ROOT, world } from '../../fixtures/compile.js';

const MANIFEST = file('sprout.json', '{\n  "name": "printers_shop"\n}\n');
const REMEDY =
  'Publish it again under this host’s limits, or ask the host to make an exception for this world.';

const caps = (set: Partial<StaticCaps>): StaticCaps => limitsFrom({ caps: set }).caps;

function checked(host: StaticCaps, recorded?: RecordedCaps, mode: 'load' | 'publish' = 'load') {
  const report = new Report(mode, MANIFEST.span(0, 0));
  const using = capsToCheck(host, recorded, MANIFEST, report);
  return { using, diagnostics: report.diagnostics.sorted() };
}

describe('a load compares the caps a world recorded with the host’s', () => {
  const host = caps({ exitsPerPlace: 8, places: 40, sourceBytes: 65_536 });

  it('refuses each cap the world was checked against that is larger, and by how much', () => {
    const recorded = caps({ exitsPerPlace: 12, places: 40, sourceBytes: 70_000 });
    const { using, diagnostics } = checked(host, { caps: recorded, excepted: false });
    expect(using).toBe(host);
    expect(diagnostics.map((d) => [d.severity, locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'refusal',
        'sprout.json:2:3',
        'This world was published allowing 12 exits on one place. This host allows 8, 4 fewer.',
        REMEDY,
      ],
      [
        'refusal',
        'sprout.json:2:3',
        'This world was published allowing 70000 total source bytes in a world, blessed library source exempt. This host allows 65536, 4464 fewer.',
        REMEDY,
      ],
    ]);
  });

  it('refuses a cap the world was checked without, where the host sets one', () => {
    const { diagnostics } = checked(caps({ places: 40 }), {
      caps: DEFAULT_LIMITS.caps,
      excepted: false,
    });
    expect(diagnostics.map((d) => d.message)).toEqual([
      'This world was published with no limit on places in a world. This host allows 40.',
    ]);
  });

  it('says nothing of a world checked against caps no larger than the host’s', () => {
    const recorded = caps({ exitsPerPlace: 4, places: 10, sourceBytes: 1_000 });
    const { using, diagnostics } = checked(host, { caps: recorded, excepted: false });
    expect(using).toBe(host);
    expect(diagnostics).toEqual([]);
  });

  it('never refuses a cap the host leaves unset', () => {
    const recorded = caps({ places: 10_000 });
    expect(checked(DEFAULT_LIMITS.caps, { caps: recorded, excepted: false }).diagnostics).toEqual(
      [],
    );
  });

  it('runs a world the host made an exception for under the larger of each cap, and says nothing', () => {
    const recorded = caps({ exitsPerPlace: 12, places: 20, sourceBytes: 70_000 });
    const { using, diagnostics } = checked(host, { caps: recorded, excepted: true });
    expect(diagnostics).toEqual([]);
    expect(using).toMatchObject({ exitsPerPlace: 12, places: 40, sourceBytes: 70_000 });
  });

  it('checks a world with nothing recorded against the host’s own caps', () => {
    expect(checked(host)).toEqual({ using: host, diagnostics: [] });
  });

  it('reads nothing recorded at publish, which is checked against the host’s own caps', () => {
    const recorded = caps({ exitsPerPlace: 12 });
    expect(checked(host, { caps: recorded, excepted: false }, 'publish')).toEqual({
      using: host,
      diagnostics: [],
    });
    expect(checked(host, { caps: recorded, excepted: true }, 'publish').using).toBe(host);
  });
});

describe('compileBundle loads a world under the caps it recorded, or refuses it', () => {
  // Five options on one enum: past a host that allows three, within a
  // publish that allowed eight.
  const five = () =>
    world({ files: [file('world.sprout', `${ROOT}\nenum Season { a, b, c, d, e }`)] });
  const limits = limitsFrom({ caps: { optionsPerEnum: 3 } });
  const published = caps({ optionsPerEnum: 8 });

  it('refuses a load recorded against a larger cap, with no exception', () => {
    const { bundle, diagnostics } = compileBundle(five(), {
      mode: 'load',
      limits,
      recorded: { caps: published, excepted: false },
    });
    expect(bundle).toBeNull();
    expect(refusals(diagnostics).map((d) => d.message)).toContain(
      'This world was published allowing 8 options on one enum. This host allows 3, 5 fewer.',
    );
  });

  it('refuses the same caps at load whose world would fit the host’s, since caps are compared and not contents', () => {
    const fits = world();
    const { bundle, diagnostics } = compileBundle(fits, {
      mode: 'load',
      limits,
      recorded: { caps: published, excepted: false },
    });
    expect(bundle).toBeNull();
    expect(refusals(diagnostics)).toHaveLength(1);
  });

  it('loads it under the exception, recording the caps it was checked against', () => {
    const { bundle, diagnostics } = compileBundle(five(), {
      mode: 'load',
      limits,
      recorded: { caps: published, excepted: true },
    });
    expect(refusals(diagnostics)).toEqual([]);
    expect(bundle!.caps.optionsPerEnum).toBe(8);
    expect(bundle!.absent).toEqual([]);
  });

  it('reads a file past even the caps the exception grants as absent, as any broken file at load', () => {
    const { bundle } = compileBundle(five(), {
      mode: 'load',
      limits,
      recorded: { caps: caps({ optionsPerEnum: 4 }), excepted: true },
    });
    expect(bundle!.caps.optionsPerEnum).toBe(4);
    expect(bundle!.absent.map((a) => [a.what, a.reason])).toContainEqual([
      'world.sprout',
      'broken',
    ]);
  });
});
