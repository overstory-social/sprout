import { describe, expect, it } from 'vitest';

import { kind, PLACE as PLACE_KIND, ROOM, VESSEL } from '../fixtures/bindings.js';
import type { KindLookup, KindRef } from './kinds.js';
import { hereKindOf, PLACE } from './places.js';

/** A hall composing `sprout.Place`, so it holds actors through it. */
const HALL: KindRef = {
  ...kind('printers_shop', 'Hall', 'sprout.Place'),
  contains: true,
  containsActors: true,
};

/** A lookup over `kinds`, which is all `hereKindOf` asks of one. */
function lookup(kinds: readonly KindRef[]): KindLookup {
  const qualified = (library: string, name: string): KindRef | null =>
    kinds.find((one) => one.library === library && one.name === name) ?? null;
  return { qualified, unqualified: (name, from) => qualified(from, name), all: () => kinds };
}

describe('what `here` is typed as', () => {
  it('is named with its library', () => expect(PLACE).toBe('sprout.Place'));

  it('is `sprout.Place` where every kind holding actors composes it', () => {
    const kinds = [PLACE_KIND, HALL, VESSEL];
    expect(hereKindOf(kinds, lookup(kinds))).toEqual({ place: PLACE_KIND, unlike: null });
  });

  it('is the object type where a kind holds actors without composing it, naming the first', () => {
    const other: KindRef = { ...ROOM, name: 'Wardrobe' };
    const kinds = [PLACE_KIND, HALL, ROOM, other];
    expect(hereKindOf(kinds, lookup(kinds))).toEqual({ place: null, unlike: ROOM });
  });

  it('is the object type where the standard library is absent, with nothing to name', () => {
    expect(hereKindOf([VESSEL], lookup([VESSEL]))).toEqual({ place: null, unlike: null });
  });
});
