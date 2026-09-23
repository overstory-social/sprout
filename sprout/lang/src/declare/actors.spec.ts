import { describe, expect, it } from 'vitest';

import type { KindDeclaration, KindExpr, WorldDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseDeclarations } from '../syntax/parse.js';
import { SourceFile, textOf } from '../source/source.js';
import { EnumTable } from './enums.js';
import { KindTable, type KindRef } from './kinds.js';
import { ACTOR, checkVisitorKind, isActor, isNpc } from './actors.js';

/** Every kind here, composed: the standard library's, the shop's own, and another library's. */
const KINDS = (() => {
  const diagnostics = new Diagnostics();
  const table = new KindTable();
  for (const [library, text] of Object.entries({
    sprout:
      'kind World { contains }\nkind Actor { contains :capacity 8 }\nkind Place { contains actors }',
    shop: [
      'kind Creature: sprout.Actor { :capacity 4 }',
      'kind Cat: Creature { }',
      'kind Porter: sprout.Actor { }',
      'kind Hall: sprout.Place { }',
      'kind Basket { contains }',
    ].join('\n'),
    victorian: 'kind Gent: sprout.Actor { }\nkind Voice { }',
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
    new SourceFile('w.sprout', `world shop: sprout.World { visitors are ${text} }`),
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
          'Write `kind Visitor: sprout.Actor { … }` and `visitors are Visitor`, or name a kind that composes `sprout.Actor`.',
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
          'Declare one that composes `sprout.Actor`, as `kind Visitor: sprout.Actor { … }`, and write `visitors are Visitor`.',
        ],
      ],
    });
  });

  it('refuses another library’s kind, suggesting it be composed when it is an actor', () => {
    expect(checked('victorian.Gent', kind('victorian', 'Gent')).told[0]![2]).toBe(
      'Declare one that composes `victorian.Gent`, as `kind Visitor: victorian.Gent { … }`, and write `visitors are Visitor`.',
    );
    expect(checked('victorian.Voice', kind('victorian', 'Voice')).told).toHaveLength(1);
  });
});
