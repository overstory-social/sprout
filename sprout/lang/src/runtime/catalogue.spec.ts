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
      'world.sprout': SHOP['world.sprout']!.replace(
        'object jar: Jar in hall.shelf\nobject cup: Jar in hall.shelf',
        'object cup: Jar in hall.shelf\nobject jar: Jar in hall.shelf',
      ),
    };
    const other = catalogueOf(compiledWorld('printers_shop', reversed), DEFAULT_LIMITS.caps);
    const rank = (name: string) => other.declared.get(id('hall', 'shelf', name))!.rank;
    expect(rank('cup')).toBeLessThan(rank('jar'));
  });

  it('holds the kinds a spawn may name, by qualified name', () => {
    expect([...catalogue.kinds.keys()].sort()).toEqual([
      'printers_shop.Crate',
      'printers_shop.Jar',
      'printers_shop.Person',
      'printers_shop.Room',
      'printers_shop.Shelf',
      'sprout.Actor',
      'sprout.Place',
      'sprout.World',
    ]);
    for (const [name, kind] of catalogue.kinds) expect(kindName(kind)).toBe(name);
  });

  it('takes the world’s kind and the visitor kind from the bundle', () => {
    const bundle = shop();
    const from = catalogueOf(bundle, DEFAULT_LIMITS.caps);
    expect(from.worldKind).toBe(bundle.world);
    expect(from.visitorKind).toBe(bundle.visitor);
    expect(kindName(from.worldKind!)).toBe('printers_shop.printers_shop');
    expect(kindName(from.visitorKind!)).toBe('printers_shop.Person');
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

  it('holds nothing for an object whose file is withheld, and no kind it declared', () => {
    expect(catalogue.declared.has(id('yard', 'kiln'))).toBe(false);
    expect(catalogue.kinds.has('printers_shop.Crate')).toBe(false);
  });

  it('has no visitor kind where the one `visitors are` names is absent', () => {
    const bundle = compiledWorld('printers_shop', SHOP, {
      mode: 'load',
      withheld: ['kiln.sprout'],
    });
    expect(catalogueOf(bundle, DEFAULT_LIMITS.caps).visitorKind).not.toBeNull();
    const elsewhere = {
      'world.sprout': SHOP['world.sprout']!.replace('kind Person: sprout.Actor { :score 0 }', ''),
      'kiln.sprout': `${SHOP['kiln.sprout']!}kind Person: sprout.Actor { :score 0 }\n`,
    };
    const gone = compiledWorld('printers_shop', elsewhere, {
      mode: 'load',
      withheld: ['kiln.sprout'],
    });
    expect(catalogueOf(gone, DEFAULT_LIMITS.caps).visitorKind).toBeNull();
    expect(gone.absent.map((a) => [a.what, a.kind])).toContainEqual(['Person', 'world']);
  });

  it('has no arrival for a world that admits no one', () => {
    const closed = {
      'world.sprout': SHOP['world.sprout']!.replace('arrive at hall', 'arrive at box'),
      'kiln.sprout': SHOP['kiln.sprout']!,
    };
    const bundle = compiledWorld('printers_shop', closed, {
      mode: 'load',
      withheld: ['kiln.sprout'],
    });
    expect(catalogueOf(bundle, DEFAULT_LIMITS.caps).arrival).toBeNull();
  });
});
