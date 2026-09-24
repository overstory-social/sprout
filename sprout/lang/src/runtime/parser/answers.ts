// What the engine says to a line it could not run as a reading (the
// spec's A worked microworld › The standard library it needs; Properties
// › Where types come from): the world's `unknown`, `unreachable` and
// `which` passages, with `thing` or `candidates` bound as the bindings
// table types them, and `actor` and `here` as every passage the engine
// speaks to an actor has them. Nothing is rendered here: B29 renders.
// A `which` also carries, for each candidate, the line to type again to
// mean it, so the question is answered with a command and the parser
// keeps nothing between turns.

import type { ResolvedPassage } from '../../declare/passages.js';
import type { Speech } from '../body.js';
import { boundObject, type Evaluated } from '../evaluate.js';
import type { InstanceId } from '../ids.js';
import type { StateReader } from '../state.js';

/** The three answers, each named for the world's passage that says it. */
export type AnswerName = 'unknown' | 'unreachable' | 'which';

/** One candidate a `which` offers: the thing, and the line that means it. */
export interface Choice {
  readonly id: InstanceId;
  readonly line: string;
}

/** A line answered rather than understood: what the actor reads, unrendered. */
export interface Answer {
  readonly answer: AnswerName;
  /** The world's passage of that name. */
  readonly said: Speech;
  /** `actor` and `here`, and `thing` for `unreachable` or `candidates` for `which`. */
  readonly bindings: ReadonlyMap<string, Evaluated>;
  /** For `which`, each candidate in the order asked, nearest first; empty otherwise. */
  readonly choices: readonly Choice[];
}

/** The answer `answer`, said to `actor` standing in `here`, with what it names. */
export function answer(
  state: StateReader,
  answer: AnswerName,
  actor: InstanceId,
  here: InstanceId,
  names: { readonly thing?: InstanceId; readonly choices?: readonly Choice[] } = {},
): Answer {
  const bindings = new Map<string, Evaluated>([
    ['actor', boundObject(actor)],
    ['here', boundObject(here)],
  ]);
  if (names.thing !== undefined) bindings.set('thing', boundObject(names.thing));
  const choices = names.choices ?? [];
  if (answer === 'which') {
    bindings.set('candidates', { binds: 'set', ids: choices.map((choice) => choice.id) });
  }
  return { answer, said: { passage: worldPassage(state, answer) }, bindings, choices };
}

/** A passage the world composes, which `sprout.World` writes for every answer. */
function worldPassage(state: StateReader, name: AnswerName): ResolvedPassage {
  const world = state.instance(state.world);
  const passage = world?.kind.passages.get(name);
  if (passage === undefined) {
    throw new Error(`the world composes no \`${name}\` passage, which \`sprout.World\` writes.`);
  }
  return passage;
}
