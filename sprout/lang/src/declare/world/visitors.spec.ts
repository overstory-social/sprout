// `resolveVisitors`: what `visitors are <Kind>` reads, the spec's world
// as a place, actors and visitors — a world's visitors are made of a
// kind of its own that composes `sprout.Actor`, never a library's kind
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
