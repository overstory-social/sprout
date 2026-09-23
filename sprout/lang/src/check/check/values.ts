// Whether a value is what is wanted where it is given (the spec's
// Properties › What the compiler checks): the same type exactly, nothing
// converted on the way in, a bare option checked against the enum it is
// given to, and an integer literal against a declared range where the
// compiler can tell. Where it cannot tell, it says nothing and the
// runtime faults.

import type { Expr, SymbolExpr } from '../../syntax/ast.js';
import { showBindingType, valueOf, type BindingType } from '../bindings.js';
import { checkOption } from '../../declare/enums.js';
import type { ResolvedProperty } from '../../declare/properties.js';
import { sameType, type ValueType } from '../../declare/types.js';
import type { CheckContext, Checker } from './checker.js';

/** Whether a type is a value of this shape. */
export function isValue(type: BindingType, shape: ValueType['type']): boolean {
  return type.binds === 'value' && type.type.type === shape;
}

/** A list's element type. */
export function elementOf(list: Extract<ValueType, { readonly type: 'list' }>): ValueType {
  return list.element;
}

/** A property's type as a binding holds it. */
export function held(property: ResolvedProperty): BindingType {
  return valueOf(property.type);
}

/** Check an expression against a type already known, options included. */
export function matches(expr: Expr, wanted: BindingType, context: Checker): boolean {
  if (expr.kind === 'symbol-expr') return option(expr, wanted, context);
  const got = context.typeOf(expr);
  if (got === null) return false;
  if (got.binds === 'value' && wanted.binds === 'value') {
    if (!sameType(got.type, wanted.type)) return wrongType(expr, got, wanted, context);
    return inRange(expr, wanted.type, context);
  }
  if (got.binds === 'object' && wanted.binds === 'object') return true;
  return wrongType(expr, got, wanted, context);
}

/** A bare option against the type it is being compared or given to. */
export function option(written: SymbolExpr, wanted: BindingType, context: CheckContext): boolean {
  if (wanted.binds !== 'value' || wanted.type.type !== 'symbol') {
    context.diagnostics.refuse(
      written.at,
      `\`:${written.name.text}\` is an option, and this is ${showBindingType(wanted)}.`,
      'An option is compared with something typed by an enum.',
    );
    return false;
  }
  return checkOption(wanted.type.of, written.name.text, written.at, context.diagnostics);
}

/**
 * An integer LITERAL against a declared range — the one case "where the
 * compiler can tell". It reads the written number off the node rather
 * than carrying it in the type, because a type that remembered it would
 * print itself as `integer 1 to 1` in every message about a literal.
 */
export function inRange(expr: Expr, wanted: ValueType, context: CheckContext): boolean {
  if (wanted.type !== 'integer') return true;
  const written = writtenNumber(expr);
  if (written === null || (written >= wanted.min && written <= wanted.max)) return true;
  context.diagnostics.refuse(
    expr.at,
    `${written} is outside ${wanted.min} to ${wanted.max}.`,
    `Write a whole number from ${wanted.min} to ${wanted.max}.`,
  );
  return false;
}

/** The number an expression IS, where it is one written down. */
export function writtenNumber(expr: Expr): number | null {
  if (expr.kind === 'integer') return expr.value;
  if (expr.kind === 'unary' && expr.operator === '-' && expr.operand.kind === 'integer') {
    return -expr.operand.value;
  }
  return null;
}

/** Refuse a value given where another type is wanted. Always false. */
export function wrongType(
  expr: Expr,
  got: BindingType,
  wanted: BindingType,
  context: CheckContext,
): boolean {
  context.diagnostics.refuse(
    expr.at,
    `This holds ${showBindingType(wanted)}, and ${showBindingType(got)} is not one.`,
    'Write something of that type.',
  );
  return false;
}
