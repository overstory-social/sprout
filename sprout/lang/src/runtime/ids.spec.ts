import { describe, expect, it } from 'vitest';

import { pathKey } from '../declare/tree.js';
import {
  declaredId,
  declaredPathOf,
  idForm,
  isMinted,
  mintedId,
  storedId,
  visitKey,
  type InstanceId,
} from './ids.js';

const WORLD = 'printers_shop';

describe('an instance id has the spec’s three forms', () => {
  it('is the declared path, world first, for a declared object', () => {
    expect(declaredId(WORLD, ['composing_room', 'cabinet'])).toBe(
      'printers_shop.composing_room.cabinet',
    );
  });

  it('is the world’s name alone for the world', () => {
    expect(declaredId(WORLD, [])).toBe('printers_shop');
  });

  it('is the world and a serial for something made while the world runs', () => {
    expect(mintedId(WORLD, 12)).toBe('printers_shop#12');
    expect(mintedId(WORLD, 1)).toBe('printers_shop#1');
  });

  it('tells a minted id from a declared one', () => {
    expect(isMinted(mintedId(WORLD, 3))).toBe(true);
    expect(isMinted(declaredId(WORLD, ['kiln']))).toBe(false);
    expect(isMinted(declaredId(WORLD, []))).toBe(false);
  });

  it('never gives a declared path and a serial the same id', () => {
    // A name matches [a-z][a-z0-9_]*, so a step can never be `12` and
    // neither form can spell the other.
    expect(() => declaredId(WORLD, ['12'])).toThrow();
    expect(() => declaredId(WORLD, ['kiln#1'])).toThrow();
    expect(() => declaredId(WORLD, ['kiln.shelf'])).toThrow();
    expect(() => declaredId('Shop', ['kiln'])).toThrow();
  });
});

describe('a minted id takes a positive whole serial', () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('refuses %s', (serial) => {
    expect(() => mintedId(WORLD, serial)).toThrow(/positive whole serial/);
  });
});

describe('the declared path reads back out of an id', () => {
  it('round-trips a path, the world’s own included', () => {
    for (const path of [[], ['kiln'], ['composing_room', 'cabinet', 'drawer']]) {
      expect(declaredPathOf(WORLD, declaredId(WORLD, path))).toEqual(path);
    }
  });

  it('is null for a minted id', () => {
    expect(declaredPathOf(WORLD, mintedId(WORLD, 7))).toBeNull();
  });

  it('is null for another world’s id, even one whose name this world’s starts with', () => {
    expect(declaredPathOf(WORLD, declaredId('bakery', ['oven']))).toBeNull();
    expect(declaredPathOf(WORLD, declaredId('printers_shop_annex', ['press']))).toBeNull();
    expect(declaredPathOf(WORLD, declaredId('printers', ['shop']))).toBeNull();
  });
});

describe('which form a stored string is', () => {
  it('names each form, and null for anything that is not an id in this world', () => {
    expect(idForm(WORLD, 'printers_shop')).toBe('world');
    expect(idForm(WORLD, 'printers_shop.kiln.shelf')).toBe('declared');
    expect(idForm(WORLD, 'printers_shop#12')).toBe('minted');
    for (const not of [
      'bakery.oven',
      'printers_shop#0',
      'printers_shop#012',
      'printers_shop#-1',
      'printers_shop#',
      'printers_shop.',
      'printers_shop..kiln',
      'printers_shop.Kiln',
      'printers_shop.kiln#1',
      'kiln',
    ]) {
      expect(idForm(WORLD, not), not).toBeNull();
    }
  });

  it('brands a string of one of the forms as an id, and refuses any other', () => {
    for (const id of ['printers_shop', 'printers_shop.kiln', 'printers_shop#3']) {
      expect(storedId(WORLD, id)).toBe(id);
    }
    expect(() => storedId(WORLD, 'bakery.oven')).toThrow(/not an id in `printers_shop`/);
    expect(() => storedId(WORLD, 'printers_shop#0')).toThrow();
  });
});

describe('the brand keeps an id an id', () => {
  it('does not take a tree’s path key, which has no world in front', () => {
    const key = pathKey(['kiln', 'shelf']);
    // @ts-expect-error a path key is a plain string, and not an instance id
    const id: InstanceId = key;
    expect(declaredPathOf(WORLD, id)).toBeNull();
  });
});

describe('a visit key', () => {
  it('is whatever non-empty key the host hands over', () => {
    expect(visitKey('v-8f2c')).toBe('v-8f2c');
  });

  it('is never empty', () => {
    expect(() => visitKey('')).toThrow();
  });
});
