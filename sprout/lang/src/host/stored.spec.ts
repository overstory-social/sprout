import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { ValueType } from '../declare/types.js';
import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from '../declare/enums.js';
import { integer, BOOLEAN, STRING } from '../declare/types.js';
import { parseDeclarations } from '../syntax/parse.js';
import { SourceFile } from '../source/source.js';
import {
  containerOf,
  declaredContainer,
  madeFrom,
  readStoredWorld,
  StoredInstanceSchema,
  StoredStateUnreadable,
  StoredValueSchema,
  StoredVisitorSchema,
  StoredWorldSchema,
  typeKey,
  type StoredInstance,
  type StoredWorld,
} from './stored.js';

/** Enums as declared at one publish, so a later one can differ. */
function enumsOf(world: string, sprout = 'enum Tool { awl, bodkin }\n'): EnumTable {
  const table = new EnumTable();
  const diagnostics = new Diagnostics();
  for (const [library, text] of [
    ['printers_shop', world],
    ['sprout', sprout],
  ] as const) {
    table.add(
      library,
      parseDeclarations(new SourceFile(`${library}.sprout`, text), diagnostics).filter(
        (d) => d.kind === 'enum',
      ),
      diagnostics,
    );
  }
  expect(diagnostics.refusals).toHaveLength(0);
  return table;
}
const symbolOf = (table: EnumTable, library: string, name: string): ValueType => ({
  type: 'symbol',
  of: table.qualified(library, name)!,
});

const BEFORE = enumsOf('enum Ward { oak, silver, brass }\n');
const WARD = symbolOf(BEFORE, 'printers_shop', 'Ward');
const TOOL = symbolOf(BEFORE, 'sprout', 'Tool');
const WARDS: ValueType = { type: 'list', element: WARD };
const GRID: ValueType = { type: 'list', element: WARDS };

// --- the schema ---------------------------------------------------------

/** The canonical golden's world: what differs from the printers' shop's declaration after a few turns. */
function world(): StoredWorld {
  return {
    world: 'printers_shop',
    serial: 4,
    instances: [
      { id: 'printers_shop', properties: { season: 'winter' } },
      {
        id: 'printers_shop#1',
        made: { from: 'visitor' },
        container: 'printers_shop.composing_room',
        arrival: 2,
      },
      {
        id: 'printers_shop#3',
        made: { from: 'spawned', kind: 'printers_shop.Sheet' },
        container: 'printers_shop.drying_loft',
        arrival: 3,
        wakes: [{ serial: 4, askedAt: 1_790_000_000, dueAt: 1_790_002_400 }],
      },
      {
        id: 'printers_shop.composing_room',
        links: { cellar: 'printers_shop#3' },
        memory: { 'printers_shop#1': { visits: 2 } },
        lastTick: 1_790_000_000,
      },
      {
        id: 'printers_shop.composing_room.cabinet',
        properties: { open: true, ward: 'iron' },
      },
    ],
    visitors: [
      {
        visit: 'v-8f2c',
        nickname: 'Marta',
        instance: 'printers_shop#1',
        lastPlace: 'printers_shop.composing_room',
        referents: [],
        lastReading: null,
      },
    ],
    tombstones: ['printers_shop.composing_room.lamp'],
  };
}

/** The world with one instance changed. */
function withInstance(i: number, change: Record<string, unknown>): unknown {
  const stored = world();
  return {
    ...stored,
    instances: stored.instances.map((x, at) => (at === i ? { ...x, ...change } : x)),
  };
}

/** What the schema says about one stored world, as `path: message` lines. */
function issues(input: unknown): string[] {
  const result = StoredWorldSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('the stored form of a world', () => {
  it('accepts a well-formed world, and reads it back as written', () => {
    const stored = world();
    expect(issues(stored)).toEqual([]);
    expect(readStoredWorld(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it('holds only what differs: a record is its id and the fields that differ, and a fresh world has none', () => {
    const fresh = {
      world: 'printers_shop',
      serial: 0,
      instances: [],
      visitors: [],
      tombstones: [],
    };
    expect(readStoredWorld(fresh)).toEqual(fresh);
    expect(issues({ ...fresh, instances: [{ id: 'printers_shop.composing_room' }] })).toEqual([]);
    expect(readStoredWorld({ ...fresh, instances: [{ id: 'printers_shop' }] }).instances).toEqual([
      { id: 'printers_shop' },
    ]);
  });

  it('takes how a minted instance was made from its record, and the rest from the id', () => {
    const stored = world();
    expect(stored.instances.map(madeFrom)).toEqual([
      'world',
      'visitor',
      'spawned',
      'declared',
      'declared',
    ]);
    expect(issues(withInstance(1, { made: undefined }))[0]).toBe(
      'instances.1.made: it should say how the instance was made: visitor, spawned or given.',
    );
    expect(issues(withInstance(3, { made: { from: 'visitor' } }))).toEqual([
      'instances.3.made: a declared id says how it was made; `made` is for a minted one.',
    ]);
    expect(issues(withInstance(0, { made: { from: 'visitor' } }))).toEqual([
      'instances.0.made: a declared id says how it was made; `made` is for a minted one.',
    ]);
    expect(issues(withInstance(1, { made: { from: 'declared' } }))).toHaveLength(1);
  });

  it('stands a declared object where it was declared unless its record says otherwise', () => {
    expect(declaredContainer('printers_shop.composing_room.cabinet')).toBe(
      'printers_shop.composing_room',
    );
    expect(declaredContainer('printers_shop.composing_room')).toBe('printers_shop');
    expect(containerOf({ id: 'printers_shop.composing_room.cabinet' })).toBe(
      'printers_shop.composing_room',
    );
    expect(
      containerOf({ id: 'printers_shop.composing_room.cabinet', container: 'printers_shop#1' }),
    ).toBe('printers_shop#1');
    expect(containerOf({ id: 'printers_shop' })).toBeNull();
    expect(containerOf({ id: 'printers_shop#1', made: { from: 'visitor' } })).toBeNull();
  });

  it('refuses a declared id with a `#` in it', () => {
    expect(issues(withInstance(3, { id: 'printers_shop.cabinet#2' }))).toContain(
      'instances.3.id: `printers_shop.cabinet#2` is not an id in printers_shop.',
    );
  });

  it('refuses a negative serial', () => {
    expect(issues({ ...world(), serial: -1 })[0]).toMatch(/^serial: /);
  });

  it('refuses a minted id, an arrival or a wake past the world’s serial, so none is issued twice', () => {
    expect(issues({ ...world(), serial: 3 })).toEqual([
      "instances.2.wakes.0.serial: serial 4 is past the world's serial, 3.",
    ]);
    expect(issues({ ...world(), serial: 2 })).toHaveLength(4);
  });

  it('refuses another world’s id wherever an id is stored', () => {
    expect(issues(withInstance(4, { container: 'bakery.oven' }))).toEqual([
      'instances.4.container: `bakery.oven` is not an id in printers_shop.',
    ]);
    expect(issues(withInstance(3, { links: { cellar: 'bakery#3' } }))).toHaveLength(1);
    expect(issues(withInstance(4, { memory: { 'bakery#1': {} } }))).toHaveLength(1);
    const stored = world();
    expect(
      issues({
        ...stored,
        visitors: [{ ...stored.visitors[0]!, referents: ['printers_shop.press', 'bakery#2'] }],
      }),
    ).toEqual(['visitors.0.referents.1: `bakery#2` is not an id in printers_shop.']);
    expect(
      issues({
        ...stored,
        visitors: [
          {
            ...stored.visitors[0]!,
            lastReading: {
              verb: { library: 'sprout', name: 'give' },
              bindings: [
                ['item', { object: 'bakery.bun' }],
                ['recipient', { set: ['printers_shop.press', 'bakery#2'] }],
                ['way', { exit: { direction: 'north', label: 'out', to: 'bakery.yard' } }],
              ],
            },
          },
        ],
      }),
    ).toEqual([
      'visitors.0.lastReading.bindings.0.1.object: `bakery.bun` is not an id in printers_shop.',
      'visitors.0.lastReading.bindings.1.1.set.1: `bakery#2` is not an id in printers_shop.',
      'visitors.0.lastReading.bindings.2.1.exit.to: `bakery.yard` is not an id in printers_shop.',
    ]);
  });

  it('reads a drawn way in a last reading as naming no place', () => {
    const stored = world();
    expect(
      issues({
        ...stored,
        visitors: [
          {
            ...stored.visitors[0]!,
            lastReading: {
              verb: { library: 'sprout', name: 'go' },
              bindings: [['way', { exit: { direction: 'west', label: 'west', to: null } }]],
            },
          },
        ],
      }),
    ).toEqual([]);
  });

  it('refuses one id stored twice, and one visit stored twice', () => {
    expect(issues(withInstance(1, { id: 'printers_shop#3' }))).toContain(
      'instances.2.id: `printers_shop#3` is stored twice.',
    );
    const stored = world();
    expect(issues({ ...stored, visitors: [...stored.visitors, stored.visitors[0]] })).toEqual([
      'visitors.1.visit: visit `v-8f2c` is stored twice.',
      'visitors.1.instance: `printers_shop#1` is named by two visitors.',
    ]);
  });

  it('pairs each visitor record with one instance made for a visitor, and each such instance with one record', () => {
    const stored = world();
    const marta = stored.visitors[0]!;
    // Another visit naming the same instance: two people in one body.
    expect(issues({ ...stored, visitors: [marta, { ...marta, visit: 'v-9a01' }] })).toEqual([
      'visitors.1.instance: `printers_shop#1` is named by two visitors.',
    ]);
    // A record naming nothing stored, or something not made for a visitor.
    expect(issues({ ...stored, visitors: [{ ...marta, instance: 'printers_shop#2' }] })).toContain(
      'visitors.0.instance: `printers_shop#2` is not a stored instance.',
    );
    expect(issues({ ...stored, visitors: [{ ...marta, instance: 'printers_shop#3' }] })).toContain(
      "visitors.0.instance: `printers_shop#3` is made from spawned, and a visitor's instance is made from visitor.",
    );
    // An instance made for a visitor with no record of whose it is.
    expect(issues({ ...stored, visitors: [] })).toEqual([
      'instances.1.made: `printers_shop#1` is made from visitor, and no visitor is stored for it.',
    ]);
  });

  it('takes a spawned instance’s content under a minted id, naming its kind and its path there', () => {
    const given = { from: 'given', kind: 'printers_shop.Sheet', path: ['shelf', 'jar'] };
    expect(issues(withInstance(2, { made: given }))).toEqual([]);
    expect(issues(withInstance(4, { made: given }))).toEqual([
      'instances.4.made: a declared id says how it was made; `made` is for a minted one.',
    ]);
    expect(issues(withInstance(2, { made: { ...given, path: [] } }))).toHaveLength(1);
    expect(issues(withInstance(2, { made: { ...given, path: ['Shelf'] } }))).toHaveLength(1);
    expect(issues(withInstance(2, { made: { from: 'given', path: ['jar'] } }))).toHaveLength(1);
  });

  it('keeps a tombstone only for a declared id, once, with nothing stored under or inside it', () => {
    const stored = world();
    expect(issues({ ...stored, tombstones: ['printers_shop#2'] })).toEqual([
      "tombstones.0: `printers_shop#2` is not a declared object's id in printers_shop.",
    ]);
    expect(issues({ ...stored, tombstones: ['printers_shop'] })).toContain(
      "tombstones.0: `printers_shop` is not a declared object's id in printers_shop.",
    );
    expect(issues({ ...stored, tombstones: ['bakery.oven'] })).toHaveLength(1);
    const lamp = 'printers_shop.composing_room.lamp';
    expect(issues({ ...stored, tombstones: [lamp, lamp] })).toEqual([
      `tombstones.1: \`${lamp}\` is a tombstone twice.`,
    ]);
    expect(issues({ ...stored, tombstones: ['printers_shop.composing_room.cabinet'] })).toEqual([
      'instances.4.id: `printers_shop.composing_room.cabinet` was destroyed, and is stored again.',
    ]);
    // A declared object that says nothing of its container is inside what was declared to hold it.
    expect(issues({ ...stored, tombstones: ['printers_shop.composing_room'] })).toEqual([
      'instances.1.container: `printers_shop#1` is inside `printers_shop.composing_room`, which was destroyed.',
      'instances.3.id: `printers_shop.composing_room` was destroyed, and is stored again.',
      'instances.4.container: `printers_shop.composing_room.cabinet` is inside `printers_shop.composing_room`, which was destroyed.',
    ]);
  });

  it('lets a link, a visitor’s last place and what their pronouns name name a tombstone, which the absent rules read', () => {
    const stored = world();
    const withLink = withInstance(2, { links: { up: 'printers_shop.attic' } }) as StoredWorld;
    expect(issues({ ...withLink, tombstones: ['printers_shop.attic'] })).toEqual([]);
    expect(
      issues({
        ...stored,
        visitors: [
          {
            ...stored.visitors[0]!,
            lastPlace: 'printers_shop.attic',
            referents: ['printers_shop.attic'],
          },
        ],
        tombstones: ['printers_shop.attic'],
      }),
    ).toEqual([]);
  });

  it('refuses a store with no tombstones at all', () => {
    const without: Record<string, unknown> = { ...world() };
    delete without.tombstones;
    expect(issues(without)).toHaveLength(1);
  });

  it('refuses a spawn that does not say its kind, a time that is not whole seconds, and a field written null', () => {
    expect(issues(withInstance(2, { made: { from: 'spawned' } }))).toHaveLength(1);
    expect(issues(withInstance(3, { lastTick: 1.5 }))).toHaveLength(1);
    expect(issues(withInstance(3, { lastTick: null }))).toHaveLength(1);
    expect(issues(withInstance(1, { container: null }))).toHaveLength(1);
    expect(issues(withInstance(1, { arrival: null }))).toHaveLength(1);
    expect(issues(withInstance(4, { properties: null }))).toHaveLength(1);
  });
});

describe('one stored record, checked on its own', () => {
  it('reads back every instance and visitor of a well-formed world as written', () => {
    const stored = world();
    for (const record of stored.instances) {
      expect(StoredInstanceSchema.parse(JSON.parse(JSON.stringify(record)))).toEqual(record);
    }
    expect(StoredVisitorSchema.parse(stored.visitors[0])).toEqual(stored.visitors[0]);
    expect(StoredValueSchema.parse([true, [1, 'x']])).toEqual([true, [1, 'x']]);
  });

  it('refuses a record of the wrong shape, and leaves which world its ids belong to for the world', () => {
    const lamp: StoredInstance = { id: 'printers_shop.lamp' };
    expect(StoredInstanceSchema.safeParse({ ...lamp, wakes: null }).success).toBe(false);
    expect(StoredInstanceSchema.safeParse({ ...lamp, lastTick: 1.5 }).success).toBe(false);
    expect(StoredInstanceSchema.safeParse({ ...lamp, properties: { p: null } }).success).toBe(
      false,
    );
    expect(StoredInstanceSchema.safeParse({ ...lamp, id: 'elsewhere.lamp' }).success).toBe(true);
    expect(StoredVisitorSchema.safeParse({ ...world().visitors[0], visit: '' }).success).toBe(
      false,
    );
    expect(StoredValueSchema.safeParse({ type: 'string', value: 'x' }).success).toBe(false);
  });
});

describe('reading stored state the schema refuses', () => {
  it.each([
    null,
    'state',
    { world: 'printers_shop' },
    withInstance(3, { made: { from: 'visitor' } }),
  ])('throws StoredStateUnreadable with the schema’s message for %j', (garbage) => {
    const expected = z.prettifyError(StoredWorldSchema.safeParse(garbage).error!);
    expect(expected.length).toBeGreaterThan(0);
    expect(() => readStoredWorld(garbage)).toThrow(StoredStateUnreadable);
    expect(() => readStoredWorld(garbage)).toThrow(expected);
  });
});

// --- type keys ---------------------------------------------------------

describe('a type’s key, as the catalogue names it', () => {
  it('names a primitive type alone, whatever an integer’s range', () => {
    expect(typeKey(BOOLEAN)).toBe('boolean');
    expect(typeKey(STRING)).toBe('string');
    expect(typeKey(integer())).toBe('integer');
    expect(typeKey(integer(0, 9))).toBe(typeKey(integer(-5, 5)));
  });

  it('names an enum by its library and its name', () => {
    expect(typeKey(WARD)).toBe('printers_shop.Ward');
    expect(typeKey(TOOL)).toBe('sprout.Tool');
  });

  it('brackets a list around its element’s key', () => {
    expect(typeKey(WARDS)).toBe('[printers_shop.Ward]');
    expect(typeKey(GRID)).toBe('[[printers_shop.Ward]]');
    expect(typeKey({ type: 'list', element: integer(0, 9) })).toBe('[integer]');
  });
});

describe('the canonical JSON of a stored world', () => {
  const file = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../corpus/goldens/stored-canon.json',
  );

  it('is the bytes the C runtime reproduces: keys in the schema’s order, integers as digits, nothing at its declaration', () => {
    const canon = readFileSync(file, 'utf8');
    expect(JSON.stringify(readStoredWorld(world())) + '\n').toBe(canon);
    expect(JSON.stringify(readStoredWorld(JSON.parse(canon))) + '\n').toBe(canon);
  });
});
