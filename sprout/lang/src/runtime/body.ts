// Running a body's block (the spec's Verbs › The two passes, Moving
// something, Acting; Movement and consent › Guards are read-only;
// Properties › What the compiler checks, Lists, Per-actor memory; The
// world model › Spawning, Destroying; Prose; Limits › Runtime budgets).
//
// One runner, in two modes. A guard and a `permit` decide: they read, and
// end in `allow`, in `refuse`, or by reaching their end. A `do` acts: it
// writes `self` through the turn's draft, spawns, destroys, moves, acts and
// says. Each mode holds exactly what `check/blocks.ts` lets its bodies
// hold, so anything else reaching it is the engine's defect, thrown as a
// plain `Error`. Every statement executed is one step and every
// expression node one more. A `set` or `remember` of a value its property
// cannot hold faults, an `adjust` clamps, and adding a new element to a
// full list faults. Nothing is rendered: B29 renders what is said. B30
// brings `tell` and B32 `send`.

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
  type EngineSend,
  type LifecycleContext,
} from './lifecycle.js';
import { SproutList } from './lists.js';
import type { Performed } from './act.js';
import type { Instance } from './state.js';
import { defaultOf, fits, type Value } from './values.js';

/** What a `say` or a `refuse` gives: a passage as it applies on the speaker's kind, or the words quoted. */
export type Speech = { readonly passage: ResolvedPassage } | { readonly text: string };

/** Whether a body decides, as a guard and a `permit` do, or acts, as a `do` does. */
export type BodyMode = 'decide' | 'act';

/** How a body ended: it ran to its end, or, deciding, it allowed or refused. */
export type Ended = 'end' | 'allow' | { readonly refused: Speech };

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
  /** What the engine tells the world of a spawn, in order. */
  sent(sends: readonly EngineSend[]): void;
  /** `self` removed with everything it held, at the end of the body that ran `destroy self`. */
  destroyed(destroyed: Destroyed): void;
  /**
   * `move item to to`, proposed by `mover`, the object whose body ran it:
   * asked through consent, and what came of it said or sent. The body
   * goes on after it, whether the move was made or refused.
   */
  move(mover: InstanceId, item: InstanceId, to: InstanceId): void;
  /**
   * `act`, performed by `actor`, the object whose body ran it: its reading
   * run through both passes, and what came of it said or sent. The body
   * goes on after it, whether the reading acted or was refused.
   */
  act(actor: InstanceId, performed: Performed): void;
}

/**
 * A `set` or `remember` of a value its property cannot hold (the spec's
 * What the compiler checks: a fault at run time where the compiler could
 * not tell). Thrown, as `ListFull` is, because the turn cannot do what it
 * was asked; B34 turns it into the world's `fault` passage.
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
 * to be destroyed, and whether `self` is already gone, destroyed by a
 * reading it performed, which ends the body there.
 */
interface Run {
  readonly mode: BodyMode;
  readonly sink: ActSink | null;
  destroying: boolean;
  gone: boolean;
}

/**
 * Run `block` as the body of `frame.self`. Deciding, it may end in
 * `allow` or a refusal; acting, it runs to its end, and a `destroy self`
 * in it takes effect then (the spec's Destroying).
 */
export function runBody(block: Block, frame: Frame, mode: BodyMode, sink: ActSink | null): Ended {
  if (mode === 'act' && sink === null) {
    throw new Error('a body that acts has somewhere to put what it does.');
  }
  const run: Run = { mode, sink, destroying: false, gone: false };
  const ended = runBlock(block, frame, run);
  if (run.destroying && !run.gone)
    sink!.destroyed(destroyInstance(sink!.lifecycle.draft, frame.self));
  return ended;
}

/** A block's statements in order, in a scope of its own: a `let` lives to its `}`. */
function runBlock(block: Block, outer: Frame, run: Run): Ended {
  const bindings = new Map(outer.bindings);
  const frame: Frame = { ...outer, bindings };
  for (const statement of block.statements) {
    const ended = runStatement(statement, frame, bindings, run);
    if (ended !== 'end' || run.gone) return ended;
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
      run.destroying = true;
      return 'end';
    case 'move': {
      const sink = acting(run, '`move`');
      const item = asObject(evaluate(named(statement.thing), frame));
      const to = asObject(evaluate(named(statement.destination), frame));
      sink.move(frame.self, item, to);
      return 'end';
    }
    case 'act': {
      const sink = acting(run, '`act`');
      const roles = new Map<string, Evaluated>();
      for (const role of statement.roles) {
        roles.set(role.role.text, evaluate(named(role.filler), frame));
      }
      sink.act(frame.self, { verb: statement.verb.text, library: frame.library, roles });
      // The reading may have destroyed the actor, and a body whose `self`
      // is gone has nothing left to run for.
      if (sink.lifecycle.draft.instance(frame.self) === undefined) run.gone = true;
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
  const container = asObject(evaluate(named(statement.container), frame));
  const spawned = spawnInstance(sink.lifecycle, frame.self, kind, container);
  sink.sent(spawned.sends);
  return spawned.id;
}

/**
 * A spawn's container, either side of a move, or what fills a role of an
 * `act`: a name in scope, since a dotted path is refused until a body
 * resolves identifiers.
 */
function named(path: ObjectPath): Expr {
  const [only, ...rest] = path.parts;
  if (only === undefined || rest.length > 0) {
    throw new Error('a dotted path reached the runtime in a body; the checker refuses it.');
  }
  return { kind: 'binding', name: only, at: only.at };
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
