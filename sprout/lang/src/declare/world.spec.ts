import { describe, expect, it } from 'vitest';

import {
  writtenPath,
  type KindDeclaration,
  type ObjectDeclaration,
  type WorldDeclaration,
} from '../syntax/ast.js';
import { kindName, KindTable } from './kinds.js';
import type { KindSource } from './compose.js';
import { WORLD } from './sprout-world.js';
import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from './enums.js';
import { parseDeclarations } from '../syntax/parse.js';
import { SourceFile, textOf } from '../source/source.js';
import { resolveObjects } from './objects.js';
import { placeObjects } from './tree.js';
import {
  arrivalOf,
  checkWorldDeclaration,
  composeWorld,
  resolveArrival,
  resolveVisitors,
  WORLD_PASSES_ANYTHING,
} from './world.js';

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

/** The kinds a world here may compose, by library, which must compose cleanly. */
const LIBRARIES: Readonly<Record<string, string>> = {
  sprout: 'kind World { }\nkind Actor { }\nkind Container { :open true }',
  printers_shop: 'kind Creature: sprout.Actor { }\nkind Hall { contains actors }',
  victorian: 'kind Voice { :formal true }\nkind Lamp { :open true }\nkind Gent: sprout.Actor { }',
};

/** Every kind in `libraries`, composed. */
function kindsOf(libraries: Readonly<Record<string, string>> = LIBRARIES): KindSource {
  const diagnostics = new Diagnostics();
  const kinds = new KindTable();
  for (const [library, text] of Object.entries(libraries)) {
    kinds.add(
      library,
      parseDeclarations(new SourceFile(`${library}.sprout`, text), diagnostics).filter(
        (d): d is KindDeclaration => d.kind === 'kind',
      ),
      diagnostics,
    );
  }
  kinds.resolve(ENUMS, diagnostics);
  expect(diagnostics.refusals.map((d) => d.message)).toEqual([]);
  return kinds;
}
const KINDS = kindsOf();

/**
 * Read a world, compose it and read what its visitors are made of. The
 * parse must succeed.
 */
function world(text: string, kinds: KindSource = KINDS) {
  const parsing = new Diagnostics();
  const declared = parseDeclarations(new SourceFile('w.sprout', text), parsing).find(
    (d): d is WorldDeclaration => d.kind === 'world',
  );
  expect(
    parsing.refusals.map((d) => d.message),
    `\`${text}\` did not parse`,
  ).toEqual([]);
  const diagnostics = new Diagnostics();
  const context = { enums: ENUMS, kinds, from: 'printers_shop', diagnostics };
  const kind = composeWorld(declared!, context);
  const visitors = resolveVisitors(declared!, context);
  return {
    kind,
    visitors,
    visitor: visitors.found === 'kind' ? visitors.kind : null,
    said: diagnostics.refusals.map((d) => d.message),
    diagnostics,
    declared: declared!,
  };
}

const SHOP = `world printers_shop: sprout.World {
  visitors are Creature
  visitors arrive at composing_room
  :season Season default autumn
}`;

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
    const { kind, said } = world(`world w: sprout.World { :remembers [seen: false]
  visitors are Creature
  visitors arrive at y }`);
    expect(said).toEqual([]);
    expect(kind!.properties.get('seen')!.remembered).toBe(true);
  });

  it('refuses to hold one property twice, and keeps the first', () => {
    const { kind, said } = world(`world w: sprout.World { :a false
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
      'Every world writes it: `world w: sprout.World { … }`.',
    );
    // At the name, which is what the sentence is about — not at a
    // composition list that is not there to point at.
    expect(diagnostics.refusals[0]!.at.start).toBe('world '.length);
    expect(kind).toBeNull();
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
        'world w: victorian.Voice, sprout.World { visitors are Creature\n visitors arrive at y }',
        ['victorian.Voice', WORLD, 'printers_shop.w'],
      ],
      [
        'world w: sprout.World, victorian.Voice { visitors are Creature\n visitors arrive at y }',
        [WORLD, 'victorian.Voice', 'printers_shop.w'],
      ],
    ] as const) {
      const { kind, said } = world(written);
      expect(said, written).toEqual([]);
      expect(kind!.order, written).toEqual(order);
    }
  });

  it('beside whatever else it composes — a library of stock lines in another register', () => {
    const { kind, said } = world(`world printers_shop: sprout.World, victorian.Voice {
  visitors are Creature
  visitors arrive at composing_room }`);
    expect(said).toEqual([]);
    expect(kind!.composes.has('victorian.Voice')).toBe(true);
    // What it composes brings its properties, from their own origin.
    expect(kind!.properties.get('formal')!.origin).toBe('victorian.Voice');
  });

  it('refuses a kind nothing declares, and still says what else is wrong', () => {
    const { kind, said } = world(`world w: sprout.World, nope.Voice {
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
      new SourceFile('w.sprout', 'world w: sprout.World, Nope { visitors are Creature }'),
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
    const without = kindsOf({ ...LIBRARIES, sprout: 'kind Actor { }\nkind Container { }' });
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
    expect(shape('world w: sprout.World { visitors are Creature }')).toEqual([]);
  });

  it('is not satisfied by an unqualified `World`, whatever it would resolve to', () => {
    expect(shape('world w: World { visitors are Creature }')).toHaveLength(1);
  });
});

describe('a world composes like a kind', () => {
  const opened = (composes: string, ...lines: string[]) =>
    world(
      `world w: ${composes} {\n  visitors are Creature\n  visitors arrive at y\n${lines.map((l) => `  ${l}\n`).join('')}}`,
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

describe('a world says what its visitors are made of: a kind of its own that is an actor', () => {
  /** What `visitors are <written>` finds, and everything said about it, with where. */
  const naming = (written: string, kinds: KindSource = KINDS) => {
    const found = world(
      `world w: sprout.World {\n  visitors are ${written}\n  visitors arrive at y\n}`,
      kinds,
    );
    return {
      ...found,
      told: found.diagnostics.refusals.map((d) => [textOf(d.at), d.message, d.remedy]),
    };
  };

  it('names the visitor kind, which is an ordinary kind', () => {
    const { visitor, said } = world(SHOP);
    expect(said).toEqual([]);
    // `item.is(sprout.Actor)` stays a nominal test rather than a name
    // the engine knows, so the visitor kind composes it like anything.
    expect(visitor!.composes.has('sprout.Actor')).toBe(true);
  });

  it('refuses a world that does not say what a visitor is, at its name', () => {
    const { visitors, diagnostics } = world('world w: sprout.World { visitors arrive at y }');
    expect(visitors).toEqual({ found: 'refused' });
    expect(diagnostics.refusals.map((d) => [textOf(d.at), d.message, d.remedy])).toEqual([
      [
        'w',
        '`w` does not say what a visitor is.',
        "Write `visitors are <Kind>`, naming a kind of the world's own that composes `sprout.Actor`.",
      ],
    ]);
  });

  it('says nothing about where visitors arrive, which is `arrivalOf`’s', () => {
    expect(world('world w: sprout.World { visitors are Creature }').said).toEqual([]);
  });

  it('refuses saying it twice at the second, and reads the first', () => {
    const { visitor, said } = world(`world w: sprout.World { visitors are Creature
  visitors are Hall
  visitors arrive at y }`);
    expect(said).toEqual(['`w` says twice what its visitors are.']);
    expect(kindName(visitor!)).toBe('printers_shop.Creature');
  });

  it('refuses a kind that is not an actor, at the kind written', () => {
    const { visitors, told } = naming('Hall');
    expect(visitors).toEqual({ found: 'refused' });
    expect(told).toEqual([
      [
        'Hall',
        "`Hall` is not an actor, and a world's visitors are made of one.",
        'Write `kind Visitor: sprout.Actor { … }` and `visitors are Visitor`, or name a kind that composes `sprout.Actor`.',
      ],
    ]);
  });

  it('refuses `sprout.Actor` itself, and any library’s kind, as not the world’s own', () => {
    expect(naming('sprout.Actor').told).toEqual([
      [
        'sprout.Actor',
        "`sprout.Actor` belongs to the library `sprout`. A world's visitors are made of a kind of its own.",
        'Declare one that composes `sprout.Actor`, as `kind Visitor: sprout.Actor { … }`, and write `visitors are Visitor`.',
      ],
    ]);
    // A library's actor is composed into the world's own kind, not named.
    expect(naming('victorian.Gent').told).toEqual([
      [
        'victorian.Gent',
        "`victorian.Gent` belongs to the library `victorian`. A world's visitors are made of a kind of its own.",
        'Declare one that composes `victorian.Gent`, as `kind Visitor: victorian.Gent { … }`, and write `visitors are Visitor`.',
      ],
    ]);
    // One that is not an actor either is told the one thing that fixes both.
    expect(naming('victorian.Voice').told[0]![2]).toBe(
      'Declare one that composes `sprout.Actor`, as `kind Visitor: sprout.Actor { … }`, and write `visitors are Visitor`.',
    );
  });

  it('gives a kind nothing declares to the caller as a gap, saying nothing itself', () => {
    const { visitors, said } = naming('Nope');
    expect(said).toEqual([]);
    expect(visitors).toMatchObject({
      found: 'absent',
      what: 'Nope',
      message: 'Nothing here is a `Nope`.',
      remedy:
        'Declare it with `kind Nope: sprout.Actor { … }`, or check the spelling of a kind this world or a library it uses declares.',
      said: false,
    });
    if (visitors.found === 'absent') expect(textOf(visitors.at)).toBe('Nope');
  });

  it('guesses at a misspelling, and suggests declaring an actor', () => {
    expect(naming('Creture').visitors).toMatchObject({
      found: 'absent',
      message: 'Nothing here is a `Creture`. Did you mean `Creature`?',
      remedy: 'Write `Creature`, or declare `Creture` with `kind Creture: sprout.Actor { … }`.',
    });
  });

  it('calls a kind that could not be composed absent, and already told', () => {
    const parsing = new Diagnostics();
    const table = new KindTable();
    table.add(
      'printers_shop',
      parseDeclarations(
        new SourceFile('k.sprout', 'kind Creature: sprout.Actor, Nope { }'),
        parsing,
      ).filter((d): d is KindDeclaration => d.kind === 'kind'),
      parsing,
    );
    table.add(
      'sprout',
      parseDeclarations(
        new SourceFile('s.sprout', 'kind World { }\nkind Actor { }'),
        parsing,
      ).filter((d): d is KindDeclaration => d.kind === 'kind'),
      parsing,
    );
    table.resolve(ENUMS, new Diagnostics(), () => {});
    expect(naming('Creature', table).visitors).toMatchObject({
      found: 'absent',
      what: 'Creature',
      message: '`Creature` is absent, so there is nothing for a visitor to be made of.',
      said: true,
    });
  });
});

describe('`arrivalOf` reads where visitors arrive, and says once what is wrong with it', () => {
  /** The world declaration in `text`, which must parse. */
  function declared(text: string): WorldDeclaration {
    const parsing = new Diagnostics();
    const found = parseDeclarations(new SourceFile('w.sprout', text), parsing).find(
      (d): d is WorldDeclaration => d.kind === 'world',
    );
    expect(parsing.refusals.map((d) => d.message)).toEqual([]);
    return found!;
  }

  it('keeps the path written, with its span', () => {
    const diagnostics = new Diagnostics();
    const path = arrivalOf(declared(SHOP), diagnostics);
    expect(diagnostics.all).toEqual([]);
    expect(path!.kind).toBe('path');
    expect(textOf(path!.at)).toBe('composing_room');
    const deeper = arrivalOf(
      declared('world w: sprout.World {\n  visitors arrive at house.bedroom.wardrobe\n}'),
      diagnostics,
    );
    expect(writtenPath(deeper!)).toBe('house.bedroom.wardrobe');
  });

  it('refuses a world that says nothing about it, at the world’s name', () => {
    const diagnostics = new Diagnostics();
    expect(arrivalOf(declared('world w: sprout.World { visitors are P }'), diagnostics)).toBeNull();
    expect(diagnostics.refusals.map((d) => [d.message, d.remedy])).toEqual([
      [
        '`w` does not say where a visitor arrives.',
        'Write `visitors arrive at <name>`, naming the place they begin in.',
      ],
    ]);
    expect(textOf(diagnostics.refusals[0]!.at)).toBe('w');
  });

  it('refuses saying it twice at the second, and keeps the first', () => {
    const diagnostics = new Diagnostics();
    const path = arrivalOf(
      declared(
        'world w: sprout.World {\n  visitors arrive at first\n  visitors arrive at second\n}',
      ),
      diagnostics,
    );
    expect(writtenPath(path!)).toBe('first');
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([
      '`w` says twice where its visitors arrive.',
    ]);
    expect(textOf(diagnostics.refusals[0]!.at)).toBe('visitors arrive at second');
  });
});

describe('`resolveArrival` finds a place, read from inside the world', () => {
  /** The world `shop` and its own files' kinds and objects, placed; the text must parse. */
  function arriving(text: string, libraries: Readonly<Record<string, string>> = {}) {
    const parsing = new Diagnostics();
    const declarations = parseDeclarations(new SourceFile('shop.sprout', text), parsing);
    expect(parsing.refusals.map((d) => d.message)).toEqual([]);
    const diagnostics = new Diagnostics();
    const kinds = new KindTable();
    for (const [library, source] of Object.entries(libraries)) {
      kinds.add(
        library,
        parseDeclarations(new SourceFile(`${library}.sprout`, source), parsing).filter(
          (d): d is KindDeclaration => d.kind === 'kind',
        ),
        diagnostics,
      );
    }
    kinds.add(
      'shop',
      declarations.filter((d): d is KindDeclaration => d.kind === 'kind'),
      diagnostics,
    );
    kinds.resolve(ENUMS, diagnostics);
    const objects = resolveObjects(
      'shop',
      declarations.filter((d): d is ObjectDeclaration => d.kind === 'object'),
      { enums: ENUMS, kinds, diagnostics },
    );
    const tree = placeObjects(objects, { world: 'shop', diagnostics });
    const before = diagnostics.all.length;
    const found = resolveArrival(
      declarations.find((d): d is WorldDeclaration => d.kind === 'world')!,
      { tree, objects, kinds, from: 'shop', diagnostics },
    );
    const said = diagnostics.all.slice(before);
    return {
      found,
      said: said.map((d) => d.message),
      remedies: said.map((d) => d.remedy),
      where: said.map((d) => textOf(d.at)),
    };
  }

  const PLACES = `kind Room {
  contains actors
}
kind Bench {
  contains
}
`;

  it('finds a place directly in the world, by its path', () => {
    const { found, said } = arriving(`${PLACES}
world shop: sprout.World {
  visitors arrive at hall
}
object hall: Room in shop`);
    expect(said).toEqual([]);
    expect(found).toEqual({ found: 'place', path: ['hall'] });
  });

  it('finds a place deeper in the tree by its dotted path', () => {
    const { found, said } = arriving(`${PLACES}
world shop: sprout.World {
  visitors arrive at hall.wardrobe
}
object hall: Room in shop
object wardrobe: Room in hall`);
    expect(said).toEqual([]);
    expect(found).toEqual({ found: 'place', path: ['hall', 'wardrobe'] });
  });

  it('takes a place whose own body says `contains actors`', () => {
    const { found, said } = arriving(`${PLACES}
world shop: sprout.World {
  visitors arrive at bench
}
object bench: Bench in shop {
  contains actors
}`);
    expect(said).toEqual([]);
    expect(found).toEqual({ found: 'place', path: ['bench'] });
  });

  it('refuses something that is not a place, at the last step, in either mode', () => {
    const { found, said, remedies, where } = arriving(`${PLACES}
world shop: sprout.World {
  visitors arrive at hall.bench
}
object hall: Room in shop
object bench: Bench in hall`);
    expect(found).toEqual({ found: 'refused' });
    expect(said).toEqual(['`bench` is not a place, and visitors arrive in one.']);
    expect(remedies).toEqual([
      'Name a place, or make `bench` one: compose `sprout.Place`, or write `contains actors` in its body.',
    ]);
    expect(where).toEqual(['bench']);
  });

  it('gives an unknown step to the caller as a gap, in the words an `in` gets', () => {
    const { found, said } = arriving(`${PLACES}
world shop: sprout.World {
  visitors arrive at hal
}
object hall: Room in shop`);
    // Nothing is said here: whether it refuses is the mode's.
    expect(said).toEqual([]);
    expect(found).toMatchObject({
      found: 'absent',
      message: 'Nothing here is called `hal`. Did you mean `hall`?',
      remedy: 'Write `visitors arrive at hall`, or declare an object called `hal`.',
      said: false,
    });
    if (found.found !== 'absent') return;
    expect(textOf(found.at)).toBe('hal');
    expect(writtenPath(found.path)).toBe('hal');
  });

  it('points at the deeper place of that name, written after `visitors arrive at`', () => {
    const { found } = arriving(`${PLACES}
world shop: sprout.World {
  visitors arrive at wardrobe
}
object hall: Room in shop
object wardrobe: Room in hall`);
    expect(found).toMatchObject({
      found: 'absent',
      message: 'Nothing here is called `wardrobe`.',
      remedy: '`wardrobe` is inside `hall`, so write `visitors arrive at hall.wardrobe`.',
    });
  });

  it('calls a place absent, and already told, when its kind is absent', () => {
    const { found, said } = arriving(`world shop: sprout.World {
  visitors arrive at hall
}
object hall: Nope in shop`);
    // What is said is the kind's, which is not `resolveArrival`'s to say.
    expect(said).toEqual([]);
    expect(found).toMatchObject({
      found: 'absent',
      message: '`hall` is absent, so visitors have nowhere to arrive.',
      said: true,
    });
  });

  it('calls a place absent, and already told, when it did not place', () => {
    const { found } = arriving(`${PLACES}
world shop: sprout.World {
  visitors arrive at hall.nook
}
object hall: Room in yard
object nook: Room in hall`);
    expect(found).toMatchObject({
      found: 'absent',
      message: '`hall.nook` is absent, so visitors have nowhere to arrive.',
      said: true,
    });
  });

  it('refuses the world’s name as a step of the path, in the words an `in` gets', () => {
    const { found, said, remedies } = arriving(`${PLACES}
world shop: sprout.World {
  visitors arrive at shop.hall
}
object hall: Room in shop`);
    expect(found).toEqual({ found: 'refused' });
    expect(said).toEqual([
      '`shop` is the world, which is named on its own and never as a step of a path.',
    ]);
    expect(remedies).toEqual([
      'A path starts from something directly in the world: write `visitors arrive at hall`.',
    ]);
  });

  it('refuses what `arrivalOf` refuses, and says it once', () => {
    const { found, said } = arriving('world shop: sprout.World {\n  visitors are P\n}');
    expect(found).toEqual({ found: 'refused' });
    expect(said).toEqual(['`shop` does not say where a visitor arrives.']);
  });
});

describe('the world is where visitors arrive only when it is a place', () => {
  it('is one where its own body says `contains actors`', () => {
    const { found, said } = arrivingAtShop('contains actors');
    expect(said).toEqual([]);
    expect(found).toEqual({ found: 'place', path: [] });
  });

  it('is one where a kind it composes beside `sprout.World` holds actors', () => {
    const { found, said } = arrivingAtShop('', ', victorian.Hall', {
      victorian: 'kind Hall {\n  contains actors\n}',
    });
    expect(said).toEqual([]);
    expect(found).toEqual({ found: 'place', path: [] });
  });

  it('is not one for holding things, and is refused at its name in the path', () => {
    const { found, said, remedies, where } = arrivingAtShop('contains');
    expect(found).toEqual({ found: 'refused' });
    expect(said).toEqual(['`shop` is not a place, and visitors arrive in one.']);
    expect(remedies).toEqual([
      "Write `contains actors` in the world's body to make it a place, or name a place in it for visitors to arrive at.",
    ]);
    expect(where).toEqual(['shop']);
  });

  it('is not known to be one when a kind it composes is not there, which is a gap', () => {
    const { found, said } = arrivingAtShop('', ', Hal', {
      shop: 'kind Hall {\n  contains actors\n}',
    });
    expect(said).toEqual([]);
    expect(found).toMatchObject({
      found: 'absent',
      message:
        'Nothing here is a `Hal`. Did you mean `Hall`? `shop` is made of it, so it is not known to be a place for visitors to arrive in.',
      said: false,
    });
  });

  /** `visitors arrive at shop`, the world's body holding `line`. */
  function arrivingAtShop(
    line: string,
    composes = '',
    libraries: Readonly<Record<string, string>> = {},
  ) {
    const diagnostics = new Diagnostics();
    const parsing = new Diagnostics();
    const kinds = new KindTable();
    for (const [library, source] of Object.entries(libraries)) {
      kinds.add(
        library,
        parseDeclarations(new SourceFile(`${library}.sprout`, source), parsing).filter(
          (d): d is KindDeclaration => d.kind === 'kind',
        ),
        diagnostics,
      );
    }
    kinds.resolve(ENUMS, diagnostics);
    const declaredWorld = parseDeclarations(
      new SourceFile(
        'shop.sprout',
        `world shop: sprout.World${composes} {\n  ${line}\n  visitors arrive at shop\n}`,
      ),
      parsing,
    ).find((d): d is WorldDeclaration => d.kind === 'world')!;
    expect(parsing.refusals.map((d) => d.message)).toEqual([]);
    const tree = placeObjects([], { world: 'shop', diagnostics });
    const found = resolveArrival(declaredWorld, {
      tree,
      objects: [],
      kinds,
      from: 'shop',
      diagnostics,
    });
    return {
      found,
      said: diagnostics.all.map((d) => d.message),
      remedies: diagnostics.all.map((d) => d.remedy),
      where: diagnostics.all.map((d) => textOf(d.at)),
    };
  }
});

describe('containment is a declaration, and a place is whatever holds actors', () => {
  /**
   * A world writing exactly these lines, and the two things it may hold,
   * composing a `sprout.World` that here declares nothing of its own.
   */
  function holding(...lines: string[]) {
    const { kind, said } = world(
      `world printers_shop: sprout.World {\n${lines.map((l) => `  ${l}`).join('\n')}\n` +
        '  visitors are Creature\n  visitors arrive at composing_room\n}',
    );
    return { said, contains: kind?.contains, containsActors: kind?.containsActors };
  }

  it('holds nothing unless it or something it composes says so', () => {
    // And is NOT refused for it: the standard library's `sprout.World`
    // declares `contains` and every world composes it.
    const nothing = holding();
    expect(nothing.said).toEqual([]);
    expect(nothing.contains).toBe(false);
    expect(nothing.containsActors).toBe(false);
  });

  it('holds what `sprout.World` holds, which is how every world holds its places', () => {
    const kinds = kindsOf({
      ...LIBRARIES,
      sprout: 'kind World { contains }\nkind Actor { }\nkind Container { :open true }',
    });
    const { kind, said } = world(SHOP, kinds);
    expect(said).toEqual([]);
    expect(kind!.contains).toBe(true);
    expect(kind!.containsActors).toBe(false);
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
  });

  it('is a default of the language, not a number a host sets', () => {
    // The spec states the value, so nothing configures it: `pass any
    // (false)` unless the world says otherwise. B32 reads the rules a
    // world writes; this is what it answers without one.
    expect(typeof WORLD_PASSES_ANYTHING).toBe('boolean');
  });
});
