// What absent means (the spec's The compiler › Strict and lenient, What
// absent means).
//
// Saving and publishing are STRICT: any problem is a refusal. Loading is
// LENIENT: a file that is missing, withheld or broken reads as absent,
// what referred to it keeps compiling, and the world runs with a visible
// gap. That is what makes a takedown safe — load the world without the
// file, and nothing goes dark that did not depend on it.
//
// Absence is not silence. Every gap is recorded in the bundle, so a
// moderator reading a world sees what is missing and a host can say so.
// And stored state for absent objects is KEPT, untouched, so that a file
// restored brings its objects back as they were: absence is a world
// running without something, never a world that forgot it.
//
// The table below is the spec's, as data, because nine different parts
// of the language consult it and each should read the same row rather
// than remember its own. One row is this compiler's and not yet the
// spec's: `container`, for an object whose `in` names nothing, which the
// working notes' Holes in the spec record for Eric to decide.

import type { Span } from '../source/source.js';

/** What a reference can point at, for the row that says what its absence does. */
export type ReferenceKind =
  | 'kind-in-composition'
  | 'container'
  | 'kind-in-role'
  | 'verb'
  | 'message'
  | 'passage'
  | 'place-in-exit'
  | 'place-underfoot'
  | 'place-of-arrival'
  | 'world'
  | 'visitor-kind'
  | 'extension';

export interface AbsenceRule {
  readonly reference: ReferenceKind;
  /** What the language does when the target is absent, in the words a moderation view uses. */
  readonly consequence: string;
  /**
   * The world passage somebody is told through, where the spec NAMES
   * one. `null` does not mean nobody is told: where a world admits no
   * one, the host says so outside the world, through no passage of its.
   */
  readonly told: string | null;
}

/** The spec's table, in its order, with `container` after the row it follows from. */
export const ABSENT_TABLE: readonly AbsenceRule[] = [
  {
    reference: 'kind-in-composition',
    consequence:
      'the object is absent: not in range, not listed, not addressable; what it holds is unreachable until the kind returns',
    told: null,
  },
  {
    reference: 'container',
    consequence:
      'the object is absent: not in range, not listed, not addressable; what it holds is unreachable until its container returns',
    told: null,
  },
  {
    reference: 'kind-in-role',
    consequence: 'nothing fills the role; the verb’s phrases do not match',
    told: null,
  },
  {
    reference: 'verb',
    consequence: 'its readings do not parse, and `act` of it does nothing',
    told: null,
  },
  { reference: 'message', consequence: 'sends of it go nowhere', told: null },
  {
    reference: 'passage',
    consequence:
      'the slot or statement renders nothing, and the description is refused at publish if that leaves it empty',
    told: null,
  },
  { reference: 'place-in-exit', consequence: 'the exit does not apply', told: null },
  {
    reference: 'place-underfoot',
    consequence: 'the visitor is moved to the world’s arrival place on their next turn and told so',
    told: 'displaced',
  },
  {
    reference: 'place-of-arrival',
    // Entry fails as a host matter and the host says so outside the
    // world, so no passage of the world's is told.
    consequence:
      'the world does not admit anyone; entry fails as a host matter, the way a crash does, and the host says so outside the world',
    told: null,
  },
  {
    reference: 'world',
    // The spec's row reads "the same" as the one above it: a bundle with
    // no world to admit anyone through fails entry the way a missing
    // arrival place does, and is reported the same way.
    consequence: 'the world does not admit anyone, and the host says so outside it',
    told: null,
  },
  {
    reference: 'visitor-kind',
    // The spec's row reads "the same" again: with nothing for a visitor
    // to be made of, the world admits no one.
    consequence: 'the world does not admit anyone, and the host says so outside it',
    told: null,
  },
  {
    reference: 'extension',
    consequence: 'its statements record nothing and its types hold their defaults',
    told: 'missing',
  },
];

/** The row for a kind of reference. Every kind has one; the table is the spec's and is complete. */
export function absenceRule(reference: ReferenceKind): AbsenceRule {
  const rule = ABSENT_TABLE.find((row) => row.reference === reference);
  if (rule === undefined) throw new Error(`No absence rule for ${reference}.`);
  return rule;
}

/** Why something is absent. */
export type AbsenceReason =
  /** It did not travel with the world. */
  | 'missing'
  /** The host is withholding it — a moderator's act, and reversible. */
  | 'withheld'
  /** It travelled, and it is not the source the manifest recorded. */
  | 'mismatched'
  /** It travelled and does not compile. */
  | 'broken';

/**
 * One gap in a loaded world, recorded so that it is visible rather than
 * fatal: the spec's "the world runs with a visible gap".
 */
export interface Absent {
  /** What is missing: a file's name, a library's name, a kind's name. */
  readonly what: string;
  /** What sort of thing it is. A file stands outside the reference table: it holds the rest. */
  readonly kind: 'file' | 'library' | ReferenceKind;
  readonly reason: AbsenceReason;
  /** Where the gap is, where there is anything to point at. */
  readonly at: Span | null;
  /** What the world does without it — the table's row, or the plain fact for a file. */
  readonly consequence: string;
}

/** How a compile treats a problem. */
export type CompileMode =
  /** Saving and publishing: any problem is a refusal. */
  | 'publish'
  /** Loading: what is missing, withheld or broken reads as absent, and the rest runs. */
  | 'load';
