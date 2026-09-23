// One step up a spine: the operator or reading above an expression whose
// type is already known (the spec's Properties › What the compiler
// checks, Precedence). There is no truthiness and no coercion — `&&`
// takes booleans, `<` takes integers, and a comparison takes two of the
// same type — and an integer literal outside the other side's declared
// range is refused, because the comparison is then decided before the
// world runs.

import type { BinaryOperator, Expr, SymbolExpr } from '../../syntax/ast.js';
import { showBindingType, valueOf, type BindingType } from '../bindings.js';
import { BOOLEAN, integer, sameType, showType, type ValueType } from '../../declare/types.js';
import type { Span } from '../../source/source.js';
import type { CheckContext, Checker } from './checker.js';
import { callType, memberType } from './readings.js';
import { isValue, option, writtenNumber } from './values.js';

/** The type of `expr`, one step above `below`, the type of what it is written on. */
export function aboveType(expr: Expr, below: BindingType, context: Checker): BindingType | null {
  switch (expr.kind) {
    case 'unary':
      return unaryType(expr.operator, expr.operand.at, below, context);
    case 'binary':
      return binaryType(expr.operator, expr, below, context);
    case 'member':
      return memberType(expr.receiver, below, expr.member, context);
    case 'call':
      return callType(expr.receiver, below, expr.method, expr.arguments, context);
    default:
      return below;
  }
}

/** `!e` takes a boolean and `-e` an integer, and each gives back the same. */
export function unaryType(
  operator: string,
  at: Span,
  operand: BindingType,
  context: CheckContext,
): BindingType | null {
  const wanted = operator === '!' ? BOOLEAN : integer();
  if (!isValue(operand, wanted.type)) {
    context.diagnostics.refuse(
      at,
      operator === '!'
        ? `\`!\` turns true into false, and this is ${showBindingType(operand)}.`
        : `A minus sign needs a number, and this is ${showBindingType(operand)}.`,
      operator === '!'
        ? 'There is no truthiness in Sprout: write a comparison.'
        : 'Write a whole number, or something that reads one.',
    );
    return null;
  }
  return valueOf(operator === '!' ? BOOLEAN : integer());
}

/** A binary operator over a left side already typed: it types the right and checks both. */
export function binaryType(
  operator: BinaryOperator,
  expr: Expr & { readonly kind: 'binary' },
  left: BindingType,
  context: Checker,
): BindingType | null {
  if (operator === '==' || operator === '!=') return identityType(expr, left, context);

  const right = context.typeOf(expr.right);
  if (right === null) return null;

  if (operator === '&&' || operator === '||') {
    return bothAre(BOOLEAN, operator, expr, left, right, context) ? valueOf(BOOLEAN) : null;
  }
  if (!bothAre(integer(), operator, expr, left, right, context)) return null;
  if (
    (operator === '<' || operator === '<=' || operator === '>' || operator === '>=') &&
    refuseLiteralOutsideRange(operator, expr, left, right, context)
  ) {
    return null;
  }
  const comparison = operator === '+' || operator === '-' ? integer() : BOOLEAN;
  return valueOf(comparison);
}

/** Whether both sides are values of `wanted`, refusing at the first that is not. */
export function bothAre(
  wanted: ValueType,
  operator: string,
  expr: Expr & { readonly kind: 'binary' },
  left: BindingType,
  right: BindingType,
  context: CheckContext,
): boolean {
  for (const [side, type] of [
    [expr.left, left],
    [expr.right, right],
  ] as const) {
    if (isValue(type, wanted.type)) continue;
    context.diagnostics.refuse(
      side.at,
      `\`${operator}\` reads ${showType(wanted)}, and this is ${showBindingType(type)}.`,
      wanted.type === 'boolean'
        ? 'There is no truthiness in Sprout and nothing is converted: write a comparison.'
        : 'Write something that reads a whole number.',
    );
    return false;
  }
  return true;
}

/**
 * `a == b`, `a != b` — same type, and not a list; a symbol literal, on
 * either side, is checked against the enum of whatever it is compared
 * to, and an integer literal against the other side's declared range.
 * That is what an enum or a range exists for: `:slver ==` or `== :slver`
 * names the options, and a literal outside a range is a comparison
 * decided before the world runs, rather than either being false for
 * ever.
 *
 * `left` is null exactly when `expr.left` is itself the symbol literal:
 * `leafType` hands it here unread rather than typing it alone, so this
 * checks it against the right the same way it checks a literal right
 * against the (already-typed) left.
 */
export function identityType(
  expr: Expr & { readonly kind: 'binary' },
  left: BindingType | null,
  context: Checker,
): BindingType | null {
  const leftOption = expr.left.kind === 'symbol-expr';
  const rightOption = expr.right.kind === 'symbol-expr';
  if (leftOption && rightOption) {
    context.diagnostics.refuse(
      expr.at,
      'Neither side of this says which enum its option belongs to.',
      'Compare an option with something typed, as in `self.get(:state) == :wet`.',
    );
    return null;
  }

  if (leftOption) {
    const right = context.typeOf(expr.right);
    return right !== null && option(expr.left as SymbolExpr, right, context)
      ? valueOf(BOOLEAN)
      : null;
  }
  // Only the leftOption case above is ever handed a null: every other
  // branch below runs with `expr.left` already typed by the spine.
  const leftType = left!;

  if (rightOption) {
    return option(expr.right as SymbolExpr, leftType, context) ? valueOf(BOOLEAN) : null;
  }
  const right = context.typeOf(expr.right);
  if (right === null) return null;

  if (
    leftType.binds === 'value' &&
    right.binds === 'value' &&
    leftType.type.type === 'list' &&
    right.type.type === 'list' &&
    sameType(leftType.type, right.type)
  ) {
    context.diagnostics.refuse(
      expr.left.at,
      `Two lists are not compared with \`${expr.operator}\`.`,
      'Ask what a list holds instead: `self.get(:opens).includes(:oak)`, or compare its `count`.',
    );
    return null;
  }

  if (leftType.binds === 'object' && right.binds === 'object') {
    // Two bindings in scope, compared for being the same thing. Kinds
    // need not agree: asking whether the mover is the actor is the
    // point, and they may be different kinds.
    return valueOf(BOOLEAN);
  }
  if (
    leftType.binds === 'value' &&
    right.binds === 'value' &&
    sameType(leftType.type, right.type)
  ) {
    return refuseLiteralOutsideRange(expr.operator, expr, leftType, right, context)
      ? null
      : valueOf(BOOLEAN);
  }
  context.diagnostics.refuse(
    expr.at,
    `This compares ${showBindingType(leftType)} with ${showBindingType(right)}.`,
    'Two things are compared only where they are the same type.',
  );
  return null;
}

/**
 * `a == b`, `a != b`, `<` `<=` `>` `>=` — an integer literal against the
 * other operand's declared range. Outside it, the comparison's answer
 * does not depend on the value the world supplies, so it is refused at
 * the literal rather than left to decide nothing at every turn.
 *
 * The verdict is computed by evaluating the operator against the
 * range's ends rather than tabulated per operator: they agree exactly
 * when the literal sits outside the range, which is what makes the
 * comparison constant. Says whether it refused.
 */
export function refuseLiteralOutsideRange(
  operator: BinaryOperator,
  expr: Expr & { readonly kind: 'binary' },
  leftType: BindingType,
  rightType: BindingType,
  context: CheckContext,
): boolean {
  if (leftType.binds !== 'value' || leftType.type.type !== 'integer') return false;
  if (rightType.binds !== 'value' || rightType.type.type !== 'integer') return false;
  const leftWritten = writtenNumber(expr.left);
  const rightWritten = writtenNumber(expr.right);
  if ((leftWritten === null) === (rightWritten === null)) return false;

  const literalOnLeft = leftWritten !== null;
  const literal = literalOnLeft ? leftWritten! : rightWritten!;
  const range = literalOnLeft ? rightType.type : leftType.type;
  if (literal >= range.min && literal <= range.max) return false;

  const always = literalOnLeft
    ? decide(operator, literal, range.min)
    : decide(operator, range.min, literal);
  context.diagnostics.refuse(
    (literalOnLeft ? expr.left : expr.right).at,
    `${literal} is outside ${range.min} to ${range.max}, so this is always ${always ? 'true' : 'false'}.`,
    `Write a whole number from ${range.min} to ${range.max}, or take the comparison out.`,
  );
  return true;
}

/** What `a operator b` decides, for the two literal numbers `a` and `b`. */
export function decide(operator: BinaryOperator, a: number, b: number): boolean {
  switch (operator) {
    case '==':
      return a === b;
    case '!=':
      return a !== b;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    default:
      return false;
  }
}
