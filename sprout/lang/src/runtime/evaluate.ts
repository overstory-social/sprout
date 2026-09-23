// What an expression evaluates to while the world runs (the spec's
// Properties, types and values › What the compiler checks, Precedence,
// Object identity; Limits › Runtime budgets).
//
// The evaluator mirrors the checker exactly: what `typeOf` accepts is
// what `evaluate` handles, and nothing else. There is no truthiness and
// no coercion, and the checker has already guaranteed every operand's
// type, so a mismatch here is an engine error, thrown as a plain
// `Error`, never a fault an author can cause. Two things can fault: the
// step budget, which charges one step for every expression node
// evaluated, and `+` or `-` whose result leaves the integer range.
//
// It only reads. `bound tool` asks whether the frame binds the name, which
// is how a role's body tells a tool it was given from one it was not; an
// identifier is what the checker resolved it to, and faults where that is
// not in range (`named.ts`).
// `chance` and `random` are B33's.

import type { BinaryOperator, CallExpr, Expr, KindExpr, MemberExpr } from '../syntax/ast.js';
import type { StaticCaps } from '../bundle/limits.js';
import { kindName, type KindLookup, type KindRef } from '../declare/kinds.js';
import { INTEGER_MAX, INTEGER_MIN } from '../declare/types.js';
import type { Budget } from './budget.js';
import type { InstanceId } from './ids.js';
import { SproutList } from './lists.js';
import type { Instance, StateReader } from './state.js';
import type { NameTable } from '../check/names.js';
import { reachedByName } from './named.js';
import type { PassRule } from './range.js';
import { defaultOf, type Value } from './values.js';

/**
 * What a name is bound to, and what an expression evaluates to: a value,
 * a thing in the world, or a set of things, the three arms a binding's
 * type has. An object is its id, which is what identity compares.
 */
export type Evaluated =
  | { readonly binds: 'value'; readonly value: Value }
  | { readonly binds: 'object'; readonly id: InstanceId }
  | { readonly binds: 'set'; readonly ids: readonly InstanceId[] };

/** What a body is evaluated inside. */
export interface Frame {
  /** The turn's state: a draft in a write turn, the committed state in a poll. */
  readonly state: StateReader;
  /** Every kind the bundle declares, for the kind an `is(K)` or a `count(K)` names. */
  readonly kinds: KindLookup;
  /** The world or library whose kind wrote the body, for a kind written without one. */
  readonly library: string;
  /** The object whose body this is: what `self` names, and whose memory `recall` reads. */
  readonly self: InstanceId;
  /** Every other name in scope. */
  readonly bindings: ReadonlyMap<string, Evaluated>;
  readonly budget: Budget;
  /** The host's caps now, which a remembered list's default is built under. */
  readonly caps: StaticCaps;
  /** What each identifier and path the bundle's bodies wrote names. */
  readonly names: NameTable;
  /** What the turn's containers let through, which reading through a name asks. */
  readonly passes: PassRule<InstanceId>;
}

/**
 * `+` or `-` gave a number outside −2,147,483,648 to 2,147,483,647, the
 * range of every integer (the spec's The types). Thrown, as `ListFull`
 * is, because the turn cannot go on; B34 turns it into the world's
 * `fault` passage.
 */
export class IntegerOverflow extends Error {
  constructor(readonly result: number) {
    super(`${result} is outside the integer range, ${INTEGER_MIN} to ${INTEGER_MAX}.`);
    this.name = 'IntegerOverflow';
  }
}

export function boundValue(value: Value): Evaluated {
  return { binds: 'value', value };
}

export function boundObject(id: InstanceId): Evaluated {
  return { binds: 'object', id };
}

/**
 * What `expr` evaluates to in `frame`. A spine of operators or readings
 * is walked with a loop, as the checker walks it, since `a + a + a + …`
 * has no bracket to count against the parser's depth bound.
 */
export function evaluate(expr: Expr, frame: Frame): Evaluated {
  const spine: Expr[] = [];
  for (let node: Expr = expr; ;) {
    spine.push(node);
    if (node.kind === 'binary') node = node.left;
    else if (node.kind === 'unary') node = node.operand;
    else if (node.kind === 'member' || node.kind === 'call') node = node.receiver;
    else break;
  }
  let below = leaf(spine.pop()!, frame);
  while (spine.length > 0) below = above(spine.pop()!, below, frame);
  return below;
}

/** A condition: an expression the checker typed as a boolean. */
export function evaluateCondition(expr: Expr, frame: Frame): boolean {
  return asBoolean(evaluate(expr, frame));
}

function leaf(expr: Expr, frame: Frame): Evaluated {
  frame.budget.spend();
  switch (expr.kind) {
    case 'boolean':
    case 'integer':
    case 'string':
      return boundValue(expr.value);
    case 'symbol-expr':
      // An option, compared or looked for: its bare name, as a value holds it.
      return boundValue(expr.name.text);
    case 'binding': {
      if (expr.name.text === 'self') return boundObject(frame.self);
      const bound = frame.bindings.get(expr.name.text);
      if (bound !== undefined) return bound;
      const named = frame.names.get(expr.name);
      if (named === undefined) throw unchecked(`\`${expr.name.text}\`, which nothing binds,`);
      return boundObject(reachedByName(named, expr.name.text, frame));
    }
    case 'bound':
      // A tool the reading left out, or a value outside what this role-player hears, is not in the frame.
      return boundValue(frame.bindings.has(expr.name.text));
    case 'kind-expr':
      throw unchecked('a kind standing as a value');
    case 'free-call':
      throw unchecked(`\`${expr.name.text}(…)\`, which B33 brings,`);
    default:
      throw unchecked(`a ${expr.kind} at the bottom of a spine`);
  }
}

/** One step up a spine, from what the node is written on. */
function above(expr: Expr, below: Evaluated, frame: Frame): Evaluated {
  frame.budget.spend();
  switch (expr.kind) {
    case 'unary':
      return expr.operator === '!'
        ? boundValue(!asBoolean(below))
        : boundValue(inRange(-asInteger(below)));
    case 'binary':
      return binary(expr.operator, below, expr.right, frame);
    case 'member':
      return member(expr, below, frame);
    case 'call':
      return reading(expr, below, frame);
    default:
      throw unchecked(`a ${expr.kind} above another expression`);
  }
}

/** `&&` and `||` decide from their left where they can, and leave the right unevaluated. */
function binary(operator: BinaryOperator, left: Evaluated, right: Expr, frame: Frame): Evaluated {
  switch (operator) {
    case '&&':
      return boundValue(asBoolean(left) && evaluateCondition(right, frame));
    case '||':
      return boundValue(asBoolean(left) || evaluateCondition(right, frame));
    case '==':
      return boundValue(same(left, evaluate(right, frame)));
    case '!=':
      return boundValue(!same(left, evaluate(right, frame)));
  }
  const a = asInteger(left);
  const b = asInteger(evaluate(right, frame));
  switch (operator) {
    case '<':
      return boundValue(a < b);
    case '<=':
      return boundValue(a <= b);
    case '>':
      return boundValue(a > b);
    case '>=':
      return boundValue(a >= b);
    case '+':
      return boundValue(inRange(a + b));
    case '-':
      return boundValue(inRange(a - b));
  }
}

/** `==` on two objects is identity; on two values of one type, equality. Lists are never compared. */
function same(a: Evaluated, b: Evaluated): boolean {
  if (a.binds === 'object' && b.binds === 'object') return a.id === b.id;
  if (a.binds === 'value' && b.binds === 'value') {
    if (a.value instanceof SproutList || b.value instanceof SproutList) {
      throw unchecked('two lists compared with `==`');
    }
    return a.value === b.value;
  }
  throw unchecked(`${a.binds} compared with ${b.binds}`);
}

/** `x.count`: what a container holds, a set's members, or a list's elements. */
function member(expr: MemberExpr, receiver: Evaluated, frame: Frame): Evaluated {
  if (expr.member.text !== 'count') throw unchecked(`the reading \`${expr.member.text}\``);
  switch (receiver.binds) {
    case 'object':
      return boundValue(frame.state.children(receiver.id).length);
    case 'set':
      return boundValue(receiver.ids.length);
    case 'value':
      return boundValue(asList(receiver).count);
  }
}

/** `get`, `recall`, `count(K)`, `holds`, `is` and `includes`, on a receiver already evaluated. */
function reading(expr: CallExpr, receiver: Evaluated, frame: Frame): Evaluated {
  const argument = expr.arguments[0];
  if (expr.arguments.length !== 1 || argument === undefined) {
    throw unchecked(`\`${expr.method.text}\` given ${expr.arguments.length} things`);
  }
  switch (expr.method.text) {
    case 'get': {
      const name = propertyNamed(argument, frame);
      const value = instanceOf(asObject(receiver), frame).properties.get(name);
      if (value === undefined) throw unchecked(`\`:${name}\`, which its object does not hold,`);
      return boundValue(value);
    }
    case 'recall':
      return boundValue(recalled(asObject(receiver), propertyNamed(argument, frame), frame));
    case 'count': {
      const kind = kindNamed(argument, frame);
      const ids =
        receiver.binds === 'set' ? receiver.ids : frame.state.children(asObject(receiver));
      return boundValue(ids.filter((id) => composes(instanceOf(id, frame), kind)).length);
    }
    case 'holds': {
      const container = asObject(receiver);
      const item = asObject(evaluate(argument, frame));
      return boundValue(instanceOf(item, frame).container === container);
    }
    case 'is': {
      const kind = kindNamed(argument, frame);
      return boundValue(composes(instanceOf(asObject(receiver), frame), kind));
    }
    case 'includes': {
      const sought = evaluate(argument, frame);
      if (receiver.binds === 'set') return boundValue(receiver.ids.includes(asObject(sought)));
      return boundValue(asList(receiver).includes(asValue(sought)));
    }
    default:
      throw unchecked(`\`${expr.method.text}\`, which is not a reading,`);
  }
}

/**
 * What `self` remembers about `actor`: what was written, or the declared
 * default. Memory is keyed to the object that declared it, so it is read
 * from `self` and never from the actor (the spec's Per-actor memory).
 */
function recalled(actor: InstanceId, name: string, frame: Frame): Value {
  const self = instanceOf(frame.self, frame);
  const written = self.memory.get(actor)?.get(name);
  if (written !== undefined) return written;
  const property = self.kind.properties.get(name);
  if (property === undefined || !property.remembered) {
    throw unchecked(`\`:${name}\`, which \`self\` does not remember,`);
  }
  return defaultOf(property, frame.caps);
}

/** The property `:p` names. Reading the name is a node, and costs a step. */
function propertyNamed(written: Expr, frame: Frame): string {
  frame.budget.spend();
  if (written.kind !== 'symbol-expr') throw unchecked('a property named without a colon');
  return written.name.text;
}

/**
 * The kind `K` names, from the library that wrote the body: its own when
 * it declares one of the name, else the standard library's, as the
 * checker resolved it. Reading the name is a node, and costs a step.
 */
function kindNamed(written: Expr, frame: Frame): KindRef {
  frame.budget.spend();
  if (written.kind !== 'kind-expr') throw unchecked('a kind named without a capital');
  const found = lookUp(written, frame);
  if (found === null) throw unchecked(`the kind \`${written.name.text}\`, which is not declared,`);
  return found;
}

function lookUp(written: KindExpr, frame: Frame): KindRef | null {
  return written.library === null
    ? frame.kinds.unqualified(written.name.text, frame.library)
    : frame.kinds.qualified(written.library.text, written.name.text);
}

/** Matching is nominal and by composition: an instance is a `K` when its kind composes `K`. */
function composes(instance: Instance, kind: KindRef): boolean {
  return instance.kind.composes.has(kindName(kind));
}

function instanceOf(id: InstanceId, frame: Frame): Instance {
  const instance = frame.state.instance(id);
  if (instance === undefined) throw new Error(`\`${id}\` is bound, and is not an instance.`);
  return instance;
}

function inRange(result: number): number {
  if (result < INTEGER_MIN || result > INTEGER_MAX) throw new IntegerOverflow(result);
  return result;
}

function asObject(evaluated: Evaluated): InstanceId {
  if (evaluated.binds !== 'object') throw unchecked(`a ${evaluated.binds} read as an object`);
  return evaluated.id;
}

function asValue(evaluated: Evaluated): Value {
  if (evaluated.binds !== 'value') throw unchecked(`${evaluated.binds} read as a value`);
  return evaluated.value;
}

function asBoolean(evaluated: Evaluated): boolean {
  const value = asValue(evaluated);
  if (typeof value !== 'boolean') throw unchecked(`\`${String(value)}\` read as true or false`);
  return value;
}

function asInteger(evaluated: Evaluated): number {
  const value = asValue(evaluated);
  if (typeof value !== 'number') throw unchecked(`\`${String(value)}\` read as a number`);
  return value;
}

function asList(evaluated: Evaluated): SproutList {
  const value = asValue(evaluated);
  if (!(value instanceof SproutList)) throw unchecked(`\`${String(value)}\` read as a list`);
  return value;
}

/** Something the checker refuses reached the evaluator: the engine's defect, not the world's. */
function unchecked(what: string): Error {
  return new Error(`${what} reached the evaluator, which the checker refuses.`);
}
