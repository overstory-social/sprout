// Whether a value is what is wanted where it is given: the same type
// exactly, a bare option in its enum, and a written number in its range.

import { describe, expect, it } from 'vitest';

import { objectOf, showBindingType, valueOf } from '../bindings.js';
import { BOOLEAN, integer, STRING } from '../../declare/types.js';
import { locationOf } from '../../source/source.js';
import type { SymbolExpr } from '../../syntax/ast.js';
import {
  checking,
  expression,
  KEY,
  saidBy,
  vessel,
  VESSEL,
  WARDED,
  warded,
} from '../../fixtures/check.js';
import {
  elementOf,
  held,
  inRange,
  isValue,
  matches,
  option,
  writtenNumber,
  wrongType,
} from './values.js';

const CAPACITY = VESSEL.properties.get('capacity')!;
const WARD = held(WARDED.properties.get('ward')!);

/** A bare option as written. */
function bare(text: string): SymbolExpr {
  const expr = expression(text);
  if (expr.kind !== 'symbol-expr') throw new Error(`\`${text}\` is not an option`);
  return expr;
}

describe('the shape of a value', () => {
  it('is a value of one shape, and a thing in the world is none', () => {
    expect(isValue(valueOf(BOOLEAN), 'boolean')).toBe(true);
    expect(isValue(valueOf(integer()), 'boolean')).toBe(false);
    expect(isValue(valueOf(integer()), 'integer')).toBe(true);
    expect(isValue(objectOf(KEY), 'boolean')).toBe(false);
  });

  it('reads a list’s element, which may itself be a list', () => {
    const opens = KEY.properties.get('opens')!.type;
    const grid = WARDED.properties.get('grid')!.type;
    if (opens.type !== 'list' || grid.type !== 'list') throw new Error('not a list');
    expect(showBindingType(valueOf(elementOf(opens)))).toBe('Ward');
    expect(showBindingType(valueOf(elementOf(grid)))).toBe('[Ward]');
  });

  it('holds a property’s declared type, range included', () => {
    expect(showBindingType(held(CAPACITY))).toBe('integer 0 to 9');
    expect(showBindingType(held(KEY.properties.get('opens')!))).toBe('[Ward]');
  });
});

describe('a written number', () => {
  it('is an integer literal, or one with a minus sign, and nothing worked out', () => {
    expect(writtenNumber(expression('12'))).toBe(12);
    expect(writtenNumber(expression('-3'))).toBe(-3);
    expect(writtenNumber(expression('1 + 2'))).toBeNull();
    expect(writtenNumber(expression('self.get(:capacity)'))).toBeNull();
  });

  it('is refused outside a declared range, and anything read at run time is left alone', () => {
    const context = vessel();
    expect(inRange(expression('9'), CAPACITY.type, context)).toBe(true);
    expect(inRange(expression('self.get(:capacity) + 50'), CAPACITY.type, context)).toBe(true);
    expect(inRange(expression('"a line"'), STRING, context)).toBe(true);
    expect(inRange(expression('-1'), CAPACITY.type, context)).toBe(false);
    expect(saidBy(context)).toEqual(['-1 is outside 0 to 9. Write a whole number from 0 to 9.']);
    expect(locationOf(context.diagnostics.refusals[0]!.at)).toBe('b.sprout:1:1');
  });
});

describe('a value where one is wanted', () => {
  it('checks a bare option against the enum it is given to, and nothing else', () => {
    const context = warded();
    expect(option(bare(':oak'), WARD, context)).toBe(true);
    expect(option(bare(':brass'), WARD, context)).toBe(false);
    expect(option(bare(':oak'), valueOf(integer()), context)).toBe(false);
    const said = saidBy(context);
    expect(said[0]).toContain('`Ward` has no option `brass`');
    expect(said[1]).toBe(
      '`:oak` is an option, and this is integer. An option is compared with something typed by an enum.',
    );
  });

  it('matches the same type exactly, in range, options included', () => {
    const context = checking(warded());
    expect(matches(expression('true'), valueOf(BOOLEAN), context)).toBe(true);
    expect(matches(expression(':silver'), WARD, context)).toBe(true);
    expect(matches(expression('self.get(:ward)'), WARD, context)).toBe(true);
    expect(context.diagnostics.refusals).toEqual([]);

    expect(matches(expression('1'), valueOf(BOOLEAN), context)).toBe(false);
    expect(matches(expression('12'), held(CAPACITY), context)).toBe(false);
    expect(matches(expression('tool'), WARD, context)).toBe(false);
    expect(context.diagnostics.refusals.map((d) => d.message)).toEqual([
      'This holds boolean, and integer is not one.',
      '12 is outside 0 to 9.',
      'This holds Ward, and shop.Key is not one.',
    ]);
  });

  it('refuses a value of the wrong type in words that name both', () => {
    const context = vessel();
    expect(wrongType(expression('1'), valueOf(integer()), valueOf(BOOLEAN), context)).toBe(false);
    expect(saidBy(context)).toEqual([
      'This holds boolean, and integer is not one. Write something of that type.',
    ]);
  });
});
