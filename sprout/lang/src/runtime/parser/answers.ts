// What the engine says to a line it could not run as a reading (the
// spec's Parsing › When nothing matches; Prose › Engine lines): the
// engine's `unknown` or `not_here`, found as every engine line is
// (`engine-lines.ts`), with `actor` and `here` bound as every passage the
// engine speaks to an actor has them. No answer binds a thing a noun
// names, so none names what is out of range. Nothing is rendered here:
// `prose/` renders.

import type { Speech } from '../body.js';
import { engineSaid } from '../engine-lines.js';
import { boundObject, type Evaluated } from '../evaluate.js';
import type { InstanceId } from '../ids.js';
import type { StateReader } from '../state.js';

/** The two answers, each named for the engine line that says it. */
export type AnswerName = 'unknown' | 'not_here';

/** A line answered rather than understood: what the actor reads, unrendered. */
export interface Answer {
  readonly answer: AnswerName;
  /** The line of that name, and who says it. */
  readonly by: InstanceId;
  readonly said: Speech;
  /** `actor` and `here`. */
  readonly bindings: ReadonlyMap<string, Evaluated>;
}

/** The answer `answer`, said to `actor` standing in `here`. */
export function answer(
  state: StateReader,
  answer: AnswerName,
  actor: InstanceId,
  here: InstanceId,
): Answer {
  const bindings = new Map<string, Evaluated>([
    ['actor', boundObject(actor)],
    ['here', boundObject(here)],
  ]);
  return { answer, ...engineSaid(state, answer, actor, here), bindings };
}
