// The expression checker's context, which every module beside it takes:
// what a body is being read inside, and the one way back to the top of a
// spine.
//
// Typing is recursive across areas — a comparison types its right side,
// a write types the value it is given — but the walk that types an
// expression is `check.ts`'s, and a module here never imports it. The
// `Checker` carries it instead, so the modules form a chain with no cycle
// and every recursion shares one context and one set of diagnostics.

import type { Expr } from '../../syntax/ast.js';
import type { BindingType, Scope } from '../bindings.js';
import type { KindLookup, KindRef } from '../../declare/kinds.js';
import type { ResolvedVerb, VerbLookup } from '../../declare/verbs.js';
import type { Diagnostics } from '../../source/diagnostics.js';

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
   * object can read another object's memory of anyone — so a `remembers`
   * entry is looked up here and never on the receiver.
   */
  readonly self: KindRef | null;
  readonly diagnostics: Diagnostics;
  /** The verb a body plays a role in, by name, where it plays one: what `bound` asks about. */
  readonly verb?: string;
  /** What an `act` in the body is checked against, where the body may hold one. */
  readonly acting?: ActSetting;
}

/** The verbs an `act` may name (the spec's Verbs › Acting). */
export interface ActSetting {
  readonly verbs: VerbLookup & { all(): readonly ResolvedVerb[] };
}

/** A context that can type an expression it meets on the way, by the walk it was made with. */
export interface Checker extends CheckContext {
  readonly typeOf: (expr: Expr) => BindingType | null;
}

/** A checker over `context`, whose `typeOf` hands `walk` this same checker. */
export function checkerOf(
  context: CheckContext,
  walk: (expr: Expr, checker: Checker) => BindingType | null,
): Checker {
  const checker: Checker = {
    scope: context.scope,
    kinds: context.kinds,
    from: context.from,
    self: context.self,
    diagnostics: context.diagnostics,
    ...(context.verb === undefined ? {} : { verb: context.verb }),
    typeOf: (expr) => walk(expr, checker),
  };
  return checker;
}
