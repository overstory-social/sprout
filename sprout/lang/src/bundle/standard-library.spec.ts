import { describe, expect, it } from 'vitest';

import type { Declaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { kindName } from '../declare/kinds.js';
import { ENGINE_VERBS, type ResolvedVerb } from '../declare/verbs.js';
import { PLACE_LINES, WORLD_LINES } from '../declare/engine-passages.js';
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
    files: ['shed.sprout', 'person.sprout', 'yard.sprout'],
  };
  return compileBundle(
    {
      manifestFile: new SourceFile('sprout.json', JSON.stringify(manifest, null, 2)),
      manifest,
      files: [
        new SourceFile(
          'shed.sprout',
          'world shed is sprout.World { visitors are Person visitors arrive at yard object yard is Yard }\n',
        ),
        new SourceFile('person.sprout', 'kind Person is sprout.Visitor { }\n'),
        new SourceFile('yard.sprout', 'kind Yard { contains actors }\n'),
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

/** The library's own kind called `name`, as a compiled world carries it. */
function libraryKind(name: string) {
  const kind = compiled().bundle!.kindLookup.qualified('sprout', name);
  expect(kind, name).not.toBeNull();
  return kind!;
}

/** Each play `kind` runs, as `as role for verb` with the parts its body writes, and who wrote it. */
function playsOf(name: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, plays] of libraryKind(name).plays) {
    out[key] = plays
      .map((play) => {
        const parts = [play.declaration.permit && 'permit', play.declaration.do && 'do'];
        return `${play.origin}: ${parts.filter(Boolean).join(' ')}`;
      })
      .join(', ');
  }
  return out;
}

/** Each of `names`' passages on `kind`: its words, after checking it is the library's and yields. */
function defaultLines(name: string, names: readonly string[]): Record<string, string> {
  const kind = libraryKind(name);
  return Object.fromEntries(
    names.map((line) => {
      const passage = kind.passages.get(line)!;
      expect(passage, line).toMatchObject({ origin: `sprout.${name}`, yields: true });
      return [line, passage.body.text.trim()];
    }),
  );
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

  it('reads clean through the first tier, each kind in the file named for it', () => {
    for (const file of STANDARD_LIBRARY.files) {
      const { declarations, diagnostics } = checkShape(file);
      expect(diagnostics, file.name).toEqual([]);
      expect(declarations.length, file.name).toBeGreaterThan(0);
      expect(declarations.filter((d) => d.kind === 'kind').length, file.name).toBeLessThan(2);
    }
  });

  it('declares exactly the worked microworld’s library, each kind beside the verbs it plays', () => {
    const declared = STANDARD_LIBRARY.files.map((file) => [
      file.name,
      checkShape(file).declarations.map((d) => `${d.kind} ${d.name.text}`),
    ]);
    expect(declared).toEqual([
      ['sprout/world.sprout', ['kind World']],
      ['sprout/engine.sprout', ENGINE_VERBS.map((name) => `verb ${name}`)],
      ['sprout/place.sprout', ['kind Place']],
      ['sprout/actor.sprout', ['verb take', 'verb drop', 'verb put', 'verb give', 'kind Actor']],
      ['sprout/visitor.sprout', ['kind Visitor']],
      ['sprout/fixture.sprout', ['kind Fixture']],
      ['sprout/container.sprout', ['verb open', 'verb close', 'kind Container']],
      ['sprout/lockable.sprout', ['verb unlock', 'kind Lockable']],
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

  it('gives the actor `take`, `drop`, `put` and `give`, the container a container, the recipient an actor, and none of them optional', () => {
    const actor = verbsByFile().get('sprout/actor.sprout')!;
    expect(Object.fromEntries(actor.map((verb) => [verb.name, rolesOf(verb)]))).toEqual({
      take: ['target:open'],
      drop: ['target:open'],
      put: ['item:open', 'container:sprout.Container'],
      give: ['item:open', 'recipient:sprout.Actor'],
    });
  });

  it('gives a container `open` and `close`, and a lock `unlock` with a tool no phrase leaves out', () => {
    const verbs = [
      ...verbsByFile().get('sprout/container.sprout')!,
      ...verbsByFile().get('sprout/lockable.sprout')!,
    ];
    expect(Object.fromEntries(verbs.map((verb) => [verb.name, rolesOf(verb)]))).toEqual({
      open: ['target:sprout.Container'],
      close: ['target:sprout.Container'],
      unlock: ['target:sprout.Lockable', 'tool:open'],
    });
    const unlock = verbs.find((verb) => verb.name === 'unlock')!;
    expect(unlock.phrases.map((phrase) => phrase.text)).toEqual([
      'unlock [target] with [tool]',
      'use [tool] on [target]',
    ]);
  });

  it('gives `sprout.Actor` the actor’s part in `take`, `drop`, `put` and `give`, each a permit and a do', () => {
    expect(playsOf('Actor')).toEqual({
      'as actor for sprout.take': 'sprout.Actor: permit do',
      'as actor for sprout.drop': 'sprout.Actor: permit do',
      'as actor for sprout.put': 'sprout.Actor: permit do',
      'as actor for sprout.give': 'sprout.Actor: permit do',
    });
    expect(
      defaultLines('Actor', [
        'taken',
        'takes',
        'dropped',
        'drops',
        'put_in',
        'puts_in',
        'given',
        'received',
        'gives',
        'not_carried',
        'not_held',
      ]),
    ).toEqual({
      taken: 'You take {target}.',
      takes: '{actor} takes {target}.',
      dropped: 'You put {target} down.',
      drops: '{actor} puts {target} down.',
      put_in: 'You put {item} in {container}.',
      puts_in: '{actor} puts {item} in {container}.',
      given: 'You give {item} to {recipient}.',
      received: '{actor} gives you {item}.',
      gives: '{actor} gives {item} to {recipient}.',
      not_carried: 'You are not holding {target}.',
      not_held: 'You are not holding {item}.',
    });
  });

  it('makes `sprout.Fixture` a `depart` guard and a passage, and nothing else', () => {
    const fixture = libraryKind('Fixture');
    expect(fixture).toMatchObject({ contains: false, containsActors: false });
    expect(fixture.properties.size).toBe(0);
    expect(fixture.plays.size).toBe(0);
    expect(fixture.passes).toMatchObject({ any: null, messages: new Map() });
    expect(fixture.guards.depart.map((one) => one.origin)).toEqual(['sprout.Fixture']);
    expect(fixture.guards.depart[0]!.declaration.parameters.map((p) => p.text)).toEqual(['to']);
    expect([...fixture.guards.release, ...fixture.guards.accept]).toEqual([]);
    expect(defaultLines('Fixture', ['immovable'])).toEqual({
      immovable: '{self} is not something you can pick up.',
    });
    expect([...fixture.passages.keys()]).toEqual(['immovable']);
  });

  it('gives `sprout.Container` a lid, open by default, a capacity of 8, and a pass rule that reads the lid', () => {
    const container = libraryKind('Container');
    expect(container).toMatchObject({ contains: true, containsActors: false });
    expect([...container.properties.keys()]).toEqual(['open', 'capacity']);
    const open = container.properties.get('open')!;
    const capacity = container.properties.get('capacity')!;
    expect([open.type.type, open.declaration.default]).toMatchObject([
      'boolean',
      { kind: 'boolean', value: true },
    ]);
    expect([capacity.type.type, capacity.declaration.default]).toMatchObject([
      'integer',
      { kind: 'integer', value: 8 },
    ]);
    // Not a constant: whether a message is let in is whatever `:open` says then.
    const any = container.passes.any!;
    expect(any.origin).toBe('sprout.Container');
    expect(any.declaration.rule.kind).not.toBe('boolean');
    expect(container.guards.accept.map((one) => one.origin)).toEqual(['sprout.Container']);
    expect([...container.guards.depart, ...container.guards.release]).toEqual([]);
    expect(playsOf('Container')).toEqual({
      'as target for sprout.open': 'sprout.Container: permit do',
      'as target for sprout.close': 'sprout.Container: permit do',
    });
    expect(
      defaultLines('Container', ['shut', 'full', 'opened', 'opens', 'closed', 'closes']),
    ).toEqual({
      shut: '{self} is shut.',
      full: 'There is no room in {self}.',
      opened: 'You open {self}.',
      opens: '{actor} opens {self}.',
      closed: 'You shut {self}.',
      closes: '{actor} shuts {self}.',
    });
  });

  it('gives `sprout.Lockable` a lock, locked by default, no pass rule, and a permit on the library’s `open`', () => {
    const lockable = libraryKind('Lockable');
    expect(lockable).toMatchObject({ contains: false, containsActors: false });
    expect([...lockable.properties.keys()]).toEqual(['locked']);
    expect(lockable.properties.get('locked')!.declaration.default).toMatchObject({
      kind: 'boolean',
      value: true,
    });
    expect(lockable.passes).toMatchObject({ any: null, messages: new Map() });
    expect(playsOf('Lockable')).toEqual({
      'as target for sprout.unlock': 'sprout.Lockable: permit do',
      // Only a permit: what opening does is the container's.
      'as target for sprout.open': 'sprout.Lockable: permit',
    });
    expect(defaultLines('Lockable', ['unlocked', 'unlocks'])).toEqual({
      unlocked: 'The lock turns over.',
      unlocks: '{actor} unlocks {self}.',
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
    expect(bundle!.libraries.map((l) => l.name)).toEqual(['sprout']);
    expect(bundle!.size.exemptBytes).toBe(bundle!.libraries[0]!.bytes);
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
    expect([...visitor.plays.keys()]).toEqual([...actor.plays.keys()]);
    for (const plays of visitor.plays.values()) {
      expect(plays.map((play) => play.origin)).toEqual(['sprout.Actor']);
    }
    for (const guard of ['depart', 'release', 'accept'] as const) {
      expect(visitor.guards[guard].map((one) => one.origin)).toEqual(['sprout.Actor']);
    }
  });

  it('makes `sprout.Place` hold actors, and `sprout.World` hold things and not people', () => {
    const kinds = new Map(compiled().bundle!.kinds.map((k) => [`${k.library}.${k.name}`, k]));
    expect(kinds.get('sprout.Place')).toMatchObject({ contains: true, containsActors: true });
    expect(kinds.get('sprout.World')).toMatchObject({ contains: true, containsActors: false });
  });

  it('makes a pocket private: `sprout.Actor` passes nothing, and a person composes that', () => {
    const kinds = new Map(compiled().bundle!.kinds.map((k) => [`${k.library}.${k.name}`, k]));
    for (const name of ['sprout.Actor', 'sprout.Visitor']) {
      const any = kinds.get(name)!.passes.any;
      expect(any?.origin, name).toBe('sprout.Actor');
      expect(any?.declaration.rule, name).toMatchObject({ kind: 'boolean', value: false });
    }
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
    expect([...actor.passages.keys()].sort()).toEqual([
      'dropped',
      'drops',
      'given',
      'gives',
      'hands_full',
      'held_fast',
      'inventory',
      'not_carried',
      'not_held',
      'not_yours',
      'put_in',
      'puts_in',
      'received',
      'taken',
      'takes',
    ]);
  });

  it('gives `sprout.Actor` the inventory the engine’s `inventory` says, as the worked microworld writes it', () => {
    const actor = compiled().bundle!.kinds.find(
      (k) => k.library === 'sprout' && k.name === 'Actor',
    )!;
    const inventory = actor.passages.get('inventory')!;
    expect(inventory).toMatchObject({ origin: 'sprout.Actor', yields: true });
    expect(inventory.body.text.trim().split(/\s+/).join(' ')).toBe(
      '{if self.count == 0}You are carrying nothing.{else} You are carrying {for thing in self}{thing}{if $last}.{else}, {/if}{/for}{/if}',
    );
  });

  it('gives `sprout.World` a default line for every passage the engine speaks through', () => {
    const world = compiled().bundle!.kinds.find(
      (k) => k.library === 'sprout' && k.name === 'World',
    )!;
    // The absent table's rows name who is told, and through what.
    const told = ABSENT_TABLE.flatMap((row) => (row.told === null ? [] : [row.told]));
    // The Runtime's Faults, and the turn's own answers: a command nothing
    // reads, a noun nothing in range answers to, a noun that could be several things, a
    // reading that says nothing, a thing with nothing to say; and the moves
    // the engine refuses: a container that would hold itself, and a person
    // going into a place the host says is full.
    const engine = [
      'fault',
      'unseen',
      'unknown',
      'not_here',
      'which',
      'nothing_happens',
      'unremarkable',
      'inside_itself',
      'crowded',
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
    expect(world.passages.size).toBe(11);
    for (const passage of world.passages.values()) {
      expect(passage, passage.name).toMatchObject({ origin: 'sprout.World', yields: true });
    }
  });

  it('writes exactly the lines the engine says, on the world and on a place', () => {
    const bundle = compiled().bundle!;
    const place = bundle.kindLookup.qualified('sprout', 'Place')!;
    expect([...bundle.world!.passages.keys()].sort()).toEqual(
      WORLD_LINES.map((line) => line.name).sort(),
    );
    expect([...place.passages.keys()].sort()).toEqual(PLACE_LINES.map((line) => line.name).sort());
  });

  it('hashes to the value every manifest pins, so a change to it is read, not absorbed', () => {
    // Change this only with the library, and rerun
    // `node scripts/pin-standard-library.mjs` so the corpus pins it too.
    expect(libraryHash(STANDARD_LIBRARY)).toBe(
      '95f1eba2f3f81e2f4939f52990e472af035b39a14e44effc39d7c0ff1b98da74',
    );
  });
});
