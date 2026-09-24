// The bodies a bundle's kinds write, checked against the kinds they belong
// to, and then every passage against the bodies that say it (the spec's
// The compiler › Two tiers: everything typed needs the whole bundle,
// `actor` reachability through passages among it). Every composed kind is
// checked for what it wrote itself — a named kind, an object's anonymous
// kind, the world — and nothing is checked twice for being composed: a
// kind's guard or play is checked once, against the kind that wrote it: a
// consent guard, a role's `permit` and `do`, a handler, a hook, a pass
// rule, an exit's destination and guard, and a `describe`. Each body's names resolve
// from where it is written, and what each reaches is recorded.

import { GUARD_NAMES } from '../../syntax/ast.js';
import type { Diagnostics } from '../../source/diagnostics.js';
import { kindName, type KindLookup, type KindRef } from '../../declare/kinds.js';
import type { HereKind } from '../../declare/places.js';
import type { VerbTable } from '../../declare/verbs.js';
import { checkGuard } from '../../check/guards.js';
import { checkPlay } from '../../check/roles.js';
import { checkHandler, checkHook, checkPass } from '../../check/handlers.js';
import { checkExit } from '../../check/exits.js';
import { checkDescribe } from '../../check/describe.js';
import type { DescribeDeclaration } from '../../syntax/ast-speech.js';
import type { MessageSetting } from '../../check/check.js';
import type { Named, NameSource, Vantage } from '../../declare/names.js';
import type { Node } from '../../source/nodes.js';
import type { Span } from '../../source/source.js';
import { checkPassages } from '../../check/passages.js';
import { PassageSites } from '../../check/speech.js';
import type { PinnedExtensions } from '../../declare/extensions.js';

/** What every body is checked against: the kinds, verbs and messages, and where names resolve. */
export interface BodySetting {
  readonly kinds: KindLookup;
  /** What `here` is typed as, over every composed kind in the world. */
  readonly here: HereKind;
  readonly verbs: VerbTable;
  readonly diagnostics: Diagnostics;
  readonly messages: MessageSetting;
  /** The tree and what each kind gives, which a body's names resolve against. */
  readonly source: NameSource;
  /** What the world is made of, which its name types as; null where it is absent. */
  readonly world: KindRef | null;
  /** Where every name a body resolves is recorded, for the runtime. */
  readonly names: Map<Node, Named>;
  /** The extensions the bundle pins, whose statements a body may write. */
  readonly extensions?: PinnedExtensions;
  /**
   * Told of a passage a body names that its kind lacks because the
   * `.prose` file that held it is absent: true where it has been told.
   */
  readonly absentPassage?: (self: KindRef, name: string, at: Span) => boolean;
  /** Told of a describe whose every `text` names a passage its kind lacks. */
  readonly emptiedDescribe?: (self: KindRef, describe: DescribeDeclaration) => void;
}

/** A kind whose own bodies are checked, and where they are written. */
export interface Written {
  readonly kind: KindRef;
  readonly vantage: Vantage;
}

/**
 * Check every body each of `composed` wrote itself, against it, its names
 * resolved from its vantage, then every passage; give back the slots that
 * render an option, which the runtime humanises.
 */
export function checkBodies(composed: readonly Written[], base: BodySetting): ReadonlySet<Node> {
  const sites = new PassageSites();
  const speech = {
    sites,
    ...(base.absentPassage === undefined ? {} : { absent: base.absentPassage }),
  };
  const namesOf = (vantage: Vantage) => ({
    source: base.source,
    vantage,
    world: base.world,
    table: base.names,
  });
  for (const { kind, vantage } of composed) {
    const setting = {
      kinds: base.kinds,
      here: base.here,
      verbs: base.verbs,
      diagnostics: base.diagnostics,
      messages: base.messages,
      names: namesOf(vantage),
      speech,
      ...(base.extensions === undefined ? {} : { extensions: base.extensions }),
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
    for (const exit of kind.exits) if (exit.origin === own) checkExit(exit, kind, setting);
    if (kind.describe !== null && kind.describe.origin === own) {
      checkDescribe(kind.describe, kind, {
        ...setting,
        ...(base.emptiedDescribe === undefined ? {} : { emptied: base.emptiedDescribe }),
      });
    }
  }
  checkPassages({
    speakers: composed.map(({ kind, vantage }) => ({ kind, names: namesOf(vantage) })),
    kinds: base.kinds,
    here: base.here,
    diagnostics: base.diagnostics,
    sites,
  });
  return sites.options;
}
