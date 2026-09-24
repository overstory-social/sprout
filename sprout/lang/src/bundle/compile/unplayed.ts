// The warnings for a verb no object plays a role for, and a role in a
// verb nothing fills (the spec's The compiler › What it warns about).
// What can take part is what the world can hold: each declared object,
// each thing a kind's body gives its instances, the world, the kind its
// visitors are made of, and each kind a body spawns. A kind role is filled
// where one of those composes its kind; a value role, where a part's
// `from` narrows it or an `act` names it. Only the world's own verbs are
// warned about, as for the unsaid warning: a library's are its author's.
//
// A verb nothing plays is said once, at its name, and nothing more is
// said of its roles or of what its plays leave unsaid.

import type { Diagnostics } from '../../source/diagnostics.js';
import { writtenKind } from '../../declare/compose.js';
import { fileNamedFor } from '../../declare/file-names.js';
import { kindName, type KindRef } from '../../declare/kinds.js';
import { ACTOR_ROLE, playKey } from '../../declare/roles.js';
import type { ResolvedRole, ResolvedVerb } from '../../declare/verbs.js';
import { bodiesOf, statementsIn } from './written.js';

/** What the warnings read: the kinds of everything that can take part, every verb, and whose verbs are the world's. */
export interface UnplayedSetting {
  /** The kind of every thing the world can hold, each once. */
  readonly takingPart: readonly KindRef[];
  /** Every composed kind, whose bodies' `act`s are read. */
  readonly kinds: readonly KindRef[];
  readonly verbs: readonly ResolvedVerb[];
  /** The world's own namespace. */
  readonly namespace: string;
  readonly diagnostics: Diagnostics;
}

/**
 * Warn at each of the world's verbs nothing plays, and at each role of
 * one that nothing fills. Gives back the verbs said to be played by
 * nothing, of which nothing more is said.
 */
export function warnUnplayed(setting: UnplayedSetting): ReadonlySet<ResolvedVerb> {
  const { takingPart, verbs, namespace, diagnostics } = setting;
  const roles: RoleSetting = { takingPart, acted: actedRoles(setting.kinds), diagnostics };
  const unplayed = new Set<ResolvedVerb>();
  for (const verb of verbs) {
    if (verb.library !== namespace) continue;
    if (!playedIn(verb, takingPart)) {
      unplayed.add(verb);
      warnVerb(verb, diagnostics);
      continue;
    }
    for (const role of verb.roles) warnRole(verb, role, roles);
  }
  return unplayed;
}

/** What a role's warning reads. */
interface RoleSetting {
  readonly takingPart: readonly KindRef[];
  /** Each role an `act` names, as `verb role`. */
  readonly acted: ReadonlySet<string>;
  readonly diagnostics: Diagnostics;
}

/** Each role some `act` in `kinds` fills, as `verb role`: an `act` gives a value role its value itself. */
function actedRoles(kinds: readonly KindRef[]): Set<string> {
  const acted = new Set<string>();
  for (const kind of kinds) {
    for (const { block } of bodiesOf(kind)) {
      for (const statement of statementsIn(block)) {
        if (statement.kind !== 'act') continue;
        for (const role of statement.roles) acted.add(`${statement.verb.text} ${role.role.text}`);
      }
    }
  }
  return acted;
}

/** Whether any of `kinds` plays any part in `verb`, the actor's included. */
function playedIn(verb: ResolvedVerb, kinds: readonly KindRef[]): boolean {
  const keys = [ACTOR_ROLE, ...verb.roles.map((role) => role.name)].map((role) =>
    playKey(verb.library, verb.name, role),
  );
  return kinds.some((kind) => keys.some((key) => (kind.plays.get(key) ?? []).length > 0));
}

function warnVerb(verb: ResolvedVerb, diagnostics: Diagnostics): void {
  const name = verb.name;
  const target = verb.roles[0];
  const outcome =
    verb.phrases.length > 0
      ? "typing it is answered with the world's `nothing_happens`"
      : `\`act ${name}\` does nothing`;
  diagnostics.warn(
    verb.declaration.name.at,
    `Nothing in this world plays a part in \`${name}\`, so ${outcome}.`,
    target === undefined
      ? `Give the kind of whoever does it a part, as in \`as actor for ${name} { do { say "…" } }\` in a kind that composes \`sprout.Actor\`.`
      : `Give the kind of what it is done to a part, as in \`as ${target.name} for ${name} { do { say "…" } }\`.`,
  );
}

function warnRole(
  verb: ResolvedVerb,
  role: ResolvedRole,
  { takingPart, acted, diagnostics }: RoleSetting,
): void {
  const filler = role.filler;
  // A kind that is absent or could not be one has been said already; an
  // open role is filled by any thing, and an exit by the place's ways out.
  if (filler === null || filler.fills === 'open' || filler.fills === 'exit') return;
  if (filler.fills === 'kind') {
    const written = role.declaration.filler;
    if (written === null || written.kind !== 'kind-expr') return;
    const identity = kindName(filler.kind);
    if (takingPart.some((kind) => kind.composes.has(identity))) return;
    const shown = writtenKind(written);
    const example = fileNamedFor(filler.kind.name).slice(0, -'.sprout'.length);
    diagnostics.warn(
      written.at,
      `Nothing in this world is a \`${shown}\`, so nothing can be \`${verb.name}\`'s \`${role.name}\`.`,
      `Put one in a place, as in \`object ${example} is ${shown}\`, or \`spawn ${shown}\` where one should appear; or give \`${role.name}\` a kind something here is made of.`,
    );
    return;
  }
  const key = (part: string) => playKey(verb.library, verb.name, part);
  const parts = [ACTOR_ROLE, ...verb.roles.map((each) => each.name)];
  const narrowed = takingPart.some((kind) =>
    parts.some((part) =>
      (kind.plays.get(key(part)) ?? []).some((play) => play.narrows.has(role.name)),
    ),
  );
  if (narrowed || acted.has(`${verb.name} ${role.name}`)) return;
  const from =
    filler.fills === 'symbol'
      ? `${role.name} from :<a list property>`
      : `${role.name} from 1 to 12`;
  // A value role is never played itself, so the example plays a thing's part.
  const player =
    verb.roles.find((each) => each.filler?.fills !== 'symbol' && each.filler?.fills !== 'integer')
      ?.name ?? ACTOR_ROLE;
  diagnostics.warn(
    role.declaration.name.at,
    `Nothing that plays a part in \`${verb.name}\` says which ${filler.fills === 'symbol' ? 'options' : 'numbers'} \`${role.name}\` takes, so it is never bound.`,
    `Say it with \`from\` in the body of a part that hears it, as in \`as ${player} for ${verb.name} { ${from} … }\`.`,
  );
}
