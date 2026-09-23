import { describe, expect, it } from 'vitest';

import { ABSENT_TABLE } from './absent.js';
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

  it('gives `sprout.Actor` one guard for each part of a move, each refusing through a default of its own', () => {
    const actor = compiled().bundle!.kinds.find(
      (k) => k.library === 'sprout' && k.name === 'Actor',
    )!;
    const refusesThrough = (guard: 'depart' | 'release' | 'accept'): string[] =>
      actor.guards[guard].map((one) => {
        expect(one.origin).toBe('sprout.Actor');
        return JSON.stringify(one.declaration.parameters.map((p) => p.text));
      });
    // The parameters the spec's three roles name, in its order.
    expect(refusesThrough('depart')).toEqual(['["to"]']);
    expect(refusesThrough('release')).toEqual(['["item","to"]']);
    expect(refusesThrough('accept')).toEqual(['["item","from"]']);
    // The worked microworld's words, each yielding to any other source's line.
    const lines = Object.fromEntries(
      ['held_fast', 'not_yours', 'hands_full'].map((name) => {
        const passage = actor.passages.get(name)!;
        expect(passage, name).toMatchObject({ origin: 'sprout.Actor', yields: true });
        return [name, passage.body.text.trim()];
      }),
    );
    expect(lines).toEqual({
      held_fast: '{self} is not something you can carry off.',
      not_yours: 'That is for {self} to put down, not you.',
      hands_full: '{self} cannot carry any more.',
    });
    expect([...actor.passages.keys()].sort()).toEqual(['hands_full', 'held_fast', 'not_yours']);
  });

  it('gives `sprout.World` a default line for every passage the engine speaks through', () => {
    const world = compiled().bundle!.kinds.find(
      (k) => k.library === 'sprout' && k.name === 'World',
    )!;
    // The absent table's rows name who is told, and through what.
    const told = ABSENT_TABLE.flatMap((row) => (row.told === null ? [] : [row.told]));
    // The Runtime's Faults, and the turn's own answers: a command nothing
    // reads, a thing out of reach, a noun that could be several things, a
    // reading that says nothing, a thing with nothing to say.
    const engine = [
      'fault',
      'unseen',
      'unknown',
      'unreachable',
      'which',
      'nothing_happens',
      'unremarkable',
    ];
    const spoken = [...new Set([...told, ...engine])];
    expect(told.length).toBeGreaterThan(0);
    expect([...world.passages.keys()].sort()).toEqual(spoken.sort());
    for (const passage of world.passages.values()) {
      expect(passage, passage.name).toMatchObject({ origin: 'sprout.World', yields: true });
    }
  });

  it('gives `sprout.Place` its arrives and leaves notices, both default', () => {
    const place = compiled().bundle!.kinds.find(
      (k) => k.library === 'sprout' && k.name === 'Place',
    )!;
    expect([...place.passages.keys()]).toEqual(['arrives', 'leaves']);
    for (const passage of place.passages.values()) {
      expect(passage, passage.name).toMatchObject({ origin: 'sprout.Place', yields: true });
    }
  });

  it('lets a world that writes none of them take every stock line, still yielding', () => {
    const world = compiled().bundle!.world!;
    expect(world.passages.size).toBe(9);
    for (const passage of world.passages.values()) {
      expect(passage, passage.name).toMatchObject({ origin: 'sprout.World', yields: true });
    }
  });

  it('hashes to the value every manifest pins, so a change to it is read, not absorbed', () => {
    // Change this only with the library, and rerun
    // `node scripts/pin-standard-library.mjs` so the corpus pins it too.
    expect(libraryHash(STANDARD_LIBRARY)).toBe(
      '7a4dd31cf82d17beb59c4fa287ab5b15f567e6d591c77ef6e238a68bf102f9cf',
    );
  });
});
