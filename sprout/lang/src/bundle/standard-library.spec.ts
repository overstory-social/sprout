import { describe, expect, it } from 'vitest';

import { libraryHash, type LibrarySource, type Manifest } from './bundle.js';
import { compileBundle } from './compile/compile.js';
import { checkShape } from './compile/first-tier.js';
import { STANDARD_LIBRARY } from './standard-library.js';
import { locationOf, SourceFile } from '../source/source.js';

/**
 * A world with nothing of its own but a place to arrive at and a kind
 * for visitors to be made of, vendoring the library (or a copy of it)
 * pinned at its hash, and blessing that hash.
 */
function compiled(library: LibrarySource = STANDARD_LIBRARY) {
  const sha = libraryHash(library);
  const manifest: Manifest = {
    name: 'shed',
    namespace: 'shed',
    version: '0.1.0',
    author: 'Eric Eslinger',
    license: 'MIT',
    level: 1,
    extensions: [],
    libraries: [{ name: 'sprout', version: STANDARD_LIBRARY.version, sha }],
    files: ['world.sprout'],
  };
  return compileBundle(
    {
      manifestFile: new SourceFile('sprout.json', JSON.stringify(manifest, null, 2)),
      manifest,
      files: [
        new SourceFile(
          'world.sprout',
          'world shed: sprout.World { contains actors visitors are Visitor visitors arrive at shed }\nkind Visitor: sprout.Actor { }\n',
        ),
      ],
      libraries: [library],
    },
    { blessed: new Set([sha]) },
  );
}

describe('the standard library', () => {
  it('is `sprout` at 0.1.0, written for level 1', () => {
    expect([STANDARD_LIBRARY.name, STANDARD_LIBRARY.version, STANDARD_LIBRARY.level]).toEqual([
      'sprout',
      '0.1.0',
      1,
    ]);
  });

  it('reads clean through the first tier, one kind to a file', () => {
    for (const file of STANDARD_LIBRARY.files) {
      const { declarations, diagnostics } = checkShape(file);
      expect(diagnostics, file.name).toEqual([]);
      expect(declarations, file.name).toHaveLength(1);
    }
  });

  it('declares exactly `World`, `Place` and `Actor`, and nothing else', () => {
    const declared = STANDARD_LIBRARY.files.flatMap((file) =>
      checkShape(file).declarations.map((d) => [file.name, d.kind, d.name.text]),
    );
    expect(declared).toEqual([
      ['sprout/world.sprout', 'kind', 'World'],
      ['sprout/place.sprout', 'kind', 'Place'],
      ['sprout/actor.sprout', 'kind', 'Actor'],
    ]);
  });

  it('names its own file in a refusal, never one the world’s files could be', () => {
    const [world, , actor] = STANDARD_LIBRARY.files;
    const fork: LibrarySource = {
      ...STANDARD_LIBRARY,
      files: [world!, new SourceFile('sprout/place.sprout', 'kind Place {\n  %\n}\n'), actor!],
    };
    const { bundle, diagnostics } = compiled(fork);
    expect(bundle).toBeNull();
    expect(diagnostics.map((d) => locationOf(d.at))).toEqual(['sprout/place.sprout:2:3']);
  });

  it('compiles whole beside a world, the world composing `sprout.World`', () => {
    const { bundle, diagnostics } = compiled();
    expect(diagnostics).toEqual([]);
    expect(bundle!.libraries.map((l) => [l.name, l.blessed])).toEqual([['sprout', true]]);
    // Only the world's own `Visitor` counts; the blessed library's three cost nothing.
    expect(bundle!.size.kinds).toBe(1);
    expect(bundle!.world!.composes.has('sprout.World')).toBe(true);
    expect(bundle!.visitor!.composes.has('sprout.Actor')).toBe(true);
  });

  it('makes `sprout.Place` hold actors, and `sprout.World` hold things and not people', () => {
    const kinds = new Map(compiled().bundle!.kinds.map((k) => [`${k.library}.${k.name}`, k]));
    expect(kinds.get('sprout.Place')).toMatchObject({ contains: true, containsActors: true });
    expect(kinds.get('sprout.World')).toMatchObject({ contains: true, containsActors: false });
  });

  it('gives `sprout.Actor` hands, and a whole-number capacity of 8', () => {
    const actor = compiled().bundle!.kinds.find(
      (k) => k.library === 'sprout' && k.name === 'Actor',
    )!;
    expect(actor).toMatchObject({ contains: true, containsActors: false });
    expect([...actor.properties.keys()]).toEqual(['capacity']);
    const capacity = actor.properties.get('capacity')!;
    expect(capacity.type.type).toBe('integer');
    expect(capacity.origin).toBe('sprout.Actor');
    expect(capacity.declaration.default).toMatchObject({ kind: 'integer', value: 8 });
  });

  it('hashes to the value every manifest pins, so a change to it is read, not absorbed', () => {
    // Change this only with the library, and rerun
    // `node scripts/pin-standard-library.mjs` so the corpus pins it too.
    expect(libraryHash(STANDARD_LIBRARY)).toBe(
      '18a55de7837b8a60ef4f5ff6f2980e644c31b1f4712178b02bccb6199350fd40',
    );
  });
});
