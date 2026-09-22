import { describe, expect, it } from 'vitest';

import { composesKind, kindName, type KindLookup, type KindRef } from './kinds.js';

function kind(library: string, name: string, ...composes: string[]): KindRef {
  return {
    library,
    name,
    composes: new Set([`${library}.${name}`, ...composes]),
    properties: new Map(),
    contains: false,
    containsActors: false,
  };
}

const CONTAINER = kind('sprout', 'Container');
const VESSEL = kind('printers_shop', 'Vessel', 'sprout.Container');

describe('a kind is matched nominally, and by composition', () => {
  it('names itself by its library and its name', () => {
    expect(kindName(CONTAINER)).toBe('sprout.Container');
    expect(kindName(VESSEL)).toBe('printers_shop.Vessel');
  });

  it('composes itself, so a kind fills a role declaring it', () => {
    expect(composesKind(VESSEL, VESSEL)).toBe(true);
    expect(composesKind(CONTAINER, CONTAINER)).toBe(true);
  });

  it('admits anything that composes the kind, whatever else it composes', () => {
    expect(composesKind(VESSEL, CONTAINER)).toBe(true);
    expect(composesKind(CONTAINER, VESSEL)).toBe(false);
  });

  it('does not match structurally: two kinds are not one for looking alike', () => {
    const elsewhere = kind('other_world', 'Vessel', 'sprout.Container');
    expect(kindName(elsewhere)).not.toBe(kindName(VESSEL));
    expect(composesKind(elsewhere, VESSEL)).toBe(false);
    expect(composesKind(VESSEL, elsewhere)).toBe(false);
  });
});

describe('a lookup answers by full identity, and unqualified from a namespace first', () => {
  const all = [CONTAINER, VESSEL, kind('printers_shop', 'Container')];
  const kinds: KindLookup = {
    qualified: (library, name) => all.find((k) => k.library === library && k.name === name) ?? null,
    unqualified: (name, from) => kinds.qualified(from, name) ?? kinds.qualified('sprout', name),
  };

  it('keeps two kinds of one name in two libraries apart', () => {
    expect(kinds.qualified('sprout', 'Container')).toBe(CONTAINER);
    expect(kinds.qualified('printers_shop', 'Container')).not.toBe(CONTAINER);
    expect(kinds.qualified('elsewhere', 'Container')).toBeNull();
  });

  it("reads an unqualified name as the asker's own before the standard library's", () => {
    expect(kinds.unqualified('Container', 'printers_shop')?.library).toBe('printers_shop');
    expect(kinds.unqualified('Container', 'other_world')).toBe(CONTAINER);
    expect(kinds.unqualified('Vessel', 'other_world')).toBeNull();
  });
});
