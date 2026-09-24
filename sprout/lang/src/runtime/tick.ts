// A tick turn (the spec's Time › Ticks; The runtime › Turns, Faults; The
// host contract › Time). Each place holding a visitor is ticked as a turn
// of its own: the place is sent `:tick (elapsed)`, and the queue drains
// from there, so the tick reaches the place and no further unless the
// place sends onward. `elapsed` is the seconds since the last tick the
// place received, and the turn records the instant it ran as that place's
// last tick; a place that was skipped folds the missed interval in.
//
// A tick that faults is dropped: abandoned like every write turn, so its
// place's last tick stays where it was and the next tick's `elapsed`
// covers it, and nobody in the world is told, since nobody acted. How
// often a place is ticked, and not ticking one whose last tick has not
// run, is the host's.

import { drain, type Drained } from './bus.js';
import type { InstanceId } from './ids.js';
import { standsInPlace } from './live.js';
import { codeUnitOrder, readerOf, type StateReader, type WorldState } from './state.js';
import { elapsedSince, hostSeconds, type HostSeconds, type TimeSend } from './time.js';
import {
  writeTurn,
  type Committed,
  type Faulted,
  type TurnHost,
  type WriteInputs,
} from './turn.js';

/** One tick, as the host hands it over and the log records it, at the instant it runs. */
export interface Tick extends WriteInputs {
  /** The place ticked. */
  readonly place: InstanceId;
}

/** What a committed tick did. */
export interface Ticked {
  /** The seconds the place was handed as `elapsed`. */
  readonly elapsed: number;
  /** What the queue did from the tick on. */
  readonly drained: Drained;
}

/** A tick not run, because the place holds no visitor by the time its turn opens. */
export interface Unoccupied {
  readonly committed: false;
  readonly unoccupied: true;
}

/** A tick turn: committed; faulted, and so dropped; or not run, for want of anyone there. */
export type TickTurn = Committed<Ticked> | Faulted | Unoccupied;

/**
 * Every place a visitor stands in, once each, in code-unit order: the
 * places the host ticks. An NPC keeps no place ticking, and nor does a
 * visitor whose place is gone, until their next turn displaces them.
 */
export function occupiedPlaces(state: WorldState): InstanceId[] {
  const places = new Set<InstanceId>();
  const reader = readerOf(state);
  for (const visitor of state.visitors.values()) {
    if (!standsInPlace(reader, visitor.instance)) continue;
    places.add(state.instances.get(visitor.instance)!.container!);
  }
  return [...places].sort(codeUnitOrder);
}

/**
 * Run `tick` as one tick turn over the committed `state`. The place must
 * be one, and the tick not before its last; either otherwise is the
 * host's defect, thrown before the turn opens.
 */
export function tickTurn(state: WorldState, host: TurnHost, tick: Tick): TickTurn {
  const committed = readerOf(state);
  const since = lastTickOf(committed, tick.place);
  const now = hostSeconds(tick.now, 'a tick’s time');
  const elapsed = since === null ? 0 : elapsedSince(since, now);
  if (!occupiedPlaces(state).includes(tick.place)) return { committed: false, unoccupied: true };
  return writeTurn<Ticked>(state, 'tick', host, tick, (turn) => {
    const place = turn.draft.instance(tick.place)!;
    turn.draft.write({ ...place, lastTick: now });
    const sent: TimeSend = { message: 'tick', recipient: tick.place, elapsed };
    return { elapsed, drained: drain({ sends: [sent], destroyed: [], marked: [] }, turn) };
  });
}

/** When `place` last ticked, or null if it never has; what is not a place is not ticked. */
function lastTickOf(state: StateReader, place: InstanceId): HostSeconds | null {
  const instance = state.instance(place);
  if (instance === undefined) throw new Error(`\`${place}\` is not in this world to be ticked.`);
  if (!instance.kind.containsActors) {
    throw new Error(`\`${place}\` holds no actors, so it is not a place and is not ticked.`);
  }
  return instance.lastTick;
}
