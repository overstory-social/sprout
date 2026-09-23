import { describe, expect, it } from 'vitest';

import type { KindDeclaration, WorldDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from './enums.js';
import { KindTable } from './kinds.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { objectsIn, placedObjects, resolveObjects } from './objects.js';
import { placeObjects } from './tree.js';

/** The world `shop` whose body is `body`, beside the kinds in `KINDS`, parsed. */
function parsed(body: string) {
  const diagnostics = new Diagnostics();
  const declared = parseDeclarations(
    new SourceFile('shop.sprout', `${KINDS}world shop is sprout.World {\n${body}\n}\n`),
    diagnostics,
  );
  expect(diagnostics.refusals, 'the fixture parses').toEqual([]);
  const world = declared.find((d): d is WorldDeclaration => d.kind === 'world')!;
  return { declared, world };
}

/** Resolve the objects written in the world's `body` against the kinds, all in the library `shop`. */
function objects(body: string) {
  const { declared, world } = parsed(body);
  const diagnostics = new Diagnostics();
  const enums = new EnumTable();
  const kinds = new KindTable();
  kinds.add(
    'shop',
    declared.filter((d): d is KindDeclaration => d.kind === 'kind'),
    diagnostics,
  );
  kinds.resolve('shop', enums, diagnostics);
  const missing: string[] = [];
  const resolved = resolveObjects('shop', objectsIn(world), {
    enums,
    kinds,
    diagnostics,
    onUnknown: (written) => missing.push(written.name.text),
  });
  return {
    resolved,
    missing,
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message] as const),
  };
}

const KINDS = 'kind Wooden { :worn 0 min 0 max 9 }\nkind Room { contains actors }\n';

describe('every object written in the world’s body', () => {
  it('is listed after what holds it, a body’s objects in order and each followed by its own', () => {
    const { world } = parsed(
      'object hall is Room {\n  object chest is Wooden {\n    object key is Wooden\n  }\n  object lamp is Wooden\n}\nobject yard is Room',
    );
    expect(
      objectsIn(world).map(({ declaration, within }) => [
        declaration.name.text,
        within?.name.text ?? null,
      ]),
    ).toEqual([
      ['hall', null],
      ['chest', 'hall'],
      ['key', 'chest'],
      ['lamp', 'hall'],
      ['yard', null],
    ]);
  });

  it('reaches any depth without recursion', () => {
    const deep = `${'object o is Room { '.repeat(100)}${'}'.repeat(100)}`;
    const { world } = parsed(deep);
    expect(objectsIn(world)).toHaveLength(100);
  });
});

describe('an object is made of its kinds and its own body', () => {
  it('composes an anonymous kind named for it, with its body last', () => {
    const { resolved, said } = objects('object chest is Wooden { :lid false }');
    expect(said).toEqual([]);
    const [chest] = resolved;
    expect(chest!.declaration.name.text).toBe('chest');
    expect(chest!.within).toBeNull();
    expect([chest!.kind!.library, chest!.kind!.name]).toEqual(['shop', 'chest']);
    expect(chest!.kind!.order).toEqual(['shop.Wooden', 'shop.chest']);
    expect([...chest!.kind!.properties.values()].map((p) => [p.name, p.origin])).toEqual([
      ['worn', 'shop.Wooden'],
      ['lid', 'shop.chest'],
    ]);
  });

  it('restates what it composes in its body, keeping the type', () => {
    const { resolved, said } = objects('object chest is Wooden { :worn 3 }');
    expect(said).toEqual([]);
    const worn = resolved[0]!.kind!.properties.get('worn')!;
    expect([worn.origin, worn.type]).toEqual(['shop.chest', { type: 'integer', min: 0, max: 9 }]);
  });

  it('takes one with no body, which has nothing of its own', () => {
    const { resolved } = objects('object hall is Room');
    expect(resolved[0]!.kind!.containsActors).toBe(true);
    expect(resolved[0]!.declaration.members).toEqual([]);
  });

  it('does not take the objects in its body for members of its anonymous kind', () => {
    const { resolved } = objects('object hall is Room {\n  :lit true\n  object lamp is Wooden\n}');
    const hall = resolved.find((o) => o.declaration.name.text === 'hall')!;
    expect([...hall.kind!.properties.keys()]).toEqual(['lit']);
  });

  it('composes every declaration, in the order written, whatever holds it', () => {
    // Where an object sits is the tree's to say, so two of one name in
    // one body both compose here.
    const { resolved, said } = objects(
      'object chest is Wooden {\n  object key is Wooden\n  object key is Wooden\n}\nobject lamp is Wooden',
    );
    expect(said).toEqual([]);
    expect(resolved.map((o) => [o.declaration.name.text, o.kind?.name])).toEqual([
      ['chest', 'chest'],
      ['key', 'key'],
      ['key', 'key'],
      ['lamp', 'lamp'],
    ]);
  });
});

describe('an object whose kind is absent', () => {
  it('has no kind, is told of once, and is still there to be placed', () => {
    const { resolved, missing, said } = objects(
      'object chest is Wooden, Missing\nobject bench is Wooden',
    );
    expect(resolved.map((o) => [o.declaration.name.text, o.kind === null])).toEqual([
      ['chest', true],
      ['bench', false],
    ]);
    expect(missing).toEqual(['Missing']);
    expect(said).toEqual([]);
  });
});

describe('the objects the bundle holds', () => {
  /** Compose the objects in the world's `body`, place them, and keep what is held. */
  function held(body: string) {
    const { resolved } = objects(body);
    const diagnostics = new Diagnostics();
    const tree = placeObjects(resolved, { world: 'shop', diagnostics });
    return { held: placedObjects('shop', resolved, tree), diagnostics };
  }

  it('are those both composed and placed, in the order written, each with its path', () => {
    const { held: kept } = held(
      'object hall is Room {\n  object chest is Wooden\n  object lamp is Wooden\n}',
    );
    expect(kept.map((o) => [o.name, o.library, o.path, o.container])).toEqual([
      ['hall', 'shop', ['hall'], []],
      ['chest', 'shop', ['hall', 'chest'], ['hall']],
      ['lamp', 'shop', ['hall', 'lamp'], ['hall']],
    ]);
  });

  it('leave out one whose kind is absent, though it was placed, and one that was not placed', () => {
    const { held: kept, diagnostics } = held(
      'object hall is Room {\n  object chest is Missing\n  object lamp is Wooden\n  object lamp is Wooden\n}',
    );
    expect(kept.map((o) => o.name)).toEqual(['hall', 'lamp']);
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([
      '`hall` holds two objects called `lamp`.',
    ]);
  });
});
