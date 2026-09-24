// Running a body's block (the spec's Verbs › The two passes, Moving
// something, Acting; Movement and consent › Guards are read-only;
// Properties › What the compiler checks, Lists, Per-actor memory; The
// world model › Spawning, Destroying; Prose; Limits › Runtime budgets).
//
// One runner, in two modes. A guard and a `permit` decide: they read, and
// end in `allow`, in `refuse`, or by reaching their end. A `do` acts: it
// writes `self` through the turn's draft, spawns, destroys, moves, acts and
// says, and a refused `move` or `act` ends it there. Each mode holds
// exactly what `check/blocks.ts` lets its bodies hold, so anything else
// reaching it is the engine's defect, thrown as a plain `Error`. Every statement executed is one step and every
// expression node one more. A `set` or `remember` of a value its property
// cannot hold faults, an `adjust` clamps, and adding a new element to a
// full list faults. A `send` or a `broadcast` queues what it sends, and
// a write that changes a property its kind watches queues the hook, which
// the bus delivers once the body has ended. Nothing is rendered: B29
// renders what is said, and B30 brings `tell`.

import type {
  Block,
  CallExpr,
  Expr,
  IfStatement,
  ObjectPath,
  RefuseStatement,
  SayStatement,
  SpawnStatement,
  Statement,
} from '../syntax/ast.js';
import { qualifiedName } from '../declare/enums.js';
import { kindName } from '../declare/kinds.js';
import type { ResolvedPassage } from '../declare/passages.js';
import type { ResolvedProperty } from '../declare/properties.js';
import { showType } from '../declare/types.js';
import {
  boundObject,
  evaluate,
  evaluateCondition,
  type Evaluated,
  type Frame,
} from './evaluate.js';
import type { InstanceId } from './ids.js';
import {
  destroyInstance,
  spawnInstance,
  type Destroyed,
  type LifecycleContext,
} from './lifecycle.js';
import { sameValue, SproutList } from './lists.js';
import type { Performed } from './act.js';
import { objectNamed, reachedByName } from './named.js';
import { broadcastFrom, sendTo, type Sent } from './sends.js';
import { reachMessage, type DeclaredMessage } from '../declare/messages.js';
import { writtenPath } from '../syntax/ast.js';
import type { Instance } from './state.js';
import { defaultOf, fits, type Value } from './values.js';

/** What a `say` or a `refuse` gives: a passage as it applies on the speaker's kind, or the words quoted. */
export type Speech = { readonly passage: ResolvedPassage } | { readonly text: string };

/** Whether a body decides, as a guard and a `permit` do, or acts, as a `do` does. */
export type BodyMode = 'decide' | 'act';

/** How a body ended: it ran to its end, or, deciding, it allowed or refused. */
export type Ended = 'end' | 'allow' | { readonly refused: Speech };

/** What came of a `move` or an `act` a body ran: done, or refused, which ends the body. */
export type Proposed = 'done' | 'refused';

/** One `say`, as the body said it. */
export interface Spoken {
  /** The object whose body said it: `self` when it renders. */
  readonly by: InstanceId;
  readonly said: Speech;
  /** Every name in scope where it was said, `let`s included, which its slots may render. */
  readonly bindings: ReadonlyMap<string, Evaluated>;
}

/** Where an acting body's effects go, and what its spawns and writes reach. */
export interface ActSink {
  /** The turn's draft, kinds, pass rules, budget and the host's bound on instances. */
  readonly lifecycle: LifecycleContext;
  say(spoken: Spoken): void;
  /** What a spawn tells the world, and what a `send` or a `broadcast` queues, in body order. */
  sent(sends: readonly Sent[]): void;
  /** `self` removed with everything it held, at the end of the body that ran `destroy self`. */
  destroyed(destroyed: Destroyed): void;
  /** `self` marked by `finally destroy self`, to be destroyed once the turn's queue is empty. */
  marked(id: InstanceId): void;
  /**
   * `move item to to`, proposed by `mover`, the object whose body ran it:
   * asked through consent, and what came of it said or sent. A refusal
   * ends the body (the spec's Moving something).
   */
  move(mover: InstanceId, item: InstanceId, to: InstanceId): Proposed;
  /**
   * `act`, performed by `actor`, the object whose body ran it: its reading
   * run through both passes, and what came of it said or sent. A refusal
   * in its consent pass ends the body (the spec's Acting).
   */
  act(actor: InstanceId, performed: Performed): Proposed;
}

/**
 * A `set` or `remember` of a value its property cannot hold (the spec's
 * What the compiler checks: a fault at run time where the compiler could
 * not tell). Thrown, as `ListFull` is, because the turn cannot do what it
 * was asked, and faults the turn (`faults.ts`).
 */
export class ValueOutOfRange extends Error {
  constructor(
    readonly object: InstanceId,
    readonly property: string,
    readonly value: Value,
  ) {
    super(`\`${object}\` cannot hold ${String(value)} in \`:${property}\`.`);
    this.name = 'ValueOutOfRange';
  }
}

/**
 * One run of a body: its mode, where its effects go, whether it has asked
 * to be destroyed, and why it stopped before its end, if it did: `self`
 * gone, destroyed by a reading it performed, or a `move` or an `act` in
 * it refused. Either ends the whole body, from however deep a block.
 */
interface Run {
  readonly mode: BodyMode;
  readonly sink: ActSink | null;
  destroying: boolean;
  /** Whether it ran `finally destroy self`, which waits for the turn's queue to empty. */
  finally: boolean;
  stopped: 'gone' | 'refused' | null;
}

/**
 * Run `block` as the body of `frame.self`. Deciding, it may end in
 * `allow` or a refusal; acting, it runs to its end or its first refused
 * `move` or `act`, and a `destroy self` in it takes effect then (the
 * spec's Destroying).
 */
export function runBody(block: Block, frame: Frame, mode: BodyMode, sink: ActSink | null): Ended {
  if (mode === 'act' && sink === null) {
    throw new Error('a body that acts has somewhere to put what it does.');
  }
  const run: Run = { mode, sink, destroying: false, finally: false, stopped: null };
  const ended = runBlock(block, frame, run);
  if (run.destroying && run.stopped !== 'gone')
    sink!.destroyed(destroyInstance(sink!.lifecycle.draft, frame.self));
  else if (run.finally && run.stopped !== 'gone') sink!.marked(frame.self);
  return ended;
}

/** A block's statements in order, in a scope of its own: a `let` lives to its `}`. */
function runBlock(block: Block, outer: Frame, run: Run): Ended {
  const bindings = new Map(outer.bindings);
  const frame: Frame = { ...outer, bindings };
  for (const statement of block.statements) {
    const ended = runStatement(statement, frame, bindings, run);
    if (ended !== 'end' || run.stopped !== null) return ended;
  }
  return 'end';
}

/** One statement, one step; a `let` adds to `bindings`, which are its block's. */
function runStatement(
  statement: Statement,
  frame: Frame,
  bindings: Map<string, Evaluated>,
  run: Run,
): Ended {
  frame.budget.spend();
  switch (statement.kind) {
    case 'let': {
      const value = statement.value;
      const bound =
        value.kind === 'spawn'
          ? boundObject(spawn(value, frame, acting(run, '`let … = spawn`')))
          : evaluate(value, frame);
      bindings.set(statement.name.text, bound);
      return 'end';
    }
    case 'if':
      return runIf(statement, frame, run);
    case 'allow':
      deciding(run, '`allow`');
      return 'allow';
    case 'refuse':
      deciding(run, '`refuse`');
      return { refused: speech(statement, frame) };
    case 'spawn':
      spawn(statement, frame, acting(run, '`spawn`'));
      return 'end';
    case 'destroy':
      acting(run, '`destroy`');
      if (statement.finally) run.finally = true;
      else run.destroying = true;
      return 'end';
    case 'move': {
      const sink = acting(run, '`move`');
      const item = objectAt(statement.thing, frame);
      const to = objectAt(statement.destination, frame);
      if (sink.move(frame.self, item, to) === 'refused') run.stopped = 'refused';
      return 'end';
    }
    case 'act': {
      const sink = acting(run, '`act`');
      const roles = new Map<string, Evaluated>();
      for (const role of statement.roles) {
        roles.set(role.role.text, evaluatedAt(role.filler, frame));
      }
      const proposed = sink.act(frame.self, {
        verb: statement.verb.text,
        library: frame.library,
        roles,
      });
      if (proposed === 'refused') run.stopped = 'refused';
      // The reading may have destroyed the actor, and a body whose `self`
      // is gone has nothing left to run for.
      else if (sink.lifecycle.draft.instance(frame.self) === undefined) run.stopped = 'gone';
      return 'end';
    }
    case 'send': {
      const sink = acting(run, '`send`');
      const target = targetAt(statement.target, frame);
      const declared = declaredMessage(statement.message.text, frame, sink);
      if (declared === null) return 'end';
      const value = statement.value === null ? null : asValue(evaluate(statement.value, frame));
      sink.sent(sendTo(sendingIn(sink, frame), frame.self, target, declared, value));
      return 'end';
    }
    case 'broadcast': {
      const sink = acting(run, '`broadcast`');
      const declared = declaredMessage(statement.message.text, frame, sink);
      if (declared === null) return 'end';
      const value = statement.value === null ? null : asValue(evaluate(statement.value, frame));
      sink.sent(broadcastFrom(sendingIn(sink, frame), frame.self, declared, value));
      return 'end';
    }
    case 'say':
      acting(run, '`say`').say({
        by: frame.self,
        said: speech(statement, frame),
        bindings: new Map(bindings),
      });
      return 'end';
    case 'expression-statement':
      write(statement.expression, frame, acting(run, 'a write'));
      return 'end';
  }
}

/** An `if` and each `else if` after it, as the chain it is; each link tested is a step. */
function runIf(statement: IfStatement, frame: Frame, run: Run): Ended {
  for (let link: IfStatement = statement; ;) {
    if (evaluateCondition(link.condition, frame)) return runBlock(link.then, frame, run);
    const otherwise = link.otherwise;
    if (otherwise === null) return 'end';
    if (otherwise.kind === 'block') return runBlock(otherwise, frame, run);
    frame.budget.spend();
    link = otherwise;
  }
}

/** `say` or `refuse` with words in quotes, or a passage as the speaker's kind has it, so a composer's own line replaces a default. */
function speech(statement: RefuseStatement | SayStatement, frame: Frame): Speech {
  const said = statement.said;
  if (said.kind === 'string') return { text: said.value };
  const passage = frame.state.instance(frame.self)?.kind.passages.get(said.text);
  if (passage === undefined) {
    const verb = statement.kind === 'say' ? 'says' : 'refuses with';
    throw new Error(
      `\`${frame.self}\` ${verb} the passage \`${said.text}\`, which its kind does not have; the checker refuses that.`,
    );
  }
  return { passage };
}

/**
 * `spawn K in c`: a new instance of `K`, as the library that wrote the
 * body names it, in what `c` is bound to. A kind absent at load is
 * named from that library, for the spawn to fault on.
 */
function spawn(statement: SpawnStatement, frame: Frame, sink: ActSink): InstanceId {
  const written = statement.spawned;
  const found =
    written.library === null
      ? frame.kinds.unqualified(written.name.text, frame.library)
      : frame.kinds.qualified(written.library.text, written.name.text);
  const kind =
    found === null
      ? qualifiedName(written.library?.text ?? frame.library, written.name.text)
      : kindName(found);
  const container = objectAt(statement.container, frame);
  const spawned = spawnInstance(sink.lifecycle, frame.self, kind, container);
  sink.sent(spawned.sends);
  return spawned.id;
}

/**
 * What a path in a statement evaluates to: one name is a binding or an
 * identifier, read as an expression reads it, and a dotted path is what
 * the checker resolved it to, read through in range. One step.
 */
function evaluatedAt(path: ObjectPath, frame: Frame): Evaluated {
  const [only, ...rest] = path.parts;
  if (only !== undefined && rest.length === 0) {
    return evaluate({ kind: 'binding', name: only, at: only.at }, frame);
  }
  frame.budget.spend();
  const named = frame.names.get(path);
  if (named === undefined) {
    throw new Error(
      `\`${writtenPath(path)}\` reached the runtime unresolved; the checker resolves it.`,
    );
  }
  return boundObject(reachedByName(named, writtenPath(path), frame));
}

/** A spawn's container or either side of a move: one object, read through in range. */
function objectAt(path: ObjectPath, frame: Frame): InstanceId {
  return asObject(evaluatedAt(path, frame));
}

/**
 * Who a `send` is to: a binding, or what an identifier or path reaches
 * now, whatever its range, which the send itself asks; null where it
 * reaches nothing, and the send goes nowhere. One step.
 */
function targetAt(path: ObjectPath, frame: Frame): InstanceId | null {
  const [only, ...rest] = path.parts;
  if (only !== undefined && rest.length === 0) {
    const bound = only.text === 'self' ? boundObject(frame.self) : frame.bindings.get(only.text);
    if (bound !== undefined) {
      frame.budget.spend();
      return asObject(bound);
    }
  }
  frame.budget.spend();
  const named = frame.names.get(rest.length === 0 && only !== undefined ? only : path);
  if (named === undefined) {
    throw new Error(
      `\`${writtenPath(path)}\` reached the runtime unresolved; the checker resolves it.`,
    );
  }
  return objectNamed(named, frame.state, frame.self);
}

/**
 * The declared message a send names, reached from the library that wrote
 * the body; null where it is absent at load, and the send goes nowhere
 * (the spec's What absent means).
 */
function declaredMessage(name: string, frame: Frame, sink: ActSink): DeclaredMessage | null {
  const reached = reachMessage(name, frame.library, sink.lifecycle.catalogue.messages);
  if (reached === null) return null;
  if ('engine' in reached) {
    throw new Error(
      `\`:${name}\` is the engine's own, and reached a send; the checker refuses it.`,
    );
  }
  return reached.declared;
}

/** What a send in this body reads: the turn's draft, its pass rules, and the meter. */
function sendingIn(sink: ActSink, frame: Frame) {
  return { state: sink.lifecycle.draft, passes: sink.lifecycle.passes, budget: frame.budget };
}

/**
 * `self.set(:p, e)`, `self.adjust(:p, n)`, `self.add(:p, e)`,
 * `self.remove(:p, e)`, `x.remember(:p, e)` and `x.adjust(:p, n)` on
 * memory: the receiver, the call and the property's name are a step
 * each, as a reading's are, and the value its own nodes.
 */
function write(expr: Expr, frame: Frame, sink: ActSink): void {
  if (expr.kind !== 'call' || expr.arguments.length !== 2) {
    throw new Error('a statement that does not write reached the runtime; the checker refuses it.');
  }
  const receiver = asObject(evaluate(expr.receiver, frame));
  frame.budget.spend();
  const name = propertyNamed(expr.arguments[0]!, frame);
  const value = asValue(evaluate(expr.arguments[1]!, frame));
  const method = expr.method.text;
  const draft = sink.lifecycle.draft;
  const self = draft.instance(frame.self);
  if (self === undefined) throw new Error(`\`${frame.self}\` writes, and is not an instance.`);
  if (method === 'remember' || (method === 'adjust' && remembersThrough(expr))) {
    draft.write(remembered(self, receiver, name, method, value, frame));
    return;
  }
  if (receiver !== frame.self) {
    throw new Error(
      `\`${method}\` on another object reached the runtime; only \`self\` writes \`self\`.`,
    );
  }
  const property = declared(self, name, false);
  const held = self.properties.get(name);
  if (held === undefined) throw new Error(`\`${self.id}\` holds no \`:${name}\`.`);
  let next: Value;
  switch (method) {
    case 'set':
      next = fitting(self.id, property, value, frame);
      break;
    case 'adjust':
      next = clamped(property, held, value);
      break;
    case 'add':
      next = asList(held).add(value);
      break;
    case 'remove':
      next = asList(held).remove(value);
      break;
    default:
      throw new Error(`\`${method}\`, which does not write, reached the runtime as a statement.`);
  }
  draft.write({ ...self, properties: new Map(self.properties).set(name, next) });
  // A hook is queued once per change, with the value it had then.
  if (!sameValue(held, next) && self.kind.hooks.has(name)) {
    sink.sent([{ message: 'changed', recipient: self.id, property: name, was: held }]);
  }
}

/** `x.adjust(…)` through a name other than `self` is memory's, as the checker reads it. */
function remembersThrough(call: CallExpr): boolean {
  return call.receiver.kind === 'binding' && call.receiver.name.text !== 'self';
}

/** `self` with what it remembers about `actor` written: `remember` sets it, `adjust` steps it within its range. */
function remembered(
  self: Instance,
  actor: InstanceId,
  name: string,
  method: string,
  value: Value,
  frame: Frame,
): Instance {
  const property = declared(self, name, true);
  const about = self.memory.get(actor);
  const held = about?.get(name) ?? defaultOf(property, frame.caps);
  const next =
    method === 'remember'
      ? fitting(self.id, property, value, frame)
      : clamped(property, held, value);
  const memory = new Map(self.memory);
  memory.set(actor, new Map(about ?? []).set(name, next));
  return { ...self, memory };
}

/** The property `self` declares by this name, remembered or not as the write needs. */
function declared(self: Instance, name: string, remembered: boolean): ResolvedProperty {
  const property = self.kind.properties.get(name);
  if (property === undefined || property.remembered !== remembered) {
    throw new Error(
      `\`:${name}\` is not ${remembered ? 'remembered' : 'held'} by \`${self.id}\`; the checker refuses that write.`,
    );
  }
  return property;
}

/** The value, where the property can hold it; a fault where it cannot. */
function fitting(
  object: InstanceId,
  property: ResolvedProperty,
  value: Value,
  frame: Frame,
): Value {
  if (!fits(property.type, value, frame.caps)) {
    throw new ValueOutOfRange(object, property.name, value);
  }
  return value;
}

/** `adjust`: the held number stepped, and clamped to the property's range, since reaching the edge is the meaning. */
function clamped(property: ResolvedProperty, held: Value, by: Value): number {
  const type = property.type;
  if (type.type !== 'integer' || typeof held !== 'number' || typeof by !== 'number') {
    throw new Error(`\`adjust\` on ${showType(type)} reached the runtime; the checker refuses it.`);
  }
  return Math.min(type.max, Math.max(type.min, held + by));
}

/** The property `:p` names. Reading the name is a node, and costs a step. */
function propertyNamed(written: Expr, frame: Frame): string {
  frame.budget.spend();
  if (written.kind !== 'symbol-expr') {
    throw new Error(
      'a property named without a colon reached the runtime; the checker refuses it.',
    );
  }
  return written.name.text;
}

function asObject(evaluated: Evaluated): InstanceId {
  if (evaluated.binds !== 'object') {
    throw new Error(`a ${evaluated.binds} stood where an object is written to or into.`);
  }
  return evaluated.id;
}

function asValue(evaluated: Evaluated): Value {
  if (evaluated.binds !== 'value') throw new Error(`a ${evaluated.binds} was written as a value.`);
  return evaluated.value;
}

function asList(held: Value): SproutList {
  if (!(held instanceof SproutList)) throw new Error(`\`${String(held)}\` was changed as a list.`);
  return held;
}

/** The sink an acting statement reaches; in a body that decides, the engine's defect. */
function acting(run: Run, what: string): ActSink {
  if (run.mode === 'decide' || run.sink === null) {
    throw new Error(
      `${what} reached a body that decides, which only reads; the checker refuses it.`,
    );
  }
  return run.sink;
}

/** `allow` and `refuse` decide; in a `do`, which acts, they are the engine's defect. */
function deciding(run: Run, what: string): void {
  if (run.mode === 'act') {
    throw new Error(
      `${what} reached a \`do\`, which acts once the deciding is done; the checker refuses it.`,
    );
  }
}
