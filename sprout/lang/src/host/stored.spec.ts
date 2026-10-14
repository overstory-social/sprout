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
  readStoredWorld,
  StoredInstanceSchema,
  StoredPropertySchema,
  StoredStateUnreadable,
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

function instance(over: Partial<StoredInstance> & Pick<StoredInstance, 'id' | 'made'>) {
  return {
    container: 'printers_shop',
    arrival: null,
    properties: {},
    links: {},
    wakes: [],
    memory: {},
    lastTick: null,
    ...over,
  };
}

function world(): StoredWorld {
  return {
    world: 'printers_shop',
    serial: 4,
    instances: [
      instance({ id: 'printers_shop', made: { from: 'world' }, container: null }),
      instance({
        id: 'printers_shop.composing_room',
        made: { from: 'declared' },
        lastTick: 1_790_000_000,
        links: { cellar: 'printers_shop#3' },
      }),
      instance({
        id: 'printers_shop.composing_room.cabinet',
        made: { from: 'declared' },
        container: 'printers_shop.composing_room',
        properties: { opens: { type: '[printers_shop.Ward]', value: ['oak'] } },
        memory: { 'printers_shop#1': { visits: { type: 'integer', value: 2 } } },
      }),
      instance({
        id: 'printers_shop#1',
        made: { from: 'visitor' },
        container: 'printers_shop.composing_room',
        arrival: 2,
      }),
      instance({
        id: 'printers_shop#3',
        made: { from: 'spawned', kind: 'printers_shop.Cellar' },
        container: 'printers_shop',
        arrival: 3,
        wakes: [{ serial: 4, askedAt: 1_790_000_000, dueAt: 1_790_010_800 }],
      }),
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

  it('refuses a minted id on a declared object', () => {
    expect(issues(withInstance(2, { id: 'printers_shop#2' }))).toEqual([
      'instances.2.made: `printers_shop#2` is a minted id, and made from declared takes a declared one.',
    ]);
  });

  it('refuses a declared path on something minted, and the world’s name on anything but the world', () => {
    expect(issues(withInstance(4, { id: 'printers_shop.cellar' }))).toHaveLength(1);
    expect(issues(withInstance(1, { id: 'printers_shop' }))[0]).toMatch(/is a world id/);
  });

  it('refuses a declared id with a `#` in it', () => {
    expect(issues(withInstance(2, { id: 'printers_shop.cabinet#2' }))).toEqual([
      'instances.2.id: `printers_shop.cabinet#2` is not an id in printers_shop.',
    ]);
  });

  it('refuses a negative serial', () => {
    expect(issues({ ...world(), serial: -1 })[0]).toMatch(/^serial: /);
  });

  it('refuses a minted id, an arrival or a wake past the world’s serial, so none is issued twice', () => {
    expect(issues({ ...world(), serial: 3 })).toEqual([
      "instances.4.wakes.0.serial: serial 4 is past the world's serial, 3.",
    ]);
    expect(issues({ ...world(), serial: 2 })).toHaveLength(4);
  });

  it('refuses another world’s id wherever an id is stored', () => {
    expect(issues(withInstance(2, { container: 'bakery.oven' }))).toEqual([
      'instances.2.container: `bakery.oven` is not an id in printers_shop.',
    ]);
    expect(issues(withInstance(1, { links: { cellar: 'bakery#3' } }))).toHaveLength(1);
    expect(issues(withInstance(2, { memory: { 'bakery#1': {} } }))).toHaveLength(1);
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

  it('refuses one id stored twice, and one visit stored twice', () => {
    expect(issues(withInstance(3, { id: 'printers_shop#3' }))).toContain(
      'instances.4.id: `printers_shop#3` is stored twice.',
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
      'instances.3.made: `printers_shop#1` is made from visitor, and no visitor is stored for it.',
    ]);
  });

  it('takes a spawned instance’s content under a minted id, naming its kind and its path there', () => {
    const given = { from: 'given', kind: 'printers_shop.Cellar', path: ['shelf', 'jar'] };
    expect(issues(withInstance(4, { made: given }))).toEqual([]);
    expect(issues(withInstance(2, { made: given }))).toEqual([
      'instances.2.made: `printers_shop.composing_room.cabinet` is a declared id, and made from given takes a minted one.',
    ]);
    expect(issues(withInstance(4, { made: { ...given, path: [] } }))).toHaveLength(1);
    expect(issues(withInstance(4, { made: { ...given, path: ['Shelf'] } }))).toHaveLength(1);
    expect(issues(withInstance(4, { made: { from: 'given', path: ['jar'] } }))).toHaveLength(1);
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
      'instances.2.id: `printers_shop.composing_room.cabinet` was destroyed, and is stored again.',
    ]);
    expect(issues({ ...stored, tombstones: ['printers_shop.composing_room'] })).toEqual([
      'instances.1.id: `printers_shop.composing_room` was destroyed, and is stored again.',
      'instances.2.container: `printers_shop.composing_room.cabinet` is inside `printers_shop.composing_room`, which was destroyed.',
      'instances.3.container: `printers_shop#1` is inside `printers_shop.composing_room`, which was destroyed.',
    ]);
  });

  it('lets a link, a visitor’s last place and what their pronouns name name a tombstone, which the absent rules read', () => {
    const stored = world();
    const withLink = withInstance(4, { links: { up: 'printers_shop.attic' } }) as StoredWorld;
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

  it('refuses a spawn that does not say its kind, and a time that is not whole seconds', () => {
    expect(issues(withInstance(4, { made: { from: 'spawned' } }))).toHaveLength(1);
    expect(issues(withInstance(1, { lastTick: 1.5 }))).toHaveLength(1);
  });
});

describe('one stored record, checked on its own', () => {
  it('reads back every instance and visitor of a well-formed world as written', () => {
    const stored = world();
    for (const record of stored.instances) {
      expect(StoredInstanceSchema.parse(JSON.parse(JSON.stringify(record)))).toEqual(record);
    }
    expect(StoredVisitorSchema.parse(stored.visitors[0])).toEqual(stored.visitors[0]);
    expect(StoredPropertySchema.parse({ type: 'string', value: 'x' })).toEqual({
      type: 'string',
      value: 'x',
    });
  });

  it('refuses a record of the wrong shape, and leaves which world its ids belong to for the world', () => {
    const lamp = instance({ id: 'printers_shop.lamp', made: { from: 'declared' } });
    expect(StoredInstanceSchema.safeParse({ ...lamp, wakes: undefined }).success).toBe(false);
    expect(StoredInstanceSchema.safeParse({ ...lamp, lastTick: 1.5 }).success).toBe(false);
    expect(StoredInstanceSchema.safeParse({ ...lamp, id: 'elsewhere.lamp' }).success).toBe(true);
    expect(StoredVisitorSchema.safeParse({ ...world().visitors[0], visit: '' }).success).toBe(
      false,
    );
    expect(StoredPropertySchema.safeParse({ type: '', value: 1 }).success).toBe(false);
  });
});

describe('reading stored state the schema refuses', () => {
  it.each([null, 'state', { world: 'printers_shop' }, withInstance(2, { id: 'printers_shop#2' })])(
    'throws StoredStateUnreadable with the schema’s message for %j',
    (garbage) => {
      const expected = z.prettifyError(StoredWorldSchema.safeParse(garbage).error!);
      expect(expected.length).toBeGreaterThan(0);
      expect(() => readStoredWorld(garbage)).toThrow(StoredStateUnreadable);
      expect(() => readStoredWorld(garbage)).toThrow(expected);
    },
  );
});

// --- type keys ---------------------------------------------------------

describe('a type’s key, as stored state records it', () => {
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

  it('is the bytes the C runtime reproduces: keys in the schema’s order, integers as digits', () => {
    const canon = readFileSync(file, 'utf8');
    expect(JSON.stringify(readStoredWorld(world())) + '\n').toBe(canon);
    expect(JSON.stringify(readStoredWorld(JSON.parse(canon))) + '\n').toBe(canon);
  });
});
