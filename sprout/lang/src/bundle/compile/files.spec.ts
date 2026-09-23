import { describe, expect, it } from 'vitest';

import type { Manifest, MicroworldSource } from '../bundle.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { checkFiles, FILE_GONE, isCode } from './files.js';
import { Report } from './report.js';

/** A world naming `named`, with `travelled` arriving and `withheld` held back. */
function source(named: string[], travelled: string[], withheld?: string[]): MicroworldSource {
  const manifest = { files: named } as unknown as Manifest;
  return {
    manifestFile: new SourceFile('sprout.json', JSON.stringify({ files: named })),
    manifest,
    files: travelled.map((name) => new SourceFile(name, '')),
    libraries: [],
    ...(withheld === undefined ? {} : { withheld }),
  };
}

/** What checking `world`'s files says in `mode`, and what it records. */
function checked(world: MicroworldSource, mode: 'publish' | 'load' = 'publish') {
  const report = new Report(mode, world.manifestFile.span(0, 0));
  const withheld = checkFiles(world, report);
  return {
    withheld: [...withheld],
    said: report.diagnostics.all.map((d) => [d.severity, locationOf(d.at), d.message]),
    absent: report.absent.map((a) => [a.what, a.reason, a.consequence]),
  };
}

describe('a world’s files are the ones its manifest names', () => {
  it('says nothing when what travelled is what is named', () => {
    expect(
      checked(source(['world.sprout', 'rooms.prose'], ['world.sprout', 'rooms.prose'])),
    ).toEqual({ withheld: [], said: [], absent: [] });
  });

  it('reads only a `.sprout` file as code', () => {
    expect(isCode(new SourceFile('world.sprout', ''))).toBe(true);
    expect(isCode(new SourceFile('rooms.prose', ''))).toBe(false);
  });

  it('refuses a name that is not a world’s file, and one named twice', () => {
    const { said } = checked(
      source(['world.sprout', 'notes.txt', 'world.sprout'], ['world.sprout', 'notes.txt']),
    );
    expect(said.map((one) => one[2])).toEqual([
      'There are two files named called "world.sprout".',
      '"notes.txt" is not a file this world can be made of.',
    ]);
  });

  it('refuses a file named and not delivered at publish, and records it at load', () => {
    const world = source(['world.sprout', 'kiln.sprout'], ['world.sprout']);
    expect(checked(world).said).toEqual([
      [
        'refusal',
        'sprout.json:1:26',
        'The manifest names the file "kiln.sprout", and it did not travel with the world.',
      ],
    ]);
    expect(checked(world, 'load').absent).toEqual([['kiln.sprout', 'missing', FILE_GONE]]);
  });

  it('gives back what the host withholds, one gap and not a missing file as well', () => {
    const world = source(['world.sprout', 'kiln.sprout'], ['world.sprout'], ['kiln.sprout']);
    const loaded = checked(world, 'load');
    expect(loaded.withheld).toEqual(['kiln.sprout']);
    expect(loaded.absent).toEqual([['kiln.sprout', 'withheld', FILE_GONE]]);
  });

  it('refuses a file that travelled unnamed at publish, and only warns at load', () => {
    const world = source(['world.sprout'], ['world.sprout', 'extra.sprout']);
    expect(checked(world).said.map((one) => one[0])).toEqual(['refusal']);
    expect(checked(world, 'load').said.map((one) => one[0])).toEqual(['warning']);
    expect(checked(world, 'load').absent).toEqual([]);
  });
});
