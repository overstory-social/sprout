import { describe, expect, it } from 'vitest';

import type { KindDeclaration, ObjectDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from './enums.js';
import { KindTable } from './kinds.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { resolveObjects } from './objects.js';

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
    expect([chest!.name, chest!.library, chest!.kind.name]).toEqual(['chest', 'shop', 'chest']);
    expect(chest!.kind.order).toEqual(['shop.Wooden', 'shop.chest']);
    expect([...chest!.kind.properties.values()].map((p) => [p.name, p.origin])).toEqual([
      ['worn', 'shop.Wooden'],
      ['lid', 'shop.chest'],
    ]);
  });

  it('restates what it composes in its body, keeping the type', () => {
    const { resolved, said } = objects(`${KINDS}object chest: Wooden in hall { :worn 3 }`);
    expect(said).toEqual([]);
    const worn = resolved[0]!.kind.properties.get('worn')!;
    expect([worn.origin, worn.type]).toEqual(['shop.chest', { type: 'integer', min: 0, max: 9 }]);
  });

  it('takes one with no body, which has nothing of its own', () => {
    const { resolved } = objects(`${KINDS}object hall: Room in shop`);
    expect(resolved[0]!.kind.containsActors).toBe(true);
    expect(resolved[0]!.declaration.members).toEqual([]);
  });

  it('keeps its container as written, for B14 to resolve', () => {
    const { resolved } = objects(`${KINDS}object hall: Room in shop\nobject bench: Wooden in hall`);
    expect(resolved.map((o) => [o.name, o.container.text, locationOf(o.container.at)])).toEqual([
      ['hall', 'shop', 'shop.sprout:3:22'],
      ['bench', 'hall', 'shop.sprout:4:25'],
    ]);
  });
});

describe('what an object may not be', () => {
  it('is absent when a kind it composes is: left out, and told of once', () => {
    const { resolved, missing, said } = objects(
      `${KINDS}object chest: Wooden, Missing in hall\nobject bench: Wooden in hall`,
    );
    expect(resolved.map((o) => o.name)).toEqual(['bench']);
    expect(missing).toEqual(['Missing']);
    expect(said).toEqual([]);
  });

  it('refuses two of one name in one container, at the second', () => {
    const { resolved, said } = objects(
      `${KINDS}object key: Wooden in chest\nobject key: Wooden in chest`,
    );
    expect(said).toEqual([['shop.sprout:4:8', '`chest` holds two objects called `key`.']]);
    expect(resolved).toHaveLength(1);
  });

  it('leaves two of one name in two containers alone, since a name is scoped to its container', () => {
    // The spec's Objects: "two chests may each hold a `key`".
    const { resolved, said } = objects(
      `${KINDS}object key: Wooden in red_chest\nobject key: Wooden in blue_chest`,
    );
    expect(said).toEqual([]);
    expect(resolved.map((o) => o.container.text)).toEqual(['red_chest', 'blue_chest']);
  });
});
