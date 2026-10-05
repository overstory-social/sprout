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
// It only reads. An identifier or a dotted path faults out of range
// (`named.ts`); `count` and `holds` see only what is in range
// (`contents.ts`); `chance` and `random` draw from the frame's stream
// (`draws.ts`).

import type {
  BinaryExpr,
  BinaryOperator,
  CallExpr,
  Expr,
  FreeCallExpr,
  KindExpr,
  MemberExpr,
} from '../syntax/ast.js';
import { writtenMembers } from '../syntax/ast.js';
import type { StaticCaps } from '../bundle/limits.js';
import { kindName, type KindLookup, type KindRef } from '../declare/kinds.js';
import { INTEGER_MAX, INTEGER_MIN } from '../declare/types.js';
import type { Budget } from './budget.js';
import type { InstanceId } from './ids.js';
import { contentsSeen, seenBy } from './contents.js';
import { SproutList } from './lists.js';
import type { Instance, StateReader } from './state.js';
import type { NameTable } from '../check/names.js';
import { reachedByName } from './named.js';
import { seenFrom } from './sight.js';
import type { PassRule } from './range.js';
import { defaultOf, type Value } from './values.js';
import { ExtensionValue, sameExtension } from './extension-values.js';
import type { Draw } from './draws.js';

/**
 * What a name is bound to, and what an expression evaluates to: a value,
 * a thing in the world, a set of things, or the readings `help` offers,
 * the four arms a binding's type has. An object is its id, which is what
 * identity compares.
 */
export type Evaluated =
  | { readonly binds: 'value'; readonly value: Value }
  | { readonly binds: 'object'; readonly id: InstanceId }
  | { readonly binds: 'set'; readonly ids: readonly InstanceId[] }
  /** `readings` in the world's `help`: each the line a visitor would type for it. */
  | { readonly binds: 'readings'; readonly typed: readonly string[] };

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
  /** The turn's draws, where the body acts in a write turn; a deciding body and a poll have none. */
  readonly draws?: Draw;
}

/**
 * `+` or `-` gave a number outside −2,147,483,648 to 2,147,483,647, the
 * range of every integer (the spec's The types). Thrown, as `ListFull`
 * is, because the turn cannot go on, and faults it (`faults.ts`).
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

/** `readings` in the world's `help`, each already typed as the line a visitor would type for it. */
export function boundReadings(typed: readonly string[]): Evaluated {
  return { binds: 'readings', typed };
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
  return walked(expr, frame).value;
}

/** A condition: an expression the checker typed as a boolean. */
export function evaluateCondition(expr: Expr, frame: Frame): boolean {
  return asBoolean(evaluate(expr, frame));
}

/**
 * The frame the branch a condition guards runs in, where the condition
 * holds, or null where it does not. Each `name.is(K)` it holds by, alone
 * or as an operand of `&&`, over a name in a kind's body that the run
 * resolves, binds the name to what it reaches now, so that a move inside
 * the branch cannot change what it reaches (the spec's What the compiler
 * checks). A name tested alone is bound before it is tested.
 */
export function branchFrame(condition: Expr, frame: Frame): Frame | null {
  const inner = narrowedFrame(condition, frame);
  const { value, held } = walked(condition, inner);
  if (!asBoolean(value)) return null;
  return isAnd(condition) ? narrowedFrame(condition.right, held) : inner;
}

/**
 * What `expr` evaluates to, and the frame the right of its topmost `&&`
 * was read in. The right of `a && b` is read where `a` held, with each
 * name `a` narrowed bound, as the checker typed it there.
 */
function walked(expr: Expr, frame: Frame): { value: Evaluated; held: Frame } {
  const spine: Expr[] = [];
  for (let node: Expr = expr; ;) {
    spine.push(node);
    if (node.kind === 'binary') node = node.left;
    else if (node.kind === 'unary') node = node.operand;
    else if (node.kind === 'member' && !frame.names.has(node)) node = node.receiver;
    else if (node.kind === 'call') node = node.receiver;
    else break;
  }
  let below = leaf(spine.pop()!, frame);
  let held = frame;
  while (spine.length > 0) {
    const node = spine.pop()!;
    if (!isAnd(node)) {
      below = above(node, below, frame);
      continue;
    }
    frame.budget.spend();
    if (!asBoolean(below)) continue;
    // An `&&` on the left is the node just walked, and `held` is where its right was read.
    held = isAnd(node.left)
      ? narrowedFrame(node.left.right, held)
      : narrowedFrame(node.left, frame);
    below = boundValue(evaluateCondition(node.right, held));
  }
  return { value: below, held };
}

/** Whether `expr` is `a && b`. */
function isAnd(expr: Expr): expr is BinaryExpr & { readonly operator: '&&' } {
  return expr.kind === 'binary' && expr.operator === '&&';
}

/**
 * `frame` with the name or dotted path `name.is(K)` tests bound to what it
 * reaches now, where it is one in a kind's body that the run resolves;
 * `frame` itself for any other operand.
 */
function narrowedFrame(operand: Expr, frame: Frame): Frame {
  if (operand.kind !== 'call' || operand.method.text !== 'is') return frame;
  if (operand.arguments.length !== 1) return frame;
  const receiver = operand.receiver;
  // A name, or a dotted path, which is bound by its text as written.
  const [written, key] =
    receiver.kind === 'binding'
      ? [receiver.name.text, receiver.name]
      : receiver.kind === 'member'
        ? [writtenMembers(receiver), receiver]
        : [null, null];
  if (written === null || key === null) return frame;
  if (written === 'self' || frame.bindings.has(written)) return frame;
  const named = frame.names.get(key);
  if (named?.names !== 'placed') return frame;
  const bindings = new Map(frame.bindings);
  bindings.set(written, boundObject(reachedByName(named, written, frame)));
  return { ...frame, bindings };
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
      return drawn(expr, frame);
    case 'member': {
      // A dotted path, `w2.forest_1.box`: what a narrowing bound it to, else what the checker resolved it to.
      const written = writtenMembers(expr);
      const named = frame.names.get(expr);
      if (written === null || named === undefined) {
        throw unchecked(`the reading \`${expr.member.text}\` at the bottom of a spine`);
      }
      const bound = frame.bindings.get(written);
      if (bound !== undefined) return bound;
      return boundObject(reachedByName(named, written, frame));
    }
    default:
      throw unchecked(`a ${expr.kind} at the bottom of a spine`);
  }
}

/** `chance(n)`, true one time in n, or `random(n)`, from 0 to n − 1, drawn from the frame's stream. */
function drawn(expr: FreeCallExpr, frame: Frame): Evaluated {
  const written = expr.arguments[0];
  if (expr.arguments.length !== 1 || written?.kind !== 'integer') {
    throw unchecked(`\`${expr.name.text}\` given what is not one number written out`);
  }
  if (frame.draws === undefined) throw unchecked(`\`${expr.name.text}\` where nothing draws`);
  const value = frame.draws.below(written.value);
  switch (expr.name.text) {
    case 'chance':
      return boundValue(value === 0);
    case 'random':
      return boundValue(value);
    default:
      throw unchecked(`\`${expr.name.text}(…)\``);
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

/** `||` decides from its left where it can, and leaves the right unevaluated; `&&` is `walked`'s. */
function binary(operator: BinaryOperator, left: Evaluated, right: Expr, frame: Frame): Evaluated {
  switch (operator) {
    case '&&':
      throw unchecked('`&&` above another expression');
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
    if (a.value instanceof ExtensionValue && b.value instanceof ExtensionValue) {
      return sameExtension(a.value, b.value);
    }
    return a.value === b.value;
  }
  throw unchecked(`${a.binds} compared with ${b.binds}`);
}

/** `x.count`: what a container holds in range of `self`, a set's members, or a list's elements. */
function member(expr: MemberExpr, receiver: Evaluated, frame: Frame): Evaluated {
  if (expr.member.text !== 'count') throw unchecked(`the reading \`${expr.member.text}\``);
  switch (receiver.binds) {
    case 'object':
      return boundValue(contentsSeen(frame, receiver.id).length);
    case 'set':
      return boundValue(receiver.ids.length);
    case 'value':
      return boundValue(asList(receiver).count);
    case 'readings':
      throw unchecked('`.count` on `readings`, which only `{for … of}` may walk');
  }
}

/**
 * `x.sees(K, :p)`, in a place's `lit`: whether something `x` sees, by
 * the sight walk (`sight.ts`), composes `K` and holds `:p` true.
 */
function sees(expr: CallExpr, receiver: Evaluated, frame: Frame): Evaluated {
  const [kindWritten, propertyWritten] = expr.arguments;
  if (expr.arguments.length !== 2 || kindWritten === undefined || propertyWritten === undefined) {
    throw unchecked(`\`sees\` given ${expr.arguments.length} things`);
  }
  const kind = kindNamed(kindWritten, frame);
  const name = propertyNamed(propertyWritten, frame);
  return boundValue(
    seenFrom(asObject(receiver), frame).some((id) => {
      const instance = instanceOf(id, frame);
      return composes(instance, kind) && instance.properties.get(name) === true;
    }),
  );
}

/** `get`, `recall`, `count(K)`, `holds`, `is` and `includes`, on a receiver already evaluated. */
function reading(expr: CallExpr, receiver: Evaluated, frame: Frame): Evaluated {
  if (expr.method.text === 'sees') return sees(expr, receiver, frame);
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
      const ids = receiver.binds === 'set' ? receiver.ids : contentsSeen(frame, asObject(receiver));
      return boundValue(ids.filter((id) => composes(instanceOf(id, frame), kind)).length);
    }
    case 'holds': {
      const container = asObject(receiver);
      const item = asObject(evaluate(argument, frame));
      return boundValue(instanceOf(item, frame).container === container && seenBy(frame, item));
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
