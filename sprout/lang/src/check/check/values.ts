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
import {
  describeLiteral,
  describeType,
  remedyFor,
  sameType,
  type ValueType,
} from '../../declare/types.js';
import type { CheckContext, Checker } from './checker.js';
import { identifiersInReach } from '../names.js';

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

/**
 * Check an expression against a type already known, options included;
 * `holder` begins a refusal with what takes the value, as `` `:door` holds `` does.
 */
export function matches(
  expr: Expr,
  wanted: BindingType,
  context: Checker,
  holder?: string,
): boolean {
  if (expr.kind === 'symbol-expr') return option(expr, wanted, context);
  if (bareOption(expr, wanted, context)) return false;
  const got = context.typeOf(expr);
  if (got === null) return false;
  if (got.binds === 'value' && wanted.binds === 'value') {
    if (!sameType(got.type, wanted.type)) return wrongType(expr, got, wanted, context, holder);
    return inRange(expr, wanted.type, context);
  }
  if (got.binds === 'object' && wanted.binds === 'object') return true;
  return wrongType(expr, got, wanted, context, holder);
}

/**
 * An option written without its colon where one is wanted, and nothing in
 * reach of that name: refused with the colon to write. True where refused.
 */
export function bareOption(expr: Expr, wanted: BindingType, context: CheckContext): boolean {
  if (expr.kind !== 'binding' || wanted.binds !== 'value' || wanted.type.type !== 'symbol') {
    return false;
  }
  const name = expr.name.text;
  if (!wanted.type.of.options.includes(name)) return false;
  if (context.scope.lookup(name) !== null || context.scope.withheld(name) !== null) return false;
  if (identifiersInReach(context).includes(name)) return false;
  context.diagnostics.refuse(
    expr.at,
    `\`${name}\` is an option of \`${wanted.type.of.name}\`, and an option is written with its colon here.`,
    `Write \`:${name}\`.`,
  );
  return true;
}

/** A bare option against the type it is being compared or given to. */
export function option(written: SymbolExpr, wanted: BindingType, context: CheckContext): boolean {
  if (wanted.binds !== 'value' || wanted.type.type !== 'symbol') {
    context.diagnostics.refuse(
      written.at,
      `\`:${written.name.text}\` is an option, and this holds ${describeBinding(wanted)}.`,
      wanted.binds === 'value'
        ? remedyFor(wanted.type, null, 'expression')
        : 'Name a thing in the world, as in `self`; an option is compared with what an enum types.',
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

/**
 * Refuse a value given where another type is wanted, saying what to write
 * instead; `holder` begins it with what takes the value, as `` `:door` holds `` does.
 * Always false.
 */
export function wrongType(
  expr: Expr,
  got: BindingType,
  wanted: BindingType,
  context: CheckContext,
  holder = 'This holds',
): boolean {
  context.diagnostics.refuse(
    expr.at,
    `${holder} ${describeBinding(wanted)}, and ${describeGiven(expr, got)}.`,
    wanted.binds === 'value'
      ? remedyFor(wanted.type, expr.kind === 'string' ? expr.value : null, 'expression')
      : 'Name a thing in the world, as in `self`.',
  );
  return false;
}

/** What a binding of this type holds, as a sentence for an author says it. */
export function describeBinding(type: BindingType): string {
  return type.binds === 'value' ? describeType(type.type) : showBindingType(type);
}

/** An expression and what it is: a literal as written, anything else by its type. */
export function describeGiven(expr: Expr, got: BindingType): string {
  if (expr.kind === 'string' || expr.kind === 'integer' || expr.kind === 'boolean') {
    return describeLiteral(expr);
  }
  return `this is ${describeKind(got)}`;
}

/** What a binding is, by its enum where it holds an option: `an option of Ward`, `true or false`. */
export function describeKind(type: BindingType): string {
  return type.binds === 'value' && type.type.type === 'symbol'
    ? `an option of ${type.type.of.name}`
    : describeBinding(type);
}
