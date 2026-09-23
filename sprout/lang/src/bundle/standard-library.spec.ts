import { describe, expect, it } from 'vitest';

import type { Declaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { kindName } from '../declare/kinds.js';
import { ENGINE_VERBS, type ResolvedVerb } from '../declare/verbs.js';
import { ABSENT_TABLE } from './absent.js';
import { resolveDeclarations } from './declarations.js';
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
          'world shed is sprout.World { visitors are Person visitors arrive at yard object yard is Yard }\nkind Person is sprout.Visitor { }\nkind Yard { contains actors }\n',
        ),
      ],
      libraries: [library],
    },
    { blessed: new Set([sha]) },
  );
}

/** The library's own verbs, resolved as the second tier resolves them, by file. */
function verbsByFile(): Map<string, ResolvedVerb[]> {
  const declared = new Map<string, Declaration[]>([
    ['sprout', STANDARD_LIBRARY.files.flatMap((file) => [...checkShape(file).declarations])],
  ]);
  const diagnostics = new Diagnostics();
  const { verbs } = resolveDeclarations(
    declared,
    { namespace: 'sprout', name: 'sprout' },
    { diagnostics, gap: () => expect.unreachable('the library names nothing it lacks') },
  );
  expect(diagnostics.all).toEqual([]);
  const byFile = new Map<string, ResolvedVerb[]>();
  for (const verb of verbs.all()) {
    const file = verb.declaration.at.source.name;
    byFile.set(file, [...(byFile.get(file) ?? []), verb]);
  }
  return byFile;
}

/** A verb's roles as `name:filler`, with `?` on an optional one and `*` on a set. */
function rolesOf(verb: ResolvedVerb): string[] {
  return verb.roles.map((role) => {
    const filler = role.filler;
    const fills =
      filler === null ? 'nothing' : filler.fills === 'kind' ? kindName(filler.kind) : filler.fills;
    return `${role.name}:${fills}${role.optional ? '?' : ''}${role.many ? '*' : ''}`;
  });
}

describe('the standard library', () => {
  it('is `sprout` at 0.1.0, written for level 1', () => {
    expect([STANDARD_LIBRARY.name, STANDARD_LIBRARY.version, STANDARD_LIBRARY.level]).toEqual([
      'sprout',
      '0.1.0',
      1,
    ]);
  });

  it('reads clean through the first tier, with at most one kind to a file', () => {
    for (const file of STANDARD_LIBRARY.files) {
      const { declarations, diagnostics } = checkShape(file);
      expect(diagnostics, file.name).toEqual([]);
      expect(declarations.length, file.name).toBeGreaterThan(0);
      expect(declarations.filter((d) => d.kind === 'kind').length, file.name).toBeLessThan(2);
    }
  });

  it('declares exactly `World`, `Place`, `Actor` and `Visitor`, the engine’s verbs, the actor’s, and `ask`', () => {
    const declared = STANDARD_LIBRARY.files.map((file) => [
      file.name,
      checkShape(file).declarations.map((d) => `${d.kind} ${d.name.text}`),
    ]);
    expect(declared).toEqual([
      ['sprout/world.sprout', ['kind World']],
      ['sprout/engine.sprout', ENGINE_VERBS.map((name) => `verb ${name}`)],
      ['sprout/place.sprout', ['kind Place']],
      ['sprout/actor.sprout', ['verb take', 'verb drop', 'verb give', 'kind Actor']],
      ['sprout/visitor.sprout', ['kind Visitor']],
      ['sprout/talk.sprout', ['verb ask']],
    ]);
  });

  it('gives the engine’s verbs their phrases, and `go` alone a role an exit fills', () => {
    const engine = verbsByFile().get('sprout/engine.sprout')!;
    expect(Object.fromEntries(engine.map((verb) => [verb.name, rolesOf(verb)]))).toEqual({
      // Every phrase names the way, so it is never unbound.
      go: ['way:exit'],
      look: [],
      examine: ['target:open'],
      inventory: [],
      wait: [],
      help: [],
    });
    // The spec's Engine verbs: `look` answers to `l`, `examine` to `x` and `look at`.
    const phrases = (name: string): string[] =>
      engine.find((verb) => verb.name === name)!.phrases.map((phrase) => phrase.text);
    expect(phrases('look')).toContain('l');
    expect(phrases('examine')).toEqual(expect.arrayContaining(['x [target]', 'look at [target]']));
    expect(phrases('go')).toContain('[way]');
  });

  it('gives the actor `take`, `drop` and `give`, the recipient an actor, and none of them optional', () => {
    const actor = verbsByFile().get('sprout/actor.sprout')!;
    expect(Object.fromEntries(actor.map((verb) => [verb.name, rolesOf(verb)]))).toEqual({
      take: ['target:open'],
      drop: ['target:open'],
      give: ['item:open', 'recipient:sprout.Actor'],
    });
  });

  it('gives `ask` a topic the visitor names, optional whatever its phrases say', () => {
    const [ask] = verbsByFile().get('sprout/talk.sprout')!;
    expect(rolesOf(ask!)).toEqual(['target:open', 'topic:symbol?']);
    // Every phrase fills it; it is optional because it is a value.
    expect(ask!.roles[1]!.omittedBy).toBeNull();
  });

  it('names its own file in a refusal, never one the world’s files could be', () => {
    const fork: LibrarySource = {
      ...STANDARD_LIBRARY,
      files: STANDARD_LIBRARY.files.map((file) =>
        file.name === 'sprout/place.sprout'
          ? new SourceFile('sprout/place.sprout', 'kind Place {\n  %\n}\n')
          : file,
      ),
    };
    const { bundle, diagnostics } = compiled(fork);
    expect(bundle).toBeNull();
    expect(diagnostics.map((d) => locationOf(d.at))).toEqual(['sprout/place.sprout:2:3']);
  });

  it('compiles whole beside a world, the world composing `sprout.World`', () => {
    const { bundle, diagnostics } = compiled();
    expect(diagnostics).toEqual([]);
    expect(bundle!.libraries.map((l) => [l.name, l.blessed])).toEqual([['sprout', true]]);
    // Only the world's own `Person` and `Yard` count; the blessed library's four cost nothing.
    expect(bundle!.size.kinds).toBe(2);
    expect(bundle!.world!.composes.has('sprout.World')).toBe(true);
    expect(bundle!.visitor!.composes.has('sprout.Visitor')).toBe(true);
  });

  it('makes `sprout.Visitor` an actor and nothing more: it adds nothing to `sprout.Actor`', () => {
    const kinds = new Map(compiled().bundle!.kinds.map((k) => [`${k.library}.${k.name}`, k]));
    const visitor = kinds.get('sprout.Visitor')!;
    const actor = kinds.get('sprout.Actor')!;
    expect([...visitor.composes].sort()).toEqual(['sprout.Actor', 'sprout.Visitor']);
    expect([...visitor.properties.keys()]).toEqual([...actor.properties.keys()]);
    expect([...visitor.passages.keys()]).toEqual([...actor.passages.keys()]);
    expect(visitor.plays.size).toBe(0);
    for (const guard of ['depart', 'release', 'accept'] as const) {
      expect(visitor.guards[guard].map((one) => one.origin)).toEqual(['sprout.Actor']);
    }
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
    // reading that says nothing, a thing with nothing to say; and a move
    // the engine refuses because a container would hold itself.
    const engine = [
      'fault',
      'unseen',
      'unknown',
      'unreachable',
      'which',
      'nothing_happens',
      'unremarkable',
      'inside_itself',
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
    expect(world.passages.size).toBe(10);
    for (const passage of world.passages.values()) {
      expect(passage, passage.name).toMatchObject({ origin: 'sprout.World', yields: true });
    }
  });

  it('hashes to the value every manifest pins, so a change to it is read, not absorbed', () => {
    // Change this only with the library, and rerun
    // `node scripts/pin-standard-library.mjs` so the corpus pins it too.
    expect(libraryHash(STANDARD_LIBRARY)).toBe(
      '5bd019792ad4a23dfe754560ee81494d1e69064a6b5ab3ef9a9247c15a2fc276',
    );
  });
});
