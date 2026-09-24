import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS, limitsFrom } from '../bundle/limits.js';
import { kindName } from '../declare/kinds.js';
import { compiledWorld, SHOP, shop, shopWithheld } from '../fixtures/bundle.js';
import { declaredId, type InstanceId } from './ids.js';
import { catalogueOf } from './catalogue.js';

const id = (...path: string[]): InstanceId => declaredId('printers_shop', path);

describe('a catalogue says what one bundle holds as instances', () => {
  const catalogue = catalogueOf(shop(), DEFAULT_LIMITS.caps);

  it('names the world by the manifest’s name, and where visitors arrive by the place’s id', () => {
    expect(catalogue.world).toBe('printers_shop');
    expect(catalogue.arrival).toBe(id('hall'));
  });

  it('holds every placement by its id, with its declared container and its kind', () => {
    expect([...catalogue.declared.keys()].sort()).toEqual(
      [
        id('hall'),
        id('yard'),
        id('hall', 'shelf'),
        id('hall', 'box'),
        id('yard', 'kiln'),
        id('hall', 'shelf', 'jar'),
        id('hall', 'shelf', 'cup'),
        id('hall', 'box', 'tin'),
      ].sort(),
    );
    const jar = catalogue.declared.get(id('hall', 'shelf', 'jar'))!;
    expect(jar.path).toEqual(['hall', 'shelf', 'jar']);
    expect(jar.container).toBe(id('hall', 'shelf'));
    expect(jar.kind!.composes.has('printers_shop.Jar')).toBe(true);
    expect(catalogue.declared.get(id('hall'))!.container).toBe(catalogue.world);
  });

  it('holds every phrase a visitor may type, the standard library’s among them', () => {
    const verbs = catalogue.phrases.map(({ verb }) => `${verb.library}.${verb.name}`);
    for (const verb of ['sprout.take', 'sprout.look', 'sprout.go']) expect(verbs).toContain(verb);
    expect(catalogue.phrases.find(({ verb }) => verb.name === 'take')!.parts).toEqual([
      { words: ['take'] },
      { slot: 0 },
    ]);
  });

  it('carries the bundle’s word set, which a nickname is admitted against', () => {
    const bundle = shop();
    expect(bundle.words.length).toBeGreaterThan(0);
    expect([...catalogue.words].sort()).toEqual([...bundle.words]);
    expect(catalogue.words.has('jar')).toBe(true);
  });

  it('ranks siblings in the order they were declared', () => {
    const rank = (...path: string[]) => catalogue.declared.get(id(...path))!.rank;
    expect(rank('hall')).toBeLessThan(rank('yard'));
    expect(rank('hall', 'shelf')).toBeLessThan(rank('hall', 'box'));
    expect(rank('hall', 'shelf', 'jar')).toBeLessThan(rank('hall', 'shelf', 'cup'));
    const ranks = [...catalogue.declared.values()].map((entry) => entry.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it('ranks by the order written, not by name', () => {
    const reversed = {
      ...SHOP,
      'printers_shop.sprout': SHOP['printers_shop.sprout']!.replace(
        'object jar is Jar\n      object cup is Jar',
        'object cup is Jar\n      object jar is Jar',
      ),
    };
    const other = catalogueOf(compiledWorld('printers_shop', reversed), DEFAULT_LIMITS.caps);
    const rank = (name: string) => other.declared.get(id('hall', 'shelf', name))!.rank;
    expect(rank('cup')).toBeLessThan(rank('jar'));
  });

  it('holds what a kind gives each declared instance under the instance’s path, and the contents a spawn makes', () => {
    const lanterns = catalogueOf(
      compiledWorld('printers_shop', {
        ...SHOP,
        'printers_shop.sprout': SHOP['printers_shop.sprout']!.replace(
          'object jar is Jar',
          'object jar is Jar object lantern is Lantern',
        ),
        'lantern.sprout': 'kind Lantern { contains object wick is Jar }\n',
      }),
      DEFAULT_LIMITS.caps,
    );
    const wick = lanterns.declared.get(id('hall', 'shelf', 'lantern', 'wick'))!;
    expect(wick.container).toBe(id('hall', 'shelf', 'lantern'));
    expect(wick.kind).toBe(lanterns.contents.get('printers_shop.Lantern')![0]!.kind);
    expect(wick.rank).toBeGreaterThan(lanterns.declared.get(id('hall', 'shelf', 'lantern'))!.rank);
  });

  it('holds the kinds a spawn may name, by qualified name, and never one composing `sprout.World` or `sprout.Visitor`', () => {
    expect([...catalogue.kinds.keys()].sort()).toEqual([
      'printers_shop.Crate',
      'printers_shop.Creature',
      'printers_shop.Jar',
      'printers_shop.Room',
      'printers_shop.Shelf',
      'sprout.Actor',
      'sprout.Place',
    ]);
    for (const [name, kind] of catalogue.kinds) {
      expect(kindName(kind)).toBe(name);
      expect(kind.composes.has('sprout.World')).toBe(false);
      expect(kind.composes.has('sprout.Visitor')).toBe(false);
    }
    const all = shop().kinds.map(kindName);
    expect(all).toEqual(
      expect.arrayContaining(['sprout.World', 'sprout.Visitor', 'printers_shop.Person']),
    );
  });

  it('carries the slots of prose that render an option, as the bundle holds them', () => {
    const bundle = compiledWorld('mill', {
      'mill.sprout': [
        'world mill is sprout.World { visitors are Person visitors arrive at yard',
        '  object yard is sprout.Place',
        '  passage season { It is {self.get(:season)}. }',
        '  :season Season default autumn',
        '}',
        'enum Season { spring, autumn }',
        'kind Person is sprout.Visitor { }',
        '',
      ].join('\n'),
    });
    const from = catalogueOf(bundle, DEFAULT_LIMITS.caps);
    expect(from.optionSlots).toBe(bundle.optionSlots);
    expect(from.optionSlots.size).toBe(1);
  });

  it('takes the world’s kind and the visitor kind from the bundle', () => {
    const bundle = shop();
    const from = catalogueOf(bundle, DEFAULT_LIMITS.caps);
    expect(from.worldKind).toBe(bundle.world);
    expect(from.visitorKind).toBe(bundle.visitor);
    expect(kindName(from.worldKind!)).toBe('printers_shop.printers_shop');
    expect(kindName(from.visitorKind!)).toBe('printers_shop.Person');
  });

  it('finds a kind by name as a body does: the world’s own first, then the standard library’s', () => {
    const { lookup } = catalogue;
    expect(kindName(lookup.unqualified('Room', 'printers_shop')!)).toBe('printers_shop.Room');
    expect(kindName(lookup.unqualified('Place', 'printers_shop')!)).toBe('sprout.Place');
    expect(kindName(lookup.unqualified('World', 'sprout')!)).toBe('sprout.World');
    expect(kindName(lookup.qualified('sprout', 'Actor')!)).toBe('sprout.Actor');
    expect(lookup.unqualified('Teapot', 'printers_shop')).toBeNull();
  });

  it('reads stored values under the host’s caps now, not the ones the bundle was checked against', () => {
    const now = limitsFrom({ caps: { listElements: 4 } }).caps;
    const bundle = shop();
    expect(catalogueOf(bundle, now).caps).toBe(now);
    expect(bundle.caps.listElements).not.toBe(4);
  });
});

describe('a catalogue of a world loaded with a gap', () => {
  const catalogue = catalogueOf(shopWithheld(), DEFAULT_LIMITS.caps);

  it('holds an object of an absent kind with no kind, and what it holds with its own', () => {
    expect(catalogue.declared.get(id('hall', 'box'))!.kind).toBeNull();
    const tin = catalogue.declared.get(id('hall', 'box', 'tin'))!;
    expect(tin.kind).not.toBeNull();
    expect(tin.container).toBe(id('hall', 'box'));
  });

  it('holds an object whose kind’s file is withheld with no kind, and no kind that file declared', () => {
    expect(catalogue.declared.get(id('yard', 'kiln'))!.kind).toBeNull();
    expect(catalogue.kinds.has('printers_shop.Crate')).toBe(false);
  });

  it('has no visitor kind where the one `visitors are` names is absent', () => {
    const bundle = compiledWorld('printers_shop', SHOP, {
      mode: 'load',
      withheld: ['crate.sprout'],
    });
    expect(catalogueOf(bundle, DEFAULT_LIMITS.caps).visitorKind).not.toBeNull();
    const gone = compiledWorld('printers_shop', SHOP, {
      mode: 'load',
      withheld: ['person.sprout'],
    });
    expect(catalogueOf(gone, DEFAULT_LIMITS.caps).visitorKind).toBeNull();
    expect(gone.absent.map((a) => [a.what, a.kind])).toContainEqual(['Person', 'visitor-kind']);
  });

  it('finds nothing for a world’s own kind that failed to compose, never the library’s of that name', () => {
    // The world's own `Place` composes a kind nothing declares: at load
    // that is a gap, and `Place` fails to compose.
    const broken = {
      ...SHOP,
      'place.sprout': 'kind Place is Nowhere { contains actors }\n',
    };
    const bundle = compiledWorld('printers_shop', broken, { mode: 'load' });
    expect(bundle.absent.map((a) => a.what)).toContain('Nowhere');
    const { lookup } = catalogueOf(bundle, DEFAULT_LIMITS.caps);
    expect(lookup.unqualified('Place', 'printers_shop')).toBeNull();
    expect(kindName(lookup.qualified('sprout', 'Place')!)).toBe('sprout.Place');
  });

  it('has no arrival for a world that admits no one', () => {
    const closed = {
      ...SHOP,
      'printers_shop.sprout': SHOP['printers_shop.sprout']!.replace(
        'arrive at hall',
        'arrive at box',
      ),
    };
    const bundle = compiledWorld('printers_shop', closed, {
      mode: 'load',
      withheld: ['crate.sprout'],
    });
    expect(catalogueOf(bundle, DEFAULT_LIMITS.caps).arrival).toBeNull();
  });
});
