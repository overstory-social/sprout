// Choosing a reading (the spec's Parsing › Choosing a reading). Every
// reading a line makes, a verb's or an intent's, is ranked whole, so a hint in one role can decide
// another: one whose consent pass allows before one it refuses, then the
// one that matched more of the line's words literally, then the one whose
// things are nearer, role by role in the order the verb declares them.
// Readings still tied are drawn from the turn's stream, which is a step,
// and the host logs the draw as a warning. Where the drawn reading names
// a thing a rival did not and words could tell the two apart, `meant`
// tells the visitor which; things written alike are drawn without it.

import type { Budget } from '../budget.js';
import type { Following } from '../command.js';
import type { Draw } from '../draws.js';
import type { InstanceId } from '../ids.js';
import type { IntentReading } from '../intents.js';
import type { Reading } from '../reading.js';
import type { PronounNamed } from './nouns.js';

/** What a line may be understood as: a verb's reading, or an intent's. */
export type Understood = Reading | IntentReading;

/** The names of what `understood` fills, in the order its verb declares its roles or its intent names its slots. */
export function slotNamesOf(understood: Understood): readonly string[] {
  return 'verb' in understood
    ? understood.verb.roles.map((role) => role.name)
    : understood.intent.slots;
}

/** A reading, and what it is ranked by. */
export interface Ranked {
  readonly reading: Understood;
  /** Whether its consent pass allows it. */
  readonly allowed: boolean;
  /** How many of the line's words it matched literally: phrase words, nouns, values and exits. */
  readonly literal: number;
  /** The nearness of what fills each role or slot, in `slotNamesOf`'s order; 0 for none. */
  readonly near: readonly number[];
  /** What it binds that a pronoun named, and the pronoun. */
  readonly pronounNamed: readonly PronounNamed[];
  /**
   * Whether it reads every word it was given: each item of a run names
   * something, and every value typed is one a participant hears. A line
   * `and` may split is read whole only by such a reading.
   */
  readonly whole: boolean;
  /** The turns the line runs after it, `all`'s or a run's, each a turn of its own; asked only of the reading chosen. */
  readonly rest: () => readonly Following[];
}

/** A reading drawn from a tie: among how many, and the thing `meant` names, if any. */
export interface Drawn {
  readonly among: number;
  readonly meant: InstanceId | null;
}

/** The reading chosen, and the draw it was, where it was drawn. */
export interface Chosen {
  readonly reading: Understood;
  readonly rest: () => readonly Following[];
  readonly pronounNamed: readonly PronounNamed[];
  readonly drawn: Drawn | null;
}

/** Negative where `a` ranks before `b`, positive where after, 0 where they tie. */
export function compareRanked(a: Ranked, b: Ranked): number {
  if (a.allowed !== b.allowed) return a.allowed ? -1 : 1;
  if (a.literal !== b.literal) return b.literal - a.literal;
  for (let at = 0; at < Math.max(a.near.length, b.near.length); at++) {
    const difference = (a.near[at] ?? 0) - (b.near[at] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The best of `readings`, drawn from `draws` where several tie, a step
 * on `budget`; `written` is how the engine writes a thing, which is all
 * a visitor could tell two apart by. `readings` is never empty.
 */
export function chooseReading(
  readings: readonly Ranked[],
  written: (id: InstanceId) => string,
  draws: Draw,
  budget: Budget,
): Chosen {
  const ordered = [...readings].sort(compareRanked);
  const tied = ordered.filter((one) => compareRanked(one, ordered[0]!) === 0);
  if (tied.length === 1) {
    const [only] = tied as [Ranked];
    return { reading: only.reading, rest: only.rest, pronounNamed: only.pronounNamed, drawn: null };
  }
  budget.spend();
  const chosen = tied[draws.below(tied.length)]!;
  const drawn = chosen.reading;
  const rivals = tied.map((one) => one.reading).filter((one) => one !== drawn);
  return {
    reading: drawn,
    rest: chosen.rest,
    pronounNamed: chosen.pronounNamed,
    drawn: { among: tied.length, meant: meantIn(drawn, rivals, written) },
  };
}

/**
 * The first thing `drawn` binds, in `slotNamesOf`'s order, that some
 * rival binds another thing in place of and that is written otherwise;
 * null where there is none.
 */
function meantIn(
  drawn: Understood,
  rivals: readonly Understood[],
  written: (id: InstanceId) => string,
): InstanceId | null {
  for (const role of slotNamesOf(drawn)) {
    const mine = objectOf(drawn, role);
    if (mine === null) continue;
    for (const rival of rivals) {
      const theirs = objectOf(rival, role);
      if (theirs !== null && theirs !== mine && written(theirs) !== written(mine)) return mine;
    }
  }
  return null;
}

/** The one object `reading` binds `role` to; null where it binds none, or a set, an exit or a value. */
function objectOf(reading: Understood, role: string): InstanceId | null {
  const bound = reading.bindings.get(role);
  return bound !== undefined && 'object' in bound ? bound.object : null;
}
