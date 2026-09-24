// The four that write — `set`, `adjust`, `add`, `remove` — and the one
// that remembers (the spec's Properties › What the compiler checks,
// Per-actor memory). Only `self` writes `self`, and the refusal says to
// send a message instead. Memory is written only through `remember`, or
// stepped by `adjust` on an actor, and only memory `self` declared.

import type { Expr, Ident } from '../../syntax/ast.js';
import { valueOf, type BindingType } from '../bindings.js';
import type { ResolvedProperty } from '../../declare/properties.js';
import { integer, showType } from '../../declare/types.js';
import { arity, propertyName } from './arguments.js';
import type { Checker } from './checker.js';
import { declaredOn, onlySelf, ownMemory, remembers } from './receivers.js';
import { elementOf, held, matches } from './values.js';

/** A call that changes something, and so is not a value. */
export const EFFECTS: ReadonlySet<string> = new Set(['set', 'adjust', 'add', 'remove', 'remember']);

/** A call `EFFECTS` names, on a receiver already typed: true, or null having said why not. */
export function effectCall(
  receiver: Expr,
  type: BindingType,
  method: Ident,
  args: readonly Expr[],
  context: Checker,
): true | null {
  if (method.text === 'remember') {
    if (!arity(method, args, 2, context)) return null;
    if (!remembers(type, method.at, context, receiver)) return null;
    const named = propertyName(args[0]!, context);
    if (named === null) return null;
    const property = ownMemory(named, context);
    if (property === null) return null;
    return matches(args[1]!, held(property), context, `\`:${named.text}\` holds`) ? true : null;
  }

  // `adjust` is two readings under one word: an integer property of
  // `self`, or a remembered one stepped through any actor. Which it is
  // follows from whether `self` remembers the name, because memory is
  // the one a receiver other than `self` may reach.
  if (method.text === 'adjust' && receiver.kind === 'binding' && receiver.name.text !== 'self') {
    if (!arity(method, args, 2, context)) return null;
    if (!remembers(type, method.at, context, receiver)) return null;
    const named = propertyName(args[0]!, context);
    if (named === null) return null;
    const property = ownMemory(named, context);
    if (property === null) return null;
    return wholeNumber(property, named, args[1]!, context) ? true : null;
  }

  const kind = onlySelf(receiver, type, method, context);
  if (kind === null) return null;
  if (!arity(method, args, 2, context)) return null;
  const named = propertyName(args[0]!, context);
  if (named === null) return null;
  const property = declaredOn(kind, named, context);
  if (property === null) return null;
  // The same split `get` draws, and for the same reason: memory is held
  // per actor and written through `remember`, so a `set` that reached it
  // would write one object's idea of everybody at once.
  if (property.remembered) {
    // `adjust` has its own memory reading, and it is the one that keeps
    // what the author wrote: stepping by one is not overwriting with
    // one, so sending them to `remember` would trade the meaning.
    const memory =
      method.text === 'adjust'
        ? `Step it on the actor, as in \`actor.adjust(:${named.text}, …)\`.`
        : `Write it with \`remember\`, as in \`actor.remember(:${named.text}, …)\`.`;
    context.diagnostics.refuse(
      named.at,
      `\`:${named.text}\` is remembered about each actor, not held by the object.`,
      memory,
    );
    return null;
  }

  switch (method.text) {
    case 'set': {
      return matches(args[1]!, held(property), context, `\`:${named.text}\` holds`) ? true : null;
    }
    case 'adjust':
      return wholeNumber(property, named, args[1]!, context) ? true : null;
    default:
      return listChange(property, named, method, args[1]!, context) ? true : null;
  }
}

/** `self.add(:p, e)`, `self.remove(:p, e)` — `p` a list, `e` its element type. */
export function listChange(
  property: ResolvedProperty,
  named: Ident,
  method: Ident,
  value: Expr,
  context: Checker,
): boolean {
  if (property.type.type !== 'list') {
    context.diagnostics.refuse(
      named.at,
      `\`${method.text}\` changes a list, and \`:${named.text}\` holds ${showType(property.type)}.`,
      'A list is declared in brackets, as in `:opens [Ward] default [oak]`.',
    );
    return false;
  }
  return matches(value, valueOf(elementOf(property.type)), context);
}

/** `adjust` steps a number, on a property or in memory. Both sides integer. */
export function wholeNumber(
  property: ResolvedProperty,
  named: Ident,
  by: Expr,
  context: Checker,
): boolean {
  if (property.type.type !== 'integer') {
    context.diagnostics.refuse(
      named.at,
      `\`adjust\` steps a number, and \`:${named.text}\` holds ${showType(property.type)}.`,
      'Write it with `set` instead.',
    );
    return false;
  }
  // The step is a number, not a value of the property's range: adjusting
  // a 0-to-99 by 1 is ordinary, and the RESULT is clamped rather than
  // refused, which is what the range is for.
  return matches(by, valueOf(integer()), context);
}
