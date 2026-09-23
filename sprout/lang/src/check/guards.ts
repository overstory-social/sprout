// A consent guard's body, checked (the spec's Movement and consent › The
// three roles, Guards are read-only; The compiler › What it refuses).
//
// In a guard `self` is the kind that wrote it, and `mover` and the
// parameters are objects, read only through `is()`. A guard reads and
// decides, as `blocks.ts` checks a deciding body: nothing in it writes,
// spawns, destroys or speaks, and a `refuse` names a passage of the kind
// that wrote it or says its words in quotes.

import type { GuardDeclaration } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { KindLookup, KindRef } from '../declare/kinds.js';
import { guardParameterBinding, moverBinding, Scope, selfBinding } from './bindings.js';
import type { CheckContext } from './check.js';
import { checkBlock } from './blocks.js';

/** Where a guard is read: the kinds in scope and somewhere to say what is wrong. */
export interface GuardSetting {
  readonly kinds: KindLookup;
  readonly diagnostics: Diagnostics;
}

/**
 * Check one guard `self` wrote: its scope is `self`, `mover` and its
 * parameters. Returns whether nothing in it was refused.
 */
export function checkGuard(guard: GuardDeclaration, self: KindRef, setting: GuardSetting): boolean {
  const { diagnostics } = setting;
  const before = diagnostics.refusals.length;
  const scope = Scope.root();
  scope.introduce(selfBinding(self, guard.at), diagnostics);
  scope.introduce(moverBinding(guard.at), diagnostics);
  // `_` leaves a parameter unnamed, as a handler's does.
  for (const parameter of guard.parameters.filter((one) => one.text !== '_')) {
    scope.introduce(guardParameterBinding(parameter.text, parameter.at), diagnostics);
  }
  const context: CheckContext = {
    scope,
    kinds: setting.kinds,
    from: self.library,
    self,
    diagnostics,
  };
  checkBlock(guard.body, context, { body: 'guard', guard: guard.guard });
  return diagnostics.refusals.length === before;
}
