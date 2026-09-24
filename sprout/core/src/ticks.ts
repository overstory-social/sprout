import {
  occupiedPlaces,
  type HostSeconds,
  type InstanceId,
  type TickTurn,
  type TurnHost,
  type WriteInputs,
} from '@overstory/sprout/lang';

import type { SproutStore } from './store.js';
import { committedState, runTick } from './turns.js';

// Ticking a world's occupied places (the spec's Time › Ticks; The host
// contract › Time). A round reads which places hold a visitor from the
// last committed state and runs one tick turn for each, under the world's
// lock like any write turn. A place whose last tick has not yet run is
// skipped rather than queued, so a slow world never builds a backlog; the
// interval it missed is folded into the next tick's `elapsed`. How often
// to run a round, and when a round's instant is, are the host's.

/** One place's part in a round: the tick turn it ran, or skipped because its last had not run. */
export type Ticking =
  | { readonly place: InstanceId; readonly turn: TickTurn }
  | { readonly place: InstanceId; readonly skipped: true };

/** Ticks worlds' occupied places, one turn per place, never two waiting for one place. */
export class Ticker {
  /** Each world's places whose tick has been asked for and has not yet run, by world then place. */
  private readonly waiting = new Map<string, Set<InstanceId>>();

  /**
   * Tick every place of `microworldId` a visitor stands in, as at `now`,
   * each turn with the inputs `inputs` gives its place. Resolves once every
   * tick this round asked for has run.
   */
  async round(
    store: SproutStore,
    microworldId: string,
    host: TurnHost,
    now: HostSeconds,
    inputs: (place: InstanceId) => WriteInputs,
  ): Promise<Ticking[]> {
    const places = occupiedPlaces(await committedState(store, microworldId, host));
    const waiting = this.waitingIn(microworldId);
    return Promise.all(
      places.map(async (place): Promise<Ticking> => {
        if (waiting.has(place)) return { place, skipped: true };
        waiting.add(place);
        try {
          return {
            place,
            turn: await runTick(store, microworldId, host, { ...inputs(place), place, now }),
          };
        } finally {
          waiting.delete(place);
          if (waiting.size === 0) this.waiting.delete(microworldId);
        }
      }),
    );
  }

  private waitingIn(microworldId: string): Set<InstanceId> {
    const found = this.waiting.get(microworldId);
    if (found !== undefined) return found;
    const made = new Set<InstanceId>();
    this.waiting.set(microworldId, made);
    return made;
  }
}
