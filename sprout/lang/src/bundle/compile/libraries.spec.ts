// Libraries as the manifest records them, by version and by the hash of
// their source (the spec's Kinds › Libraries and namespaces): a library is
// used when what travelled is what was recorded, and the bundle notes
// whether the host blessed each hash.

import { describe, expect, it } from 'vitest';

import {
  libraryHash,
  type LibrarySource,
  type Manifest,
  type MicroworldSource,
} from '../bundle.js';
import { STANDARD_LIBRARY } from '../standard-library.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { checkLibraries } from './libraries.js';
import { atKey } from './manifest-fields.js';
import { compileBundle } from './compile.js';
import { Report } from './report.js';
import {
  file,
  MANIFEST,
  PERSON,
  refusals,
  SPROUT_SHA,
  warnings,
  world,
  WORLD_LINE,
} from '../../fixtures/compile.js';

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

/** What checking `world`'s libraries gives back and says, in `mode`. */
function checked(world: MicroworldSource, mode: 'publish' | 'load' = 'publish') {
  const report = new Report(mode, world.manifestFile.span(0, 0));
  const usable = checkLibraries(world, report);
  return {
    usable,
    said: report.diagnostics.all.map((d) => [d.severity, d.message]),
    absent: report.absent.map((a) => [a.what, a.reason]),
  };
}

describe('a library is used when what travelled is what the manifest recorded', () => {
  it('gives it back hashed and weighed, with nothing said of the host’s blessing', () => {
    const { usable, said } = checked(source([PIN], [STANDARD_LIBRARY]));
    expect(said).toEqual([]);
    expect(usable.map((one) => [one.name, one.hash])).toEqual([['sprout', SHA]]);
    expect(usable[0]!.bytes).toBe(
      STANDARD_LIBRARY.files.reduce((n, f) => n + new TextEncoder().encode(f.text).length, 0),
    );
    expect(Object.keys(usable[0]!)).not.toContain('blessed');
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

// The same rules through a whole compile, and what the bundle records of
// the host's blessing.

describe('the manifest records every library by version and by the hash of its source', () => {
  it('compiles when the source that travelled is the source recorded', () => {
    const { bundle } = compileBundle(world());
    expect(bundle!.libraries[0]!.hash).toBe(SPROUT_SHA);
  });

  it('refuses a library whose source did not travel', () => {
    const { bundle, diagnostics } = compileBundle(world({ libraries: [] }));
    expect(bundle).toBeNull();
    expect(refusals(diagnostics)[0]!.message).toContain('did not travel');
    expect(locationOf(refusals(diagnostics)[0]!.at)).toBe('sprout.json:8:27');
  });

  it('refuses a library whose source is not the source the manifest recorded', () => {
    const fork: LibrarySource = {
      ...STANDARD_LIBRARY,
      files: [STANDARD_LIBRARY.files[0]!, file('glaze.sprout', 'enum Glaze { none }')],
    };
    const { bundle, diagnostics } = compileBundle(world({ libraries: [fork] }));
    expect(bundle).toBeNull();
    expect(refusals(diagnostics)[0]!.message).toContain('is not the source the manifest recorded');
    expect(refusals(diagnostics)[0]!.remedy).toContain('Vendor the library again');
  });

  it('points a mismatch at the pin, not at a namespace spelled the same', () => {
    const fork: LibrarySource = {
      ...STANDARD_LIBRARY,
      files: [STANDARD_LIBRARY.files[0]!, file('glaze.sprout', 'enum Glaze { none }')],
    };
    const manifestText = JSON.stringify(
      {
        name: 'sprout',
        namespace: 'sprout',
        libraries: [{ name: 'sprout', version: '0.1.0', sha: SHA }],
      },
      null,
      2,
    );
    const named = world({ manifest: { namespace: 'sprout' }, manifestText, libraries: [fork] });
    const { diagnostics } = compileBundle(named);
    const mismatch = refusals(diagnostics).find((d) =>
      d.message.includes('is not the source the manifest recorded'),
    );
    expect(mismatch).toBeDefined();
    expect(mismatch!.at.start).toBeGreaterThan(atKey(named.manifestFile, 'libraries').start);
  });

  it('refuses a version the manifest records that the source does not agree with', () => {
    const renamed: LibrarySource = { ...STANDARD_LIBRARY, version: '2.0.0' };
    const { bundle, diagnostics } = compileBundle(world({ libraries: [renamed] }));
    expect(bundle).toBeNull();
    expect(refusals(diagnostics)[0]!.message).toContain('version 0.1.0');
    expect(refusals(diagnostics)[0]!.message).toContain('says 2.0.0');
  });

  it('refuses a library pinned at a version that is not semver, as the world’s is', () => {
    for (const version of ['1.0', 'v0.1.0', 'latest']) {
      const manifestText = MANIFEST.replace('"version": "0.1.0"', `"version": "${version}"`);
      const pinned = { libraries: [{ name: 'sprout', version, sha: SPROUT_SHA }] };
      for (const mode of ['publish', 'load'] as const) {
        const { bundle, diagnostics } = compileBundle(world({ manifest: pinned, manifestText }), {
          mode,
        });
        expect(bundle, `${version} at ${mode}`).toBeNull();
        expect(
          refusals(diagnostics).map((d) => [locationOf(d.at), d.message, d.remedy]),
          `${version} at ${mode}`,
        ).toEqual([
          [
            'sprout.json:8:48',
            `"${version}" is not a version of the library "sprout".`,
            'A version is three numbers with dots, as in 0.1.0; a pre-release or build tag may follow, as in 1.2.0-beta.1.',
          ],
        ]);
      }
    }
  });

  it('refuses a vendored library whose own version is not semver, and compares nothing', () => {
    const odd: LibrarySource = { ...STANDARD_LIBRARY, version: '0.1' };
    const { bundle, diagnostics } = compileBundle(world({ libraries: [odd] }));
    expect(bundle).toBeNull();
    expect(refusals(diagnostics).map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'sprout.json:8:27',
        'The library "sprout" that travelled says its version is "0.1", which is not a version.',
        'A version is three numbers with dots, as in 0.1.0; a pre-release or build tag may follow, as in 1.2.0-beta.1. Vendor a copy that says one.',
      ],
    ]);
  });

  it('says a version that is not one once, when the pin and the source agree on it', () => {
    const odd: LibrarySource = { ...STANDARD_LIBRARY, version: 'latest' };
    const { diagnostics } = compileBundle(
      world({
        libraries: [odd],
        manifest: { libraries: [{ name: 'sprout', version: 'latest', sha: SPROUT_SHA }] },
      }),
    );
    expect(refusals(diagnostics).map((d) => d.message)).toEqual([
      '"latest" is not a version of the library "sprout".',
    ]);
  });

  it('refuses a library travelling unused whose version is not semver, at its first file', () => {
    const spare: LibrarySource = {
      name: 'ericworld',
      version: 'one',
      level: 1,
      files: [file('a.sprout', 'enum Spare { one }')],
    };
    const { diagnostics } = compileBundle(world({ libraries: [STANDARD_LIBRARY, spare] }));
    expect(refusals(diagnostics).map((d) => [locationOf(d.at), d.message])).toEqual([
      [
        'a.sprout:1:1',
        'The library "ericworld" that travelled says its version is "one", which is not a version.',
      ],
    ]);
  });

  it('refuses a library name that is not a name', () => {
    const odd: LibrarySource = { ...STANDARD_LIBRARY, name: 'Sprout' };
    expect(
      compileBundle(
        world({
          manifest: { libraries: [{ name: 'Sprout', version: '0.1.0', sha: libraryHash(odd) }] },
          libraries: [odd],
        }),
      ).bundle,
    ).toBeNull();
  });

  it('refuses the same library used twice, or vendored twice', () => {
    const pin = { name: 'sprout', version: '0.1.0', sha: SPROUT_SHA };
    expect(compileBundle(world({ manifest: { libraries: [pin, pin] } })).bundle).toBeNull();
    expect(
      compileBundle(world({ libraries: [STANDARD_LIBRARY, STANDARD_LIBRARY] })).bundle,
    ).toBeNull();
  });

  it('warns about a library that travelled and is not used', () => {
    const spare: LibrarySource = {
      name: 'ericworld',
      version: '0.1.0',
      level: 1,
      files: [file('a.sprout', 'enum Spare { one }')],
    };
    const { bundle, diagnostics } = compileBundle(world({ libraries: [STANDARD_LIBRARY, spare] }));
    expect(bundle).not.toBeNull();
    expect(warnings(diagnostics)).toHaveLength(1);
    expect(warnings(diagnostics)[0]!.message).toContain('"ericworld"');
  });

  it('lets a library and the world share a file name, since they are different source', () => {
    const files = [file('ward.sprout', `${WORLD_LINE}\nenum Mine { one }`), PERSON];
    expect(compileBundle(world({ files })).bundle).not.toBeNull();
  });
});
