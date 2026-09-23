// `composeWorld` and `checkWorldDeclaration`: a world composes like a
// kind and every world writes `sprout.World`, checked at its own tier
// (the shape alone) and once kinds are resolved. `declare/world/*.spec.ts`
// holds the rest of `world.ts`'s own concerns — visitors, `arrivalOf`,
// `resolveArrival`, the world as a place, containment and the pass rule.

import { describe, expect, it } from 'vitest';

import type { WorldDeclaration } from '../syntax/ast.js';
import { kindName } from './kinds.js';
import { WORLD } from './sprout-world.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseDeclarations } from '../syntax/parse.js';
import { SourceFile, textOf } from '../source/source.js';
import { checkWorldDeclaration, composeWorld } from './world.js';
import { ENUMS, KINDS, kindsOf, LIBRARIES, SHOP, world } from '../fixtures/world.js';

describe('a world is the root of the one tree', () => {
  it('reads the spec’s own world', () => {
    const { kind, visitor, said } = world(SHOP);
    expect(said).toEqual([]);
    expect(kind!.name).toBe('printers_shop');
    expect(kindName(visitor!)).toBe('printers_shop.Creature');
    expect([...kind!.properties.keys()]).toEqual(['season']);
  });

  it('holds what belongs to no single place, by the ordinary property rules', () => {
    const { kind } = world(SHOP);
    expect(kind!.properties.get('season')!.type).toMatchObject({ type: 'symbol' });
    expect(kind!.properties.get('season')!.remembered).toBe(false);
    // The world's own body is the origin of what it declares.
    expect(kind!.properties.get('season')!.origin).toBe('printers_shop.printers_shop');
  });

  it('remembers about each actor, in the same syntax as anything else', () => {
    const { kind, said } = world(`world w is sprout.World { :remembers [seen: false]
  visitors are Creature
  visitors arrive at y }`);
    expect(said).toEqual([]);
    expect(kind!.properties.get('seen')!.remembered).toBe(true);
  });

  it('refuses to hold one property twice, and keeps the first', () => {
    const { kind, said } = world(`world w is sprout.World { :a false
  :a true
  visitors are Creature
  visitors arrive at y }`);
    expect(said.join(' ')).toContain('holds `:a` twice');
    expect(kind!.properties.get('a')!.declaration.default).toMatchObject({ value: false });
  });
});

describe('every world writes `sprout.World`', () => {
  it('and is refused at its name where it does not, and not composed', () => {
    const { kind, said, diagnostics } = world(`world w {
  visitors are Creature
  visitors arrive at y }`);
    expect(said).toEqual(['`w` does not compose `sprout.World`.']);
    expect(diagnostics.refusals[0]!.remedy).toBe(
      'Every world writes it: `world w is sprout.World { … }`.',
    );
    // At the name, which is what the sentence is about — not at a
    // composition list that is not there to point at.
    expect(diagnostics.refusals[0]!.at.start).toBe('world '.length);
    expect(kind).toBeNull();
  });

  it('with the library named, because `World` on its own is another kind', () => {
    const { said, diagnostics } = world(`world w is World {
  visitors are Creature
  visitors arrive at y }`);
    expect(said).toEqual(['`w` does not compose `sprout.World`.']);
    expect(diagnostics.refusals[0]!.remedy).toBe(
      '`World` on its own is not `sprout.World`; write the library too: `world w is sprout.World { … }`.',
    );
  });

  it('and composes exactly what it wrote, itself last', () => {
    const { kind, said } = world(SHOP);
    expect(said).toEqual([]);
    expect(kind!.order).toEqual([WORLD, 'printers_shop.printers_shop']);
  });

  it('in the order written, `sprout.World` among the rest', () => {
    // A world composes like a kind, and rule 3 runs contributions in the
    // order their source appears in the composition list, so the two
    // spellings sequence differently and can never differ in what happened.
    for (const [written, order] of [
      [
        'world w is victorian.Voice, sprout.World { visitors are Creature\n visitors arrive at y }',
        ['victorian.Voice', WORLD, 'printers_shop.w'],
      ],
      [
        'world w is sprout.World, victorian.Voice { visitors are Creature\n visitors arrive at y }',
        [WORLD, 'victorian.Voice', 'printers_shop.w'],
      ],
    ] as const) {
      const { kind, said } = world(written);
      expect(said, written).toEqual([]);
      expect(kind!.order, written).toEqual(order);
    }
  });

  it('beside whatever else it composes — a library of stock lines in another register', () => {
    const { kind, said } = world(`world printers_shop is sprout.World, victorian.Voice {
  visitors are Creature
  visitors arrive at composing_room }`);
    expect(said).toEqual([]);
    expect(kind!.composes.has('victorian.Voice')).toBe(true);
    // What it composes brings its properties, from their own origin.
    expect(kind!.properties.get('formal')!.origin).toBe('victorian.Voice');
  });

  it('refuses a kind nothing declares, and still says what else is wrong', () => {
    const { kind, said } = world(`world w is sprout.World, nope.Voice {
  visitors arrive at y }`);
    expect(said[0]).toContain('Nothing here is a `nope.Voice`');
    // An author owed two problems is owed both. The world itself cannot
    // be made of a kind that is not there, as no kind can.
    expect(said[1]).toBe('`w` does not say what a visitor is.');
    expect(kind).toBeNull();
  });

  it('tells a compile of a kind nothing declares, rather than refusing it', () => {
    const parsing = new Diagnostics();
    const [declared] = parseDeclarations(
      new SourceFile('w.sprout', 'world w is sprout.World, Nope { visitors are Creature }'),
      parsing,
    ) as WorldDeclaration[];
    const diagnostics = new Diagnostics();
    const told: string[] = [];
    const kind = composeWorld(declared!, {
      enums: ENUMS,
      kinds: KINDS,
      from: 'printers_shop',
      diagnostics,
      onUnknown: (written, message) => told.push(`${textOf(written.at)}: ${message}`),
    });
    expect(kind).toBeNull();
    expect(diagnostics.all).toEqual([]);
    expect(told).toEqual(['Nope: Nothing here is a `Nope`.']);
  });

  it('refuses the same kind twice', () => {
    const { said } = world(`world w is sprout.World, victorian.Voice, victorian.Voice {
  visitors are Creature
  visitors arrive at y }`);
    expect(said.join(' ')).toContain('composes `victorian.Voice` twice');
  });

  it('refuses `sprout.World` twice, like any other kind', () => {
    const { said } = world(`world w is sprout.World, sprout.World {
  visitors are Creature
  visitors arrive at y }`);
    expect(said.join(' ')).toContain('composes `sprout.World` twice');
  });

  it('says so plainly when the standard library has no `World` to compose', () => {
    const without = kindsOf({
      ...LIBRARIES,
      sprout: 'kind Actor { }\nkind Visitor is Actor { }\nkind Container { }',
    });
    const { said } = world(SHOP, without);
    // The author wrote the right thing, so the problem is the library
    // rather than the sentence they typed.
    expect(said.join(' ')).toContain('The standard library is missing `sprout.World`.');
  });

  it('names the library where the world does not use `sprout` at all', () => {
    const without = kindsOf({ printers_shop: 'kind Creature { }' });
    const { diagnostics } = world(SHOP, without);
    expect(diagnostics.refusals.map((d) => [textOf(d.at), d.message, d.remedy])[0]).toEqual([
      'sprout.World',
      '`sprout.World` is not here, because the library `sprout` is not.',
      "Every world composes `sprout.World` from the library `sprout`: name it among the manifest's libraries and vendor it with the world, as `sprout init` does.",
    ]);
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
    expect(shape('world w is sprout.World { visitors are Creature }')).toEqual([]);
  });

  it('is not satisfied by an unqualified `World`, whatever it would resolve to', () => {
    expect(shape('world w is World { visitors are Creature }')).toHaveLength(1);
  });
});

describe('a world composes like a kind', () => {
  const opened = (composes: string, ...lines: string[]) =>
    world(
      `world w is ${composes} {\n  visitors are Creature\n  visitors arrive at y\n${lines.map((l) => `  ${l}\n`).join('')}}`,
    );

  it('refuses a property from two origins, as a kind is refused', () => {
    const { kind, said } = opened('sprout.World, sprout.Container, victorian.Lamp');
    expect(said).toEqual([
      '`w` gets `:open` from both `sprout.Container` and `victorian.Lamp`, which are two claims on one slot.',
    ]);
    expect(kind).not.toBeNull();
  });

  it('takes its own restatement as the one property, with the world as its origin', () => {
    const { kind, said } = opened('sprout.World, sprout.Container, victorian.Lamp', ':open false');
    expect(said).toEqual([]);
    expect(kind!.properties.get('open')!.origin).toBe('printers_shop.w');
  });

  it('reads `without` by the same rules, `sprout.World` among what it composes', () => {
    expect(opened('sprout.World', 'without depart from sprout.World').said).toEqual([
      '`sprout.World` has no `depart` to leave out.',
    ]);
    expect(opened('sprout.World', 'without depart from victorian.Voice').said).toEqual([
      '`w` does not compose `victorian.Voice`, so there is nothing of its to leave out.',
    ]);
  });
});
