// What the engine says to a line it could not run as a reading (the
// spec's Parsing › When nothing matches; Verbs › Carried roles; Prose ›
// Engine lines): the engine's `cannot`, `not_carrying`, `not_here` or
// `unknown`, found as every engine line is (`engine-lines.ts`), with
// `actor` and `here` bound as every passage the engine speaks to an actor
// has them, `cannot` the reading as far as it was understood, as words,
// and `not_carrying` the thing in range the actor does not carry. No
// answer names what is out of range. Nothing is rendered here: `prose/`
// renders.

import type { Speech } from '../body.js';
import { engineSaid } from '../engine-lines.js';
import { boundObject, boundValue, type Evaluated } from '../evaluate.js';
import type { InstanceId } from '../ids.js';
import type { StateReader } from '../state.js';

/** The answers, each named for the engine line that says it. */
export type AnswerName = 'cannot' | 'not_carrying' | 'not_here' | 'unknown';

/** What an answer is given besides `actor` and `here`: `cannot`'s reading, as words, or the thing `not_carrying` names. */
export type Given = { readonly reading: string } | { readonly thing: InstanceId };

/** A line answered rather than understood: what the actor reads, unrendered. */
export interface Answer {
  readonly answer: AnswerName;
  /** The line of that name, and who says it. */
  readonly by: InstanceId;
  readonly said: Speech;
  /** `actor` and `here`, `cannot`'s `reading` and `not_carrying`'s `thing`. */
  readonly bindings: ReadonlyMap<string, Evaluated>;
}

/** The answer `answer`, said to `actor` standing in `here`; `given` is `cannot`'s or `not_carrying`'s, and only theirs. */
export function answer(
  state: StateReader,
  answer: AnswerName,
  actor: InstanceId,
  here: InstanceId,
  given?: Given,
): Answer {
  const bindings = new Map<string, Evaluated>([
    ['actor', boundObject(actor)],
    ['here', boundObject(here)],
  ]);
  if (given !== undefined && 'reading' in given) bindings.set('reading', boundValue(given.reading));
  if (given !== undefined && 'thing' in given) bindings.set('thing', boundObject(given.thing));
  return { answer, ...engineSaid(state, answer, actor, here), bindings };
}
