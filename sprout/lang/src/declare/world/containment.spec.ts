// *How members combine*: `contains` and `contains actors` are
// declarations a world holds like any other, idempotent under repeating,
// composed from whatever it writes and whatever it composes — every
// world's `sprout.World` among them — and `contains actors` implies
// `contains` though the spec never says so outright.

import { describe, expect, it } from 'vitest';

import { kindsOf, LIBRARIES, SHOP, world } from '../../fixtures/world.js';

describe('containment is a declaration, and a place is whatever holds actors', () => {
  /**
   * A world writing exactly these lines, and the two things it may hold,
   * composing a `sprout.World` that here declares nothing of its own.
   */
  function holding(...lines: string[]) {
    const { kind, said } = world(
      `world printers_shop: sprout.World {\n${lines.map((l) => `  ${l}`).join('\n')}\n` +
        '  visitors are Creature\n  visitors arrive at composing_room\n}',
    );
    return { said, contains: kind?.contains, containsActors: kind?.containsActors };
  }

  it('holds nothing unless it or something it composes says so', () => {
    // And is NOT refused for it: the standard library's `sprout.World`
    // declares `contains` and every world composes it.
    const nothing = holding();
    expect(nothing.said).toEqual([]);
    expect(nothing.contains).toBe(false);
    expect(nothing.containsActors).toBe(false);
  });

  it('holds what `sprout.World` holds, which is how every world holds its places', () => {
    const kinds = kindsOf({
      ...LIBRARIES,
      sprout: 'kind World { contains }\nkind Actor { }\nkind Container { :open true }',
    });
    const { kind, said } = world(SHOP, kinds);
    expect(said).toEqual([]);
    expect(kind!.contains).toBe(true);
    expect(kind!.containsActors).toBe(false);
  });

  it('holds others where it declares `contains`', () => {
    const held = holding('contains');
    expect(held.said).toEqual([]);
    expect(held.contains).toBe(true);
    // Holding things is not holding people: a world is not a place for
    // having said this much.
    expect(held.containsActors).toBe(false);
  });

  it('is a place where it declares `contains actors`, which implies holding', () => {
    // The standard library's `kind Place` declares only `contains
    // actors` and still holds a bench, so the second implies the first.
    // The spec never says so outright — see the working notes.
    const place = holding('contains actors');
    expect(place.said).toEqual([]);
    expect(place.contains).toBe(true);
    expect(place.containsActors).toBe(true);
  });

  it('takes either of them twice, and both together, in silence', () => {
    // *How members combine* calls these two idempotent, so saying what
    // is already true is not a mistake — unlike a property, which a
    // world is refused for declaring twice. Whether a redundant one is
    // worth a warning is B50's, which owns the list of warnings.
    //
    // And repeating one says no more than writing it once did: two
    // plain `contains` still do not make a place, whichever order they
    // come in with `contains actors`.
    for (const [lines, place] of [
      [['contains', 'contains'], false],
      [['contains actors', 'contains actors'], true],
      [['contains', 'contains actors'], true],
      [['contains actors', 'contains'], true],
    ] as const) {
      const written = lines.join(' / ');
      const both = holding(...lines);
      expect(both.said, written).toEqual([]);
      expect(both.contains, written).toBe(true);
      expect(both.containsActors, written).toBe(place);
    }
  });

  it('is not confused by what else the world holds', () => {
    const mixed = holding('contains actors', ':season Season default autumn');
    expect(mixed.said).toEqual([]);
    expect(mixed.containsActors).toBe(true);
  });
});
