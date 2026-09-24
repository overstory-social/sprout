// What the compiler checks (the spec's Properties › What the compiler
// checks). This module is the checker's entry; the checker itself is in
// `check/`, one module per area of expression, each a set of functions
// taking the `Checker` context.
//
// Every value has a declared type, every binding's type is known where
// it is bound, and there is no null — so this checks exactly. It never
// guesses at a receiver and never reports a problem that might not be
// one: where a range cannot be decided until the world runs, it says
// nothing and the runtime faults, which is what "where the compiler can
// tell" means.
//
// THREE RULES SHAPE THE WHOLE CHECKER.
//
// There is no truthiness and no coercion. `&&` takes booleans, `<`
// takes integers, and nothing is converted on the way in. A condition
// that is an integer is a refusal, not a zero-test.
//
// Only `self` writes `self`. `set`, `adjust`, `add` and `remove` go
// through the one binding `bindings.ts` marks writable; every other
// receiver is refused, and the refusal says to send it a message
// instead, because that is what consent is made of.
//
// `is()` is the only read through the object type. Everything else
// refuses an object whose kind is unknown and says to narrow it first —
// so a body never reads a property off something that might not have
// one.
//
// Statements are `statements.ts`'s, not this module's.

import type { CallExpr, Expr } from '../syntax/ast.js';
import {
  isObjectBinding,
  showBindingType,
  valueOf,
  type Binding,
  type BindingType,
  type ObjectBinding,
  type Scope,
} from './bindings.js';
import type { KindRef } from '../declare/kinds.js';
import { resolveKind } from './check/arguments.js';
import { checkerOf, type CheckContext, type Checker } from './check/checker.js';
import { leafType } from './check/leaves.js';
import { aboveType } from './check/operators.js';
import { EFFECTS, effectCall } from './check/writes.js';
import { matches } from './check/values.js';
import type { ValueType } from '../declare/types.js';

export type { ActSetting, CheckContext, MessageSetting } from './check/checker.js';
export { bindingType } from './check/leaves.js';
export { resolveKind } from './check/arguments.js';

/** What an expression evaluates to, or null having said why it does not. */
export function typeOf(expr: Expr, context: CheckContext): BindingType | null {
  return walk(expr, checkerOf(context, walk));
}

/**
 * Down the unbounded spines iteratively, then type upward. A tree is as
 * deep as its longest chain of operators, and `a + a + a + …` has no
 * bracket in it to count against the parser's depth bound — so a
 * recursive walk would answer a long enough expression with a stack
 * overflow rather than with a diagnostic. Everything off a spine is
 * bounded by that depth and is typed by `checker.typeOf`, which comes
 * back here.
 *
 * The walk stops one node early for `sym == x` / `sym != x`: a bare
 * option names no enum on its own, so its left is never handed to
 * `leafType` alone — `identityType` types it against the right instead.
 */
function walk(expr: Expr, checker: Checker): BindingType | null {
  const spine: Expr[] = [];
  for (let node: Expr = expr; ;) {
    spine.push(node);
    if (node.kind === 'binary') {
      const identityWithLiteralLeft =
        (node.operator === '==' || node.operator === '!=') && node.left.kind === 'symbol-expr';
      if (identityWithLiteralLeft) break;
      node = node.left;
    } else if (node.kind === 'unary') node = node.operand;
    else if (node.kind === 'member' || node.kind === 'call') node = node.receiver;
    else break;
  }

  let type = leafType(spine.pop()!, checker);
  while (spine.length > 0) {
    if (type === null) return null;
    type = aboveType(spine.pop()!, type, checker);
  }
  return type;
}

/**
 * A value given where `wanted` is: the same type exactly, an option of its
 * enum, a literal in its range. `holder` begins a refusal, as `` `:gust` carries `` does.
 */
export function checkValue(
  expr: Expr,
  wanted: ValueType,
  context: CheckContext,
  holder?: string,
): boolean {
  return matches(expr, valueOf(wanted), checkerOf(context, walk), holder);
}

/** `if (e)` — `e` boolean. Nothing else is a condition, and nothing is coerced. */
export function checkCondition(expr: Expr, context: CheckContext): boolean {
  const type = typeOf(expr, context);
  if (type === null) return false;
  if (type.binds === 'value' && type.type.type === 'boolean') return true;
  context.diagnostics.refuse(
    expr.at,
    `A condition is true or false, and this is ${showBindingType(type)}.`,
    'Compare it, as in `self.get(:wear) >= 99`, or narrow it with `is()`.',
  );
  return false;
}

/**
 * `x.is(K)` written as a whole condition — what it narrows, for the
 * branch it guards. The narrowing itself is `Scope.narrowing`, and
 * applying it belongs to whoever writes `if`.
 */
export function narrowingOf(
  expr: Expr,
  context: CheckContext,
): { readonly binding: ObjectBinding; readonly kind: KindRef } | null {
  if (expr.kind !== 'call' || expr.method.text !== 'is') return null;
  if (expr.receiver.kind !== 'binding' || expr.arguments.length !== 1) return null;
  const binding = context.scope.lookup(expr.receiver.name.text);
  if (binding === null || !isObjectBinding(binding)) return null;
  const written = expr.arguments[0]!;
  if (written.kind !== 'kind-expr') return null;
  const kind = resolveKind(written, context);
  return kind === null ? null : { binding, kind };
}

/** The scope a condition, checked already, opens for the branch it guards: `x.is(K)` narrows, `bound tool` binds. */
export function branchScope(condition: Expr, context: CheckContext): Scope {
  const narrowing = narrowingOf(condition, context);
  if (narrowing !== null) return context.scope.narrowing(narrowing.binding, narrowing.kind);
  const bound = boundOf(condition, context);
  return bound === null ? context.scope : context.scope.bounding(bound);
}

/** `bound tool` written as a whole condition: the binding `tool` has in the branch it guards. */
function boundOf(condition: Expr, context: CheckContext): Binding | null {
  if (condition.kind !== 'bound') return null;
  const withheld = context.scope.withheld(condition.name.text);
  return withheld !== null && withheld.bound.bindable ? withheld.bound.binding : null;
}

/** Whether an expression is a call to one of the four that write or the one that remembers. */
export function isEffect(expr: Expr): expr is CallExpr {
  return expr.kind === 'call' && EFFECTS.has(expr.method.text);
}

/**
 * A call `isEffect` answers yes to, checked as the write or the memory it
 * is: only `self` writes `self`, and the value given matches what it is
 * given to. Where one is allowed is the statement checker's.
 */
export function checkEffectCall(call: CallExpr, context: CheckContext): boolean {
  const checker = checkerOf(context, walk);
  const receiver = walk(call.receiver, checker);
  if (receiver === null) return false;
  return effectCall(call.receiver, receiver, call.method, call.arguments, checker) !== null;
}
