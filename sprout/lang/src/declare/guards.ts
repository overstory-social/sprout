// Which consent guards run, and in what order, on a composed kind (the
// spec's Kinds, composition and libraries › How members combine, the row
// "`depart` / `release` / `accept`: all run; any refusal decides";
// Consent under composition; Suppressing a contribution).
//
// Guards compose conjunctively: every contribution runs, in the order its
// source appears in the closure, the composer's own last. One origin
// reached by several paths contributes once. A `without` leaves one
// origin's guard out of the kind that wrote it and so out of every kind
// that reaches that origin through it; the same guard reaching a composer
// by another path still runs.

import type { GuardDeclaration, GuardName, KindMember } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { Suppression } from './kinds.js';

/** One kind's guard, as a composed kind runs it. */
export interface ResolvedGuard {
  /** The kind that wrote it, by qualified name; an object's or a world's own body is named for it. */
  readonly origin: string;
  readonly declaration: GuardDeclaration;
}

/** Every guard a composed kind runs, for each part of a move, in run order. */
export interface Guards {
  readonly depart: readonly ResolvedGuard[];
  readonly release: readonly ResolvedGuard[];
  readonly accept: readonly ResolvedGuard[];
}

/** A kind with no guard anywhere in its closure: the engine allows. */
export const NO_GUARDS: Guards = { depart: [], release: [], accept: [] };

/**
 * The guards a composer's own body writes, with `origin` as their origin.
 * A guard written twice is refused at the second, which is dropped: a
 * kind answers once for each part of a move.
 */
export function ownGuards(
  composer: string,
  members: readonly KindMember[],
  origin: string,
  diagnostics: Diagnostics,
): Map<GuardName, ResolvedGuard> {
  const own = new Map<GuardName, ResolvedGuard>();
  for (const member of members) {
    if (member.kind !== 'guard') continue;
    if (own.has(member.guard)) {
      diagnostics.refuse(
        member.at,
        `\`${composer}\` writes \`${member.guard}\` twice.`,
        `A kind answers once for each part of a move. Keep one \`${member.guard}\`, and write what both decide in it with \`if\` and \`else if\`.`,
      );
      continue;
    }
    own.set(member.guard, { origin, declaration: member });
  }
  return own;
}

/**
 * The guards a composer runs: what its composed kinds run (each already
 * less what that kind left out), each origin once and in closure order
 * (`order`, the composer not in it), less what the composer's own
 * `suppressed` leaves out, then its own.
 */
export function composeGuards(
  composed: readonly Guards[],
  order: readonly string[],
  suppressed: readonly Suppression[],
  own: ReadonlyMap<GuardName, ResolvedGuard>,
): Guards {
  const runs = (name: GuardName): ResolvedGuard[] => {
    const arrived = new Map<string, ResolvedGuard>();
    for (const guards of composed) {
      for (const guard of guards[name]) {
        if (!arrived.has(guard.origin)) arrived.set(guard.origin, guard);
      }
    }
    const left = [...arrived.values()]
      .filter((guard) => !suppressed.some((one) => leavesOut(one, name, guard.origin)))
      .sort((a, b) => order.indexOf(a.origin) - order.indexOf(b.origin));
    const mine = own.get(name);
    return mine === undefined ? left : [...left, mine];
  };
  return { depart: runs('depart'), release: runs('release'), accept: runs('accept') };
}

/** Whether a kind's guards include one written by `origin` itself. */
export function writesGuard(guards: Guards, name: GuardName, origin: string): boolean {
  return guards[name].some((guard) => guard.origin === origin);
}

/** Whether a suppression leaves out the guard `name` that `origin` wrote. */
function leavesOut(suppression: Suppression, name: GuardName, origin: string): boolean {
  const { member, source } = suppression;
  return member.kind === 'guard-ref' && member.guard === name && source === origin;
}
