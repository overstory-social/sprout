// How the contributions of a composable member combine (the spec's Kinds,
// composition and libraries › How members combine, rules 2 and 3;
// Suppressing a contribution). Every origin's contribution runs, once
// however many paths reach it, in the order its source appears in the
// closure, the composer's own last. A `without` leaves one origin's out of
// the kind that wrote it and so out of every kind that reaches that origin
// through it; the same contribution reaching a composer by another path
// still runs. Guards and plays each compose through this, one written
// member at a time.

import type { Suppression } from './kinds.js';

/** Anything a composed kind runs every source's copy of. */
export interface Contribution {
  /** The kind that wrote it, by qualified name. */
  readonly origin: string;
}

/**
 * What a composer runs of one written member: what each of its composed
 * kinds runs (each already less what that kind left out), each origin
 * once and in closure order (`order`, the composer not in it), less what
 * the composer's own `suppressed` leaves out as `leavesOut` reads it,
 * then its own.
 */
export function composeContributions<C extends Contribution>(
  composed: readonly (readonly C[])[],
  order: readonly string[],
  suppressed: readonly Suppression[],
  own: C | undefined,
  leavesOut: (suppression: Suppression, contribution: C) => boolean,
): C[] {
  const arrived = new Map<string, C>();
  for (const contributions of composed) {
    for (const one of contributions) {
      if (!arrived.has(one.origin)) arrived.set(one.origin, one);
    }
  }
  const left = [...arrived.values()]
    .filter((one) => !suppressed.some((suppression) => leavesOut(suppression, one)))
    .sort((a, b) => order.indexOf(a.origin) - order.indexOf(b.origin));
  return own === undefined ? left : [...left, own];
}
