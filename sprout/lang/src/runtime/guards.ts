// Running one consent guard's body (the spec's Movement and consent › The
// three roles, Guards are read-only; Limits › Runtime budgets).
//
// A guard ends in `allow`, in `refuse`, or by reaching its end, which
// allows. Inside it `self` is the party asked, `mover` whatever proposed
// the move, and the parameters the objects the move names, positionally.
// A guard only reads, so it can fault only as an expression can: by
// exhausting the step budget, or by arithmetic leaving the integer range.
// Every statement executed is one step, and every expression node one more.
//
// Nothing here renders. A refusal carries the passage it names, looked up
// on the refusing instance's kind at run time so that a composer's own
// line replaces a library default, or the words it quoted; B29 renders
// either.

import type { Block, GuardName, IfStatement, RefuseStatement, Statement } from '../syntax/ast.js';
import type { StaticCaps } from '../bundle/limits.js';
import type { ResolvedGuard } from '../declare/guards.js';
import type { KindLookup } from '../declare/kinds.js';
import type { ResolvedPassage } from '../declare/passages.js';
import type { Budget } from './budget.js';
import {
  boundObject,
  evaluate,
  evaluateCondition,
  type Evaluated,
  type Frame,
} from './evaluate.js';
import type { InstanceId } from './ids.js';
import type { StateReader } from './state.js';

/** One party's refusal of a move, and what it said. */
export interface Refusal {
  readonly guard: GuardName;
  /** The instance whose guard refused. */
  readonly by: InstanceId;
  /** The kind that wrote the guard, by qualified name. */
  readonly origin: string;
  /** The passage named, as it applies on the refusing instance's kind, or the words quoted. */
  readonly said: { readonly passage: ResolvedPassage } | { readonly text: string };
}

/** What a guard is asked about, and what it reads while it decides. */
export interface GuardContext {
  readonly state: StateReader;
  readonly kinds: KindLookup;
  readonly budget: Budget;
  readonly caps: StaticCaps;
  /** The party asked: the thing for `depart`, the container left or entered for the others. */
  readonly self: InstanceId;
  /** Whatever proposed the move. */
  readonly mover: InstanceId;
  /** `to` for `depart`; `item, to` for `release`; `item, from` for `accept`. */
  readonly parameters: readonly InstanceId[];
}

/** How a block ended: it ran to its end, or a statement in it decided. */
type Ended = 'end' | 'allow' | Refusal;

/** Run `guard` for `context.self`: `'allow'`, or the refusal that decides. */
export function runGuard(guard: ResolvedGuard, context: GuardContext): 'allow' | Refusal {
  const { declaration } = guard;
  if (declaration.parameters.length !== context.parameters.length) {
    throw new Error(
      `\`${declaration.guard}\` takes ${count(declaration.parameters.length)} and was given ${context.parameters.length}.`,
    );
  }
  const bindings = new Map<string, Evaluated>([['mover', boundObject(context.mover)]]);
  declaration.parameters.forEach((parameter, at) => {
    bindings.set(parameter.text, boundObject(context.parameters[at]!));
  });
  const frame: Frame = {
    state: context.state,
    kinds: context.kinds,
    library: libraryOf(guard.origin),
    self: context.self,
    bindings,
    budget: context.budget,
    caps: context.caps,
  };
  const ended = runBlock(declaration.body, frame, guard);
  return ended === 'end' ? 'allow' : ended;
}

/** A block's statements in order, in a scope of its own: a `let` lives to its `}`. */
function runBlock(block: Block, outer: Frame, guard: ResolvedGuard): Ended {
  const bindings = new Map(outer.bindings);
  const frame: Frame = { ...outer, bindings };
  for (const statement of block.statements) {
    const ended = runStatement(statement, frame, bindings, guard);
    if (ended !== 'end') return ended;
  }
  return 'end';
}

/** One statement, one step; a `let` adds to `bindings`, which are its block's. */
function runStatement(
  statement: Statement,
  frame: Frame,
  bindings: Map<string, Evaluated>,
  guard: ResolvedGuard,
): Ended {
  frame.budget.spend();
  switch (statement.kind) {
    case 'let':
      if (statement.value.kind === 'spawn') throw readOnly('`let … = spawn`');
      bindings.set(statement.name.text, evaluate(statement.value, frame));
      return 'end';
    case 'if':
      return runIf(statement, frame, guard);
    case 'allow':
      return 'allow';
    case 'refuse':
      return refusal(statement, frame, guard);
    case 'spawn':
      throw readOnly('`spawn`');
    case 'destroy':
      throw readOnly('`destroy`');
    case 'expression-statement':
      throw readOnly('an expression standing as a statement');
  }
}

/** An `if` and each `else if` after it, as the chain it is; each link tested is a step. */
function runIf(statement: IfStatement, frame: Frame, guard: ResolvedGuard): Ended {
  for (let link: IfStatement = statement; ;) {
    if (evaluateCondition(link.condition, frame)) return runBlock(link.then, frame, guard);
    const otherwise = link.otherwise;
    if (otherwise === null) return 'end';
    if (otherwise.kind === 'block') return runBlock(otherwise, frame, guard);
    frame.budget.spend();
    link = otherwise;
  }
}

/** `refuse "…"` or `refuse <passage>`, as the refusing instance's kind has that passage. */
function refusal(statement: RefuseStatement, frame: Frame, guard: ResolvedGuard): Refusal {
  const said = statement.said;
  const by = frame.self;
  const base = { guard: guard.declaration.guard, by, origin: guard.origin };
  if (said.kind === 'string') return { ...base, said: { text: said.value } };
  const passage = frame.state.instance(by)?.kind.passages.get(said.text);
  if (passage === undefined) {
    throw new Error(
      `\`${by}\` refuses with the passage \`${said.text}\`, which its kind does not have; the checker refuses that.`,
    );
  }
  return { ...base, said: { passage } };
}

function count(parameters: number): string {
  return parameters === 1 ? 'one parameter' : `${parameters} parameters`;
}

/**
 * The library of a kind by its qualified name. A library's name is a
 * manifest name, which holds no `.`, so the library is what precedes the first.
 */
function libraryOf(qualified: string): string {
  const dot = qualified.indexOf('.');
  if (dot <= 0) throw new Error(`\`${qualified}\` is not a qualified name.`);
  return qualified.slice(0, dot);
}

/** What a guard may not do reached it: the checker refuses it, so this is the engine's defect. */
function readOnly(what: string): Error {
  return new Error(`${what} reached a guard, which only reads; the checker refuses it.`);
}
