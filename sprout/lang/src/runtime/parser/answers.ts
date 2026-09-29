// What the engine says to a line it could not run as a reading (the
// spec's Parsing › When nothing matches; Prose › Engine lines): the
// engine's `cannot`, `not_here` or `unknown`, found as every engine line
// is (`engine-lines.ts`), with `actor` and `here` bound as every passage
// the engine speaks to an actor has them, and `cannot` the reading as far
// as it was understood, as words. No answer binds a thing a noun names,
// so none names what is out of range. Nothing is rendered here: `prose/`
// renders.

import type { Speech } from '../body.js';
import { engineSaid } from '../engine-lines.js';
import { boundObject, boundValue, type Evaluated } from '../evaluate.js';
import type { InstanceId } from '../ids.js';
import type { StateReader } from '../state.js';

/** The answers, each named for the engine line that says it. */
export type AnswerName = 'cannot' | 'not_here' | 'unknown';

/** A line answered rather than understood: what the actor reads, unrendered. */
export interface Answer {
  readonly answer: AnswerName;
  /** The line of that name, and who says it. */
  readonly by: InstanceId;
  readonly said: Speech;
  /** `actor` and `here`, and `cannot`'s `reading`. */
  readonly bindings: ReadonlyMap<string, Evaluated>;
}

/** The answer `answer`, said to `actor` standing in `here`; `reading` is `cannot`'s, and only its. */
export function answer(
  state: StateReader,
  answer: AnswerName,
  actor: InstanceId,
  here: InstanceId,
  reading?: string,
): Answer {
  const bindings = new Map<string, Evaluated>([
    ['actor', boundObject(actor)],
    ['here', boundObject(here)],
  ]);
  if (reading !== undefined) bindings.set('reading', boundValue(reading));
  return { answer, ...engineSaid(state, answer, actor, here), bindings };
}
