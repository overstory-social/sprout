// What a condition, holding, says about the names it tests (the spec's
// Properties › What the compiler checks; Optional tools). `x.is(K)`
// narrows `x` to `K` and `bound tool` binds `tool`, for the branch the
// condition guards. Written as an operand of `&&`, each says the same for
// the operands to its right and for the branch the whole `&&` guards,
// since `&&` reads its right only where its left held; any other operator
// says nothing about its operands.

import type { BinaryExpr, Expr } from '../../syntax/ast.js';
import { isObjectBinding, type Binding, type ObjectBinding, type Scope } from '../bindings.js';
import type { KindRef } from '../../declare/kinds.js';
import { placedBinding } from '../names.js';
import { resolveKind } from './arguments.js';
import type { CheckContext } from './checker.js';

/**
 * `x.is(K)` written as one operand — what it narrows: an object binding,
 * or a name in a kind's body that the run resolves, which the branch then
 * binds. Null for anything else.
 */
export function narrowingOf(
  expr: Expr,
  context: CheckContext,
): { readonly binding: ObjectBinding; readonly kind: KindRef } | null {
  if (expr.kind !== 'call' || expr.method.text !== 'is') return null;
  if (expr.receiver.kind !== 'binding' || expr.arguments.length !== 1) return null;
  const binding =
    context.scope.lookup(expr.receiver.name.text) ?? placedBinding(expr.receiver.name, context);
  if (binding === null || !isObjectBinding(binding)) return null;
  const written = expr.arguments[0]!;
  if (written.kind !== 'kind-expr') return null;
  const kind = resolveKind(written, context);
  return kind === null ? null : { binding, kind };
}

/** The scope one operand, checked already and holding, opens: `x.is(K)` narrows, `bound tool` binds. */
export function heldScope(operand: Expr, context: CheckContext): Scope {
  const narrowing = narrowingOf(operand, context);
  if (narrowing !== null) return context.scope.narrowing(narrowing.binding, narrowing.kind);
  const bound = boundOf(operand, context);
  return bound === null ? context.scope : context.scope.bounding(bound);
}

/**
 * The scope a condition, checked already, opens for the branch it guards:
 * what each operand of its `&&`s says, in the order written. The chain is
 * walked down its left with a loop, since it has no bracket to bound it.
 */
export function branchScope(condition: Expr, context: CheckContext): Scope {
  const operands: Expr[] = [];
  let node = condition;
  for (; isAnd(node); node = node.left) operands.push(node.right);
  operands.push(node);
  let scope = context.scope;
  for (const operand of operands.reverse()) scope = heldScope(operand, { ...context, scope });
  return scope;
}

/** Whether `expr` is `a && b`. */
export function isAnd(expr: Expr): expr is BinaryExpr & { readonly operator: '&&' } {
  return expr.kind === 'binary' && expr.operator === '&&';
}

/** `bound tool` written as one operand: the binding `tool` has where it holds. */
function boundOf(operand: Expr, context: CheckContext): Binding | null {
  if (operand.kind !== 'bound') return null;
  const withheld = context.scope.withheld(operand.name.text);
  return withheld !== null && withheld.bound.bindable ? withheld.bound.binding : null;
}
