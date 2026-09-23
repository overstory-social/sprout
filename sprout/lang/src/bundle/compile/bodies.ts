// The bodies a bundle's kinds write, checked against the kinds they belong
// to (the spec's The compiler › Two tiers: everything typed needs the
// whole bundle). Every composed kind is checked for what it wrote itself —
// a named kind, an object's anonymous kind, the world — and nothing is
// checked twice for being composed: a kind's guard is checked once,
// against the kind that wrote it. Today a body is a consent guard; roles,
// handlers and hooks join as the items that read them land.

import { GUARD_NAMES } from '../../syntax/ast.js';
import type { Diagnostics } from '../../source/diagnostics.js';
import { kindName, type KindLookup, type KindRef } from '../../declare/kinds.js';
import { checkGuard } from '../../check/guards.js';

/** Check every guard each of `composed` wrote itself, against it. */
export function checkBodies(
  composed: readonly KindRef[],
  kinds: KindLookup,
  diagnostics: Diagnostics,
): void {
  for (const kind of composed) {
    const own = kindName(kind);
    for (const name of GUARD_NAMES) {
      for (const guard of kind.guards[name]) {
        if (guard.origin === own) checkGuard(guard.declaration, kind, { kinds, diagnostics });
      }
    }
  }
}
