// A world's files are the ones its manifest names, and every one of them
// is read (the spec's Bundles › Files): a file the manifest leaves out is
// not the world's, and one it names that did not travel reads as absent.

import { describe, expect, it } from 'vitest';

import type { Manifest, MicroworldSource } from '../bundle.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { checkFiles, FILE_GONE, isCode, isProse } from './files.js';
import { compileBundle } from './compile.js';
import { Report } from './report.js';
import { file, refusals, WORLD_TEXT, world, worldFiles } from '../../fixtures/compile.js';

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

  it('reads only a `.sprout` file as code, and only a `.prose` file as prose', () => {
    expect(isCode(new SourceFile('world.sprout', ''))).toBe(true);
    expect(isCode(new SourceFile('rooms.prose', ''))).toBe(false);
    expect(isProse(new SourceFile('rooms.prose', ''))).toBe(true);
    expect(isProse(new SourceFile('world.sprout', ''))).toBe(false);
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

// The same rule through a whole compile, where a mismatch between the
// manifest's `files` and what travelled reaches `compileBundle` rather
// than `checkFiles` alone.

describe('the manifest enumerates the world’s own files', () => {
  it('refuses a file it names that did not travel, naming it in the manifest', () => {
    const { bundle, diagnostics } = compileBundle(
      world({ manifest: { files: ['world.sprout', 'kiln.prose'] } }),
    );
    expect(bundle).toBeNull();
    const problem = refusals(diagnostics).find((d) => d.message.includes('kiln.prose'))!;
    expect(problem.message).toContain('did not travel');
    expect(locationOf(problem.at)).toBe('sprout.json:9:3');
  });

  it('refuses a file that travelled and the manifest does not name', () => {
    const { bundle, diagnostics } = compileBundle(
      world({
        files: [...worldFiles(WORLD_TEXT), file('kiln.sprout', 'enum Kiln { cold }')],
        manifest: { files: ['world.sprout', 'person.sprout'] },
      }),
    );
    expect(bundle).toBeNull();
    expect(refusals(diagnostics)[0]!.message).toContain('does not name it');
    expect(locationOf(refusals(diagnostics)[0]!.at)).toBe('kiln.sprout:1:1');
  });

  it('refuses a name that is not a sprout or prose file', () => {
    const { bundle, diagnostics } = compileBundle(
      world({ manifest: { files: ['world.sprout', 'notes.txt'] } }),
    );
    expect(bundle).toBeNull();
    expect(refusals(diagnostics).some((d) => d.message.includes('notes.txt'))).toBe(true);
  });

  it('takes a .prose file as readily as a .sprout one', () => {
    const files = [...worldFiles(WORLD_TEXT), file('kiln.prose', 'passage warmth { Warm brick. }')];
    expect(compileBundle(world({ files })).bundle).not.toBeNull();
  });

  it('refuses the same file named twice', () => {
    expect(
      compileBundle(world({ manifest: { files: ['world.sprout', 'world.sprout'] } })).bundle,
    ).toBeNull();
  });

  it('refuses two files of one name arriving', () => {
    expect(
      compileBundle(
        world({ files: [file('a.sprout', 'enum A { a }'), file('a.sprout', 'enum B { b }')] }),
      ).bundle,
    ).toBeNull();
  });
});
