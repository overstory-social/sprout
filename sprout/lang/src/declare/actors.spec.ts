import { describe, expect, it } from 'vitest';

import type { KindDeclaration, KindExpr, WorldDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseDeclarations } from '../syntax/parse.js';
import { SourceFile, textOf } from '../source/source.js';
import { EnumTable } from './enums.js';
import { KindTable, type KindRef } from './kinds.js';
import { ACTOR, checkActors, checkVisitorKind, isActor, isNpc, notAnNpc } from './actors.js';
import { objectsIn, resolveObjects } from './objects.js';
import { placeObjects } from './tree.js';

/** Every kind here, composed: the standard library's, the shop's own, and another library's. */
const KINDS = (() => {
  const diagnostics = new Diagnostics();
  const table = new KindTable();
  for (const [library, text] of Object.entries({
    sprout:
      'kind World { contains }\nkind Actor { contains :capacity 8 }\nkind Place { contains actors }',
    shop: [
      'kind Creature is sprout.Actor { :capacity 4 }',
      'kind Cat is Creature { }',
      'kind Porter is sprout.Actor { }',
      'kind Hall is sprout.Place { }',
      'kind Basket { contains }',
    ].join('\n'),
    victorian: 'kind Gent is sprout.Actor { }\nkind Voice { }',
  })) {
    table.add(
      library,
      parseDeclarations(new SourceFile(`${library}.sprout`, text), diagnostics).filter(
        (d): d is KindDeclaration => d.kind === 'kind',
      ),
      diagnostics,
    );
  }
  table.resolve('shop', new EnumTable(), diagnostics);
  expect(diagnostics.all.map((d) => d.message)).toEqual([]);
  return table;
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
    expect(isActor(kind('shop', 'Creature'))).toBe(true);
    expect(isActor(kind('shop', 'Cat'))).toBe(true);
    expect(isActor(kind('victorian', 'Gent'))).toBe(true);
  });

  it('is not a place, nor a container, for holding things or people', () => {
    expect(isActor(kind('shop', 'Hall'))).toBe(false);
    expect(isActor(kind('shop', 'Basket'))).toBe(false);
    expect(isActor(kind('sprout', 'World'))).toBe(false);
  });
});

describe('an NPC is an object composing the visitor kind', () => {
  const creature = kind('shop', 'Creature');

  it('is made of the visitor kind, or of a kind that composes it', () => {
    expect(isNpc(creature, creature)).toBe(true);
    expect(isNpc(kind('shop', 'Cat'), creature)).toBe(true);
  });

  it('is not every actor: one composing `sprout.Actor` beside the visitor kind is not', () => {
    expect(isNpc(kind('shop', 'Porter'), creature)).toBe(false);
    expect(isActor(kind('shop', 'Porter'))).toBe(true);
  });

  it('is not what the visitor kind composes', () => {
    expect(isNpc(kind('sprout', 'Actor'), creature)).toBe(false);
  });
});

describe('the visitor kind is the world’s own, and an actor', () => {
  it('takes a kind of the world’s own composing `sprout.Actor`, saying nothing', () => {
    expect(checked('Creature', kind('shop', 'Creature'))).toEqual({ ok: true, told: [] });
    expect(checked('Cat', kind('shop', 'Cat'))).toEqual({ ok: true, told: [] });
  });

  it('refuses one that is not an actor, at the kind as written', () => {
    expect(checked('Hall', kind('shop', 'Hall'))).toEqual({
      ok: false,
      told: [
        [
          'Hall',
          "`Hall` is not an actor, and a world's visitors are made of one.",
          'Write `kind Visitor is sprout.Actor { … }` and `visitors are Visitor`, or name a kind that composes `sprout.Actor`.',
        ],
      ],
    });
  });

  it('refuses `sprout.Actor` itself, since the world’s own kind is where a person is written', () => {
    expect(checked('sprout.Actor', kind('sprout', 'Actor'))).toEqual({
      ok: false,
      told: [
        [
          'sprout.Actor',
          "`sprout.Actor` belongs to the library `sprout`. A world's visitors are made of a kind of its own.",
          'Declare one that composes `sprout.Actor`, as `kind Visitor is sprout.Actor { … }`, and write `visitors are Visitor`.',
        ],
      ],
    });
  });

  it('refuses another library’s kind, suggesting it be composed when it is an actor', () => {
    expect(checked('victorian.Gent', kind('victorian', 'Gent')).told[0]![2]).toBe(
      'Declare one that composes `victorian.Gent`, as `kind Visitor is victorian.Gent { … }`, and write `visitors are Visitor`.',
    );
    expect(checked('victorian.Voice', kind('victorian', 'Voice')).told).toHaveLength(1);
  });
});

/**
 * What `checkActors` says of the objects written in `body`, the body of a
 * world made of `world`, as [where, message, remedy]. The objects must
 * place.
 */
function actorsIn(
  body: string,
  world: KindRef | null = kind('shop', 'Basket'),
  visitor: KindRef | null = kind('shop', 'Creature'),
) {
  const placing = new Diagnostics();
  const root = parseDeclarations(
    new SourceFile('o.sprout', `world shop is sprout.World {\n${body}\n}`),
    placing,
  ).find((d): d is WorldDeclaration => d.kind === 'world')!;
  const objects = resolveObjects('shop', objectsIn(root), {
    enums: new EnumTable(),
    kinds: KINDS,
    diagnostics: placing,
  });
  const tree = placeObjects(objects, { world: 'shop', diagnostics: placing });
  expect(placing.all.map((d) => d.message)).toEqual([]);
  const diagnostics = new Diagnostics();
  checkActors({ tree, objects, world, visitor, diagnostics });
  return diagnostics.all.map((d) => [textOf(d.at), d.message, d.remedy]);
}

describe('the only actors are visitors and NPCs, and each stands in a place', () => {
  it('names why an actor kind that is not the visitor kind may not be one', () => {
    expect(notAnNpc('porter', kind('shop', 'Creature'))).toBe(
      '`porter` composes `sprout.Actor` but not `Creature`, and the only actors are visitors and NPCs.',
    );
  });

  it('accepts NPCs in a place, in a place inside a place, and directly in a world holding actors', () => {
    const body = [
      'object hall is Hall {',
      '  object nook is Hall { object dog is Creature }',
      '  object basket is Basket { object ball is Basket }',
      '  object cat is Cat',
      '}',
      'object mouse is Creature',
    ].join('\n');
    expect(actorsIn(body, kind('shop', 'Hall'))).toEqual([]);
  });

  it('refuses an actor that is not an NPC at its name, and says nothing more of it', () => {
    const body = [
      'object hall is Hall {',
      '  object basket is Basket { object porter is Porter }',
      '  object gent is victorian.Gent',
      '}',
    ].join('\n');
    expect(actorsIn(body)).toEqual([
      [
        'porter',
        '`porter` composes `sprout.Actor` but not `Creature`, and the only actors are visitors and NPCs.',
        "Compose `Creature`, what this world's visitors are made of, to make `porter` an NPC, or make it of kinds that do not compose `sprout.Actor`.",
      ],
      [
        'gent',
        '`gent` composes `sprout.Actor` but not `Creature`, and the only actors are visitors and NPCs.',
        "Compose `Creature`, what this world's visitors are made of, to make `gent` an NPC, or make it of kinds that do not compose `sprout.Actor`.",
      ],
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

  it('says nothing that the absent world kind or visitor kind would decide', () => {
    expect(actorsIn('object porter is Porter', null, null)).toEqual([]);
    // With no visitor kind to be made of, an actor is still refused where it cannot stand.
    expect(actorsIn('object porter is Porter', kind('shop', 'Basket'), null)).toHaveLength(1);
  });
});
