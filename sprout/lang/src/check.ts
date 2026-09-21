// What the compiler checks (B09; the spec's Properties › What the
// compiler checks).
//
// Every value has a declared type, every binding's type is known where
// it is bound, and there is no null — so this checks exactly. It never
// guesses at a receiver and never reports a problem that might not be
// one: where a range cannot be decided until the world runs, it says
// nothing and the runtime faults, which is what "where the compiler can
// tell" means.
//
// THREE RULES SHAPE THE WHOLE FILE.
//
// There is no truthiness and no coercion. `&&` takes booleans, `<`
// takes integers, and nothing is converted on the way in. A condition
// that is an integer is a refusal, not a zero-test.
//
// Only `self` writes `self`. `set`, `adjust`, `add` and `remove` go
// through the one binding B08 marks writable; every other receiver is
// refused, and the refusal says to send it a message instead, because
// that is what consent is made of.
//
// `is()` is the only read through the object type. Everything else
// refuses an object whose kind is unknown and says to narrow it first —
// so a body never reads a property off something that might not have
// one.
//
// What is NOT here: statements (B24 onward), `let` (B11), and the free
// calls `chance` and `random`, whose types the spec gives but whose
// rules about where they may appear are B33's. `FREE_CALLS` is the
// empty table B33 fills; the parser reads the shape so the refusal can
// name the word rather than complain about a bracket.

import type { BinaryOperator, Expr, Ident, KindExpr, SymbolExpr } from './ast.js';
import {
  isObjectBinding,
  kindName,
  objectOf,
  OPEN_OBJECT,
  showBindingType,
  valueOf,
  asHeldType,
  type Binding,
  type BindingType,
  type HeldType,
  type KindRef,
  type ObjectBinding,
  type Scope,
} from './bindings.js';
import type { Diagnostics } from './diagnostics.js';
import { checkOption, nearestOption, SPROUT } from './enums.js';
import type { ResolvedProperty } from './properties.js';
import type { Span } from './source.js';
import { BOOLEAN, integer, sameType, showType, STRING, type SproutType } from './types.js';

/** `sprout.Actor` — what a binding must compose before it remembers anything. */
export const ACTOR = `${SPROUT}.Actor`;

/**
 * Every kind the bundle declares, as this file needs to ask. B12
 * declares kinds, B19 composes them and B21 namespaces them; the shape
 * mirrors `EnumTable`, which answers the same two questions.
 */
export interface KindLookup {
  qualified(library: string, name: string): KindRef | null;
  unqualified(name: string, from: string): KindRef | null;
}

/** What a body is being read inside. */
export interface CheckContext {
  /** What is in reach, and what each name means. */
  readonly scope: Scope;
  /** Every kind in scope. */
  readonly kinds: KindLookup;
  /** The world or library the body belongs to, for a name written without one. */
  readonly from: string;
  /**
   * `self`'s kind. Memory is keyed to the object that declared it — no
   * object can read another object's memory of anyone — so `:remembers`
   * is looked up here and never on the receiver.
   */
  readonly self: KindRef | null;
  readonly diagnostics: Diagnostics;
}

/** The free calls this compiler reads. B33 fills it with `chance` and `random`. */
const FREE_CALLS: ReadonlySet<string> = new Set<string>();

/** A call that changes something, and so is not a value. */
const EFFECTS: ReadonlySet<string> = new Set(['set', 'adjust', 'add', 'remove', 'remember']);

/** Every reading this file knows, for the message when a word is none of them. */
const READINGS = ['get', 'recall', 'count', 'holds', 'is', 'includes'] as const;

// --- the entry points -----------------------------------------------------

/** What an expression evaluates to, or null having said why it does not. */
export function typeOf(expr: Expr, context: CheckContext): BindingType | null {
  // Down the unbounded spines iteratively, then type upward. A tree is
  // as deep as its longest chain of operators, and `a + a + a + …` has
  // no bracket in it to count against the host's nesting cap — so a
  // recursive walk would answer a long enough expression with a stack
  // overflow rather than with a diagnostic. Everything off a spine is
  // bounded by that cap and is typed by an ordinary call.
  const spine: Expr[] = [];
  for (let node: Expr = expr; ;) {
    spine.push(node);
    if (node.kind === 'binary') node = node.left;
    else if (node.kind === 'unary') node = node.operand;
    else if (node.kind === 'member' || node.kind === 'call') node = node.receiver;
    else break;
  }

  let type = leafType(spine.pop()!, context);
  while (spine.length > 0) {
    if (type === null) return null;
    type = aboveType(spine.pop()!, type, context);
  }
  return type;
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

/**
 * A call in statement position: the four that write and the one that
 * remembers. Everything else is a value, and using a value as a
 * statement is a refusal with nothing to say for itself.
 */
export function checkEffect(expr: Expr, context: CheckContext): boolean {
  if (expr.kind !== 'call' || !EFFECTS.has(expr.method.text)) {
    context.diagnostics.refuse(
      expr.at,
      'This reads something rather than doing something.',
      'A body changes the world with `self.set(…)`, `self.adjust(…)`, `self.add(…)`, `self.remove(…)` or `x.remember(…)`.',
    );
    return false;
  }
  const receiver = typeOf(expr.receiver, context);
  if (receiver === null) return false;
  return effectCall(expr.receiver, receiver, expr.method, expr.arguments, context) !== null;
}

// --- the bottom of a spine ------------------------------------------------

function leafType(expr: Expr, context: CheckContext): BindingType | null {
  switch (expr.kind) {
    case 'boolean':
      return valueOf(BOOLEAN);
    case 'integer':
      return valueOf(integer());
    case 'string':
      return valueOf(STRING);
    case 'binding':
      return bindingType(expr.name, context);
    case 'symbol-expr':
      context.diagnostics.refuse(
        expr.at,
        `\`:${expr.name.text}\` does not say which enum it belongs to.`,
        'An option is compared with something typed, as in `self.get(:state) == :wet`.',
      );
      return null;
    case 'kind-expr':
      context.diagnostics.refuse(
        expr.at,
        `\`${writtenKind(expr)}\` is a kind, not a value.`,
        'A kind is what `is()` and `count()` take, as in `tool.is(Key)`.',
      );
      return null;
    case 'free-call':
      context.diagnostics.refuse(
        expr.name.at,
        `Sprout does not know how to read \`${expr.name.text}\` here.`,
        `This compiler reads ${readable([...FREE_CALLS])}.`,
      );
      return null;
    default:
      // A binary, unary, member or call never reaches here: the spine
      // walk stops above it and `aboveType` types it.
      context.diagnostics.refuse(
        expr.at,
        'Sprout cannot work out what this reads.',
        'Write a value, a name something in scope answers to, or a reading such as `self.get(:wear)`.',
      );
      return null;
  }
}

function bindingType(name: Ident, context: CheckContext): BindingType | null {
  const binding = context.scope.lookup(name.text);
  if (binding !== null) return binding.type;
  const meant = nearestOption(name.text, context.scope.names());
  context.diagnostics.refuse(
    name.at,
    `Nothing here is called \`${name.text}\`.${meant === null ? '' : ` Did you mean \`${meant}\`?`}`,
    `In reach: ${readable(context.scope.names())}.`,
  );
  return null;
}

// --- one step up a spine --------------------------------------------------

function aboveType(expr: Expr, below: BindingType, context: CheckContext): BindingType | null {
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

function unaryType(
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

function binaryType(
  operator: BinaryOperator,
  expr: Expr & { readonly kind: 'binary' },
  left: BindingType,
  context: CheckContext,
): BindingType | null {
  if (operator === '==' || operator === '!=') return identityType(expr, left, context);

  const right = typeOf(expr.right, context);
  if (right === null) return null;

  if (operator === '&&' || operator === '||') {
    return bothAre(BOOLEAN, operator, expr, left, right, context) ? valueOf(BOOLEAN) : null;
  }
  if (!bothAre(integer(), operator, expr, left, right, context)) return null;
  const comparison = operator === '+' || operator === '-' ? integer() : BOOLEAN;
  return valueOf(comparison);
}

function bothAre(
  wanted: SproutType,
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
 * `a == b`, `a != b` — same type, and a bare option is checked against
 * the enum of whatever it is being compared to. That last part is what
 * an enum exists for: `== :slver` names the options rather than being
 * false for ever.
 */
function identityType(
  expr: Expr & { readonly kind: 'binary' },
  left: BindingType,
  context: CheckContext,
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

  if (rightOption) {
    return option(expr.right as SymbolExpr, left, context) ? valueOf(BOOLEAN) : null;
  }
  const right = typeOf(expr.right, context);
  if (right === null) return null;
  if (leftOption) {
    // The left was already refused by `leafType`; nothing more is owed.
    return null;
  }

  if (left.binds === 'object' && right.binds === 'object') {
    // Two bindings in scope, compared for being the same thing. Kinds
    // need not agree: asking whether the mover is the actor is the
    // point, and they may be different kinds.
    return valueOf(BOOLEAN);
  }
  if (left.binds === 'value' && right.binds === 'value' && sameType(left.type, right.type)) {
    return valueOf(BOOLEAN);
  }
  context.diagnostics.refuse(
    expr.at,
    `This compares ${showBindingType(left)} with ${showBindingType(right)}.`,
    'Two things are compared only where they are the same type.',
  );
  return null;
}

/** A bare option against the type it is being compared or given to. */
function option(written: SymbolExpr, wanted: BindingType, context: CheckContext): boolean {
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

// --- readings -------------------------------------------------------------

/** `x.count` — the one member read with no brackets. */
function memberType(
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

function callType(
  receiver: Expr,
  type: BindingType,
  method: Ident,
  args: readonly Expr[],
  context: CheckContext,
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
      return getCall(type, method, args, context);
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
function getCall(
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
  const property = declaredOn(kind, named, context);
  if (property === null) return null;
  if (property.remembered) {
    context.diagnostics.refuse(
      named.at,
      `\`:${named.text}\` is remembered about each actor, not held by the object.`,
      `Read it with \`recall\`, as in \`actor.recall(:${named.text})\`.`,
    );
    return null;
  }
  return held(property, context);
}

/**
 * `x.recall(:p)` — `x` composes `sprout.Actor`, and `p` is in SELF's
 * `:remembers`. Only the object that declared them may read them, and
 * no object can read another object's memory of anyone.
 */
function recallCall(
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
  return property === null ? null : held(property, context);
}

function isCall(
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

function holdsCall(
  receiver: Expr,
  type: BindingType,
  method: Ident,
  args: readonly Expr[],
  context: CheckContext,
): boolean {
  if (!arity(method, args, 1, context)) return false;
  if (!container(type, method.at, context)) return false;
  const held = typeOf(args[0]!, context);
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
function includesCall(
  type: BindingType,
  method: Ident,
  args: readonly Expr[],
  context: CheckContext,
): boolean {
  if (!arity(method, args, 1, context)) return false;
  if (type.binds === 'set') {
    const member = type.kind === null ? OPEN_OBJECT : objectOf(type.kind);
    return matches(args[0]!, member, context);
  }
  if (type.binds === 'value' && type.type.type === 'list') {
    const element = elementOf(type.type, method.at, context);
    return element !== null && matches(args[0]!, valueOf(element), context);
  }
  context.diagnostics.refuse(
    method.at,
    `\`includes\` asks what a list or a set holds, and this is ${showBindingType(type)}.`,
    'Ask it of a list property or of a role marked `many`.',
  );
  return false;
}

// --- the four that write, and the one that remembers ----------------------

function effectCall(
  receiver: Expr,
  type: BindingType,
  method: Ident,
  args: readonly Expr[],
  context: CheckContext,
): true | null {
  if (method.text === 'remember') {
    if (!arity(method, args, 2, context)) return null;
    if (!remembers(type, method.at, context)) return null;
    const named = propertyName(args[0]!, context);
    if (named === null) return null;
    const property = ownMemory(named, context);
    if (property === null) return null;
    const wanted = held(property, context);
    return wanted !== null && matches(args[1]!, wanted, context) ? true : null;
  }

  // `adjust` is two readings under one word: an integer property of
  // `self`, or a remembered one stepped through any actor. Which it is
  // follows from whether `self` remembers the name, because memory is
  // the one a receiver other than `self` may reach.
  if (method.text === 'adjust' && receiver.kind === 'binding' && receiver.name.text !== 'self') {
    if (!arity(method, args, 2, context)) return null;
    if (!remembers(type, method.at, context)) return null;
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
      const wanted = held(property, context);
      return wanted !== null && matches(args[1]!, wanted, context) ? true : null;
    }
    case 'adjust':
      return wholeNumber(property, named, args[1]!, context) ? true : null;
    default:
      return listChange(property, named, method, args[1]!, context) ? true : null;
  }
}

/** `self.add(:p, e)`, `self.remove(:p, e)` — `p` a list, `e` its element type. */
function listChange(
  property: ResolvedProperty,
  named: Ident,
  method: Ident,
  value: Expr,
  context: CheckContext,
): boolean {
  if (property.type.type !== 'list') {
    context.diagnostics.refuse(
      named.at,
      `\`${method.text}\` changes a list, and \`:${named.text}\` holds ${showType(property.type)}.`,
      'A list is declared in brackets, as in `:opens [Ward] default [oak]`.',
    );
    return false;
  }
  const element = elementOf(property.type, named.at, context);
  return element !== null && matches(value, valueOf(element), context);
}

/** `adjust` steps a number, on a property or in memory. Both sides integer. */
function wholeNumber(
  property: ResolvedProperty,
  named: Ident,
  by: Expr,
  context: CheckContext,
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

// --- the small questions --------------------------------------------------

/** Whether a type is a value of this shape. */
function isValue(type: BindingType, shape: SproutType['type']): boolean {
  return type.binds === 'value' && type.type.type === shape;
}

/**
 * A list's element type. No list holds objects — `resolveType` refuses
 * a written `object` and a list of lists — so this is a value type, and
 * saying so here is what keeps the callers from carrying the object arm
 * through every branch that handles a list.
 */
function elementOf(
  list: Extract<SproutType, { readonly type: 'list' }>,
  at: Span,
  context: CheckContext,
): HeldType | null {
  const element = asHeldType(list.element);
  if (element !== null) return element;
  context.diagnostics.refuse(
    at,
    'A list holds values, and this one was declared to hold things in the world.',
    'A list holds booleans, whole numbers, text or options of an enum.',
  );
  return null;
}

/** A property's type as a binding holds it. No property holds an object. */
function held(property: ResolvedProperty, context: CheckContext): BindingType | null {
  if (property.type.type === 'object') {
    context.diagnostics.refuse(
      property.declaration.at,
      `\`:${property.name}\` holds no value.`,
      'A property holds a boolean, an integer, a string, an option of an enum, or a list of those.',
    );
    return null;
  }
  return valueOf(property.type);
}

/** Check an expression against a type already known, options included. */
function matches(expr: Expr, wanted: BindingType, context: CheckContext): boolean {
  if (expr.kind === 'symbol-expr') return option(expr, wanted, context);
  const got = typeOf(expr, context);
  if (got === null) return false;
  if (got.binds === 'value' && wanted.binds === 'value') {
    if (!sameType(got.type, wanted.type)) return wrongType(expr, got, wanted, context);
    return inRange(expr, wanted.type, context);
  }
  if (got.binds === 'object' && wanted.binds === 'object') return true;
  return wrongType(expr, got, wanted, context);
}

/**
 * An integer LITERAL against a declared range — the one case "where the
 * compiler can tell". Anything read at run time is left alone: a `set`
 * out of range then faults, and reporting a problem that might not be
 * one is the thing this compiler does not do.
 *
 * It reads the written number off the node rather than carrying it in
 * the type, because a type that remembered it would print itself as
 * `integer 1 to 1` in every message about an operand that happened to
 * be a literal.
 */
function inRange(expr: Expr, wanted: HeldType, context: CheckContext): boolean {
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
function writtenNumber(expr: Expr): number | null {
  if (expr.kind === 'integer') return expr.value;
  if (expr.kind === 'unary' && expr.operator === '-' && expr.operand.kind === 'integer') {
    return -expr.operand.value;
  }
  return null;
}

function wrongType(
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

/** The kind a receiver is, or a refusal naming what to do about the object type. */
function receiverKind(
  type: BindingType,
  at: Span,
  doing: string,
  context: CheckContext,
): KindRef | null {
  if (type.binds === 'object' && type.kind !== null) return type.kind;
  if (type.binds === 'object') {
    context.diagnostics.refuse(
      at,
      `Sprout does not know what this is, so it cannot ${doing} it.`,
      'Narrow it first, as in `if (thing.is(Key)) { … }`.',
    );
    return null;
  }
  context.diagnostics.refuse(
    at,
    `Only a thing in the world has properties, and this is ${showBindingType(type)}.`,
    'Name a binding that holds a thing in the world.',
  );
  return null;
}

/** Only `self` writes `self`. Everything else asks, and a message is how. */
function onlySelf(
  receiver: Expr,
  type: BindingType,
  method: Ident,
  context: CheckContext,
): KindRef | null {
  const named = receiver.kind === 'binding' ? context.scope.lookup(receiver.name.text) : null;
  if (named === null || !named.writable) {
    context.diagnostics.refuse(
      method.at,
      `Only \`self\` writes its own state, and this is ${describe(named, type)}.`,
      'Send it a message and let it decide, as in `send it :unlock_attempt`.',
    );
    return null;
  }
  return receiverKind(type, method.at, 'write to', context);
}

function describe(binding: Binding | null, type: BindingType): string {
  if (binding === null) return showBindingType(type);
  return binding.name === 'self' ? showBindingType(type) : `\`${binding.name}\``;
}

/** Whether a receiver may be asked about memory: it composes `sprout.Actor`. */
function remembers(type: BindingType, at: Span, context: CheckContext): boolean {
  if (type.binds === 'object' && type.kind !== null) {
    if (type.kind.composes.has(ACTOR)) return true;
    context.diagnostics.refuse(
      at,
      `\`${kindName(type.kind)}\` is not someone a thing is remembered about.`,
      `Only a kind composing \`${ACTOR}\` is. Hold it on the object itself, with \`get\` and \`set\`.`,
    );
    return false;
  }
  if (type.binds === 'object') {
    context.diagnostics.refuse(
      at,
      'Sprout does not know whether this is someone who can be remembered about.',
      'Narrow it first, as in `if (item.is(Creature)) { … }`.',
    );
    return false;
  }
  context.diagnostics.refuse(
    at,
    `Only an actor is remembered about, and this is ${showBindingType(type)}.`,
    `Ask it of \`actor\`, or of something composing \`${ACTOR}\`.`,
  );
  return false;
}

/** A remembered property of `self` — the only memory any object may touch. */
function ownMemory(named: Ident, context: CheckContext): ResolvedProperty | null {
  const declared = context.self?.properties.get(named.text) ?? null;
  if (declared !== null && declared.remembered) return declared;
  context.diagnostics.refuse(
    named.at,
    declared === null
      ? `This remembers nothing called \`:${named.text}\`.`
      : `\`:${named.text}\` is held by the object, not remembered about each actor.`,
    declared === null
      ? 'Declare it first, as in `:remembers [visits: 0 min 0 max 99]`. No object reads another object’s memory of anyone.'
      : `Read it with \`get\`, as in \`self.get(:${named.text})\`.`,
  );
  return null;
}

function declaredOn(kind: KindRef, named: Ident, context: CheckContext): ResolvedProperty | null {
  const property = kind.properties.get(named.text);
  if (property !== undefined) return property;
  const meant = nearestOption(named.text, [...kind.properties.keys()]);
  context.diagnostics.refuse(
    named.at,
    `\`${kindName(kind)}\` has no \`:${named.text}\`.${meant === null ? '' : ` Did you mean \`:${meant}\`?`}`,
    `It has ${readable([...kind.properties.keys()].map((name) => `:${name}`))}.`,
  );
  return null;
}

/** `x.count` and `x.count(K)` — a container or a set role. */
function countable(type: BindingType, at: Span, context: CheckContext): boolean {
  if (type.binds === 'set') return true;
  // Lists names `count` as one of a list's four operations, where the
  // checker's own table names only a container and a set role. The
  // fuller sentence wins, and the narrower row is recorded in the
  // notes as a row to widen.
  if (type.binds === 'value' && type.type.type === 'list') return true;
  return container(type, at, context);
}

function container(type: BindingType, at: Span, context: CheckContext): boolean {
  if (type.binds === 'object' && type.kind !== null && type.kind.contains) return true;
  if (type.binds === 'object' && type.kind !== null) {
    context.diagnostics.refuse(
      at,
      `\`${kindName(type.kind)}\` holds nothing, so there is nothing to count.`,
      'Containment is a declaration: a kind that holds things writes `contains`.',
    );
    return false;
  }
  if (type.binds === 'object') {
    context.diagnostics.refuse(
      at,
      'Sprout does not know whether this holds anything.',
      'Narrow it first, as in `if (thing.is(sprout.Container)) { … }`.',
    );
    return false;
  }
  context.diagnostics.refuse(
    at,
    `Only a thing that holds things can be counted, and this is ${showBindingType(type)}.`,
    'Ask it of a container, or of a role marked `many`.',
  );
  return false;
}

/** `:p` in the place a call names a property. */
function propertyName(written: Expr, context: CheckContext): Ident | null {
  if (written.kind === 'symbol-expr') return written.name;
  context.diagnostics.refuse(
    written.at,
    'This names the property to read, and that is written with a colon.',
    'Write `:wear`, naming the property.',
  );
  return null;
}

function resolveKind(written: Expr, context: CheckContext): KindRef | null {
  if (written.kind !== 'kind-expr') {
    context.diagnostics.refuse(
      written.at,
      'This names a kind, which starts with a capital letter.',
      'Write the kind, as in `Key` or `sprout.Container`.',
    );
    return null;
  }
  const found =
    written.library === null
      ? context.kinds.unqualified(written.name.text, context.from)
      : context.kinds.qualified(written.library.text, written.name.text);
  if (found !== null) return found;
  context.diagnostics.refuse(
    written.at,
    `Nothing here is a \`${writtenKind(written)}\`.`,
    'Write a kind this world declares, or one a library it uses exports.',
  );
  return null;
}

function arity(
  method: Ident,
  args: readonly Expr[],
  wanted: number,
  context: CheckContext,
): boolean {
  if (args.length === wanted) return true;
  context.diagnostics.refuse(
    method.at,
    `\`${method.text}\` is given ${count(wanted)}, and this gives it ${count(args.length)}.`,
    wanted === 1
      ? `Write \`${method.text}(…)\` with one thing in the brackets.`
      : `Write \`${method.text}(…, …)\` with two.`,
  );
  return false;
}

function count(many: number): string {
  return many === 1 ? 'one thing' : `${many} things`;
}

function writtenKind(written: KindExpr): string {
  return written.library === null
    ? written.name.text
    : `${written.library.text}.${written.name.text}`;
}

/** `a, b and c`, or `nothing` — the same shape the parser's own lists use. */
function readable(words: readonly string[]): string {
  const sorted = [...words];
  if (sorted.length === 0) return 'none of them';
  if (sorted.length === 1) return `\`${sorted[0]}\``;
  const last = sorted.pop()!;
  return `${sorted.map((word) => `\`${word}\``).join(', ')} and \`${last}\``;
}
