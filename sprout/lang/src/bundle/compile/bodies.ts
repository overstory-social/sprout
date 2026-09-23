// The bodies a bundle's kinds write, checked against the kinds they belong
// to (the spec's The compiler › Two tiers: everything typed needs the
// whole bundle). Every composed kind is checked for what it wrote itself —
// a named kind, an object's anonymous kind, the world — and nothing is
// checked twice for being composed: a kind's guard or play is checked
// once, against the kind that wrote it: a consent guard, a role's `permit`
// and `do`, a handler, a hook and a pass rule. Each body's names resolve
// from where it is written, and what each reaches is recorded.

import { GUARD_NAMES } from '../../syntax/ast.js';
import type { Diagnostics } from '../../source/diagnostics.js';
import { kindName, type KindLookup, type KindRef } from '../../declare/kinds.js';
import type { VerbTable } from '../../declare/verbs.js';
import { checkGuard } from '../../check/guards.js';
import { checkPlay } from '../../check/roles.js';
import { checkHandler, checkHook, checkPass } from '../../check/handlers.js';
import type { MessageSetting } from '../../check/check.js';
import type { Named, NameSource, Vantage } from '../../declare/names.js';
import type { Node } from '../../source/nodes.js';

/** What every body is checked against: the kinds, verbs and messages, and where names resolve. */
export interface BodySetting {
  readonly kinds: KindLookup;
  readonly verbs: VerbTable;
  readonly diagnostics: Diagnostics;
  readonly messages: MessageSetting;
  /** The tree and what each kind gives, which a body's names resolve against. */
  readonly source: NameSource;
  /** What the world is made of, which its name types as; null where it is absent. */
  readonly world: KindRef | null;
  /** Where every name a body resolves is recorded, for the runtime. */
  readonly names: Map<Node, Named>;
}

/** A kind whose own bodies are checked, and where they are written. */
export interface Written {
  readonly kind: KindRef;
  readonly vantage: Vantage;
}

/** Check every body each of `composed` wrote itself, against it, its names resolved from its vantage. */
export function checkBodies(composed: readonly Written[], base: BodySetting): void {
  for (const { kind, vantage } of composed) {
    const setting = {
      kinds: base.kinds,
      verbs: base.verbs,
      diagnostics: base.diagnostics,
      messages: base.messages,
      names: { source: base.source, vantage, world: base.world, table: base.names },
    };
    const own = kindName(kind);
    for (const name of GUARD_NAMES) {
      for (const guard of kind.guards[name]) {
        if (guard.origin === own) checkGuard(guard.declaration, kind, setting);
      }
    }
    for (const plays of kind.plays.values()) {
      for (const play of plays) if (play.origin === own) checkPlay(play, kind, setting);
    }
    for (const handlers of kind.handlers.values()) {
      for (const handler of handlers) {
        if (handler.origin === own) checkHandler(handler, kind, setting);
      }
    }
    for (const hooks of kind.hooks.values()) {
      for (const hook of hooks) if (hook.origin === own) checkHook(hook, kind, setting);
    }
    const { any, messages } = kind.passes;
    for (const pass of [...(any === null ? [] : [any]), ...messages.values()]) {
      if (pass.origin === own) checkPass(pass, kind, setting);
    }
  }
}
