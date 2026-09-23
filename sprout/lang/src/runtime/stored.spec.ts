import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { ValueType } from '../declare/types.js';
import { DEFAULT_LIMITS, limitsFrom } from '../bundle/limits.js';
import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from '../declare/enums.js';
import { integer, BOOLEAN, STRING } from '../declare/types.js';
import { parseDeclarations } from '../syntax/parse.js';
import { SourceFile } from '../source/source.js';
import { SproutList } from './lists.js';
import { fits, typeKey, type Value } from './values.js';
import {
  decodeValue,
  encodeValue,
  readStoredWorld,
  StoredStateUnreadable,
  StoredWorldSchema,
  type StoredInstance,
  type StoredValue,
  type StoredWorld,
} from './stored.js';

const CAPS = DEFAULT_LIMITS.caps;

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
        properties: { opens: encodeValue(WARDS, SproutList.of(WARD, ['oak'])) },
        memory: { 'printers_shop#1': { visits: encodeValue(integer(0, 99), 2) } },
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
      },
    ],
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
  });

  it('refuses one id stored twice, and one visit stored twice', () => {
    expect(issues(withInstance(3, { id: 'printers_shop#3' }))).toContain(
      'instances.4.id: `printers_shop#3` is stored twice.',
    );
    const stored = world();
    expect(issues({ ...stored, visitors: [...stored.visitors, stored.visitors[0]] })).toEqual([
      'visitors.1.visit: visit `v-8f2c` is stored twice.',
    ]);
  });

  it('refuses a spawn that does not say its kind, and a time that is not whole seconds', () => {
    expect(issues(withInstance(4, { made: { from: 'spawned' } }))).toHaveLength(1);
    expect(issues(withInstance(1, { lastTick: 1.5 }))).toHaveLength(1);
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

// --- values ---------------------------------------------------------------

/** Encode under one type, through JSON as a store would, and decode under another. */
function carried(written: ValueType, value: Value, read: ValueType, caps = CAPS) {
  const stored = JSON.parse(JSON.stringify(encodeValue(written, value)));
  return decodeValue(read, stored, caps);
}

describe('a value round-trips through its stored form', () => {
  const cases: [string, ValueType, Value][] = [
    ['a boolean', BOOLEAN, true],
    ['an integer', integer(-5, 5), -5],
    ['a string', STRING, 'a line'],
    ['an option', WARD, 'silver'],
    ['an option of another library', TOOL, 'bodkin'],
    ['a list', WARDS, SproutList.of(WARD, ['silver', 'oak'])],
    ['an empty list', WARDS, SproutList.of(WARD, [])],
    [
      'a list of lists',
      GRID,
      SproutList.of(WARDS, [SproutList.of(WARD, ['oak']), SproutList.of(WARD, ['brass', 'oak'])]),
    ],
  ];

  it.each(cases)('decodes %s to what was encoded', (_, type, value) => {
    const decoded = carried(type, value, type);
    expect(decoded.fits).toBe(true);
    if (!decoded.fits) return;
    expect(String(decoded.value)).toBe(String(value));
    expect(fits(type, decoded.value, CAPS)).toBe(true);
    if (value instanceof SproutList) {
      expect(decoded.value).toBeInstanceOf(SproutList);
      expect((decoded.value as SproutList).holds).toEqual(value.holds);
    } else {
      expect(decoded.value).toBe(value);
    }
  });

  it('stores a list as an array, an inner list as an inner array', () => {
    const grid = SproutList.of(WARDS, [SproutList.of(WARD, ['oak']), SproutList.of(WARD, [])]);
    expect(encodeValue(GRID, grid)).toEqual({
      type: '[[printers_shop.Ward]]',
      value: [['oak'], []],
    });
    expect(encodeValue(TOOL, 'awl')).toEqual({ type: 'sprout.Tool', value: 'awl' });
  });
});

describe('a stored value that no longer fits falls to the default', () => {
  it('is retyped when written under another type, even when it would fit the new one', () => {
    expect(fits(WARD, 'oak', CAPS)).toBe(true);
    expect(carried(STRING, 'oak', WARD)).toEqual({ fits: false, why: 'retyped' });
    expect(carried(BOOLEAN, true, STRING)).toEqual({ fits: false, why: 'retyped' });
  });

  it('is retyped when its enum is another library’s of the same name', () => {
    const other = symbolOf(enumsOf('enum Ward { oak }\n', 'enum Ward { oak }\n'), 'sprout', 'Ward');
    expect(carried(WARD, 'oak', other)).toEqual({ fits: false, why: 'retyped' });
  });

  it('is retyped when a list’s element type changed', () => {
    expect(carried(WARDS, SproutList.of(WARD, ['oak']), GRID)).toEqual({
      fits: false,
      why: 'retyped',
    });
  });

  it('no longer fits a narrowed range, and is not clamped into it', () => {
    expect(carried(integer(0, 99), 50, integer(0, 9))).toEqual({
      fits: false,
      why: 'no-longer-fits',
    });
    expect(carried(integer(0, 99), 0, integer(1, 9))).toEqual({
      fits: false,
      why: 'no-longer-fits',
    });
  });

  it('no longer fits once its option is removed', () => {
    const after = symbolOf(enumsOf('enum Ward { oak, silver }\n'), 'printers_shop', 'Ward');
    expect(carried(WARD, 'brass', after)).toEqual({ fits: false, why: 'no-longer-fits' });
    expect(carried(WARD, 'oak', after)).toMatchObject({ fits: true, value: 'oak' });
  });

  it('no longer fits a host whose list cap is now below its length', () => {
    const three = SproutList.of(WARD, ['oak', 'silver', 'brass']);
    const two = limitsFrom({ caps: { listElements: 2 } }).caps;
    expect(carried(WARDS, three, WARDS, two)).toEqual({ fits: false, why: 'no-longer-fits' });
    expect(carried(WARDS, three, WARDS, limitsFrom({ caps: { listElements: 3 } }).caps).fits).toBe(
      true,
    );
  });

  it('defaults whole when one element misfits, keeping none of the rest', () => {
    const after = symbolOf(enumsOf('enum Ward { oak, silver }\n'), 'printers_shop', 'Ward');
    const held = SproutList.of(WARD, ['oak', 'brass', 'silver']);
    expect(carried(WARDS, held, { type: 'list', element: after })).toEqual({
      fits: false,
      why: 'no-longer-fits',
    });
    const grid = SproutList.of(WARDS, [
      SproutList.of(WARD, ['oak']),
      SproutList.of(WARD, ['brass']),
    ]);
    expect(
      carried(GRID, grid, { type: 'list', element: { type: 'list', element: after } }),
    ).toEqual({
      fits: false,
      why: 'no-longer-fits',
    });
  });

  it('no longer fits when what is stored is not the shape its key says', () => {
    const cases: [ValueType, StoredValue][] = [
      [WARDS, ['oak', 'oak']],
      [WARDS, 'oak'],
      [WARD, ['oak']],
      [integer(), 1.5],
      [BOOLEAN, 'true'],
      [GRID, ['oak']],
    ];
    for (const [type, value] of cases) {
      expect(
        decodeValue(type, { type: typeKey(type), value }, CAPS),
        JSON.stringify(value),
      ).toEqual({
        fits: false,
        why: 'no-longer-fits',
      });
    }
  });
});

describe('a stored value that still fits keeps its value', () => {
  it('keeps an integer when its range was widened', () => {
    expect(carried(integer(0, 9), 9, integer(-10, 99))).toEqual({ fits: true, value: 9 });
  });

  it('keeps an option when another was added beside it', () => {
    const after = symbolOf(
      enumsOf('enum Ward { oak, silver, brass, iron }\n'),
      'printers_shop',
      'Ward',
    );
    expect(carried(WARD, 'brass', after)).toEqual({ fits: true, value: 'brass' });
    const decoded = carried(WARDS, SproutList.of(WARD, ['brass', 'oak']), {
      type: 'list',
      element: after,
    });
    expect(decoded.fits && decoded.value.toString()).toBe('[brass, oak]');
  });
});
