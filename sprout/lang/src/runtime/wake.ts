// A wake turn (the spec's Time › Wakes; The runtime › Turns, Faults; The
// host contract › Time). One due wake is delivered as a turn of its own:
// it comes off its object's list, the object is sent `:woke (elapsed)`,
// and the queue drains from there. `elapsed` is the seconds since the
// wake was asked for, which may be more than was asked.
//
// A wake that faults is consumed and logged, not retried: the turn is
// abandoned like every write turn, and then the wake alone is taken off
// its object's list, so the object is not woken again unless it asks.
// Which wake to deliver, and when, is the host's; an instant before the
// wake is due is the host's defect, thrown before the turn opens.

import { drain, type Drained } from './bus.js';
import type { InstanceId } from './ids.js';
import { isLive } from './live.js';
import { readerOf, type WorldState } from './state.js';
import { elapsedSince, hostSeconds, type TimeSend } from './time.js';
import {
  writeTurn,
  type Committed,
  type Faulted,
  type TurnHost,
  type WriteInputs,
  type WriteTurn,
  type WriteTurnKind,
} from './turn.js';
import { withoutWake, type DueWake } from './wakes.js';

/** One wake, as the host hands it over and the log records it. */
export interface Wake extends WriteInputs {
  /** The object woken. */
  readonly object: InstanceId;
  /** The serial the wake was asked under. */
  readonly serial: number;
}

/** What a committed wake did. */
export interface Woke {
  /** The seconds the object was handed as `elapsed`. */
  readonly elapsed: number;
  /** What the queue did from the wake on. */
  readonly drained: Drained;
}

/** A wake that faulted: its turn abandoned, and the wake consumed in a turn of its own. */
export interface FaultedWake extends Faulted {
  /** The wake taken off its object's list, which the store writes. */
  readonly consumed: Committed<null>;
}

/**
 * A wake not run, because by the time its turn opens it is no longer
 * pending or its object is not in the tree: another turn destroyed it,
 * consumed it, or carried it away.
 */
export interface Unwoken {
  readonly committed: false;
  readonly unwoken: true;
}

/** A wake turn: committed; faulted, and so consumed; or not run. */
export type WakeTurn = Committed<Woke> | FaultedWake | Unwoken;

/** Run `wake` as one wake turn over the committed `state`. */
export function wakeTurn(state: WorldState, host: TurnHost, wake: Wake): WakeTurn {
  const now = hostSeconds(wake.now, 'a wake’s time');
  const pending = pendingWake(state, wake.object, wake.serial);
  if (pending === null) return { committed: false, unwoken: true };
  if (pending.dueAt > now) {
    throw new Error(`\`${wake.object}\`'s wake is due at ${pending.dueAt}, and it is only ${now}.`);
  }
  const elapsed = elapsedSince(pending.askedAt, now);
  const woken = writeTurn<Woke>(state, 'wake', host, wake, (turn) => ({
    elapsed,
    drained: deliverWake(turn, pending, elapsed),
  }));
  if (woken.committed) return woken;
  return { ...woken, consumed: consumeWake(state, 'wake', host, wake, pending) };
}

/** The wake `object` holds under `serial`, where it is pending on something in the tree; null otherwise. */
export function pendingWake(state: WorldState, object: InstanceId, serial: number): DueWake | null {
  const wake = state.instances.get(object)?.wakes.find((one) => one.serial === serial);
  if (wake === undefined || !isLive(readerOf(state), object)) return null;
  return { object, ...wake };
}

/** Take `wake` off its object's list and send it `:woke (elapsed)`, then drain the queue. */
export function deliverWake(turn: WriteTurn, wake: DueWake, elapsed: number): Drained {
  turn.draft.write(withoutWake(turn.draft.instance(wake.object)!, wake.serial));
  const sent: TimeSend = { message: 'woke', recipient: wake.object, elapsed };
  return drain({ sends: [sent], destroyed: [], marked: [] }, turn);
}

/**
 * `wake` taken off its object's list over `state`, and nothing else: what
 * a faulted wake leaves. Nothing a world does runs, so this cannot fault
 * but by the engine's own defect.
 */
export function consumeWake(
  state: WorldState,
  kind: WriteTurnKind,
  host: TurnHost,
  inputs: WriteInputs,
  wake: DueWake,
): Committed<null> {
  const consumed = writeTurn<null>(state, kind, host, inputs, (turn) => {
    turn.draft.write(withoutWake(turn.draft.instance(wake.object)!, wake.serial));
    return null;
  });
  if (!consumed.committed) {
    throw new Error(`\`${wake.object}\`'s wake could not be consumed: ${consumed.fault.detail}`);
  }
  return consumed;
}
