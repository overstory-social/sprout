// A run of things in a role that takes one thing (the spec's Parsing ›
// Sequences, again and all): `take sack and bottle`, `take sack, bottle
// and lamp`, a comma before `and` or not. The words split at `and` and
// commas, and each noun is one item, which the reading runs once for, in
// the order written. A name that holds a connector is still read whole:
// a stretch of the run is one item where it names something by a noun or
// its whole name, the longest such stretch first, so `the salt and pepper
// shaker and the lamp` is two items where the shaker is in reach. As
// `all` does, a run takes at most as many items as a set role may bind,
// the host's figure, and the items past it are not read. Every stretch
// tried is a noun tried, and each is charged as one.

import type { ResolvedRole } from '../../declare/verbs.js';
import { nounsOfRun, thingsIn, type Candidate, type NounContext } from './nouns.js';

/** Where one item of a run stands among the slot's words. */
export interface RunItem {
  readonly start: number;
  readonly end: number;
}

/**
 * The items `words` hold as a run in `role`, in the order written; null
 * where they are no run: a single noun, a name read whole, or a run with
 * an empty noun, which is no run of things.
 */
export function itemsOfRun(
  words: readonly string[],
  role: ResolvedRole,
  candidates: readonly Candidate[],
  context: NounContext,
): RunItem[] | null {
  if (role.many) return null;
  const fills = role.filler?.fills;
  if (fills !== 'open' && fills !== 'kind') return null;
  const nouns = nounsOfRun(words);
  if (nouns.length < 2 || nouns.some(({ start, end }) => start === end)) return null;
  const items: RunItem[] = [];
  for (let at = 0; at < nouns.length;) {
    let to = at;
    for (let last = nouns.length - 1; last > at; last--) {
      if (namesOutright(words.slice(nouns[at]!.start, nouns[last]!.end), candidates, context)) {
        to = last;
        break;
      }
    }
    items.push({ start: nouns[at]!.start, end: nouns[to]!.end });
    at = to + 1;
  }
  // As `all`, a run takes no more than a set role may bind.
  return items.length < 2 ? null : items.slice(0, context.budget.limits.setRoleObjects);
}

/** Whether `words` name something in reach by a noun or its whole name, not adjectives alone. */
function namesOutright(
  words: readonly string[],
  candidates: readonly Candidate[],
  context: NounContext,
): boolean {
  const found = thingsIn(words, () => true, candidates, context);
  return found.found !== 'nothing' && found.things.some((one) => one.literal > 0);
}
