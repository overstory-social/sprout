// The bodies a bundle's kinds write, checked against the kinds they belong
// to (the spec's The compiler › Two tiers: everything typed needs the
// whole bundle). Every composed kind is checked for what it wrote itself —
// a named kind, an object's anonymous kind, the world — and nothing is
// checked twice for being composed: a kind's guard or play is checked
// once, against the kind that wrote it. Today a body is a consent guard or
// a role's `permit` and `do`; handlers and hooks join as B32 reads them.

import { GUARD_NAMES } from '../../syntax/ast.js';
import type { Diagnostics } from '../../source/diagnostics.js';
import { kindName, type KindLookup, type KindRef } from '../../declare/kinds.js';
import type { VerbTable } from '../../declare/verbs.js';
import { checkGuard } from '../../check/guards.js';
import { checkPlay } from '../../check/roles.js';

/** What every body is checked against: the kinds and verbs. */
export interface BodySetting {
  readonly kinds: KindLookup;
  readonly verbs: VerbTable;
  readonly diagnostics: Diagnostics;
}

/** Check every guard and play each of `composed` wrote itself, against it. */
export function checkBodies(composed: readonly KindRef[], setting: BodySetting): void {
  for (const kind of composed) {
    const own = kindName(kind);
    for (const name of GUARD_NAMES) {
      for (const guard of kind.guards[name]) {
        if (guard.origin === own) checkGuard(guard.declaration, kind, setting);
      }
    }
    for (const plays of kind.plays.values()) {
      for (const play of plays) if (play.origin === own) checkPlay(play, kind, setting);
    }
  }
}
