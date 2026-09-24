// One step up a spine: the operators, row by row through the spec's
// table, and each function of the module asked directly with the type
// below it already known.

import { describe, expect, it } from 'vitest';

import { letBinding, objectOf, showBindingType, valueOf } from '../bindings.js';
import { BOOLEAN, integer } from '../../declare/types.js';
import { locationOf } from '../../source/source.js';
import type { Expr } from '../../syntax/ast.js';
import {
  at,
  bodyOf,
  checking,
  expression,
  RIB,
  read,
  shapeOf,
  VESSEL,
  vessel,
  warded,
  WARDED,
} from '../../fixtures/check.js';
import {
  aboveType,
  binaryType,
  bothAre,
  decide,
  identityType,
  refuseLiteralOutsideRange,
  unaryType,
} from './operators.js';

/** A binary expression as written. */
function binary(text: string): Expr & { readonly kind: 'binary' } {
  const expr = expression(text);
  if (expr.kind !== 'binary') throw new Error(`\`${text}\` is not a binary expression`);
  return expr;
}

const CAPACITY = valueOf(VESSEL.properties.get('capacity')!.type);

describe('what the compiler checks — the table, row by row', () => {
  it('`a == b`, `a != b` — same type', () => {
    expect(shapeOf('self.get(:inked) == self.get(:inked)')).toBe('boolean');
    expect(shapeOf('self.get(:capacity) != 4')).toBe('boolean');
    const mixed = read('self.get(:inked) == 4', vessel());
    expect(mixed.type).toBeNull();
    expect(mixed.said.join(' ')).toContain('`:inked` holds true or false, and 4 is a number.');
  });

  it('`a == b`, `a != b` — not a list, refused at the left list', () => {
    const eq = read('self.get(:row) == self.get(:row)', warded());
    expect(eq.type).toBeNull();
    expect(eq.said).toEqual([
      'Two lists are not compared with `==`. Ask what a list holds instead: `self.get(:opens).includes(:oak)`, or compare its `count`.',
    ]);
    expect(locationOf(eq.diagnostics.refusals[0]!.at)).toBe('b.sprout:1:1');

    const neq = read('self.get(:row) != self.get(:row)', warded());
    expect(neq.type).toBeNull();
    expect(neq.said.join(' ')).toContain('Two lists are not compared with `!=`.');
    expect(locationOf(neq.diagnostics.refusals[0]!.at)).toBe('b.sprout:1:1');

    // A list of lists is still a list.
    const grid = read('self.get(:grid) == self.get(:grid)', warded());
    expect(grid.type).toBeNull();
    expect(grid.said.join(' ')).toContain('Two lists are not compared with `==`.');

    // What a list holds, and how many, are not lists themselves.
    expect(shapeOf('self.get(:row).count == 2', warded())).toBe('boolean');
    expect(shapeOf('tool.get(:opens).includes(:oak)', warded())).toBe('boolean');
  });

  it('`a == b` — a list against something else is a type mismatch, not the list refusal', () => {
    // The list-specific refusal is only for two lists of the same type;
    // a list against anything else falls through to the ordinary
    // "compares X with Y" mismatch, at the whole comparison.
    const withInteger = read('self.get(:row) == 4', warded());
    expect(withInteger.type).toBeNull();
    expect(withInteger.said.join(' ')).toContain(
      'This compares a list of Ward with a whole number,',
    );
    expect(locationOf(withInteger.diagnostics.refusals[0]!.at)).toBe('b.sprout:1:1');

    const withObject = read('self.get(:row) == tool', warded());
    expect(withObject.type).toBeNull();
    expect(withObject.said.join(' ')).toContain('This compares a list of Ward with shop.Key,');

    const withString = read('self.get(:row) == self.get(:note)', warded());
    expect(withString.type).toBeNull();
    expect(withString.said.join(' ')).toContain('This compares a list of Ward with text,');

    // Exactly one refusal per comparison, not the list message too.
    for (const result of [withInteger, withObject, withString]) {
      expect(result.diagnostics.refusals).toHaveLength(1);
      expect(result.said.join(' ')).not.toContain('Two lists are not compared');
    }
  });

  it('`a == b` — a symbol literal must be one of the operand’s options', () => {
    expect(shapeOf('self.get(:state) == :wet', warded())).toBe('boolean');
    const wrong = read('self.get(:state) == :slver', warded());
    expect(wrong.type).toBeNull();
    // The one check an enum exists for: named options, not a comparison
    // that is false for ever.
    expect(wrong.said.join(' ')).toContain('`Drying` has no option `slver`');
    expect(wrong.said.join(' ')).toContain('wet, cured');
  });

  it('`a == b` — a symbol literal on the left is checked against the right, the same as on the right', () => {
    expect(shapeOf(':wet == self.get(:state)', warded())).toBe('boolean');
    expect(shapeOf(':wet != self.get(:state)', warded())).toBe('boolean');

    const leftWrong = read(':slver == self.get(:state)', warded());
    const rightWrong = read('self.get(:state) == :slver', warded());
    expect(leftWrong.type).toBeNull();
    expect(leftWrong.said).toEqual(rightWrong.said);
    expect(locationOf(leftWrong.diagnostics.refusals[0]!.at)).toBe('b.sprout:1:1');

    const leftWrongNeq = read(':slver != self.get(:state)', warded());
    expect(leftWrongNeq.type).toBeNull();
    expect(leftWrongNeq.said).toEqual(rightWrong.said);

    const leftAgainstNonEnum = read(':wet == 4', warded());
    const rightAgainstNonEnum = read('4 == :wet', warded());
    expect(leftAgainstNonEnum.type).toBeNull();
    expect(leftAgainstNonEnum.said).toEqual(rightAgainstNonEnum.said);

    // Neither side names an enum on its own, whichever side it is on.
    const bothLiterals = read(':wet == :dry', warded());
    expect(bothLiterals.type).toBeNull();
    expect(bothLiterals.said.join(' ')).toContain(
      'Neither side of this says which enum its option belongs to.',
    );
  });

  it('`< <= > >=` — both integer', () => {
    expect(shapeOf('self.get(:capacity) > 1')).toBe('boolean');
    expect(shapeOf('1 <= self.get(:capacity)')).toBe('boolean');
    const wrong = read('self.get(:inked) < 1', vessel());
    expect(wrong.type).toBeNull();
    expect(wrong.said.join(' ')).toContain('`<` reads integer, and this is boolean');
  });

  it('`a == b`, `a != b` — an integer literal outside the other operand’s range is always decided', () => {
    // `:capacity` is declared `4 min 0 max 9`.
    const eq = read('self.get(:capacity) == 12', vessel());
    expect(eq.type).toBeNull();
    expect(eq.said).toEqual([
      '12 is outside 0 to 9, so this is always false. Write a whole number from 0 to 9, or take the comparison out.',
    ]);
    expect(locationOf(eq.diagnostics.refusals[0]!.at)).toBe('b.sprout:1:24');

    // The literal on the left is refused the same way, at itself.
    const eqLeft = read('12 == self.get(:capacity)', vessel());
    expect(eqLeft.type).toBeNull();
    expect(eqLeft.said).toEqual(eq.said);
    expect(locationOf(eqLeft.diagnostics.refusals[0]!.at)).toBe('b.sprout:1:1');

    const neq = read('self.get(:capacity) != 12', vessel());
    expect(neq.type).toBeNull();
    expect(neq.said.join(' ')).toContain('12 is outside 0 to 9, so this is always true.');

    // A negated literal is a written number too.
    const negated = read('-1 == self.get(:capacity)', vessel());
    expect(negated.type).toBeNull();
    expect(negated.said.join(' ')).toContain('-1 is outside 0 to 9, so this is always false.');
  });

  it('`a == b` — a literal at either end of the range is untouched', () => {
    expect(shapeOf('self.get(:capacity) == 9')).toBe('boolean');
    expect(shapeOf('self.get(:capacity) == 0')).toBe('boolean');
  });

  it('`a == b` — a full-range integer against any literal is untouched', () => {
    const withLet = bodyOf(VESSEL, letBinding('n', valueOf(integer()), at('n')));
    expect(shapeOf('n == 1000000', withLet)).toBe('boolean');
    expect(shapeOf('self.get(:row).count == 1000000', warded())).toBe('boolean');
  });

  it('`a == b` — two operands with no declared range are untouched', () => {
    expect(shapeOf('self.get(:capacity) == self.get(:capacity)')).toBe('boolean');
  });

  it('`a == b` — a literal against a mismatched type keeps its one type-mismatch refusal', () => {
    const mixed = read('"a" == 12', vessel());
    expect(mixed.type).toBeNull();
    expect(mixed.diagnostics.refusals).toHaveLength(1);
    expect(mixed.said.join(' ')).toContain('This compares text with a whole number,');
  });

  it('`a == b` — a literal of the wrong type is refused at the literal, with what to write', () => {
    const quoted = read('self.get(:ward) == "silver"', warded());
    expect(quoted.type).toBeNull();
    expect(quoted.said).toEqual([
      '`:ward` holds one of oak, silver, and "silver" is text in quotes. Write `:silver`, without quotes.',
    ]);
    expect(locationOf(quoted.diagnostics.refusals[0]!.at)).toBe('b.sprout:1:20');
    // Either side: the literal is what is rewritten.
    const first = read('4 == self.get(:ward)', warded());
    expect(first.said[0]).toContain('`:ward` holds one of oak, silver, and 4 is a number.');
  });

  it('`a == b` — an option written without its colon is answered with the colon', () => {
    const bare = read('self.get(:ward) == oak', warded());
    expect(bare.type).toBeNull();
    expect(bare.said).toEqual([
      '`oak` is an option of `Ward`, and an option is written with its colon here. Write `:oak`.',
    ]);
  });

  it('`< <= > >=` — an integer literal outside the other operand’s range is always decided', () => {
    const above = read('self.get(:capacity) < 12', vessel());
    expect(above.type).toBeNull();
    expect(above.said.join(' ')).toContain('12 is outside 0 to 9, so this is always true.');

    const aboveLe = read('self.get(:capacity) <= 12', vessel());
    expect(aboveLe.said.join(' ')).toContain('12 is outside 0 to 9, so this is always true.');

    const aboveGt = read('self.get(:capacity) > 12', vessel());
    expect(aboveGt.said.join(' ')).toContain('12 is outside 0 to 9, so this is always false.');

    const aboveGe = read('self.get(:capacity) >= 12', vessel());
    expect(aboveGe.said.join(' ')).toContain('12 is outside 0 to 9, so this is always false.');

    const below = read('self.get(:capacity) < -1', vessel());
    expect(below.said.join(' ')).toContain('-1 is outside 0 to 9, so this is always false.');

    const belowLe = read('self.get(:capacity) <= -1', vessel());
    expect(belowLe.said.join(' ')).toContain('-1 is outside 0 to 9, so this is always false.');

    const belowGt = read('self.get(:capacity) > -1', vessel());
    expect(belowGt.said.join(' ')).toContain('-1 is outside 0 to 9, so this is always true.');

    const belowGe = read('self.get(:capacity) >= -1', vessel());
    expect(belowGe.said.join(' ')).toContain('-1 is outside 0 to 9, so this is always true.');

    // A literal on the left flips which end of the range decides it.
    const literalLeft = read('12 < self.get(:capacity)', vessel());
    expect(literalLeft.said.join(' ')).toContain('12 is outside 0 to 9, so this is always false.');
  });

  it('`< <= > >=` — a literal within the range is untouched', () => {
    expect(shapeOf('self.get(:capacity) < 5')).toBe('boolean');
    expect(shapeOf('5 <= self.get(:capacity)')).toBe('boolean');
  });

  it('`+ -`, unary `-` — integer', () => {
    expect(shapeOf('self.get(:capacity) + 1')).toBe('integer');
    expect(shapeOf('self.get(:capacity) - 1')).toBe('integer');
    expect(shapeOf('-self.get(:capacity)')).toBe('integer');
    expect(read('-self.get(:inked)', vessel()).type).toBeNull();
  });

  it('`&& || !` — operands boolean, with no truthiness and no coercion', () => {
    expect(shapeOf('self.get(:inked) && self.get(:inked)')).toBe('boolean');
    expect(shapeOf('!self.get(:inked)')).toBe('boolean');
    for (const text of ['1 && self.get(:inked)', 'self.get(:inked) || 0', '!1']) {
      const wrong = read(text, vessel());
      expect(wrong.type, text).toBeNull();
      expect(wrong.said.join(' '), text).toMatch(/truthiness|number/);
    }
  });
});

describe('one step up a spine, asked directly', () => {
  it('decides a comparison of two written numbers, and nothing else', () => {
    expect(decide('==', 2, 2)).toBe(true);
    expect(decide('!=', 2, 2)).toBe(false);
    expect(decide('<', 1, 2)).toBe(true);
    expect(decide('<=', 2, 2)).toBe(true);
    expect(decide('>', 1, 2)).toBe(false);
    expect(decide('>=', 2, 1)).toBe(true);
    // Arithmetic decides no comparison.
    expect(decide('+', 1, 2)).toBe(false);
  });

  it('gives `!` a boolean and `-` an integer, and refuses anything else', () => {
    const context = vessel();
    expect(unaryType('!', at('n'), valueOf(BOOLEAN), context)).toEqual(valueOf(BOOLEAN));
    // A minus sign gives the whole range back, not the operand's.
    expect(showBindingType(unaryType('-', at('n'), CAPACITY, context)!)).toBe('integer');
    expect(context.diagnostics.refusals).toEqual([]);

    expect(unaryType('!', at('n'), CAPACITY, context)).toBeNull();
    expect(unaryType('-', at('n'), valueOf(BOOLEAN), context)).toBeNull();
    expect(context.diagnostics.refusals.map((d) => d.message)).toEqual([
      '`!` turns true into false, and this is integer 0 to 9.',
      'A minus sign needs a number, and this is boolean.',
    ]);
  });

  it('trusts the type it is given for the left, and types only the right', () => {
    // The spine has already typed the left, so the type handed in is the
    // one checked, whatever the left is written as.
    const context = checking(vessel());
    expect(
      binaryType('+', binary('self.get(:capacity) + 1'), valueOf(BOOLEAN), context),
    ).toBeNull();
    expect(context.diagnostics.refusals.map((d) => d.message)).toEqual([
      '`+` reads integer, and this is boolean.',
    ]);
    expect(locationOf(context.diagnostics.refusals[0]!.at)).toBe('b.sprout:1:1');
  });

  it('refuses at the first side that is not what the operator reads', () => {
    const context = vessel();
    const both = binary('1 && 2');
    expect(bothAre(BOOLEAN, '&&', both, valueOf(BOOLEAN), valueOf(BOOLEAN), context)).toBe(true);
    expect(bothAre(BOOLEAN, '&&', both, CAPACITY, CAPACITY, context)).toBe(false);
    expect(context.diagnostics.refusals).toHaveLength(1);
    expect(locationOf(context.diagnostics.refusals[0]!.at)).toBe('b.sprout:1:1');
  });

  it('checks a bare option on the left against the right, with no left type', () => {
    const context = checking(warded());
    expect(identityType(binary(':oak == self.get(:ward)'), null, context)).toEqual(
      valueOf(BOOLEAN),
    );
    expect(identityType(binary(':brass == self.get(:ward)'), null, context)).toBeNull();
    expect(context.diagnostics.refusals[0]!.message).toContain('`Ward` has no option `brass`');
  });

  it('lets two things in the world be compared, whatever their kinds', () => {
    const context = checking(warded());
    expect(identityType(binary('tool == self'), objectOf(WARDED), context)).toEqual(
      valueOf(BOOLEAN),
    );
    expect(context.diagnostics.refusals).toEqual([]);
  });

  it('refuses a literal outside the range at the literal, and nothing else', () => {
    const context = vessel();
    const whole = valueOf(integer());
    expect(
      refuseLiteralOutsideRange('<', binary('self.get(:capacity) < 12'), CAPACITY, whole, context),
    ).toBe(true);
    expect(
      refuseLiteralOutsideRange('<', binary('self.get(:capacity) < 5'), CAPACITY, whole, context),
    ).toBe(false);
    // Two written numbers, or none, decide nothing about a range.
    expect(refuseLiteralOutsideRange('<', binary('12 < 13'), whole, whole, context)).toBe(false);
    expect(
      refuseLiteralOutsideRange(
        '<',
        binary('self.get(:capacity) < self.get(:capacity)'),
        CAPACITY,
        CAPACITY,
        context,
      ),
    ).toBe(false);
    expect(context.diagnostics.refusals.map((d) => d.message)).toEqual([
      '12 is outside 0 to 9, so this is always true.',
    ]);
    expect(locationOf(context.diagnostics.refusals[0]!.at)).toBe('b.sprout:1:23');
  });

  it('hands a reading to the readings, and anything else back as it was', () => {
    const context = checking(vessel());
    const set = context.scope.lookup('tools')!.type;
    expect(aboveType(expression('tools.count'), set, context)).toEqual(valueOf(integer()));
    expect(aboveType(expression('tools.count(Rib)'), set, context)).toEqual(valueOf(integer()));
    const below = objectOf(RIB);
    expect(aboveType(expression('true'), below, context)).toBe(below);
    expect(context.diagnostics.refusals).toEqual([]);
  });
});
