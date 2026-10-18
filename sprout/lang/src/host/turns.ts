// What a host hands an engine's write turns, and records beside each in
// the log (the spec's The runtime › Turns, The log; The host contract ›
// Time, Admission and identity): every turn's seed, bound and instant,
// and what is particular to its kind. A typed command may carry a step an
// earlier turn of its line planned, as a reading; a replay hands one back
// from the log. A world whose bundle admits no one is closed before any
// turn opens.

import type { ResolvedVerb } from '../declare/verbs.js';
import type { Catalogue } from './catalogue.js';
import type { InstanceId, VisitKey } from './ids.js';
import type { HostSeconds } from './time.js';
import type { CommandExit } from './view.js';

/** What the host gives one write turn, and records beside it (the spec's The log). */
export interface WriteInputs {
  /** The seed the host drew for this turn, a whole number from 0 to `SEED_MAX`, which every draw it makes comes from. */
  readonly seed: number;
  /** The most instances the host will store for this world this turn; null where it sets no bound. */
  readonly mayHold: number | null;
  /** When the turn runs, in whole host seconds. */
  readonly now: HostSeconds;
}

/**
 * What fills one role of a reading: a thing, the things a set role names
 * in typed order, a value the visitor named (an option of a symbol role,
 * or an integer), or the exit a visitor named for the engine's `go`.
 */
export type Bound =
  | { readonly object: InstanceId }
  | { readonly set: readonly InstanceId[] }
  | { readonly value: string | number }
  | { readonly exit: CommandExit };

/** One understood command: a verb, who performs it, and what fills its roles. */
export interface Reading {
  readonly verb: ResolvedVerb;
  readonly actor: InstanceId;
  /**
   * What fills each role, by the role's name. A tool left out has no
   * entry, and neither need a set role, which is then the empty set.
   */
  readonly bindings: ReadonlyMap<string, Bound>;
}

/**
 * An item of a run that is read on its own turn (the spec's Parsing ›
 * Sequences, again and all): the role it fills and its words. The
 * reading it is planned with holds every other thing the line bound, so
 * only these words are read afresh, as the line was: with the words of
 * each value role, which bind against the thing this item names, and
 * what the actor's pronouns named when the line began.
 */
export interface Reread {
  readonly role: string;
  readonly words: string;
  /** Each value role's words, as the line typed them. */
  readonly values: readonly { readonly role: string; readonly words: string }[];
  /** What the actor's pronouns named when the line began. */
  readonly referents: readonly InstanceId[];
}

/** One typed command, as the host hands it over and the log records it. */
export interface Command extends WriteInputs {
  /** Who typed it. */
  readonly visit: VisitKey;
  readonly text: string;
  /**
   * A step an earlier turn of the same line planned, run in place of
   * reading `text` again (the spec's Parsing › Intents): its `when` was
   * read before the line ran, against the world the visitor typed into.
   */
  readonly planned?: Reading;
  /** The item of a run whose words this turn reads afresh, `planned` holding the other roles. */
  readonly reread?: Reread;
}

/** One tick, as the host hands it over and the log records it, at the instant it runs. */
export interface Tick extends WriteInputs {
  /** The place ticked. */
  readonly place: InstanceId;
}

/** One wake, as the host hands it over and the log records it. */
export interface Wake extends WriteInputs {
  /** The object woken. */
  readonly object: InstanceId;
  /** The serial the wake was asked under. */
  readonly serial: number;
}

/** One visitor arriving, as the host hands it over and the log records it. */
export interface Arrival extends WriteInputs {
  readonly visit: VisitKey;
  /** The nickname the host admitted for this visit (the engine's `nicknameRefusal`), kept as its words single-spaced. */
  readonly nickname: string;
}

/** Why a world admits no one, each a row of the spec's What absent means. */
export type ClosedReason =
  /** The bundle has no world declaration to admit anyone through. */
  | 'no-world'
  /** Nothing for a visitor to be made of. */
  | 'no-visitor-kind'
  /** The place visitors arrive at is absent from source. */
  | 'no-arrival-place'
  /** It is declared, and destroyed, of an absent kind, inside something absent, or no longer a place. */
  | 'arrival-place-gone';

/** Entry refused as a host matter: the host says so outside the world, in these words or its own. */
export interface Closed {
  readonly reason: ClosedReason;
  readonly words: string;
}

/** What a host tells a person a world admits no one, outside the world. */
export const NOT_ADMITTING = 'This world is not letting anyone in just now.';

/**
 * Why `catalogue`'s world admits no one whatever its state, or null: no
 * world, no visitor kind, or no arrival place in source. A host may ask
 * this before running catch-up for someone who cannot come in.
 */
export function closedByBundle(catalogue: Catalogue): ClosedReason | null {
  if (catalogue.worldKind === null) return 'no-world';
  if (catalogue.visitorKind === null) return 'no-visitor-kind';
  if (catalogue.arrival === null) return 'no-arrival-place';
  return null;
}

/** One visitor going away, as the host hands it over and the log records it. */
export interface Departure extends WriteInputs {
  readonly visit: VisitKey;
}

/**
 * A handler or hook that ran: the kind that wrote it, what it answers
 * (a message as `messageKey` names it, `changed :p` for a hook, or
 * `after command`), and where it was written, `kiln.sprout:23:9`, which
 * tells two apart.
 */
export interface Ran {
  readonly origin: string;
  readonly on: string;
  readonly at: string;
}

/** One pending wake: the serial it was asked under, and when it was asked and is due, in host seconds. */
export interface PendingWake {
  readonly serial: number;
  readonly askedAt: number;
  readonly dueAt: number;
}

/** One pending wake and the object that asked for it. */
export interface DueWake extends PendingWake {
  readonly object: InstanceId;
}

/** Whether `a` is delivered before `b`: the one due first, then the one asked first. */
export function oldestFirst(a: PendingWake, b: PendingWake): number {
  return a.dueAt - b.dueAt || a.serial - b.serial;
}
