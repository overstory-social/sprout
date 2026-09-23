// `resolveVisitors`: what `visitors are <Kind>` reads, the spec's world
// as a place, actors and visitors — a world's visitors are made of a
// kind of its own that composes `sprout.Visitor`, never a library's kind
// directly, and a kind that is absent or could not compose is a gap
// rather than a fresh refusal.

import { describe, expect, it } from 'vitest';

import type { KindDeclaration } from '../../syntax/ast.js';
import { kindName, KindTable } from '../kinds.js';
import type { KindSource } from '../compose.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { parseDeclarations } from '../../syntax/parse.js';
import { SourceFile, textOf } from '../../source/source.js';
import { ENUMS, KINDS, SHOP, world } from '../../fixtures/world.js';

describe('a world says what its visitors are made of: a kind of its own for a person', () => {
  /** What `visitors are <written>` finds, and everything said about it, with where. */
  const naming = (written: string, kinds: KindSource = KINDS) => {
    const found = world(
      `world w is sprout.World {\n  visitors are ${written}\n  visitors arrive at y\n}`,
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
    expect(visitor!.composes.has('sprout.Visitor')).toBe(true);
    expect(visitor!.composes.has('sprout.Actor')).toBe(true);
  });

  it('refuses a world that does not say what a visitor is, at its name', () => {
    const { visitors, diagnostics } = world('world w is sprout.World { visitors arrive at y }');
    expect(visitors).toEqual({ found: 'refused' });
    expect(diagnostics.refusals.map((d) => [textOf(d.at), d.message, d.remedy])).toEqual([
      [
        'w',
        '`w` does not say what a visitor is.',
        "Write `visitors are <Kind>`, naming a kind of the world's own that composes `sprout.Visitor`.",
      ],
    ]);
  });

  it('says nothing about where visitors arrive, which is `arrivalOf`’s', () => {
    expect(world('world w is sprout.World { visitors are Creature }').said).toEqual([]);
  });

  it('refuses saying it twice at the second, and reads the first', () => {
    const { visitor, said } = world(`world w is sprout.World { visitors are Creature
  visitors are Hall
  visitors arrive at y }`);
    expect(said).toEqual(['`w` says twice what its visitors are.']);
    expect(kindName(visitor!)).toBe('printers_shop.Creature');
  });

  it('refuses a kind that does not compose `sprout.Visitor`, at the kind written', () => {
    const { visitors, told } = naming('Hall');
    expect(visitors).toEqual({ found: 'refused' });
    expect(told).toEqual([
      [
        'Hall',
        "`Hall` does not compose `sprout.Visitor`, and a world's visitors are made of a kind that does.",
        'Write `kind Person is sprout.Visitor { … }` and `visitors are Person`, or name a kind that composes `sprout.Visitor`.',
      ],
    ]);
  });

  it('refuses `sprout.Visitor` itself, and any library’s kind, as not the world’s own', () => {
    expect(naming('sprout.Visitor').told).toEqual([
      [
        'sprout.Visitor',
        "`sprout.Visitor` belongs to the library `sprout`. A world's visitors are made of a kind of its own.",
        'Declare one that composes `sprout.Visitor`, as `kind Person is sprout.Visitor { … }`, and write `visitors are Person`.',
      ],
    ]);
    // A library's kind for a person is composed into the world's own kind, not named.
    expect(naming('victorian.Gent').told).toEqual([
      [
        'victorian.Gent',
        "`victorian.Gent` belongs to the library `victorian`. A world's visitors are made of a kind of its own.",
        'Declare one that composes `victorian.Gent`, as `kind Person is victorian.Gent { … }`, and write `visitors are Person`.',
      ],
    ]);
    // One that is not for a person either is told the one thing that fixes both.
    for (const written of ['victorian.Voice', 'victorian.Butler', 'sprout.Actor']) {
      expect(naming(written).told[0]![2]).toBe(
        'Declare one that composes `sprout.Visitor`, as `kind Person is sprout.Visitor { … }`, and write `visitors are Person`.',
      );
    }
  });

  it('gives a kind nothing declares to the caller as a gap, saying nothing itself', () => {
    const { visitors, said } = naming('Nope');
    expect(said).toEqual([]);
    expect(visitors).toMatchObject({
      found: 'absent',
      what: 'Nope',
      message: 'Nothing here is a `Nope`.',
      remedy:
        'Declare it with `kind Nope is sprout.Visitor { … }`, or check the spelling of a kind this world or a library it uses declares.',
      said: false,
    });
    if (visitors.found === 'absent') expect(textOf(visitors.at)).toBe('Nope');
  });

  it('guesses at a misspelling, and suggests declaring a kind for a person', () => {
    expect(naming('Creture').visitors).toMatchObject({
      found: 'absent',
      message: 'Nothing here is a `Creture`. Did you mean `Creature`?',
      remedy: 'Write `Creature`, or declare `Creture` with `kind Creture is sprout.Visitor { … }`.',
    });
  });

  it('calls a kind that could not be composed absent, and already told', () => {
    const parsing = new Diagnostics();
    const table = new KindTable();
    table.add(
      'printers_shop',
      parseDeclarations(
        new SourceFile('k.sprout', 'kind Creature is sprout.Visitor, Nope { }'),
        parsing,
      ).filter((d): d is KindDeclaration => d.kind === 'kind'),
      parsing,
    );
    table.add(
      'sprout',
      parseDeclarations(
        new SourceFile('s.sprout', 'kind World { }\nkind Actor { }\nkind Visitor is Actor { }'),
        parsing,
      ).filter((d): d is KindDeclaration => d.kind === 'kind'),
      parsing,
    );
    table.resolve('printers_shop', ENUMS, new Diagnostics(), () => {});
    expect(naming('Creature', table).visitors).toMatchObject({
      found: 'absent',
      what: 'Creature',
      message: '`Creature` is absent, so there is nothing for a visitor to be made of.',
      said: true,
    });
  });
});
