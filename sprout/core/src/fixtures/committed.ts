import {
  pollTurn,
  type Polled,
  type PollTurn,
  type TurnHost,
  type WorldState,
} from '@overstory/sprout/lang';

import { loaded } from '../steps.js';
import type { SproutStore } from '../store.js';

// The last committed state of a world as the TypeScript runtime reads it, for the specs that check
// what a turn left behind through that runtime's own state. A host asks its engine instead
// (`engine.ts`). Spec support: the package build leaves it out.

/** The last committed state of `microworldId`, read against the bundle the host runs, with no lock. */
export function committedState(
  store: SproutStore,
  microworldId: string,
  host: TurnHost,
): Promise<WorldState> {
  return store.read(microworldId, async (tx) => loaded(await tx.state(), host));
}

/** Run `look` as a poll of `microworldId`, on the last committed state, with no lock. */
export function runPoll<T>(
  store: SproutStore,
  microworldId: string,
  host: TurnHost,
  look: (turn: PollTurn) => T,
): Promise<Polled<T>> {
  return store.read(microworldId, async (tx) =>
    pollTurn(loaded(await tx.state(), host), host, look),
  );
}

/**
 * `given` as the TypeScript runtime gave it, for a spec whose host names no
 * engine and which reads what only that runtime's turns hold; thrown where
 * a committed turn holds no state, being another engine's.
 */
export function tsTurn<T extends object>(given: object): T {
  if ('committed' in given && given.committed === true && !('state' in given)) {
    throw new Error('This turn is not the TypeScript runtime’s, so holds none of its state.');
  }
  return given as T;
}
