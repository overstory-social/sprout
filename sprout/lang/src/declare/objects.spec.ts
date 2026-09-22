import { describe, expect, it } from 'vitest';

import type { KindDeclaration, ObjectDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from './enums.js';
import { KindTable } from './kinds.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { placedObjects, resolveObjects } from './objects.js';
import { placeObjects } from './tree.js';

/** Resolve the objects in `text` against the kinds in it, all in the library `shop`. */
function objects(text: string) {
  const diagnostics = new Diagnostics();
  const declared = parseDeclarations(new SourceFile('shop.sprout', text), diagnostics);
  expect(diagnostics.refusals, 'the fixture parses').toEqual([]);
  const enums = new EnumTable();
  const kinds = new KindTable();
  kinds.add(
    'shop',
    declared.filter((d): d is KindDeclaration => d.kind === 'kind'),
    diagnostics,
  );
  kinds.resolve(enums, diagnostics);
  const missing: string[] = [];
  const resolved = resolveObjects(
    'shop',
    declared.filter((d): d is ObjectDeclaration => d.kind === 'object'),
    { enums, kinds, diagnostics, onUnknown: (written) => missing.push(written.name.text) },
  );
  return {
    resolved,
    missing,
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message] as const),
  };
}

const KINDS = 'kind Wooden { :worn 0 min 0 max 9 }\nkind Room { contains actors }\n';

describe('an object is made of its kinds and its own body', () => {
  it('composes an anonymous kind named for it, with its body last', () => {
    const { resolved, said } = objects(`${KINDS}object chest: Wooden in hall { :lid false }`);
    expect(said).toEqual([]);
    const [chest] = resolved;
    expect(chest!.declaration.name.text).toBe('chest');
    expect([chest!.kind!.library, chest!.kind!.name]).toEqual(['shop', 'chest']);
    expect(chest!.kind!.order).toEqual(['shop.Wooden', 'shop.chest']);
    expect([...chest!.kind!.properties.values()].map((p) => [p.name, p.origin])).toEqual([
      ['worn', 'shop.Wooden'],
      ['lid', 'shop.chest'],
    ]);
  });

  it('restates what it composes in its body, keeping the type', () => {
    const { resolved, said } = objects(`${KINDS}object chest: Wooden in hall { :worn 3 }`);
    expect(said).toEqual([]);
    const worn = resolved[0]!.kind!.properties.get('worn')!;
    expect([worn.origin, worn.type]).toEqual(['shop.chest', { type: 'integer', min: 0, max: 9 }]);
  });

  it('takes one with no body, which has nothing of its own', () => {
    const { resolved } = objects(`${KINDS}object hall: Room in shop`);
    expect(resolved[0]!.kind!.containsActors).toBe(true);
    expect(resolved[0]!.declaration.members).toEqual([]);
  });

  it('composes every declaration, in the order written, whatever it says holds it', () => {
    // Where an object sits is the tree's to say, so two of one name in
    // one container both compose here.
    const { resolved, said } = objects(
      `${KINDS}object key: Wooden in chest\nobject key: Wooden in chest\nobject lamp: Wooden in nowhere`,
    );
    expect(said).toEqual([]);
    expect(resolved.map((o) => [o.declaration.name.text, o.kind?.name])).toEqual([
      ['key', 'key'],
      ['key', 'key'],
      ['lamp', 'lamp'],
    ]);
  });
});

describe('an object whose kind is absent', () => {
  it('has no kind, is told of once, and is still there to be placed', () => {
    const { resolved, missing, said } = objects(
      `${KINDS}object chest: Wooden, Missing in hall\nobject bench: Wooden in hall`,
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
  /** Compose `text`'s objects, place them in the world `shop`, and keep what is held. */
  function held(text: string) {
    const { resolved } = objects(text);
    const diagnostics = new Diagnostics();
    const tree = placeObjects(resolved, { world: 'shop', diagnostics });
    return { held: placedObjects('shop', resolved, tree), diagnostics };
  }

  it('are those both composed and placed, in the order declared, each with its path', () => {
    const { held: kept } = held(
      `${KINDS}object chest: Wooden in hall\nobject hall: Room in shop\nobject lamp: Wooden in hall`,
    );
    expect(kept.map((o) => [o.name, o.library, o.path, o.container])).toEqual([
      ['chest', 'shop', ['hall', 'chest'], ['hall']],
      ['hall', 'shop', ['hall'], []],
      ['lamp', 'shop', ['hall', 'lamp'], ['hall']],
    ]);
  });

  it('leave out one whose kind is absent, though it was placed, and one that was not placed', () => {
    const { held: kept, diagnostics } = held(
      `${KINDS}object hall: Room in shop\nobject chest: Missing in hall\nobject lamp: Wooden in hal`,
    );
    expect(kept.map((o) => o.name)).toEqual(['hall']);
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([
      'Nothing here is called `hal`. Did you mean `hall`?',
    ]);
  });
});
