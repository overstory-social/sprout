import { describe, expect, it } from 'vitest';

import type { WorldDeclaration } from '../syntax/ast.js';
import { kindName, WORLD, type KindLookup, type KindRef } from './kinds.js';
import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from './enums.js';
import { parseDeclarations } from '../syntax/parse.js';
import { SourceFile } from '../source/source.js';
import { checkWorldDeclaration, resolveWorld, WORLD_PASSES_ANYTHING } from './world.js';

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
  const order = [...composes, `${library}.${name}`];
  return {
    library,
    name,
    order,
    composes: new Set(order),
    properties: new Map(),
    contains: false,
    containsActors: false,
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

const SHOP = `world printers_shop: sprout.World {
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
    // The world's own body is the origin of what it declares.
    expect(resolved!.properties.get('season')!.origin).toBe('printers_shop.printers_shop');
  });

  it('remembers about each actor, in the same syntax as anything else', () => {
    const { resolved, said } = world(`world w: sprout.World { :remembers [seen: false]
  visitors are Creature
  visitors arrive at y }`);
    expect(said).toEqual([]);
    expect(resolved!.properties.get('seen')!.remembered).toBe(true);
  });

  it('refuses to hold one property twice, and keeps the first', () => {
    const { resolved, said } = world(`world w: sprout.World { :a false
  :a true
  visitors are Creature
  visitors arrive at y }`);
    expect(said.join(' ')).toContain('holds `:a` twice');
    expect(resolved!.properties.get('a')!.declaration.default).toMatchObject({ value: false });
  });
});

describe('every world writes `sprout.World`', () => {
  it('and is refused at its name where it does not', () => {
    const { said, diagnostics } = world(`world w {
  visitors are Creature
  visitors arrive at y }`);
    expect(said).toEqual(['`w` does not compose `sprout.World`.']);
    expect(diagnostics.refusals[0]!.remedy).toBe(
      'Every world writes it: `world w: sprout.World { … }`.',
    );
    // At the name, which is what the sentence is about — not at a
    // composition list that is not there to point at.
    expect(diagnostics.refusals[0]!.at.start).toBe('world '.length);
  });

  it('with the library named, because `World` on its own is another kind', () => {
    const { said, diagnostics } = world(`world w: World {
  visitors are Creature
  visitors arrive at y }`);
    expect(said).toEqual(['`w` does not compose `sprout.World`.']);
    expect(diagnostics.refusals[0]!.remedy).toBe(
      '`World` on its own is not `sprout.World`; write the library too: `world w: sprout.World { … }`.',
    );
  });

  it('and composes exactly what it wrote', () => {
    const { resolved, said } = world(SHOP);
    expect(said).toEqual([]);
    expect(resolved!.composes.map(kindName)).toEqual([WORLD]);
  });

  it('first, wherever it was written', () => {
    // Composition order sequences a composable member's contributions,
    // and the words the engine speaks for itself are the ones
    // everything else is written over, so the two spellings mean one
    // thing.
    for (const written of [
      'world w: victorian.Voice, sprout.World { visitors are Creature\n visitors arrive at y }',
      'world w: sprout.World, victorian.Voice { visitors are Creature\n visitors arrive at y }',
    ]) {
      const { resolved, said } = world(written);
      expect(said, written).toEqual([]);
      expect(resolved!.composes.map(kindName), written).toEqual([WORLD, 'victorian.Voice']);
    }
  });

  it('beside whatever else it composes — a library of stock lines in another register', () => {
    const { resolved, said } = world(`world printers_shop: sprout.World, victorian.Voice {
  visitors are Creature
  visitors arrive at composing_room }`);
    expect(said).toEqual([]);
    expect(resolved!.composes.map(kindName)).toEqual([WORLD, 'victorian.Voice']);
  });

  it('refuses a kind nothing declares, and carries on', () => {
    const { resolved, said } = world(`world w: sprout.World, nope.Voice {
  visitors are Creature
  visitors arrive at y }`);
    expect(said.join(' ')).toContain('Nothing here is a `nope.Voice`');
    // The world is still worked out: an author owed three problems is
    // owed all three, and a strict compile refuses on the diagnostic.
    expect(resolved).not.toBeNull();
  });

  it('refuses the same kind twice', () => {
    const { said } = world(`world w: sprout.World, victorian.Voice, victorian.Voice {
  visitors are Creature
  visitors arrive at y }`);
    expect(said.join(' ')).toContain('composes `victorian.Voice` twice');
  });

  it('refuses `sprout.World` twice, like any other kind', () => {
    const { said } = world(`world w: sprout.World, sprout.World {
  visitors are Creature
  visitors arrive at y }`);
    expect(said.join(' ')).toContain('composes `sprout.World` twice');
  });

  it('says so plainly when the standard library has no `World` to compose', () => {
    const without: KindLookup = {
      qualified: (library, name) =>
        library === 'sprout' && name === 'World' ? null : KINDS.qualified(library, name),
      unqualified: (name, from) => KINDS.unqualified(name, from),
    };
    const { said } = world(SHOP, without);
    // The author wrote the right thing, so the problem is the library
    // rather than the sentence they typed.
    expect(said.join(' ')).toContain('missing `sprout.World`');
  });
});

describe('a world that does not write `sprout.World` is refused on its own', () => {
  /** What the shape tier says about one world, without resolving anything. */
  function shape(text: string) {
    const diagnostics = new Diagnostics();
    const declared = parseDeclarations(new SourceFile('w.sprout', text), diagnostics).find(
      (d): d is WorldDeclaration => d.kind === 'world',
    );
    expect(diagnostics.refusals, `\`${text}\` did not parse`).toEqual([]);
    const said = new Diagnostics();
    checkWorldDeclaration(declared!, said);
    return said.refusals;
  }

  it('takes the world as written, with no kinds resolved', () => {
    expect(shape('world w { visitors are Creature }').map((d) => d.message)).toEqual([
      '`w` does not compose `sprout.World`.',
    ]);
  });

  it('is satisfied by the written words alone', () => {
    expect(shape('world w: sprout.World { visitors are Creature }')).toEqual([]);
  });

  it('is not satisfied by an unqualified `World`, whatever it would resolve to', () => {
    expect(shape('world w: World { visitors are Creature }')).toHaveLength(1);
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
    const { resolved, said } = world('world w: sprout.World { visitors arrive at y }');
    expect(resolved).toBeNull();
    expect(said).toEqual(['`w` does not say what a visitor is.']);
  });

  it('refuses a world that does not say where a visitor arrives', () => {
    const { resolved, said } = world('world w: sprout.World { visitors are Creature }');
    expect(resolved).toBeNull();
    expect(said).toEqual(['`w` does not say where a visitor arrives.']);
  });

  it('owes both sentences to a world that says neither', () => {
    const { resolved, said } = world('world w: sprout.World { :a false }');
    expect(resolved).toBeNull();
    expect(said).toHaveLength(2);
  });

  it('refuses a visitor kind nothing declares, and says which sentence is missing', () => {
    const { resolved, said } = world(`world w: sprout.World { visitors are Nope
  visitors arrive at y }`);
    expect(resolved).toBeNull();
    expect(said[0]).toContain('Nothing here is a `Nope`');
    // Not "does not say what a visitor is" — it said, and the kind is
    // what is missing.
    expect(said[1]).toContain('does not say what its visitors are made of');
  });

  it('refuses saying either of them twice, and keeps the first', () => {
    const twiceAre = world(`world w: sprout.World { visitors are Creature
  visitors are Creature
  visitors arrive at y }`);
    expect(twiceAre.said.join(' ')).toContain('says twice what its visitors are');

    const twiceAt = world(`world w: sprout.World { visitors are Creature
  visitors arrive at first
  visitors arrive at second }`);
    expect(twiceAt.said.join(' ')).toContain('says twice where its visitors arrive');
    expect(twiceAt.resolved!.arriveAt.text).toBe('first');
  });

  it('keeps where they arrive as written, for B14 to resolve', () => {
    // Identifier scope does not exist yet, and whether the thing named
    // is a place is B14's. What is kept is the name and its span.
    const { resolved } = world(SHOP);
    expect(resolved!.arriveAt.text).toBe('composing_room');
    expect(resolved!.arriveAt.kind).toBe('ident');
  });
});

describe('containment is a declaration, and a place is whatever holds actors', () => {
  /** A world writing exactly these lines, and the two things it may hold. */
  function holding(...lines: string[]) {
    const { resolved, said } = world(
      `world printers_shop: sprout.World {\n${lines.map((l) => `  ${l}`).join('\n')}\n` +
        '  visitors are Creature\n  visitors arrive at composing_room\n}',
    );
    return { said, contains: resolved?.contains, containsActors: resolved?.containsActors };
  }

  it('holds nothing unless it says so', () => {
    // And is NOT refused for it: `sprout.World` declares `contains`
    // itself and every world composes it, so the capability arrives
    // through composition, which is B19's to merge. What is resolved
    // here is only what this declaration wrote.
    const nothing = holding();
    expect(nothing.said).toEqual([]);
    expect(nothing.contains).toBe(false);
    expect(nothing.containsActors).toBe(false);
  });

  it('holds others where it declares `contains`', () => {
    const held = holding('contains');
    expect(held.said).toEqual([]);
    expect(held.contains).toBe(true);
    // Holding things is not holding people: a world is not a place for
    // having said this much.
    expect(held.containsActors).toBe(false);
  });

  it('is a place where it declares `contains actors`, which implies holding', () => {
    // The standard library's `kind Place` declares only `contains
    // actors` and still holds a bench, so the second implies the first.
    // The spec never says so outright — see the working notes.
    const place = holding('contains actors');
    expect(place.said).toEqual([]);
    expect(place.contains).toBe(true);
    expect(place.containsActors).toBe(true);
  });

  it('takes either of them twice, and both together, in silence', () => {
    // *How members combine* calls these two idempotent, so saying what
    // is already true is not a mistake — unlike a property, which a
    // world is refused for declaring twice. Whether a redundant one is
    // worth a warning is B50's, which owns the list of warnings.
    //
    // And repeating one says no more than writing it once did: two
    // plain `contains` still do not make a place, whichever order they
    // come in with `contains actors`.
    for (const [lines, place] of [
      [['contains', 'contains'], false],
      [['contains actors', 'contains actors'], true],
      [['contains', 'contains actors'], true],
      [['contains actors', 'contains'], true],
    ] as const) {
      const written = lines.join(' / ');
      const both = holding(...lines);
      expect(both.said, written).toEqual([]);
      expect(both.contains, written).toBe(true);
      expect(both.containsActors, written).toBe(place);
    }
  });

  it('is not confused by what else the world holds', () => {
    const mixed = holding('contains actors', ':season Season default autumn');
    expect(mixed.said).toEqual([]);
    expect(mixed.containsActors).toBe(true);
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
