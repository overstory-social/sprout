// Time as a world reads it (the spec's Time; The host contract › Time).
// The host keeps time in whole host seconds, and a world reads it only as
// the `elapsed` a tick or a wake is handed: an integer of the language's
// own range, the seconds between two instants the host supplied. Nothing
// here reads a clock; every instant is one the host passed in.
//
// A tick is delivered as an engine message to its place, and a wake as
// one to the object that asked, each queued at the head of its turn's
// drain, so the queue stays the one place that delivers.

import { INTEGER_MAX } from '../declare/types.js';
import type { InstanceId } from './ids.js';

/** An instant, in whole host seconds: what the host says the time is, and what state stores. */
export type HostSeconds = number;

/** The engine's time messages: `:tick (elapsed)` to a place, `:woke (elapsed)` to what asked. */
export interface TimeSend {
  readonly message: 'tick' | 'woke';
  readonly recipient: InstanceId;
  /** The seconds the handler's `elapsed` binds. */
  readonly elapsed: number;
}

/** `instant`, checked as the host must give one: a whole number of seconds, not before 0. */
export function hostSeconds(instant: number, what: string): HostSeconds {
  if (!Number.isSafeInteger(instant) || instant < 0) {
    throw new Error(`${what} is \`${instant}\`, and the host gives time in whole seconds from 0.`);
  }
  return instant;
}

/**
 * The seconds from `since` to `now`, as `elapsed` carries them. Time the
 * host says ran backwards, or an interval past the integer range, is the
 * host's defect: `elapsed` is supplied truthfully or not at all.
 */
export function elapsedSince(since: HostSeconds, now: HostSeconds): number {
  const elapsed = hostSeconds(now, 'now') - hostSeconds(since, 'the instant it is measured from');
  if (elapsed < 0) {
    throw new Error(`now (\`${now}\`) is before \`${since}\`, and time does not run backwards.`);
  }
  if (elapsed > INTEGER_MAX) {
    throw new Error(
      `${elapsed} seconds have passed since \`${since}\`, more than \`elapsed\` can carry.`,
    );
  }
  return elapsed;
}
