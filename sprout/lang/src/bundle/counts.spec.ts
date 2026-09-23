import { describe, expect, it } from 'vitest';

import type { KindDeclaration, WorldDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from '../declare/enums.js';
import { KindTable } from '../declare/kinds.js';
import { objectsIn, resolveObjects } from '../declare/objects.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { countWorld } from './counts.js';
import { DEFAULT_LIMITS, limitsFrom, type StaticCaps } from './limits.js';

const KINDS = 'kind Room { contains actors }\nkind Crate { contains }\n';

/**
 * Two kinds, one of them a place, and three objects, two of them places:
 * the hall by its kind, the cupboard by its own body. The box is on line
 * 5 and the cupboard on line 6.
 */
const SHOP = `object hall is Room {
    object box is Crate
    object cupboard is Crate { contains actors }
  }`;

/** Count the kinds in `kinds` and the objects written in the world's `body`, under these caps. */
function count(body: string, caps: Partial<StaticCaps> = {}, kinds = KINDS) {
  const read = new Diagnostics();
  const declared = parseDeclarations(
    new SourceFile('shop.sprout', `${kinds}world shop is sprout.World {\n  ${body}\n}\n`),
    read,
  );
  expect(read.refusals, 'the fixture parses').toEqual([]);
  const own = declared.filter((d): d is KindDeclaration => d.kind === 'kind');
  const world = declared.find((d): d is WorldDeclaration => d.kind === 'world')!;
  const enums = new EnumTable();
  const table = new KindTable();
  table.add('shop', own, read);
  table.resolve('shop', enums, read);
  const composed = resolveObjects('shop', objectsIn(world), {
    enums,
    kinds: table,
    diagnostics: read,
    onUnknown: () => {},
  });
  expect(read.refusals, 'the fixture composes').toEqual([]);

  const diagnostics = new Diagnostics();
  const counts = countWorld(
    { kinds: own, objects: composed.map((object) => object.declaration), composed },
    limitsFrom({ caps }).caps,
    diagnostics,
  );
  return {
    counts,
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy] as const),
  };
}

describe('a world’s kinds, objects and places are counted', () => {
  it('as declared, a place being an object whose composed kind holds actors', () => {
    expect(count(SHOP).counts).toEqual({ kinds: 2, objects: 3, places: 2 });
  });

  it('bounded by nothing the host left unset, which is every one of them by default', () => {
    expect([
      DEFAULT_LIMITS.caps.kinds,
      DEFAULT_LIMITS.caps.objects,
      DEFAULT_LIMITS.caps.places,
    ]).toEqual([null, null, null]);
    expect(count(SHOP).said).toEqual([]);
  });

  it('counts a place by its composed kind, at any depth, and not one whose kind is absent', () => {
    // `nook` sits deep inside the hall, and still declares a place;
    // `shed` is made of a kind nobody declared, and so holds nothing yet.
    expect(
      count(
        `${SHOP}\n  object yard is Crate { object pen is Crate { object nook is Room } }\n  object shed is Room, Missing`,
      ).counts,
    ).toEqual({ kinds: 2, objects: 7, places: 3 });
  });

  it('within a cap that is exactly met', () => {
    expect(count(SHOP, { kinds: 2, objects: 3, places: 2 }).said).toEqual([]);
  });
});

describe('a cap exceeded is refused at the first declaration past it', () => {
  it('kinds, with a blessed library as the way out', () => {
    expect(count(SHOP, { kinds: 1 }).said).toEqual([
      [
        'shop.sprout:2:6',
        'This world declares 2 kinds, and 1 is as many as it may have.',
        'Take some out, or use a library the host has blessed, whose kinds cost nothing.',
      ],
    ]);
  });

  it('objects', () => {
    expect(count(SHOP, { objects: 1 }).said).toEqual([
      [
        'shop.sprout:5:12',
        'This world declares 3 objects, and 1 is as many as it may have.',
        'Take some out, or let one object do the work of two.',
      ],
    ]);
  });

  it('places, counting one that is a place by its own body', () => {
    expect(count(SHOP, { places: 1 }).said).toEqual([
      [
        'shop.sprout:6:12',
        'This world has 2 places, and 1 is as many as it may have.',
        'Take some out, or join two into one. A place is anything people can be inside: whatever holds `contains actors`.',
      ],
    ]);
  });

  it('each on its own, all three at once', () => {
    const { said } = count(
      'object a is Room\n  object b is Room',
      { kinds: 1, objects: 1, places: 1 },
      'kind Room { contains actors }\nkind Nook { }\n',
    );
    expect(said.map(([at, message]) => [at, message])).toEqual([
      ['shop.sprout:2:6', 'This world declares 2 kinds, and 1 is as many as it may have.'],
      ['shop.sprout:5:10', 'This world declares 2 objects, and 1 is as many as it may have.'],
      ['shop.sprout:5:10', 'This world has 2 places, and 1 is as many as it may have.'],
    ]);
  });
});
