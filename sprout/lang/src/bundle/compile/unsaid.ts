// The warning for a verb nobody speaks for (the spec's The compiler ›
// What it warns about): a verb with phrases that no participant ever
// `say`s for answers every command with the world's `nothing_happens`
// (Verbs › The two passes). Only the world's own verbs are warned about:
// a library's are its author's, and a world may write their plays itself.
//
// A verb counts as spoken for where any play for it, for any role or for
// the actor, in any composed kind of the bundle, holds a `say` in its
// `do`, however deep inside an `if` or an `each`. A `refuse` does not count: it is said
// only when the reading is refused.

import type { Block, Statement } from '../../syntax/ast.js';
import { statementsWithin } from '../../syntax/ast.js';
import type { Diagnostics } from '../../source/diagnostics.js';
import type { KindRef } from '../../declare/kinds.js';
import { ACTOR_ROLE, playKey } from '../../declare/roles.js';
import type { ResolvedVerb } from '../../declare/verbs.js';

/** What the warning reads: every composed kind, every verb, and whose declarations are the world's. */
export interface UnsaidSetting {
  readonly kinds: readonly KindRef[];
  readonly verbs: readonly ResolvedVerb[];
  /** The world's own namespace. */
  readonly namespace: string;
  readonly diagnostics: Diagnostics;
}

/** Warn at each of the world's verbs with phrases that no play `say`s anything for. */
export function warnUnsaid(setting: UnsaidSetting): void {
  const { kinds, verbs, namespace, diagnostics } = setting;
  for (const verb of verbs) {
    if (verb.library !== namespace || verb.phrases.length === 0) continue;
    if (spokenFor(verb, kinds)) continue;
    const name = verb.name;
    const role = verb.roles[0]?.name ?? ACTOR_ROLE;
    diagnostics.warn(
      verb.declaration.name.at,
      `Nothing that takes part in \`${name}\` ever \`say\`s anything, so typing it is answered with the world's \`nothing_happens\`.`,
      `Say what happens in a role's \`do\`, as in \`as ${role} for ${name} { do { say "…" } }\`.`,
    );
  }
}

/** Whether some play for `verb` in `kinds` holds a `say` in its `do`. */
function spokenFor(verb: ResolvedVerb, kinds: readonly KindRef[]): boolean {
  const keys = [ACTOR_ROLE, ...verb.roles.map((role) => role.name)].map((role) =>
    playKey(verb.library, verb.name, role),
  );
  return kinds.some((kind) =>
    keys.some((key) => (kind.plays.get(key) ?? []).some((play) => says(play.declaration.do))),
  );
}

/** Whether `block` holds a `say`, however deep inside an `if` or an `each`. */
function says(block: Block | null): boolean {
  const pending: Statement[] = [...(block?.statements ?? [])];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next.kind === 'say') return true;
    pending.push(...statementsWithin(next));
  }
  return false;
}
