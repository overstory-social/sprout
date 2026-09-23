import { describe, expect, it } from 'vitest';

import type { KindDeclaration, KindExpr, ObjectDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from './enums.js';
import { KindTable } from './kinds.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import {
  composeKind,
  identityOf,
  unknownKind,
  writtenKind,
  type Found,
  type KindSource,
} from './compose.js';
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
function compose(
  text: string,
  options: {
    sprout?: string;
    /** Other libraries' kinds, by library. */
    libraries?: Readonly<Record<string, string>>;
    mayComposeWorld?: boolean;
  } = {},
) {
  const read = new Diagnostics();
  const sprout = parseDeclarations(
    new SourceFile('sprout.sprout', options.sprout ?? SPROUT_TEXT),
    read,
  );
  const libraries = Object.entries(options.libraries ?? {}).map(
    ([library, source]) =>
      [library, parseDeclarations(new SourceFile(`${library}.sprout`, source), read)] as const,
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
  for (const [library, declared] of libraries) {
    kinds.add(
      library,
      declared.filter((d): d is KindDeclaration => d.kind === 'kind'),
      setup,
    );
  }
  const last = shop.at(-1)!;
  const composer: KindDeclaration | ObjectDeclaration =
    last.kind === 'world' ? last.objects.at(-1)! : (last as KindDeclaration);
  kinds.add(
    'shop',
    shop.filter((d): d is KindDeclaration => d.kind === 'kind' && d !== composer),
    setup,
  );
  kinds.resolve('shop', enums, setup);
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
      mayComposeWorld: options.mayComposeWorld ?? false,
    },
    { enums, kinds, world: 'shop', diagnostics, onUnknown: (written) => unknown.push(written) },
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
kind B is A { }
kind C is A { }
`;

describe('the closure is depth-first, left to right, each kind at its first appearance, own last', () => {
  it('walks a diamond once: `D is B, C` with `B is A` and `C is A` is A, B, C, D', () => {
    const { kind, said } = compose(`${DIAMOND}kind D is B, C { }`);
    expect(said).toEqual([]);
    expect(kind!.order).toEqual(['shop.A', 'shop.B', 'shop.C', 'shop.D']);
  });

  it('walks a chain three deep from the bottom: `D is C`, `C is B`, `B is A` is A, B, C, D', () => {
    const { kind } = compose('kind A { }\nkind B is A { }\nkind C is B { }\nkind D is C { }');
    expect(kind!.order).toEqual(['shop.A', 'shop.B', 'shop.C', 'shop.D']);
  });

  it('follows the list as written, so `E is C, B` runs C before B', () => {
    const { kind } = compose(`${DIAMOND}kind E is C, B { }`);
    expect(kind!.order).toEqual(['shop.A', 'shop.C', 'shop.B', 'shop.E']);
  });

  it('places a kind at its first appearance, not where it is written again', () => {
    const { kind } = compose(`${DIAMOND}kind F is B, A { }`);
    expect(kind!.order).toEqual(['shop.A', 'shop.B', 'shop.F']);
  });

  it('holds the same kinds as a set, itself included', () => {
    const { kind } = compose(`${DIAMOND}kind D is B, C { }`);
    expect([...kind!.composes].sort()).toEqual([...kind!.order].sort());
    expect(kind!.composes.has('shop.D')).toBe(true);
  });

  it('composes an object as its anonymous kind, named for the object', () => {
    const { kind, said } = compose(
      `${DIAMOND}world shop is sprout.World { object chest is B, C { :worn 3 } }`,
    );
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
        new SourceFile('k.sprout', `kind K is ${text} { }`),
        new Diagnostics(),
      )[0] as KindDeclaration
    ).composes[0]!;

  it('takes its own before the standard library’s, and the library it names when it names one', () => {
    expect(identityOf(written('Container'), 'shop', kinds)).toBe('shop.Container');
    expect(identityOf(written('Container'), 'other', kinds)).toBe('sprout.Container');
    expect(identityOf(written('sprout.Container'), 'shop', kinds)).toBe('sprout.Container');
    expect(identityOf(written('Chest'), 'shop', kinds)).toBe('sprout.Chest');
  });

  it('is shown as it was written, bare or with its library, whatever it resolves to', () => {
    expect(writtenKind(written('Container'))).toBe('Container');
    expect(writtenKind(written('sprout.Container'))).toBe('sprout.Container');
  });

  it('composes the world’s own `Container` over the standard library’s', () => {
    const { kind } = compose('kind Container { :lid false }\nkind Crate is Container { }');
    expect(kind!.order).toEqual(['shop.Container', 'shop.Crate']);
    expect([...kind!.properties.keys()]).toEqual(['lid']);
  });
});

describe('a property from one origin is one property, however many paths reach it', () => {
  it('merges the diamond’s `:worn` into one, from `A`', () => {
    const { kind, said } = compose(`${DIAMOND}kind D is B, C { }`);
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
    const { said } = compose(`${TWO}kind Crate is Lidded, Futon { }`);
    expect(said).toEqual([
      [
        'shop.sprout:3:23',
        '`Crate` gets `:open` from both `Lidded` and `Futon`, which are two claims on one slot.',
        'If they are meant to be one property, restate it in `Crate`: `:open true`.',
      ],
    ]);
  });

  it('refuses even identical declarations, since two kinds meaning `:open` may mean two things', () => {
    const { said } = compose(
      'kind Lidded { :open true }\nkind Futon { :open true }\nkind Crate is Lidded, Futon { }',
    );
    expect(said.map(([, message]) => message)).toEqual([
      '`Crate` gets `:open` from both `Lidded` and `Futon`, which are two claims on one slot.',
    ]);
  });

  it('names a library’s kind with its library', () => {
    const { said } = compose(
      'kind Futon { :open false }\nkind Crate is sprout.Container, Futon { }',
    );
    expect(said.map(([at, message]) => [at, message])).toEqual([
      [
        'shop.sprout:2:33',
        '`Crate` gets `:open` from both `sprout.Container` and `Futon`, which are two claims on one slot.',
      ],
    ]);
  });

  it('names every origin when there are more than two', () => {
    const { said } = compose(`${TWO}kind Box { :open true }\nkind Crate is Lidded, Futon, Box { }`);
    expect(said.map(([at, message]) => [at, message])).toEqual([
      [
        'shop.sprout:4:23',
        '`Crate` gets `:open` from `Lidded`, `Futon` and `Box`, which are 3 claims on one slot.',
      ],
    ]);
  });

  it('takes the restatement as the one property, with the composer as its origin', () => {
    const { kind, said } = compose(`${TWO}kind Crate is Lidded, Futon { :open false }`);
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
    const { said } = compose(`${REMEMBERS}kind Crate is Lidded, Futon { }`);
    expect(said.map(([, message, remedy]) => [message, remedy])).toEqual([
      [
        '`Crate` gets `:seen` from both `Lidded` and `Futon`, which are two claims on one slot.',
        'If they are meant to be one property, restate it in `Crate`: `:remembers [seen: false]`.',
      ],
    ]);
    const restated = compose(`${REMEMBERS}kind Crate is Lidded, Futon { :remembers [seen: true] }`);
    expect(restated.said).toEqual([]);
    expect(restated.kind!.properties.get('seen')!.remembered).toBe(true);
  });

  it('cannot merge two origins that disagree in type, and says so rather than offering a restatement', () => {
    const DIFFER = 'kind Lidded { :open true }\nkind Hinged { :open 0 min 0 max 9 }\n';
    const { said } = compose(`${DIFFER}kind Crate is Lidded, Hinged { }`);
    expect(said.map(([, , remedy]) => remedy)).toEqual([
      'They hold boolean and integer 0 to 9, so they cannot be one property: compose only one of them, or give one of them another name in a kind of your own.',
    ]);
    const restated = compose(`${DIFFER}kind Crate is Lidded, Hinged { :open false }`);
    expect(restated.said).toEqual([
      [
        'shop.sprout:3:32',
        '`:open` holds boolean in `Lidded` and integer 0 to 9 in `Hinged`, so restating it cannot make them one property.',
        'Compose only one of them, or give one of them another name in a kind of your own.',
      ],
    ]);
  });

  it('counts a remembered and a plain declaration of one name as disagreeing', () => {
    const { said } = compose(
      'kind Lidded { :open true }\nkind Futon { :remembers [open: true] }\nkind Crate is Lidded, Futon { :open false }',
    );
    expect(said.map(([, message]) => message)).toEqual([
      '`:open` holds boolean in `Lidded` and boolean (remembered) in `Futon`, so restating it cannot make them one property.',
    ]);
  });

  it('makes a restating kind the origin, so composing it beside what it restated collides again', () => {
    // `Crate` restates `sprout.Container`'s `:capacity`, and is its
    // origin from then on: composing both is two origins.
    const { said } = compose(
      'kind Crate is sprout.Container { :capacity 40 }\nworld shop is sprout.World { object box is Crate, sprout.Container }',
    );
    // `:open` reaches `box` by both paths from one origin, and is one.
    expect(said.map(([, message]) => message)).toEqual([
      '`box` gets `:capacity` from both `Crate` and `sprout.Container`, which are two claims on one slot.',
    ]);
  });
});

describe('a restatement keeps the composed type', () => {
  it('keeps `sprout.Container`’s range for `:capacity 40`', () => {
    const { kind, said } = compose('kind Crate is sprout.Container { :capacity 40 }');
    expect(said).toEqual([]);
    expect(kind!.properties.get('capacity')!.type).toEqual(integer(0, 99));
  });

  it('keeps the enum for a bare option', () => {
    const { kind, said } = compose(
      'kind Warded { :ward sprout.Ward default oak }\nkind Gate is Warded { :ward silver }',
    );
    expect(said).toEqual([]);
    expect(showType(kind!.properties.get('ward')!.type)).toBe('Ward');
  });

  it('refuses a change of type at what was written, naming the kind it came from', () => {
    const { said } = compose('kind Crate is sprout.Container { :capacity 40 min 0 max 50 }');
    expect(said).toEqual([
      [
        'shop.sprout:1:51',
        '`:capacity` holds integer 0 to 99 in `sprout.Container`, and whatever composes it keeps that type.',
        'Restate only its default, as in `:capacity 40`; a property holding something else takes a name of its own.',
      ],
    ]);
  });
});

describe('`contains` and `contains actors` are idempotent, so they hold across the closure', () => {
  const HOLDERS = 'kind Box { contains }\nkind Room { contains actors }\n';

  it('holds what anything it composes holds', () => {
    const { kind } = compose(`${HOLDERS}kind Crate is Box { }`);
    expect([kind!.contains, kind!.containsActors]).toEqual([true, false]);
  });

  it('is a place when anything it composes is, which implies holding', () => {
    const { kind } = compose(`${HOLDERS}kind Hall is Box, Room { }`);
    expect([kind!.contains, kind!.containsActors]).toEqual([true, true]);
    expect(compose(`${HOLDERS}kind Hall is Room { }`).kind!.contains).toBe(true);
  });

  it('holds nothing when nothing says so', () => {
    const { kind } = compose(`${HOLDERS}kind Brick { }`);
    expect([kind!.contains, kind!.containsActors]).toEqual([false, false]);
  });

  it('takes its own line as well as what it composes', () => {
    const { kind } = compose(`${HOLDERS}kind Den is Box { contains actors }`);
    expect([kind!.contains, kind!.containsActors]).toEqual([true, true]);
  });
});

describe('what a composition list may not name', () => {
  it('tells `onUnknown` of a kind nothing declares, and composes nothing', () => {
    const { kind, unknown, said } = compose('kind Crate is Missing, sprout.Gone { }');
    expect(kind).toBeNull();
    expect(unknown.map((w) => locationOf(w.at))).toEqual(['shop.sprout:1:15', 'shop.sprout:1:24']);
    expect(said).toEqual([]);
  });

  it('says so in words a person can act on', () => {
    const [bare, qualified] = (
      parseDeclarations(
        new SourceFile('k.sprout', 'kind K is Missing, victorian.Voice { }'),
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
    expect(unknownKind(composes('kind K is Wodden { }'), 'shop', kinds)).toEqual({
      message: 'Nothing here is a `Wodden`. Did you mean `Wooden`?',
      remedy: 'Write `Wooden`, or declare `Wodden` with `kind Wodden { … }`.',
    });
    expect(unknownKind(composes('kind K is Contianer { }'), 'shop', kinds).message).toBe(
      'Nothing here is a `Contianer`. Did you mean `Container`?',
    );
    expect(unknownKind(composes('kind K is victorian.Vioce { }'), 'shop', kinds)).toEqual({
      message: 'Nothing here is a `victorian.Vioce`. Did you mean `victorian.Voice`?',
      remedy: 'Write `victorian.Voice`.',
    });
    // A library's kinds are not offered for a bare name, nor a guess too far off.
    expect(unknownKind(composes('kind K is Vioce { }'), 'shop', kinds).message).toBe(
      'Nothing here is a `Vioce`.',
    );
    expect(unknownKind(composes('kind K is Barrel { }'), 'shop', kinds).message).toBe(
      'Nothing here is a `Barrel`.',
    );
  });

  it('refuses it itself when nobody asked to be told', () => {
    const diagnostics = new Diagnostics();
    const [crate] = parseDeclarations(
      new SourceFile('k.sprout', 'kind Crate is Missing { }'),
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
      { enums: new EnumTable(), kinds, world: 'shop', diagnostics },
    );
    expect(kind).toBeNull();
    expect(diagnostics.refusals.map((d) => [locationOf(d.at), d.message])).toEqual([
      ['k.sprout:1:15', 'Nothing here is a `Missing`.'],
    ]);
  });

  it('does not read a body whose composition failed, since a restatement would read as new', () => {
    // `:ward silver` restates a `sprout.Ward` property only if `Warded`
    // is there to say so; read alone it would be refused for naming no enum.
    const { said, unknown } = compose('kind Gate is Warded { :ward silver }');
    expect(unknown).toHaveLength(1);
    expect(said).toEqual([]);
  });

  it('refuses the same kind twice, at the second', () => {
    const { said } = compose('kind Box { }\nkind Crate is Box, Box { }');
    expect(said).toEqual([
      ['shop.sprout:2:20', '`Crate` composes `Box` twice.', 'Compose it once.'],
    ]);
  });

  it('names a kind written twice as it was written, bare or qualified', () => {
    // A bare name nothing declares resolves to the standard library's
    // spelling, which the author never wrote and must not be shown.
    const unknown = compose('kind Crate is Wodden, Wodden { }');
    expect(unknown.unknown).toHaveLength(1);
    expect(unknown.said).toEqual([
      ['shop.sprout:1:23', '`Crate` composes `Wodden` twice.', 'Compose it once.'],
    ]);
    expect(compose('kind Crate is sprout.Container, sprout.Container { }').said).toEqual([
      ['shop.sprout:1:33', '`Crate` composes `sprout.Container` twice.', 'Compose it once.'],
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
      new SourceFile('k.sprout', 'kind Crate is Broken { }'),
      diagnostics,
    );
    const kind = composeKind(
      {
        library: 'shop',
        name: 'Crate',
        composes: (crate as KindDeclaration).composes,
        members: [],
      },
      { enums: new EnumTable(), kinds: failed, world: 'shop', diagnostics },
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
    const [kind] = parseDeclarations(new SourceFile('k.sprout', 'kind C is A { }'), diagnostics);
    composeKind(
      { library: 'shop', name: 'C', composes: (kind as KindDeclaration).composes, members: [] },
      { enums: new EnumTable(), kinds: looping, world: 'shop', diagnostics },
    );
    expect(diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'k.sprout:1:11',
        '`A` composes itself, through `B` and `sprout.C`.',
        'Take `A` out of what `C` composes: a kind cannot be made of itself.',
      ],
    ]);
  });
});

describe('`sprout.World` is composed by a world and nothing else', () => {
  it('refuses a bare `World` that means it, with the words the shape tier uses', () => {
    const { said, kind } = compose('world shop is sprout.World { object hall is World }');
    expect(said).toEqual([
      [
        'shop.sprout:1:45',
        '`hall` composes `sprout.World`, which only a world may.',
        'Take it out of what `hall` composes: it would make a thing into a world, and a bundle has one world, written `world <name> is sprout.World { … }`.',
      ],
    ]);
    // The rest of it is composed: nothing else was wrong with it.
    expect(kind!.order).toEqual(['shop.hall']);
  });

  it('knows it by identity even when no standard library travelled', () => {
    const { said } = compose('kind Hall is World { }', { sprout: '' });
    expect(said.map(([, message]) => message)).toEqual([
      '`Hall` composes `sprout.World`, which only a world may.',
    ]);
  });

  it('leaves `sprout.World` written out to the shape tier, which has refused it once already', () => {
    expect(compose('kind Hall is sprout.World { }').said).toEqual([]);
  });

  it('lets a world’s own `World` be composed, since it is some other kind', () => {
    const { said, kind } = compose('kind World { }\nkind Hall is World { }');
    expect(said).toEqual([]);
    expect(kind!.order).toEqual(['shop.World', 'shop.Hall']);
  });

  it('is composed where the composer may, in the order written like any kind', () => {
    const { said, kind } = compose('kind Voice { }\nkind Shop is Voice, sprout.World { }', {
      mayComposeWorld: true,
    });
    expect(said).toEqual([]);
    expect(kind!.order).toEqual(['shop.Voice', 'sprout.World', 'shop.Shop']);
    // What it declares holds, as anything composed does.
    expect(kind!.contains).toBe(true);
  });

  it('is said to be missing from the standard library where one may compose it and none did', () => {
    const { kind, unknown } = compose('kind Shop is sprout.World { }', {
      sprout: '',
      mayComposeWorld: true,
    });
    expect(kind).toBeNull();
    expect(unknown.map((written) => written.name.text)).toEqual(['World']);
  });
});

describe('`without` leaves out one contribution, naming the member and the kind it comes from', () => {
  /** A lamp two kinds deep, so its closure holds more than what it wrote. */
  const LAMPS = 'kind Light { :lit false }\nkind Lantern is Light { }\n';

  it('refuses a kind the composer does not compose, at the kind', () => {
    const { kind, said } = compose(
      `${LAMPS}kind Crate is sprout.Container {\n  without changed :lit from Light\n}`,
    );
    expect(said).toEqual([
      [
        'shop.sprout:4:29',
        '`Crate` does not compose `Light`, so there is nothing of its to leave out.',
        'After `from`, name a kind `Crate` composes, or take this line out.',
      ],
    ]);
    // Only the line is refused; the kind composes, having left nothing out.
    expect(kind!.suppressed).toEqual([]);
  });

  it('refuses the composer itself, whose own members are dropped by taking them out', () => {
    const { said } = compose(`${LAMPS}kind Safety is Lantern {\n  without depart from Safety\n}`);
    expect(said).toEqual([
      [
        'shop.sprout:4:23',
        '`Safety` cannot leave out its own `depart`.',
        '`without` leaves out what a kind `Safety` composes contributes. To drop its own, take `depart` out of `Safety`.',
      ],
    ]);
  });

  it('refuses a kind nothing declares, with the kind it most likely meant', () => {
    const { said } = compose(`${LAMPS}kind Safety is Lantern {\n  without depart from Lantrn\n}`);
    expect(said.map(([, message]) => message)).toEqual([
      'Nothing here is a `Lantrn`. Did you mean `Lantern`?',
    ]);
  });

  it('reaches any kind in the closure, and then asks whether that kind declares the member', () => {
    // `Light` is reached through `Lantern`, so the only question left is
    // the member, and `Light` declares none of these: every form is
    // refused at the member, saying so.
    for (const [member, column] of [
      ['changed :lit', 11],
      ['on :stir', 11],
      ['depart', 11],
      ['release', 11],
      ['accept', 11],
      ['as target for unlock', 11],
    ] as const) {
      const { kind, said } = compose(
        `${LAMPS}message :stir\nkind Safety is Lantern {\n  without ${member} from Light\n}`,
      );
      expect(said, member).toEqual([
        [
          `shop.sprout:5:${column}`,
          `\`Light\` has no \`${member}\` to leave out.`,
          `\`without\` names a member the kind after \`from\` declares itself. Take this line out, or name the kind that declares \`${member}\`.`,
        ],
      ]);
      expect(kind!.suppressed, member).toEqual([]);
    }
  });

  it('is read on a world, where `sprout.World` is in the closure like any kind', () => {
    const { said } = compose('kind Shop is sprout.World {\n  without depart from sprout.World\n}', {
      mayComposeWorld: true,
    });
    expect(said.map(([, message]) => message)).toEqual([
      '`sprout.World` has no `depart` to leave out.',
    ]);
  });

  it('names `sprout.World` as not composed on anything that may not compose it', () => {
    const { said } = compose('kind Hall {\n  without depart from sprout.World\n}');
    expect(said.map(([, message]) => message)).toEqual([
      '`Hall` does not compose `sprout.World`, so there is nothing of its to leave out.',
    ]);
  });

  it('records a guard the kind after `from` writes itself, and refuses one it only composes', () => {
    const GUARDED = `${LAMPS}kind Fragile { depart (to) { refuse "It would break." } }\nkind Vase is Fragile { }\n`;
    const left = compose(`${GUARDED}kind Urn is Vase {\n  without depart from Fragile\n}`);
    expect(left.said).toEqual([]);
    expect(left.kind!.suppressed.map((one) => one.source)).toEqual(['shop.Fragile']);
    expect(left.kind!.guards.depart).toEqual([]);

    const through = compose(`${GUARDED}kind Urn is Vase {\n  without depart from Vase\n}`);
    expect(through.said.map(([, message]) => message)).toEqual([
      '`Vase` has no `depart` to leave out.',
    ]);
  });

  it('records nothing on a kind that writes none', () => {
    expect(compose(`${LAMPS}kind Safety is Lantern { }`).kind!.suppressed).toEqual([]);
  });
});

describe('a passage is one per name: the composer’s own, else the one that is not `default`', () => {
  /** A standard library whose world and place carry stock lines, as `sprout` does. */
  const VOICED = `kind World {
  contains
  passage nothing_happens default { Nothing much comes of that. }
}
kind Place {
  contains actors
  passage arrives default { {item} arrives. }
  passage leaves default { {item} leaves. }
}
`;
  const origins = (kind: { passages: ReadonlyMap<string, { origin: string }> }) =>
    Object.fromEntries([...kind.passages].map(([name, passage]) => [name, passage.origin]));

  it('gives a kind what it composes, and its own line over a composed default', () => {
    const { kind, said } = compose(
      'kind Plain { passage taken default { You take it. } passage dropped default { Down. } }\nkind Bold is Plain { passage taken { You seize it. } }',
    );
    expect(said).toEqual([]);
    expect(origins(kind!)).toEqual({ taken: 'shop.Bold', dropped: 'shop.Plain' });
  });

  it('lets an object write its own over a kind’s line, with the object as its origin', () => {
    const { kind, said } = compose(
      'kind Mirror { passage greeting { Old glass. } }\nworld shop is sprout.World { object mirror is Mirror { passage greeting { Clouded. } } }',
    );
    expect(said).toEqual([]);
    expect(origins(kind!)).toEqual({ greeting: 'shop.mirror' });
  });

  it('lets the world write its own `nothing_happens` over `sprout.World`’s', () => {
    const { kind, said } = compose(
      'kind Shop is sprout.World { passage nothing_happens { The shop does not notice. } }',
      { sprout: VOICED, mayComposeWorld: true },
    );
    expect(said).toEqual([]);
    expect(kind!.passages.get('nothing_happens')).toMatchObject({
      origin: 'shop.Shop',
      yields: false,
    });
  });

  it('takes a register’s line that is not a default over `sprout.Place`’s, and the rest from the library', () => {
    const { kind, said } = compose(
      'kind Hushed { passage arrives { {item} slips in. } }\nworld shop is sprout.World { object hall is sprout.Place, Hushed { } }',
      { sprout: VOICED },
    );
    expect(said).toEqual([]);
    expect(origins(kind!)).toEqual({ arrives: 'shop.Hushed', leaves: 'sprout.Place' });
  });

  it('takes a register library’s default over `sprout.Place`’s, still a default, and the rest from the library', () => {
    const { kind, said } = compose(
      'world shop is sprout.World { object hall is sprout.Place, victorian.Hushed { } }',
      {
        sprout: VOICED,
        libraries: { victorian: 'kind Hushed { passage arrives default { {item} slips in. } }' },
      },
    );
    expect(said).toEqual([]);
    expect(origins(kind!)).toEqual({ arrives: 'victorian.Hushed', leaves: 'sprout.Place' });
    expect(kind!.passages.get('arrives')!.yields).toBe(true);
  });

  it('refuses two defaults at the kind as written, naming a library’s kind with its library', () => {
    const { kind, said } = compose(
      'kind Quiet { passage arrives default { {item} is here. } }\nworld shop is sprout.World { object hall is sprout.Place, Quiet { } }',
      { sprout: VOICED },
    );
    expect(said).toEqual([
      [
        'shop.sprout:2:59',
        '`hall` gets a default passage `arrives` from both `sprout.Place` and `Quiet`, and a thing speaks each line in one voice: a default gives way only to a passage that is not one, or the standard library’s to another library’s.',
        'Write its own `passage arrives { … }` in `hall`, which is then the one that applies, or compose only one of them.',
      ],
    ]);
    // A collision is refused and the kind still composes, so nothing further is said of it.
    expect(kind).not.toBeNull();
  });

  it('refuses two sources that are not defaults, and not the composer’s own line written once', () => {
    const { said } = compose(
      'kind Plain { passage taken { A. } }\nkind Terse { passage taken { B. } }\nkind Porter is Plain, Terse {\n  passage greeting { Hello. }\n}',
    );
    expect(said.map(([at, message]) => [at, message])).toEqual([
      [
        'shop.sprout:3:23',
        '`Porter` gets the passage `taken` from both `Plain` and `Terse`, and a thing speaks each line in one voice.',
      ],
    ]);
  });

  it('refuses a passage written twice in the composer’s own body', () => {
    const { said } = compose(
      'kind Mirror { }\nworld shop is sprout.World { object mirror is Mirror {\n  passage greeting { A. }\n  passage greeting { B. }\n} }',
    );
    expect(said.map(([at, message]) => [at, message])).toEqual([
      ['shop.sprout:4:11', '`mirror` writes the passage `greeting` twice.'],
    ]);
  });
});
