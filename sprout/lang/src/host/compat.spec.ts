import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { compiledWorld, SHOP } from '../fixtures/bundle.js';
import { locationOf } from '../source/source.js';
import { catalogueOf, type Catalogue } from './catalogue.js';
import { saveBreaks, type SaveBreak } from './compat.js';

const SHOP_WITH_LANTERN: Readonly<Record<string, string>> = {
  ...SHOP,
  'lantern.sprout': 'kind Lantern { contains object wick is Crate }\n',
};

const catalogue = (files: Readonly<Record<string, string>>, name = 'printers_shop'): Catalogue =>
  catalogueOf(compiledWorld(name, files), DEFAULT_LIMITS.caps);

const before = catalogue(SHOP_WITH_LANTERN);

/** The breaks from the shop to the shop with `changed` laid over its files. */
const breaksTo = (changed: Readonly<Record<string, string>>): SaveBreak[] =>
  saveBreaks(before, catalogue({ ...SHOP_WITH_LANTERN, ...changed }));

const where = (one: SaveBreak): string =>
  one.at === null ? '-' : `${one.in} ${locationOf(one.at)}`;

const WORLD = SHOP['printers_shop.sprout']!;

describe('what a save of one build of a world does not survive in the next', () => {
  it('finds nothing between a build and itself', () => {
    expect(saveBreaks(before, catalogue(SHOP_WITH_LANTERN))).toEqual([]);
  });

  it('keeps a save across what it never names: a room, a property with a default, an option, a wider range, prose', () => {
    expect(
      breaksTo({
        'printers_shop.sprout': WORLD.replace(
          '  object yard is Room {',
          '  object attic is Room { describe { text "Dust." } }\n  object yard is Room {',
        ).replace(
          'enum Glaze { none, shino, tenmoku }',
          'enum Glaze { none, shino, tenmoku, celadon }',
        ),
        'jar.sprout':
          'kind Jar { :glaze Glaze default none :fill 3 min 0 max 99 :chipped false remembers { :seen false } }\n',
        'room.sprout':
          'kind Room { contains actors :lit true describe { text "A plain room." } }\n',
        'kiln.sprout': 'kind Kiln { :hot false }\n',
      }),
    ).toEqual([]);
  });

  it('breaks on a renamed room, at each id the earlier build declared, where it was declared', () => {
    const breaks = breaksTo({
      'printers_shop.sprout': WORLD.replace('object yard is Room', 'object court is Room'),
    });
    expect(breaks.map((one) => [where(one), one.message.slice(0, 40)])).toEqual([
      ['earlier printers_shop.sprout:11:3', '`yard` is not declared there any more: a'],
      ['earlier printers_shop.sprout:12:5', '`yard.kiln` is not declared there any mo'],
    ]);
    expect(breaks[0]!.remedy).toBe(
      'Declare it again under the same name in the same place, or make this a breaking version.',
    );
  });

  it('breaks on a property whose type changed, once, at its declaration in the later build', () => {
    const breaks = breaksTo({
      'jar.sprout':
        'kind Jar { :glaze Glaze default none :fill "full" remembers { :seen false } }\n',
    });
    expect(breaks).toHaveLength(1);
    expect(where(breaks[0]!)).toBe('later jar.sprout:1:38');
    expect(breaks[0]!.message).toBe(
      '`:fill` of `Jar` held a whole number from 0 to 9, and now holds text: ' +
        'a save that holds a value it no longer can cannot be read.',
    );
  });

  it('breaks on a removed enum option and a narrowed range, and names the option', () => {
    const breaks = breaksTo({
      'printers_shop.sprout': WORLD.replace(
        'enum Glaze { none, shino, tenmoku }',
        'enum Glaze { none, shino }',
      ),
      'jar.sprout':
        'kind Jar { :glaze Glaze default none :fill 3 min 0 max 5 remembers { :seen false } }\n',
    });
    expect(breaks.map((one) => one.message)).toEqual([
      '`:glaze` of `Jar` held one of none, shino, tenmoku, and now holds one of none, shino: ' +
        '`tenmoku` is no longer one of its options, so a save that holds a value it no longer can cannot be read.',
      '`:fill` of `Jar` held a whole number from 0 to 9, and now holds a whole number from 0 to 5: ' +
        'a save that holds a value it no longer can cannot be read.',
    ]);
  });

  it('breaks on a changed default, since a record holds only what differs from it', () => {
    const breaks = breaksTo({ 'crate.sprout': 'kind Crate { contains :lid true }\n' });
    expect(breaks.map((one) => one.message)).toEqual([
      '`:lid` of `Crate` starts at true now, and started at false: a save keeps only what ' +
        'differs from where a thing starts, so one it left at false would read true.',
    ]);
  });

  it('breaks on a property gone or moved between held and remembered', () => {
    const breaks = breaksTo({
      'jar.sprout': 'kind Jar { :glaze Glaze default none :seen false }\n',
    });
    expect(breaks.map((one) => [one.in, one.message])).toEqual([
      [
        'later',
        '`:seen`, which `Jar` remembers for each person, is now held by the thing itself: ' +
          'a save keeps the two apart, so what it holds of it cannot be read.',
      ],
      ['earlier', '`:fill` of `Jar` is gone: a save that changed it cannot be read.'],
    ]);
  });

  it('breaks on a kind gone, since a save may hold a thing spawned as one', () => {
    const breaks = breaksTo({
      'shelf.sprout': 'kind Rack { contains }\n',
      'printers_shop.sprout': WORLD.replace('is Shelf', 'is Rack'),
    });
    expect(breaks.map((one) => one.message)).toContain(
      'The kind `Shelf` is gone: a save may hold a thing spawned as one, which cannot be read without it.',
    );
  });

  it('breaks on what a kind gives, gone or added, since things already made lack what was added', () => {
    expect(
      breaksTo({ 'lantern.sprout': 'kind Lantern { contains }\n' }).map((one) => one.message),
    ).toEqual([
      '`wick`, which every `Lantern` is given, is gone: a save that holds one cannot be read.',
    ]);
    const added = breaksTo({
      'lantern.sprout': 'kind Lantern { contains object wick is Crate object glass is Crate }\n',
    });
    expect(added.map((one) => [where(one), one.message])).toEqual([
      [
        'later lantern.sprout:1:46',
        '`glass` is new in the body of `Lantern`: every `Lantern` a save already holds was made without it.',
      ],
    ]);
  });

  it('breaks on what a kind gains by composing another that gives it, for a kind spawned and for a visitor', () => {
    const shade = { 'shade.sprout': 'kind Shade { contains object bulb is Shelf }\n' };
    const crate = breaksTo({
      ...shade,
      'crate.sprout': 'kind Crate is Shade { contains :lid false }\n',
    });
    expect(crate.map((one) => one.message)).toContain(
      'Every `Crate` is now given `bulb` by `Shade`: every `Crate` a save already holds was made without it.',
    );
    const person = breaksTo({
      ...shade,
      'person.sprout': 'kind Person is Creature, Shade, sprout.Visitor { }\n',
    });
    expect(person.map((one) => one.message)).toContain(
      'Every `Person` is now given `bulb` by `Shade`: every `Person` a save already holds was made without it.',
    );
  });

  it('names the giver whose own body gained an object, not a kind that composes it', () => {
    const before = catalogue({
      ...SHOP_WITH_LANTERN,
      'shade.sprout': 'kind Shade { contains }\n',
      'crate.sprout': 'kind Crate is Shade { contains :lid false }\n',
    });
    const after = catalogue({
      ...SHOP_WITH_LANTERN,
      'shade.sprout': 'kind Shade { contains object bulb is Shelf }\n',
      'crate.sprout': 'kind Crate is Shade { contains :lid false }\n',
    });
    expect(saveBreaks(before, after).map((one) => [one.message, one.remedy])).toEqual([
      [
        '`bulb` is new in the body of `Shade`: every `Shade` a save already holds was made without it.',
        'Leave the body of `Shade` as it was, or make this a breaking version.',
      ],
    ]);
  });

  it('breaks once, and only, on a world renamed, since every id is under its name', () => {
    const renamed = catalogue(
      {
        ...SHOP_WITH_LANTERN,
        'printers_shop.sprout': WORLD.replace('world printers_shop', 'world press'),
      },
      'press',
    );
    expect(saveBreaks(before, renamed).map((one) => one.message)).toEqual([
      'The world is named `press` now, and was `printers_shop`: everything a save holds is named under ' +
        "the world's name, so no save of it can be read.",
    ]);
  });
});
