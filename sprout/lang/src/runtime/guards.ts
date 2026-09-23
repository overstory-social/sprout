// Running one consent guard's body (the spec's Movement and consent › The
// three roles, Guards are read-only; Limits › Runtime budgets).
//
// A guard ends in `allow`, in `refuse`, or by reaching its end, which
// allows. Inside it `self` is the party asked, `mover` whatever proposed
// the move, and the parameters the objects the move names, positionally.
// A guard only reads, so it can fault only as an expression can: by
// exhausting the step budget, or by arithmetic leaving the integer range.
// Every statement executed is one step, and every expression node one
// more; `body.ts` runs the block, as it runs a `permit`.
//
// Nothing here renders. A refusal carries the passage it names, looked up
// on the refusing instance's kind at run time so that a composer's own
// line replaces a library default, or the words it quoted; B29 renders
// either.

import type { GuardName } from '../syntax/ast.js';
import type { StaticCaps } from '../bundle/limits.js';
import type { ResolvedGuard } from '../declare/guards.js';
import { libraryOf } from '../declare/enums.js';
import type { KindLookup } from '../declare/kinds.js';
import { runBody, type Speech } from './body.js';
import type { Budget } from './budget.js';
import { boundObject, type Evaluated, type Frame } from './evaluate.js';
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
  readonly said: Speech;
  /** `mover` and the guard's parameters, which the refusal's slots may render. */
  readonly bindings: ReadonlyMap<string, Evaluated>;
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
    if (parameter.text !== '_') bindings.set(parameter.text, boundObject(context.parameters[at]!));
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
  const ended = runBody(declaration.body, frame, 'decide', null);
  if (ended === 'end' || ended === 'allow') return 'allow';
  return {
    guard: declaration.guard,
    by: context.self,
    origin: guard.origin,
    said: ended.refused,
    bindings,
  };
}

function count(parameters: number): string {
  return parameters === 1 ? 'one parameter' : `${parameters} parameters`;
}
