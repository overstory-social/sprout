import { describe, expect, it } from 'vitest';

import type { WorldDeclaration } from './ast.js';
import { kindName, type KindRef } from './bindings.js';
import type { KindLookup } from './check.js';
import { Diagnostics } from './diagnostics.js';
import { EnumTable } from './enums.js';
import { parseDeclarations } from './parse.js';
import { SourceFile } from './source.js';
import { resolveWorld, WORLD, WORLD_PASSES_ANYTHING } from './world.js';

const ENUMS = (() => {
  const table = new EnumTable();
  const diagnostics = new Diagnostics();
  table.add(
    'printers_shop',
    parseDeclarations(
      new SourceFile('e.sprout', 'enum Season { autumn, winter }\n'),
      diagnostics,
    ).filter((d) => d.kind === 'enum'),
    diagnostics,
  );
  expect(diagnostics.refusals).toHaveLength(0);
  return table;
})();

function kind(library: string, name: string, ...composes: string[]): KindRef {
  return {
    library,
    name,
    composes: new Set([`${library}.${name}`, ...composes]),
    properties: new Map(),
    contains: false,
  };
}

const KNOWN: Record<string, KindRef> = {
  'sprout.World': kind('sprout', 'World'),
  'sprout.Actor': kind('sprout', 'Actor'),
  'printers_shop.Creature': kind('printers_shop', 'Creature', 'sprout.Actor'),
  'victorian.Voice': kind('victorian', 'Voice'),
};
const KINDS: KindLookup = {
  qualified: (library, name) => KNOWN[`${library}.${name}`] ?? null,
  unqualified: (name, from) => KINDS.qualified(from, name) ?? KINDS.qualified('sprout', name),
};

/** Read a world and work out what it declares. The parse must succeed. */
function world(text: string, kinds: KindLookup = KINDS) {
  const parsing = new Diagnostics();
  const declared = parseDeclarations(new SourceFile('w.sprout', text), parsing).find(
    (d): d is WorldDeclaration => d.kind === 'world',
  );
  expect(
    parsing.refusals.map((d) => d.message),
    `\`${text}\` did not parse`,
  ).toEqual([]);
  const diagnostics = new Diagnostics();
  const resolved = resolveWorld(declared!, ENUMS, kinds, 'printers_shop', diagnostics);
  return { resolved, said: diagnostics.refusals.map((d) => d.message), diagnostics };
}

const SHOP = `world printers_shop {
  visitors are Creature
  visitors arrive at composing_room
  :season Season default autumn
}`;

describe('a world is the root of the one tree', () => {
  it('reads the spec’s own world', () => {
    const { resolved, said } = world(SHOP);
    expect(said).toEqual([]);
    expect(resolved!.name).toBe('printers_shop');
    expect(kindName(resolved!.visitor)).toBe('printers_shop.Creature');
    expect(resolved!.arriveAt.text).toBe('composing_room');
    expect([...resolved!.properties.keys()]).toEqual(['season']);
  });

  it('holds what belongs to no single place, by the ordinary property rules', () => {
    const { resolved } = world(SHOP);
    expect(resolved!.properties.get('season')!.type).toMatchObject({ type: 'symbol' });
    expect(resolved!.properties.get('season')!.remembered).toBe(false);
  });

  it('remembers about each actor, in the same syntax as anything else', () => {
    const { resolved, said } = world(`world w { :remembers [seen: false]
  visitors are Creature
  visitors arrive at y }`);
    expect(said).toEqual([]);
    expect(resolved!.properties.get('seen')!.remembered).toBe(true);
  });

  it('refuses to hold one property twice, and keeps the first', () => {
    const { resolved, said } = world(`world w { :a false
  :a true
  visitors are Creature
  visitors arrive at y }`);
    expect(said.join(' ')).toContain('holds `:a` twice');
    expect(resolved!.properties.get('a')!.declaration.default).toMatchObject({ value: false });
  });
});

describe('every world composes `sprout.World`', () => {
  it('whether it says so or not', () => {
    const { resolved } = world(SHOP);
    expect(resolved!.composes.map(kindName)).toEqual([WORLD]);
  });

  it('and writing it adds nothing rather than colliding', () => {
    const { resolved, said } = world(`world w: sprout.World {
  visitors are Creature
  visitors arrive at y }`);
    expect(said).toEqual([]);
    expect(resolved!.composes.map(kindName)).toEqual([WORLD]);
  });

  it('first, wherever it was written', () => {
    // Composition order sequences a composable member's contributions,
    // so leaving a written `sprout.World` where the author put it would
    // make the two spellings mean different things — and "writing it
    // adds nothing" would stop being true the moment it has a member of
    // its own to sequence.
    for (const written of [
      'world w: victorian.Voice { visitors are Creature\n visitors arrive at y }',
      'world w: victorian.Voice, sprout.World { visitors are Creature\n visitors arrive at y }',
      'world w: sprout.World, victorian.Voice { visitors are Creature\n visitors arrive at y }',
    ]) {
      const { resolved, said } = world(written);
      expect(said, written).toEqual([]);
      expect(resolved!.composes.map(kindName), written).toEqual([WORLD, 'victorian.Voice']);
    }
  });

  it('beside whatever else it composes — a library of stock lines in another register', () => {
    const { resolved, said } = world(`world printers_shop: victorian.Voice {
  visitors are Creature
  visitors arrive at composing_room }`);
    expect(said).toEqual([]);
    expect(resolved!.composes.map(kindName)).toEqual([WORLD, 'victorian.Voice']);
  });

  it('refuses a kind nothing declares, and carries on', () => {
    const { resolved, said } = world(`world w: nope.Voice {
  visitors are Creature
  visitors arrive at y }`);
    expect(said.join(' ')).toContain('Nothing here is a `nope.Voice`');
    // The world is still worked out: an author owed three problems is
    // owed all three, and a strict compile refuses on the diagnostic.
    expect(resolved).not.toBeNull();
  });

  it('refuses the same kind twice', () => {
    const { said } = world(`world w: victorian.Voice, victorian.Voice {
  visitors are Creature
  visitors arrive at y }`);
    expect(said.join(' ')).toContain('composes `victorian.Voice` twice');
  });

  it('says so plainly when the standard library has no `World` to compose', () => {
    const without: KindLookup = {
      qualified: (library, name) =>
        library === 'sprout' && name === 'World' ? null : KINDS.qualified(library, name),
      unqualified: (name, from) => KINDS.unqualified(name, from),
    };
    const { resolved, said } = world(SHOP, without);
    expect(resolved).toBeNull();
    expect(said.join(' ')).toContain('missing `sprout.World`');
  });
});

describe('a world says what a person is, and where they begin', () => {
  it('names the visitor kind, which is an ordinary kind', () => {
    const { resolved } = world(SHOP);
    // `item.is(sprout.Actor)` stays a nominal test rather than a name
    // the engine knows, so the visitor kind composes it like anything.
    expect(resolved!.visitor.composes.has('sprout.Actor')).toBe(true);
  });

  it('refuses a world that does not say what a visitor is', () => {
    const { resolved, said } = world('world w { visitors arrive at y }');
    expect(resolved).toBeNull();
    expect(said).toEqual(['`w` does not say what a visitor is.']);
  });

  it('refuses a world that does not say where a visitor arrives', () => {
    const { resolved, said } = world('world w { visitors are Creature }');
    expect(resolved).toBeNull();
    expect(said).toEqual(['`w` does not say where a visitor arrives.']);
  });

  it('owes both sentences to a world that says neither', () => {
    const { resolved, said } = world('world w { :a false }');
    expect(resolved).toBeNull();
    expect(said).toHaveLength(2);
  });

  it('refuses a visitor kind nothing declares, and says which sentence is missing', () => {
    const { resolved, said } = world(`world w { visitors are Nope
  visitors arrive at y }`);
    expect(resolved).toBeNull();
    expect(said[0]).toContain('Nothing here is a `Nope`');
    // Not "does not say what a visitor is" — it said, and the kind is
    // what is missing.
    expect(said[1]).toContain('does not say what its visitors are made of');
  });

  it('refuses saying either of them twice, and keeps the first', () => {
    const twiceAre = world(`world w { visitors are Creature
  visitors are Creature
  visitors arrive at y }`);
    expect(twiceAre.said.join(' ')).toContain('says twice what its visitors are');

    const twiceAt = world(`world w { visitors are Creature
  visitors arrive at first
  visitors arrive at second }`);
    expect(twiceAt.said.join(' ')).toContain('says twice where its visitors arrive');
    expect(twiceAt.resolved!.arriveAt.text).toBe('first');
  });

  it('keeps where they arrive as written, for B14 to resolve', () => {
    // Identifier scope does not exist yet, and whether the thing named
    // is a place is B13's. What is kept is the name and its span.
    const { resolved } = world(SHOP);
    expect(resolved!.arriveAt.text).toBe('composing_room');
    expect(resolved!.arriveAt.kind).toBe('ident');
  });
});

describe('the world refuses to pass, which is why places cannot reach one another', () => {
  it('passes nothing unless it says otherwise', () => {
    expect(WORLD_PASSES_ANYTHING).toBe(false);
    expect(world(SHOP).resolved!.passesAnything).toBe(false);
  });

  it('is a default of the language, not a number a host sets', () => {
    // The spec states the value, so nothing configures it: `pass any
    // (false)` unless the world says otherwise. B32 reads the rules a
    // world writes; this is what it answers without one.
    expect(typeof WORLD_PASSES_ANYTHING).toBe('boolean');
  });
});
