import { describe, expect, it } from 'vitest';

import type { KindDeclaration, KindExpr, WorldDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseDeclarations } from '../syntax/parse.js';
import { SourceFile, textOf } from '../source/source.js';
import { EnumTable } from './enums.js';
import { KindTable, type KindRef } from './kinds.js';
import {
  ACTOR,
  aVisitorMade,
  checkActors,
  checkVisitorBody,
  checkVisitorKind,
  isActor,
  isVisitorKind,
  VISITOR,
} from './actors.js';
import { resolveContents } from './contents.js';
import { resolveObjects } from './objects.js';
import { placeObjects } from './tree.js';

/**
 * Every kind here, composed: the standard library's, the shop's own, and
 * another library's; and what their bodies give.
 */
const { KINDS, CONTENTS } = (() => {
  const diagnostics = new Diagnostics();
  const table = new KindTable();
  const byLibrary = new Map<string, KindDeclaration[]>();
  for (const [library, text] of Object.entries({
    sprout: [
      'kind World { contains }',
      'kind Actor { contains :capacity 8 }',
      'kind Visitor is Actor { }',
      'kind Place { contains actors }',
    ].join('\n'),
    shop: [
      'kind Creature is sprout.Actor { }',
      'kind Cat is Creature { }',
      'kind Person is Creature, sprout.Visitor { }',
      'kind Porter is sprout.Actor { }',
      'kind Hall is sprout.Place { }',
      'kind Basket { contains }',
      'kind Hutch { contains object rabbit is Creature }',
    ].join('\n'),
    victorian: 'kind Gent is sprout.Visitor { }\nkind Butler is sprout.Actor { }\nkind Voice { }',
  })) {
    const declared = parseDeclarations(new SourceFile(`${library}.sprout`, text), diagnostics);
    const kinds = declared.filter((d): d is KindDeclaration => d.kind === 'kind');
    byLibrary.set(library, kinds);
    table.add(library, kinds, diagnostics);
  }
  const enums = new EnumTable();
  table.resolve('shop', enums, diagnostics);
  const contents = resolveContents(byLibrary, { enums, kinds: table, world: 'shop', diagnostics });
  expect(diagnostics.all.map((d) => d.message)).toEqual([]);
  return { KINDS: table, CONTENTS: contents };
})();

const kind = (library: string, name: string): KindRef => KINDS.qualified(library, name)!;

/** `visitors are <written>` as the parser reads it, for its span. */
function written(text: string): KindExpr {
  const [world] = parseDeclarations(
    new SourceFile('w.sprout', `world shop is sprout.World { visitors are ${text} }`),
    new Diagnostics(),
  ) as WorldDeclaration[];
  const member = world!.members.find((m) => m.kind === 'visitors-are');
  if (member?.kind !== 'visitors-are') throw new Error(`no visitor kind in ${text}`);
  return member.visitor;
}

/** What `checkVisitorKind` says of `text` naming `named`, as [where, message, remedy]. */
function checked(text: string, named: KindRef) {
  const diagnostics = new Diagnostics();
  const ok = checkVisitorKind(written(text), named, 'shop', diagnostics);
  return { ok, told: diagnostics.refusals.map((d) => [textOf(d.at), d.message, d.remedy]) };
}

describe('an actor is whatever composes `sprout.Actor`', () => {
  it('is named with its library', () => expect(ACTOR).toBe('sprout.Actor'));

  it('is `sprout.Actor` itself, and anything composing it however far down', () => {
    expect(isActor(kind('sprout', 'Actor'))).toBe(true);
    expect(isActor(kind('sprout', 'Visitor'))).toBe(true);
    expect(isActor(kind('shop', 'Creature'))).toBe(true);
    expect(isActor(kind('shop', 'Cat'))).toBe(true);
    expect(isActor(kind('shop', 'Person'))).toBe(true);
    expect(isActor(kind('victorian', 'Gent'))).toBe(true);
  });

  it('is not a place, nor a container, for holding things or people', () => {
    expect(isActor(kind('shop', 'Hall'))).toBe(false);
    expect(isActor(kind('shop', 'Basket'))).toBe(false);
    expect(isActor(kind('sprout', 'World'))).toBe(false);
  });
});

describe('a kind for a person is whatever composes `sprout.Visitor`', () => {
  it('is named with its library', () => expect(VISITOR).toBe('sprout.Visitor'));

  it('is `sprout.Visitor` itself, and anything composing it', () => {
    expect(isVisitorKind(kind('sprout', 'Visitor'))).toBe(true);
    expect(isVisitorKind(kind('shop', 'Person'))).toBe(true);
    expect(isVisitorKind(kind('victorian', 'Gent'))).toBe(true);
  });

  it('is not every actor: what an NPC is made of, or what a person shares with one, is not', () => {
    expect(isVisitorKind(kind('sprout', 'Actor'))).toBe(false);
    expect(isVisitorKind(kind('shop', 'Creature'))).toBe(false);
    expect(isVisitorKind(kind('shop', 'Porter'))).toBe(false);
    expect(isVisitorKind(kind('shop', 'Hall'))).toBe(false);
  });
});

describe('the visitor kind is the world’s own, composing `sprout.Visitor`', () => {
  it('takes a kind of the world’s own composing `sprout.Visitor`, saying nothing', () => {
    expect(checked('Person', kind('shop', 'Person'))).toEqual({ ok: true, told: [] });
  });

  it('refuses one that is not an actor, at the kind as written', () => {
    expect(checked('Hall', kind('shop', 'Hall'))).toEqual({
      ok: false,
      told: [
        [
          'Hall',
          "`Hall` does not compose `sprout.Visitor`, and a world's visitors are made of a kind that does.",
          'Write `kind Person is sprout.Visitor { … }` and `visitors are Person`, or name a kind that composes `sprout.Visitor`.',
        ],
      ],
    });
  });

  it('refuses an actor that is not for a person, suggesting a kind for people that shares it', () => {
    for (const name of ['Creature', 'Porter']) {
      expect(checked(name, kind('shop', name))).toEqual({
        ok: false,
        told: [
          [
            name,
            `\`${name}\` does not compose \`sprout.Visitor\`, and a world's visitors are made of a kind that does.`,
            `Write \`kind Person is ${name}, sprout.Visitor { }\` and \`visitors are Person\`, so a person has what \`${name}\` gives.`,
          ],
        ],
      });
    }
    // An actor kind already called `Person` is told of a kind by another name.
    expect(checked('Person', kind('shop', 'Porter')).told[0]![2]).toBe(
      'Write `kind Guest is Person, sprout.Visitor { }` and `visitors are Guest`, so a person has what `Person` gives.',
    );
  });

  it('refuses `sprout.Visitor` itself, and `sprout.Actor`, since the world’s own kind is where a person is written', () => {
    for (const name of ['Visitor', 'Actor']) {
      expect(checked(`sprout.${name}`, kind('sprout', name))).toEqual({
        ok: false,
        told: [
          [
            `sprout.${name}`,
            `\`sprout.${name}\` belongs to the library \`sprout\`. A world's visitors are made of a kind of its own.`,
            'Declare one that composes `sprout.Visitor`, as `kind Person is sprout.Visitor { … }`, and write `visitors are Person`.',
          ],
        ],
      });
    }
  });

  it('refuses another library’s kind, suggesting it be composed when it is for a person', () => {
    expect(checked('victorian.Gent', kind('victorian', 'Gent')).told[0]![2]).toBe(
      'Declare one that composes `victorian.Gent`, as `kind Person is victorian.Gent { … }`, and write `visitors are Person`.',
    );
    for (const name of ['Butler', 'Voice']) {
      expect(checked(`victorian.${name}`, kind('victorian', name)).told[0]![2]).toBe(
        'Declare one that composes `sprout.Visitor`, as `kind Person is sprout.Visitor { … }`, and write `visitors are Person`.',
      );
    }
  });
});

/** What `checkVisitorBody` says of `text`, one kind declaration, as [where, message, remedy]. */
function bodyOf(text: string) {
  const parsing = new Diagnostics();
  const [declared] = parseDeclarations(
    new SourceFile('k.sprout', text),
    parsing,
  ) as KindDeclaration[];
  expect(parsing.all.map((d) => d.message)).toEqual([]);
  const diagnostics = new Diagnostics();
  checkVisitorBody(declared!, diagnostics);
  expect(diagnostics.warnings).toEqual([]);
  return diagnostics.refusals.map((d) => [textOf(d.at), d.message, d.remedy]);
}

/** The words `Person`'s body is told for a member that `does`, written on a shared kind as `written`. */
function behaviour(does: string, written: string, kept = ' ') {
  return [
    `\`Person\` is what a person is made of, and a person acts by typing, so its own body does not ${does}.`,
    `Write it on a kind \`Person\` composes: \`kind Creature is sprout.Actor { ${written} … }\` and \`kind Person is Creature, sprout.Visitor {${kept}}\`.`,
  ];
}

describe('the visitor kind’s own body declares no behaviour', () => {
  it('takes what a person has, holds and is described by, and what it leaves out, saying nothing', () => {
    const text = [
      'kind Person is Creature, sprout.Visitor {',
      '  :stamina 3 min 0 max 9',
      '  contains',
      '  passage tired { You are too tired. }',
      '  without as actor for wave from Creature',
      '}',
    ];
    expect(bodyOf(text.join('\n'))).toEqual([]);
  });

  it('refuses a play at its head, naming the role and verb it plays', () => {
    expect(
      bodyOf('kind Person is sprout.Visitor { as actor for pull { do { say "Hup." } } }'),
    ).toEqual([
      ['as actor for pull', ...behaviour('play `as actor for pull`', 'as actor for pull')],
    ]);
  });

  it('refuses each consent guard at the guard, with its parameters as written', () => {
    const text = [
      'kind Person is sprout.Visitor {',
      '  depart (there) { }',
      '  release (item, to) { }',
      '  accept (thing, from) { allow }',
      '}',
    ];
    expect(
      bodyOf(text.join('\n')).map(([at, message, remedy]) => [at!.split(' ')[0], message, remedy]),
    ).toEqual([
      ['depart', ...behaviour('guard a move with `depart`', 'depart (there)')],
      ['release', ...behaviour('guard a move with `release`', 'release (item, to)')],
      ['accept', ...behaviour('guard a move with `accept`', 'accept (thing, from)')],
    ]);
  });

  it('refuses a handler, a hook and a pass rule, each at the member', () => {
    const text = [
      'kind Person is sprout.Visitor {',
      '  on :stir { }',
      '  changed :stamina { }',
      '  pass any (true)',
      '}',
    ];
    expect(
      bodyOf(text.join('\n')).map(([at, message, remedy]) => [at!.split(' ')[0], message, remedy]),
    ).toEqual([
      ['on', ...behaviour('answer a message with `on :stir`', 'on :stir')],
      ['changed', ...behaviour('watch a property with `changed :stamina`', 'changed :stamina')],
      ['pass', ...behaviour('say what passes with `pass any`', 'pass any (…)')],
    ]);
  });

  it('keeps what else the body declares in the remedy’s braces', () => {
    const told = bodyOf('kind Person is sprout.Visitor { :stamina 3  depart (to) { } }');
    expect(told).toEqual([
      ['depart (to) { }', ...behaviour('guard a move with `depart`', 'depart (to)', ' … ')],
    ]);
  });

  it('names a shared kind other than the visitor kind itself', () => {
    const [[, message, remedy]] = bodyOf('kind Creature is sprout.Visitor { depart (to) { } }') as [
      [string, string, string],
    ];
    expect(message).toMatch(/^`Creature` is what a person is made of/);
    expect(remedy).toBe(
      'Write it on a kind `Creature` composes: `kind Being is sprout.Actor { depart (to) … }` and `kind Creature is Being, sprout.Visitor { }`.',
    );
  });
});

/**
 * What `checkActors` says of the objects written in `body`, the body of a
 * world made of `world`, as [where, message, remedy]. The objects must
 * place.
 */
function actorsIn(body: string, world: KindRef | null = kind('shop', 'Basket')) {
  const placing = new Diagnostics();
  const root = parseDeclarations(
    new SourceFile('o.sprout', `world shop is sprout.World {\n${body}\n}`),
    placing,
  ).find((d): d is WorldDeclaration => d.kind === 'world')!;
  const objects = resolveObjects(
    'shop',
    root,
    { enums: new EnumTable(), kinds: KINDS, diagnostics: placing },
    CONTENTS,
  );
  const tree = placeObjects(objects, { world: 'shop', diagnostics: placing });
  expect(placing.all.map((d) => d.message)).toEqual([]);
  const diagnostics = new Diagnostics();
  checkActors({ tree, objects, world, diagnostics });
  return diagnostics.all.map((d) => [textOf(d.at), d.message, d.remedy]);
}

/** The remedy for a declared or spawned visitor, which names no kind of the world's. */
const FOR_AN_NPC =
  'For an NPC, use a kind that composes `sprout.Actor` and not `sprout.Visitor`; to share it with the visitors, write `kind Creature is sprout.Actor { … }` and `kind Person is Creature, sprout.Visitor { }`.';

/** What is said of an object named `name` that is made for a person. */
const declaredVisitor = (name: string): string =>
  `\`${name}\` composes \`sprout.Visitor\`, what a person is made of, and nothing declares a visitor: each one is a person who arrives.`;

describe('nothing declares a visitor, and every NPC stands in a place', () => {
  it('names why something made for a person may not be declared or spawned', () => {
    expect(aVisitorMade('guest', 'declares')).toEqual({
      message: declaredVisitor('guest'),
      remedy: FOR_AN_NPC,
    });
    expect(aVisitorMade('Person', 'spawns')).toEqual({
      message:
        '`Person` composes `sprout.Visitor`, what a person is made of, and nothing spawns a visitor: each one is a person who arrives.',
      remedy: FOR_AN_NPC,
    });
    expect(aVisitorMade('sprout.Visitor', 'spawns').message).toBe(
      '`sprout.Visitor` is what a person is made of, and nothing spawns a visitor: each one is a person who arrives.',
    );
  });

  it('accepts every actor not made for a person as an NPC, wherever actors stand', () => {
    const body = [
      'object hall is Hall {',
      '  object nook is Hall { object dog is Creature }',
      '  object basket is Basket { object ball is Basket }',
      '  object cat is Cat',
      '  object porter is Porter',
      '  object butler is victorian.Butler',
      '}',
      'object mouse is Creature',
    ].join('\n');
    expect(actorsIn(body, kind('shop', 'Hall'))).toEqual([]);
  });

  it('refuses an object made for a person at its name, and says nothing more of it', () => {
    const body = [
      'object hall is Hall {',
      '  object basket is Basket { object guest is Person }',
      '  object gent is victorian.Gent',
      '}',
    ].join('\n');
    expect(actorsIn(body)).toEqual([
      ['guest', declaredVisitor('guest'), FOR_AN_NPC],
      ['gent', declaredVisitor('gent'), FOR_AN_NPC],
    ]);
  });

  it('refuses an NPC written in the body of what holds no actors, at its name', () => {
    const body = ['object hall is Hall {', '  object basket is Basket { object cat is Cat }', '}'];
    expect(actorsIn(body.join('\n'))).toEqual([
      [
        'cat',
        '`basket` holds no actors, so `cat` cannot stand in it.',
        'Write `cat` inside the braces of a place, or make `basket` one: compose `sprout.Place`, or write `contains actors` in its body.',
      ],
    ]);
  });

  it('refuses an NPC directly in a world that holds no actors, naming its first place', () => {
    const body = ['object yard is Basket {', '  object hall is Hall', '}', 'object cat is Cat'];
    expect(actorsIn(body.join('\n'))).toEqual([
      [
        'cat',
        '`shop` is the world, which holds no actors, so `cat` cannot stand directly in it.',
        'Write `cat` inside the braces of a place in the world, such as `yard.hall`.',
      ],
    ]);
    expect(actorsIn('object cat is Cat')[0]![2]).toBe(
      'Declare a place in the world, an object that composes `sprout.Place` or writes `contains actors` in its body, and write `cat` inside its braces.',
    );
  });

  it('refuses what a kind gives each instance as it would one written there, at the kind, once', () => {
    const body = ['object hall is Hall {', '  object hutch is Hutch', '  object pen is Hutch', '}'];
    expect(actorsIn(body.join('\n'))).toEqual([
      [
        'rabbit',
        '`hutch` holds no actors, so `rabbit` cannot stand in it.',
        'Write `rabbit` inside the braces of a place, or make `hutch` one: compose `sprout.Place`, or write `contains actors` in its body.',
      ],
      [
        'rabbit',
        '`pen` holds no actors, so `rabbit` cannot stand in it.',
        'Write `rabbit` inside the braces of a place, or make `pen` one: compose `sprout.Place`, or write `contains actors` in its body.',
      ],
    ]);
  });

  it('accepts what a kind gives an instance whose own body holds actors', () => {
    const body = ['object hall is Hall {', '  object hutch is Hutch { contains actors }', '}'];
    expect(actorsIn(body.join('\n'))).toEqual([]);
  });

  it('says nothing of where an NPC stands that an absent world kind would decide', () => {
    expect(actorsIn('object porter is Porter', null)).toEqual([]);
    // With no world kind to stand in, something made for a person is still refused.
    expect(actorsIn('object guest is Person', null).map(([at]) => at)).toEqual(['guest']);
  });
});
