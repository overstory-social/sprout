// The readings a receiver answers — `get`, `recall`, `count`, `holds`,
// `is`, `includes` — typed one step up a spine from the receiver below
// them (the spec's Properties › What the compiler checks). `is()` is the
// only one that reads through the object type; every other refuses an
// object whose kind is unknown. A call that writes is refused here, where
// a value is wanted, once it has been checked as the write it is.

import type { Expr, Ident } from '../../syntax/ast.js';
import { objectOf, OPEN_OBJECT, showBindingType, valueOf, type BindingType } from '../bindings.js';
import { BOOLEAN, integer, showType } from '../../declare/types.js';
import { readable } from '../../source/words.js';
import { textOf } from '../../source/source.js';
import { arity, propertyName, resolveKind } from './arguments.js';
import type { CheckContext, Checker } from './checker.js';
import {
  container,
  countable,
  declaredOn,
  ownMemory,
  receiverKind,
  remembers,
} from './receivers.js';
import { elementOf, held, matches } from './values.js';
import { EFFECTS, effectCall } from './writes.js';

/** Every reading this checker knows, for the message when a word is none of them. */
export const READINGS = ['get', 'recall', 'count', 'holds', 'is', 'includes'] as const;

/** `x.count` — the one member read with no brackets. */
export function memberType(
  receiver: Expr,
  type: BindingType,
  member: Ident,
  context: CheckContext,
): BindingType | null {
  if (member.text !== 'count') {
    context.diagnostics.refuse(
      member.at,
      `Sprout does not know how to read \`${member.text}\`.`,
      `A reading is one of ${readable([...READINGS])}, and \`count\` is the only one written without brackets.`,
    );
    return null;
  }
  return countable(type, member.at, context) ? valueOf(integer()) : null;
}

/** `x.m(…)` on a receiver already typed: what the reading gives, or null having said why. */
export function callType(
  receiver: Expr,
  type: BindingType,
  method: Ident,
  args: readonly Expr[],
  context: Checker,
): BindingType | null {
  if (EFFECTS.has(method.text)) {
    const effect = effectCall(receiver, type, method, args, context);
    if (effect === null) return null;
    context.diagnostics.refuse(
      method.at,
      `\`${method.text}\` changes something; it is not a value.`,
      'Write it on its own, not inside something that reads it.',
    );
    return null;
  }

  switch (method.text) {
    case 'get':
      return getCall(receiver, type, method, args, context);
    case 'recall':
      return recallCall(type, method, args, context);
    case 'is':
      return isCall(type, method, args, context) ? valueOf(BOOLEAN) : null;
    case 'holds':
      return holdsCall(receiver, type, method, args, context) ? valueOf(BOOLEAN) : null;
    case 'includes':
      return includesCall(type, method, args, context) ? valueOf(BOOLEAN) : null;
    case 'count':
      if (!arity(method, args, 1, context)) return null;
      if (!countable(type, method.at, context)) return null;
      // `count(K)` counts the contents that compose a kind, which a
      // list has none of: a list holds values, and `[Ward]` is the
      // whole of what it holds.
      if (type.binds === 'value') {
        context.diagnostics.refuse(
          method.at,
          `A list holds ${showType(type.type)}, not things of a kind.`,
          'Write `count` on its own to ask how many it holds.',
        );
        return null;
      }
      return resolveKind(args[0]!, context) === null ? null : valueOf(integer());
    default:
      context.diagnostics.refuse(
        method.at,
        `Sprout does not know how to read \`${method.text}\`.`,
        `A reading is one of ${readable([...READINGS])}.`,
      );
      return null;
  }
}

/** `x.get(:p)` — `p` declared on `x`'s type, and `x` not of object type. */
export function getCall(
  receiver: Expr,
  type: BindingType,
  method: Ident,
  args: readonly Expr[],
  context: CheckContext,
): BindingType | null {
  if (!arity(method, args, 1, context)) return null;
  const kind = receiverKind(type, method.at, 'read a property from', context);
  if (kind === null) return null;
  const named = propertyName(args[0]!, context);
  if (named === null) return null;
  const property = declaredOn(kind, named, context, textOf(receiver.at));
  if (property === null) return null;
  if (property.remembered) {
    context.diagnostics.refuse(
      named.at,
      `\`:${named.text}\` is remembered about each actor, not held by the object.`,
      `Read it with \`recall\`, as in \`actor.recall(:${named.text})\`.`,
    );
    return null;
  }
  return held(property);
}

/**
 * `x.recall(:p)` — `x` composes `sprout.Actor`, and `p` is in SELF's
 * `remembers` block. Only the object that declared them may read them, and
 * no object can read another object's memory of anyone.
 */
export function recallCall(
  type: BindingType,
  method: Ident,
  args: readonly Expr[],
  context: CheckContext,
): BindingType | null {
  if (!arity(method, args, 1, context)) return null;
  if (!remembers(type, method.at, context)) return null;
  const named = propertyName(args[0]!, context);
  if (named === null) return null;
  const property = ownMemory(named, context);
  return property === null ? null : held(property);
}

/** `x.is(K)` — `x` an object binding, `K` a kind in scope. */
export function isCall(
  type: BindingType,
  method: Ident,
  args: readonly Expr[],
  context: CheckContext,
): boolean {
  if (!arity(method, args, 1, context)) return false;
  if (type.binds !== 'object') {
    context.diagnostics.refuse(
      method.at,
      `\`is\` asks what a thing is, and this is ${showBindingType(type)}.`,
      'Ask it of a binding that names a thing in the world.',
    );
    return false;
  }
  return resolveKind(args[0]!, context) !== null;
}

/** `x.holds(y)` — `x` a container, `y` an object binding. */
export function holdsCall(
  receiver: Expr,
  type: BindingType,
  method: Ident,
  args: readonly Expr[],
  context: Checker,
): boolean {
  if (!arity(method, args, 1, context)) return false;
  if (!container(type, method.at, context)) return false;
  const held = context.typeOf(args[0]!);
  if (held === null) return false;
  if (held.binds !== 'object') {
    context.diagnostics.refuse(
      args[0]!.at,
      `\`holds\` asks after a thing, and this is ${showBindingType(held)}.`,
      'Name a binding that holds a thing in the world.',
    );
    return false;
  }
  return true;
}

/** `x.includes(e)` — `x` a list or a set role, `e` its element type. */
export function includesCall(
  type: BindingType,
  method: Ident,
  args: readonly Expr[],
  context: Checker,
): boolean {
  if (!arity(method, args, 1, context)) return false;
  if (type.binds === 'set') {
    const member = type.kind === null ? OPEN_OBJECT : objectOf(type.kind);
    return matches(args[0]!, member, context);
  }
  if (type.binds === 'value' && type.type.type === 'list') {
    return matches(args[0]!, valueOf(elementOf(type.type)), context);
  }
  context.diagnostics.refuse(
    method.at,
    `\`includes\` asks what a list or a set holds, and this is ${showBindingType(type)}.`,
    'Ask it of a list property or of a role marked `many`.',
  );
  return false;
}
