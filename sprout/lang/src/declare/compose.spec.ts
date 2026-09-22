import { describe, expect, it } from 'vitest';

import type { KindDeclaration, KindExpr, ObjectDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from './enums.js';
import { KindTable } from './kinds.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { composeKind, identityOf, unknownKind, type Found, type KindSource } from './compose.js';
import { integer, showType } from './types.js';

/** The standard library's part of every suite here: a container with a range to keep. */
const SPROUT_TEXT = `kind Container {
  contains
  :open true
  :capacity 8 min 0 max 99
}
kind World { contains }
enum Ward { oak, silver }
`;

/**
 * Compose `composer`, the last kind or object in `text`, against every
 * kind before it, all in the library `shop`, and the standard library's
 * above. What the composer's own composition says is all that is
 * reported.
 */
function compose(text: string, options: { sprout?: string } = {}) {
  const read = new Diagnostics();
  const sprout = parseDeclarations(
    new SourceFile('sprout.sprout', options.sprout ?? SPROUT_TEXT),
    read,
  );
  const shop = parseDeclarations(new SourceFile('shop.sprout', text), read);
  expect(
    read.refusals.map((d) => d.message),
    'the fixture parses',
  ).toEqual([]);

  const setup = new Diagnostics();
  const enums = new EnumTable();
  enums.add(
    'sprout',
    sprout.filter((d) => d.kind === 'enum'),
    setup,
  );
  const kinds = new KindTable();
  kinds.add(
    'sprout',
    sprout.filter((d): d is KindDeclaration => d.kind === 'kind'),
    setup,
  );
  const composer = shop.at(-1) as KindDeclaration | ObjectDeclaration;
  kinds.add(
    'shop',
    shop.filter((d): d is KindDeclaration => d.kind === 'kind' && d !== composer),
    setup,
  );
  kinds.resolve(enums, setup);
  expect(
    setup.refusals.map((d) => d.message),
    'the kinds it composes resolve',
  ).toEqual([]);

  const diagnostics = new Diagnostics();
  const unknown: KindExpr[] = [];
  const kind = composeKind(
    {
      library: 'shop',
      name: composer.name.text,
      composes: composer.composes,
      members: composer.members,
    },
    { enums, kinds, diagnostics, onUnknown: (written) => unknown.push(written) },
  );
  return {
    kind,
    unknown,
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy] as const),
  };
}

/** A source that declares nothing, for a suite that overrides what it is about. */
const NOTHING: KindSource = {
  declares: () => false,
  named: () => [],
  find: (): Found => ({ found: 'unknown' }),
};

const DIAMOND = `kind A { :worn 0 min 0 max 9 }
kind B: A { }
kind C: A { }
`;

describe('the closure is depth-first, left to right, each kind at its first appearance, own last', () => {
  it('walks a diamond once: `D: B, C` with `B: A` and `C: A` is A, B, C, D', () => {
    const { kind, said } = compose(`${DIAMOND}kind D: B, C { }`);
    expect(said).toEqual([]);
    expect(kind!.order).toEqual(['shop.A', 'shop.B', 'shop.C', 'shop.D']);
  });

  it('walks a chain three deep from the bottom: `D: C`, `C: B`, `B: A` is A, B, C, D', () => {
    const { kind } = compose('kind A { }\nkind B: A { }\nkind C: B { }\nkind D: C { }');
    expect(kind!.order).toEqual(['shop.A', 'shop.B', 'shop.C', 'shop.D']);
  });

  it('follows the list as written, so `E: C, B` runs C before B', () => {
    const { kind } = compose(`${DIAMOND}kind E: C, B { }`);
    expect(kind!.order).toEqual(['shop.A', 'shop.C', 'shop.B', 'shop.E']);
  });

  it('places a kind at its first appearance, not where it is written again', () => {
    const { kind } = compose(`${DIAMOND}kind F: B, A { }`);
    expect(kind!.order).toEqual(['shop.A', 'shop.B', 'shop.F']);
  });

  it('holds the same kinds as a set, itself included', () => {
    const { kind } = compose(`${DIAMOND}kind D: B, C { }`);
    expect([...kind!.composes].sort()).toEqual([...kind!.order].sort());
    expect(kind!.composes.has('shop.D')).toBe(true);
  });

  it('composes an object as its anonymous kind, named for the object', () => {
    const { kind, said } = compose(`${DIAMOND}object chest: B, C in hall { :worn 3 }`);
    expect(said).toEqual([]);
    expect(kind!.order).toEqual(['shop.A', 'shop.B', 'shop.C', 'shop.chest']);
  });
});

describe('a written kind is read from the composer’s library, then the standard library’s', () => {
  const kinds: KindSource = {
    ...NOTHING,
    declares: (identity) => identity === 'shop.Container',
  };
  const written = (text: string): KindExpr =>
    (
      parseDeclarations(
        new SourceFile('k.sprout', `kind K: ${text} { }`),
        new Diagnostics(),
      )[0] as KindDeclaration
    ).composes[0]!;

  it('takes its own before the standard library’s, and the library it names when it names one', () => {
    expect(identityOf(written('Container'), 'shop', kinds)).toBe('shop.Container');
    expect(identityOf(written('Container'), 'other', kinds)).toBe('sprout.Container');
    expect(identityOf(written('sprout.Container'), 'shop', kinds)).toBe('sprout.Container');
    expect(identityOf(written('Chest'), 'shop', kinds)).toBe('sprout.Chest');
  });

  it('composes the world’s own `Container` over the standard library’s', () => {
    const { kind } = compose('kind Container { :lid false }\nkind Crate: Container { }');
    expect(kind!.order).toEqual(['shop.Container', 'shop.Crate']);
    expect([...kind!.properties.keys()]).toEqual(['lid']);
  });
});

describe('a property from one origin is one property, however many paths reach it', () => {
  it('merges the diamond’s `:worn` into one, from `A`', () => {
    const { kind, said } = compose(`${DIAMOND}kind D: B, C { }`);
    expect(said).toEqual([]);
    expect([...kind!.properties.values()].map((p) => [p.name, p.origin])).toEqual([
      ['worn', 'shop.A'],
    ]);
  });

  it('declares what the body declares, with the composer as its origin', () => {
    const { kind } = compose('kind Crate { :lid false\n:remembers [seen: 0] }');
    expect([...kind!.properties.values()].map((p) => [p.name, p.origin, p.remembered])).toEqual([
      ['lid', 'shop.Crate', false],
      ['seen', 'shop.Crate', true],
    ]);
  });

  it('refuses one name declared twice in one body, at the second', () => {
    const { said } = compose('kind Crate { :lid false\n:remembers [lid: true] }');
    expect(said).toEqual([
      [
        'shop.sprout:2:13',
        '`Crate` holds `:lid` twice.',
        'A property is declared once. Remove the second, or give it another name.',
      ],
    ]);
  });
});

describe('a property from two origins is refused until the composer restates it', () => {
  const TWO = 'kind Lidded { :open true }\nkind Futon { :open false }\n';

  it('refuses at the kind, as written, that brought the second origin, naming both', () => {
    const { said } = compose(`${TWO}kind Crate: Lidded, Futon { }`);
    expect(said).toEqual([
      [
        'shop.sprout:3:21',
        '`Crate` gets `:open` from both `Lidded` and `Futon`, which are two claims on one slot.',
        'If they are meant to be one property, restate it in `Crate`: `:open true`.',
      ],
    ]);
  });

  it('refuses even identical declarations, since two kinds meaning `:open` may mean two things', () => {
    const { said } = compose(
      'kind Lidded { :open true }\nkind Futon { :open true }\nkind Crate: Lidded, Futon { }',
    );
    expect(said.map(([, message]) => message)).toEqual([
      '`Crate` gets `:open` from both `Lidded` and `Futon`, which are two claims on one slot.',
    ]);
  });

  it('names a library’s kind with its library', () => {
    const { said } = compose('kind Futon { :open false }\nkind Crate: sprout.Container, Futon { }');
    expect(said.map(([at, message]) => [at, message])).toEqual([
      [
        'shop.sprout:2:31',
        '`Crate` gets `:open` from both `sprout.Container` and `Futon`, which are two claims on one slot.',
      ],
    ]);
  });

  it('names every origin when there are more than two', () => {
    const { said } = compose(`${TWO}kind Box { :open true }\nkind Crate: Lidded, Futon, Box { }`);
    expect(said.map(([at, message]) => [at, message])).toEqual([
      [
        'shop.sprout:4:21',
        '`Crate` gets `:open` from `Lidded`, `Futon` and `Box`, which are 3 claims on one slot.',
      ],
    ]);
  });

  it('takes the restatement as the one property, with the composer as its origin', () => {
    const { kind, said } = compose(`${TWO}kind Crate: Lidded, Futon { :open false }`);
    expect(said).toEqual([]);
    const open = kind!.properties.get('open')!;
    expect([open.origin, showType(open.type), open.declaration.default]).toMatchObject([
      'shop.Crate',
      'boolean',
      { value: false },
    ]);
  });

  it('refuses two origins of `:remembers` the same way, and restates inside `:remembers`', () => {
    const REMEMBERS =
      'kind Lidded { :remembers [seen: false] }\nkind Futon { :remembers [seen: true] }\n';
    const { said } = compose(`${REMEMBERS}kind Crate: Lidded, Futon { }`);
    expect(said.map(([, message, remedy]) => [message, remedy])).toEqual([
      [
        '`Crate` gets `:seen` from both `Lidded` and `Futon`, which are two claims on one slot.',
        'If they are meant to be one property, restate it in `Crate`: `:remembers [seen: false]`.',
      ],
    ]);
    const restated = compose(`${REMEMBERS}kind Crate: Lidded, Futon { :remembers [seen: true] }`);
    expect(restated.said).toEqual([]);
    expect(restated.kind!.properties.get('seen')!.remembered).toBe(true);
  });

  it('cannot merge two origins that disagree in type, and says so rather than offering a restatement', () => {
    const DIFFER = 'kind Lidded { :open true }\nkind Hinged { :open 0 min 0 max 9 }\n';
    const { said } = compose(`${DIFFER}kind Crate: Lidded, Hinged { }`);
    expect(said.map(([, , remedy]) => remedy)).toEqual([
      'They hold boolean and integer 0 to 9, so they cannot be one property: compose only one of them, or give one of them another name in a kind of your own.',
    ]);
    const restated = compose(`${DIFFER}kind Crate: Lidded, Hinged { :open false }`);
    expect(restated.said).toEqual([
      [
        'shop.sprout:3:30',
        '`:open` holds boolean in `Lidded` and integer 0 to 9 in `Hinged`, so restating it cannot make them one property.',
        'Compose only one of them, or give one of them another name in a kind of your own.',
      ],
    ]);
  });

  it('counts a remembered and a plain declaration of one name as disagreeing', () => {
    const { said } = compose(
      'kind Lidded { :open true }\nkind Futon { :remembers [open: true] }\nkind Crate: Lidded, Futon { :open false }',
    );
    expect(said.map(([, message]) => message)).toEqual([
      '`:open` holds boolean in `Lidded` and boolean (remembered) in `Futon`, so restating it cannot make them one property.',
    ]);
  });

  it('makes a restating kind the origin, so composing it beside what it restated collides again', () => {
    // `Crate` restates `sprout.Container`'s `:capacity`, and is its
    // origin from then on: composing both is two origins.
    const { said } = compose(
      'kind Crate: sprout.Container { :capacity 40 }\nobject box: Crate, sprout.Container in hall',
    );
    // `:open` reaches `box` by both paths from one origin, and is one.
    expect(said.map(([, message]) => message)).toEqual([
      '`box` gets `:capacity` from both `Crate` and `sprout.Container`, which are two claims on one slot.',
    ]);
  });
});

describe('a restatement keeps the composed type', () => {
  it('keeps `sprout.Container`’s range for `:capacity 40`', () => {
    const { kind, said } = compose('kind Crate: sprout.Container { :capacity 40 }');
    expect(said).toEqual([]);
    expect(kind!.properties.get('capacity')!.type).toEqual(integer(0, 99));
  });

  it('keeps the enum for a bare option', () => {
    const { kind, said } = compose(
      'kind Warded { :ward sprout.Ward default oak }\nkind Gate: Warded { :ward silver }',
    );
    expect(said).toEqual([]);
    expect(showType(kind!.properties.get('ward')!.type)).toBe('Ward');
  });

  it('refuses a change of type at what was written, naming the kind it came from', () => {
    const { said } = compose('kind Crate: sprout.Container { :capacity 40 min 0 max 50 }');
    expect(said).toEqual([
      [
        'shop.sprout:1:49',
        '`:capacity` holds integer 0 to 99 in `sprout.Container`, and whatever composes it keeps that type.',
        'Restate only its default, as in `:capacity 40`; a property holding something else takes a name of its own.',
      ],
    ]);
  });
});

describe('`contains` and `contains actors` are idempotent, so they hold across the closure', () => {
  const HOLDERS = 'kind Box { contains }\nkind Room { contains actors }\n';

  it('holds what anything it composes holds', () => {
    const { kind } = compose(`${HOLDERS}kind Crate: Box { }`);
    expect([kind!.contains, kind!.containsActors]).toEqual([true, false]);
  });

  it('is a place when anything it composes is, which implies holding', () => {
    const { kind } = compose(`${HOLDERS}kind Hall: Box, Room { }`);
    expect([kind!.contains, kind!.containsActors]).toEqual([true, true]);
    expect(compose(`${HOLDERS}kind Hall: Room { }`).kind!.contains).toBe(true);
  });

  it('holds nothing when nothing says so', () => {
    const { kind } = compose(`${HOLDERS}kind Brick { }`);
    expect([kind!.contains, kind!.containsActors]).toEqual([false, false]);
  });

  it('takes its own line as well as what it composes', () => {
    const { kind } = compose(`${HOLDERS}kind Den: Box { contains actors }`);
    expect([kind!.contains, kind!.containsActors]).toEqual([true, true]);
  });
});

describe('what a composition list may not name', () => {
  it('tells `onUnknown` of a kind nothing declares, and composes nothing', () => {
    const { kind, unknown, said } = compose('kind Crate: Missing, sprout.Gone { }');
    expect(kind).toBeNull();
    expect(unknown.map((w) => locationOf(w.at))).toEqual(['shop.sprout:1:13', 'shop.sprout:1:22']);
    expect(said).toEqual([]);
  });

  it('says so in words a person can act on', () => {
    const [bare, qualified] = (
      parseDeclarations(
        new SourceFile('k.sprout', 'kind K: Missing, victorian.Voice { }'),
        new Diagnostics(),
      )[0] as KindDeclaration
    ).composes;
    expect(unknownKind(bare!, 'shop', NOTHING)).toEqual({
      message: 'Nothing here is a `Missing`.',
      remedy:
        'Declare it with `kind Missing { … }`, or check the spelling of a kind this world or a library it uses declares.',
    });
    expect(unknownKind(qualified!, 'shop', NOTHING)).toEqual({
      message: 'Nothing here is a `victorian.Voice`.',
      remedy:
        'Check the spelling, and that the world uses the library `victorian` and it declares `Voice`.',
    });
  });

  it('offers the kind a misspelling most likely meant, from where the name is read', () => {
    const composes = (text: string) =>
      (parseDeclarations(new SourceFile('k.sprout', text), new Diagnostics())[0] as KindDeclaration)
        .composes[0]!;
    const kinds: KindSource = {
      ...NOTHING,
      named: (library) =>
        ({ shop: ['Wooden'], sprout: ['Container'], victorian: ['Voice'] })[library] ?? [],
    };
    expect(unknownKind(composes('kind K: Wodden { }'), 'shop', kinds)).toEqual({
      message: 'Nothing here is a `Wodden`. Did you mean `Wooden`?',
      remedy: 'Write `Wooden`, or declare `Wodden` with `kind Wodden { … }`.',
    });
    expect(unknownKind(composes('kind K: Contianer { }'), 'shop', kinds).message).toBe(
      'Nothing here is a `Contianer`. Did you mean `Container`?',
    );
    expect(unknownKind(composes('kind K: victorian.Vioce { }'), 'shop', kinds)).toEqual({
      message: 'Nothing here is a `victorian.Vioce`. Did you mean `victorian.Voice`?',
      remedy: 'Write `victorian.Voice`.',
    });
    // A library's kinds are not offered for a bare name, nor a guess too far off.
    expect(unknownKind(composes('kind K: Vioce { }'), 'shop', kinds).message).toBe(
      'Nothing here is a `Vioce`.',
    );
    expect(unknownKind(composes('kind K: Barrel { }'), 'shop', kinds).message).toBe(
      'Nothing here is a `Barrel`.',
    );
  });

  it('refuses it itself when nobody asked to be told', () => {
    const diagnostics = new Diagnostics();
    const [crate] = parseDeclarations(
      new SourceFile('k.sprout', 'kind Crate: Missing { }'),
      diagnostics,
    );
    const kinds = new KindTable();
    const kind = composeKind(
      {
        library: 'shop',
        name: 'Crate',
        composes: (crate as KindDeclaration).composes,
        members: [],
      },
      { enums: new EnumTable(), kinds, diagnostics },
    );
    expect(kind).toBeNull();
    expect(diagnostics.refusals.map((d) => [locationOf(d.at), d.message])).toEqual([
      ['k.sprout:1:13', 'Nothing here is a `Missing`.'],
    ]);
  });

  it('does not read a body whose composition failed, since a restatement would read as new', () => {
    // `:ward silver` restates a `sprout.Ward` property only if `Warded`
    // is there to say so; read alone it would be refused for naming no enum.
    const { said, unknown } = compose('kind Gate: Warded { :ward silver }');
    expect(unknown).toHaveLength(1);
    expect(said).toEqual([]);
  });

  it('refuses the same kind twice, at the second', () => {
    const { said } = compose('kind Box { }\nkind Crate: Box, Box { }');
    expect(said).toEqual([
      ['shop.sprout:2:18', '`Crate` composes `Box` twice.', 'Compose it once.'],
    ]);
  });

  it('names a kind written twice as it was written, bare or qualified', () => {
    // A bare name nothing declares resolves to the standard library's
    // spelling, which the author never wrote and must not be shown.
    const unknown = compose('kind Crate: Wodden, Wodden { }');
    expect(unknown.unknown).toHaveLength(1);
    expect(unknown.said).toEqual([
      ['shop.sprout:1:21', '`Crate` composes `Wodden` twice.', 'Compose it once.'],
    ]);
    expect(compose('kind Crate: sprout.Container, sprout.Container { }').said).toEqual([
      ['shop.sprout:1:31', '`Crate` composes `sprout.Container` twice.', 'Compose it once.'],
    ]);
  });

  it('says nothing more of a kind that failed, which has been said already', () => {
    const failed: KindSource = {
      ...NOTHING,
      declares: () => true,
      find: (): Found => ({ found: 'failed' }),
    };
    const diagnostics = new Diagnostics();
    const [crate] = parseDeclarations(
      new SourceFile('k.sprout', 'kind Crate: Broken { }'),
      diagnostics,
    );
    const kind = composeKind(
      {
        library: 'shop',
        name: 'Crate',
        composes: (crate as KindDeclaration).composes,
        members: [],
      },
      { enums: new EnumTable(), kinds: failed, diagnostics },
    );
    expect(kind).toBeNull();
    expect(diagnostics.all).toEqual([]);
  });

  it('refuses a loop at the kind as written that closes it, naming the kinds it runs through', () => {
    const looping: KindSource = {
      ...NOTHING,
      declares: () => true,
      find: (): Found => ({ found: 'cycle', through: ['shop.B', 'sprout.C'] }),
    };
    const diagnostics = new Diagnostics();
    const [kind] = parseDeclarations(new SourceFile('k.sprout', 'kind C: A { }'), diagnostics);
    composeKind(
      { library: 'shop', name: 'C', composes: (kind as KindDeclaration).composes, members: [] },
      { enums: new EnumTable(), kinds: looping, diagnostics },
    );
    expect(diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'k.sprout:1:9',
        '`A` composes itself, through `B` and `sprout.C`.',
        'Take `A` out of what `C` composes: a kind cannot be made of itself.',
      ],
    ]);
  });
});

describe('`sprout.World` is composed by a world and nothing else', () => {
  it('refuses a bare `World` that means it, with the words the shape tier uses', () => {
    const { said, kind } = compose('object hall: World in nowhere');
    expect(said).toEqual([
      [
        'shop.sprout:1:14',
        '`hall` composes `sprout.World`, which only a world may.',
        'Take it out of what `hall` composes: it would make a thing into a world, and a bundle has one world, written `world <name>: sprout.World { … }`.',
      ],
    ]);
    // The rest of it is composed: nothing else was wrong with it.
    expect(kind!.order).toEqual(['shop.hall']);
  });

  it('knows it by identity even when no standard library travelled', () => {
    const { said } = compose('kind Hall: World { }', { sprout: '' });
    expect(said.map(([, message]) => message)).toEqual([
      '`Hall` composes `sprout.World`, which only a world may.',
    ]);
  });

  it('leaves `sprout.World` written out to the shape tier, which has refused it once already', () => {
    expect(compose('kind Hall: sprout.World { }').said).toEqual([]);
  });

  it('lets a world’s own `World` be composed, since it is some other kind', () => {
    const { said, kind } = compose('kind World { }\nkind Hall: World { }');
    expect(said).toEqual([]);
    expect(kind!.order).toEqual(['shop.World', 'shop.Hall']);
  });
});
