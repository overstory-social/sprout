import { describe, expect, it } from 'vitest';

import type { ValueType } from '../declare/types.js';
import { DEFAULT_LIMITS, limitsFrom } from '../bundle/limits.js';
import { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from '../declare/enums.js';
import { integer, BOOLEAN, STRING } from '../declare/types.js';
import { parseDeclarations, parseProperty } from '../syntax/parse.js';
import { resolveProperty, type ResolvedProperty } from '../declare/properties.js';
import { SourceFile } from '../source/source.js';
import { SproutList } from './lists.js';
import { defaultOf, fits, typeKey, valueOfLiteral } from './values.js';

const CAPS = DEFAULT_LIMITS.caps;
const ALLOWED = CAPS.listElements;

function enums(): EnumTable {
  const table = new EnumTable();
  const diagnostics = new Diagnostics();
  const add = (library: string, text: string) =>
    table.add(
      library,
      parseDeclarations(new SourceFile(`${library}.sprout`, text), diagnostics).filter(
        (d) => d.kind === 'enum',
      ),
      diagnostics,
    );
  add('printers_shop', 'enum Ward { oak, silver }\nenum Drying { wet, cured }\n');
  add('sprout', 'enum Tool { awl, bodkin }\n');
  expect(diagnostics.refusals).toHaveLength(0);
  return table;
}
const ENUMS = enums();
const WARD: ValueType = { type: 'symbol', of: ENUMS.qualified('printers_shop', 'Ward')! };
const WARDS: ValueType = { type: 'list', element: WARD };

/** A property as a kind in `printers_shop` declares it. */
function declare(text: string): ResolvedProperty {
  const diagnostics = new Diagnostics();
  const declared = parseProperty(new SourceFile('kiln.sprout', text), diagnostics);
  const resolved =
    declared &&
    resolveProperty(declared, ENUMS, 'printers_shop', 'printers_shop.Kiln', diagnostics);
  expect(diagnostics.refusals).toHaveLength(0);
  return resolved!;
}

describe('every instance starts at its property’s default', () => {
  it('reads a boolean, an integer and a string as written', () => {
    expect(defaultOf(declare(':lit false'), CAPS)).toBe(false);
    expect(defaultOf(declare(':lit boolean default true'), CAPS)).toBe(true);
    expect(defaultOf(declare(':wear 3 min 0 max 99'), CAPS)).toBe(3);
    expect(defaultOf(declare(':note "a line"'), CAPS)).toBe('a line');
  });

  it('holds an option as its bare name', () => {
    expect(defaultOf(declare(':state Drying default wet'), CAPS)).toBe('wet');
  });

  it('reads an option written with its enum, and with its library', () => {
    expect(defaultOf(declare(':ward Ward.silver'), CAPS)).toBe('silver');
    expect(defaultOf(declare(':tool sprout.Tool.bodkin'), CAPS)).toBe('bodkin');
  });

  it('makes a list of the property’s element type, in the order written', () => {
    const opens = defaultOf(declare(':opens [Ward] default [silver, oak]'), CAPS);
    expect(opens).toBeInstanceOf(SproutList);
    const list = opens as SproutList;
    expect(list.holds).toEqual(WARD);
    expect(list.elements).toEqual(['silver', 'oak']);
    expect(defaultOf(declare(':cars [Ward] default []'), CAPS)).toMatchObject({ count: 0 });
  });

  it('makes a list of lists, each inner list of the inner element type', () => {
    const rings = defaultOf(declare(':rings [[Ward]] default [[oak], [oak, silver]]'), CAPS);
    const outer = rings as SproutList;
    expect(outer.holds).toEqual(WARDS);
    expect(outer.elements.map(String)).toEqual(['[oak]', '[oak, silver]']);
    expect((outer.elements[1] as SproutList).holds).toEqual(WARD);
    expect(fits({ type: 'list', element: WARDS }, rings, CAPS)).toBe(true);
  });
});

describe('a literal that is not a value of its type never becomes one', () => {
  it('refuses rather than build a value the type cannot hold', () => {
    const declared = declare(':wear 3 min 0 max 9').declaration.default!;
    expect(() => valueOfLiteral(integer(0, 2), declared, CAPS)).toThrow(/integer 0 to 2/);
    const option = declare(':ward Ward.silver').declaration.default!;
    expect(() => valueOfLiteral(BOOLEAN, option, CAPS)).toThrow();
    const list = declare(':opens [Ward] default [oak]').declaration.default!;
    expect(() => valueOfLiteral(WARD, list, CAPS)).toThrow();
  });
});

describe('whether a value fits a type', () => {
  it('holds an integer to its range, both ends included', () => {
    const wear = integer(0, 99);
    expect(fits(wear, 0, CAPS)).toBe(true);
    expect(fits(wear, 99, CAPS)).toBe(true);
    expect(fits(wear, -1, CAPS)).toBe(false);
    expect(fits(wear, 100, CAPS)).toBe(false);
  });

  it('takes only whole numbers as integers', () => {
    expect(fits(integer(), 1.5, CAPS)).toBe(false);
    expect(fits(integer(), Number.NaN, CAPS)).toBe(false);
    expect(fits(integer(), '3', CAPS)).toBe(false);
  });

  it('holds an option to its enum', () => {
    expect(fits(WARD, 'oak', CAPS)).toBe(true);
    expect(fits(WARD, 'brass', CAPS)).toBe(false);
    expect(fits(WARD, true, CAPS)).toBe(false);
  });

  it('holds a boolean and a string to their own kind of value', () => {
    expect(fits(BOOLEAN, false, CAPS)).toBe(true);
    expect(fits(BOOLEAN, 'false', CAPS)).toBe(false);
    expect(fits(STRING, '', CAPS)).toBe(true);
    expect(fits(STRING, 0, CAPS)).toBe(false);
  });

  it('holds a list to the host’s cap, at it and not one over', () => {
    const numbers = { type: 'list', element: integer() } as const;
    const at = SproutList.of(
      integer(),
      Array.from({ length: ALLOWED }, (_, i) => i),
    );
    expect(fits(numbers, at, CAPS)).toBe(true);
    // One over the host's cap as it now stands: a list built under a
    // larger cap no longer fits a host that lowered it.
    const lowered = limitsFrom({ caps: { listElements: ALLOWED - 1 } }).caps;
    expect(fits(numbers, at, lowered)).toBe(false);
  });

  it('holds a list to its element type, and each element to it', () => {
    expect(fits(WARDS, SproutList.of(WARD, ['oak']), CAPS)).toBe(true);
    expect(fits(WARDS, SproutList.of(STRING, ['oak']), CAPS)).toBe(false);
    expect(fits(WARDS, 'oak', CAPS)).toBe(false);
    const digits = { type: 'list', element: integer(0, 9) } as const;
    expect(fits(digits, SproutList.of(integer(), [1, 2]), CAPS)).toBe(true);
    expect(fits(digits, SproutList.of(integer(), [1, 10]), CAPS)).toBe(false);
  });

  it('holds a list to its type all the way down', () => {
    const grid = { type: 'list', element: WARDS } as const;
    const good = SproutList.of(WARDS, [SproutList.of(WARD, ['oak'])]);
    const bad = SproutList.of(WARDS, [
      SproutList.of(WARD, ['oak']),
      SproutList.of(WARD, ['brass']),
    ]);
    expect(fits(grid, good, CAPS)).toBe(true);
    expect(fits(grid, bad, CAPS)).toBe(false);
  });
});

describe('a type’s key', () => {
  it('names the built-in types, and an integer without its range', () => {
    expect(typeKey(BOOLEAN)).toBe('boolean');
    expect(typeKey(STRING)).toBe('string');
    expect(typeKey(integer())).toBe('integer');
    expect(typeKey(integer(0, 9))).toBe(typeKey(integer(-5, 5)));
  });

  it('names an enum by its library and its name', () => {
    expect(typeKey(WARD)).toBe('printers_shop.Ward');
    expect(typeKey(declare(':tool sprout.Tool.awl').type)).toBe('sprout.Tool');
  });

  it('brackets a list around its element’s key', () => {
    expect(typeKey(WARDS)).toBe('[printers_shop.Ward]');
    expect(typeKey({ type: 'list', element: WARDS })).toBe('[[printers_shop.Ward]]');
    expect(typeKey({ type: 'list', element: integer(0, 9) })).toBe('[integer]');
  });
});
