import { describe, expect, it } from 'vitest';

import {
  libraryHash,
  type LibrarySource,
  type Manifest,
  type MicroworldSource,
} from '../bundle.js';
import { STANDARD_LIBRARY } from '../standard-library.js';
import { SourceFile } from '../../source/source.js';
import { checkLibraries } from './libraries.js';
import { Report } from './report.js';

const SHA = libraryHash(STANDARD_LIBRARY);
const PIN = { name: 'sprout', version: '0.1.0', sha: SHA };

/** A world pinning `pins` and vendoring `libraries`. */
function source(pins: Manifest['libraries'], libraries: LibrarySource[]): MicroworldSource {
  const manifest = { libraries: pins } as unknown as Manifest;
  return {
    manifestFile: new SourceFile('sprout.json', JSON.stringify({ libraries: pins })),
    manifest,
    files: [],
    libraries,
  };
}

/** What checking `world`'s libraries gives back and says, in `mode`, with `blessed`. */
function checked(
  world: MicroworldSource,
  mode: 'publish' | 'load' = 'publish',
  blessed: ReadonlySet<string> = new Set(),
) {
  const report = new Report(mode, world.manifestFile.span(0, 0));
  const usable = checkLibraries(world, blessed, report);
  return {
    usable,
    said: report.diagnostics.all.map((d) => [d.severity, d.message]),
    absent: report.absent.map((a) => [a.what, a.reason]),
  };
}

describe('a library is used when what travelled is what the manifest recorded', () => {
  it('gives it back hashed, weighed and asked about the host’s blessing', () => {
    const { usable, said } = checked(source([PIN], [STANDARD_LIBRARY]), 'publish', new Set([SHA]));
    expect(said).toEqual([]);
    expect(usable.map((one) => [one.name, one.hash, one.blessed])).toEqual([['sprout', SHA, true]]);
    expect(usable[0]!.bytes).toBeGreaterThan(0);
    expect(checked(source([PIN], [STANDARD_LIBRARY])).usable[0]!.blessed).toBe(false);
  });

  it('is not used when it did not travel, and is a gap at load', () => {
    expect(checked(source([PIN], [])).said).toEqual([
      ['refusal', 'This world uses the library "sprout", and its source did not travel with it.'],
    ]);
    const loaded = checked(source([PIN], []), 'load');
    expect(loaded.usable).toEqual([]);
    expect(loaded.absent).toEqual([['sprout', 'missing']]);
  });

  it('is not used at all when its source is not the source recorded', () => {
    const loaded = checked(source([{ ...PIN, sha: 'f'.repeat(64) }], [STANDARD_LIBRARY]), 'load');
    expect(loaded.usable).toEqual([]);
    expect(loaded.absent).toEqual([['sprout', 'mismatched']]);
  });

  it('refuses a pin whose name or version cannot be one', () => {
    const { said } = checked(source([{ ...PIN, version: '1' }], [STANDARD_LIBRARY]));
    expect(said.map((one) => one[1])).toEqual(['"1" is not a version of the library "sprout".']);
  });

  it('refuses a copy whose version disagrees with its pin at publish, and runs it at load', () => {
    const newer: LibrarySource = { ...STANDARD_LIBRARY, version: '0.2.0' };
    const pinned = source([PIN], [newer]);
    expect(checked(pinned).said.map((one) => one[0])).toEqual(['refusal']);
    expect(checked(pinned, 'load').usable).toHaveLength(1);
  });

  it('warns about a library that travelled and is not used', () => {
    const extra: LibrarySource = {
      name: 'victorian',
      version: '1.0.0',
      level: 1,
      files: [new SourceFile('victorian/voice.sprout', 'kind Voice { }')],
    };
    const { usable, said } = checked(source([PIN], [STANDARD_LIBRARY, extra]));
    expect(said).toEqual([
      ['warning', 'The library "victorian" travels with this world and the world does not use it.'],
    ]);
    expect(usable.map((one) => one.name)).toEqual(['sprout', 'victorian']);
  });
});
