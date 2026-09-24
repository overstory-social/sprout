import { z } from 'zod';

import {
  storedId,
  type Committed,
  type FaultedWake,
  type TurnHost,
  type Wake,
  type Woke,
} from '@overstory/sprout/lang';

import {
  inputsOf,
  LoggedEffect,
  LoggedFault,
  loggedEffects,
  loggedFault,
  TurnInputs,
  writeInputsOf,
} from './parts.js';

// A wake in the log (the spec's The runtime › The log, Faults; Time ›
// Wakes): the object woken and the serial it asked under, the turn's
// inputs, and what it said. A wake that faulted is consumed and logged
// with its fault and nothing said. A wake no longer pending when its turn
// opened ran nothing and is not logged.

export const WakeEntry = TurnInputs.extend({
  kind: z.literal('wake'),
  object: z.string().min(1),
  serial: z.number().int().positive(),
  /** Null where the wake committed; a wake that faulted was consumed. */
  fault: LoggedFault.nullable(),
  effects: z.array(LoggedEffect),
});
export type WakeEntry = z.infer<typeof WakeEntry>;

/** What the log keeps of `wake`, run by `host` as `turn`. */
export function wakeEntry(
  wake: Wake,
  host: TurnHost,
  turn: Committed<Woke> | FaultedWake,
): WakeEntry {
  return {
    kind: 'wake',
    ...inputsOf(wake, host),
    object: wake.object,
    serial: wake.serial,
    fault: turn.committed ? null : loggedFault(turn.fault),
    effects: turn.committed ? loggedEffects(turn.effects) : [],
  };
}

/** The wake `entry` records, in `world`. */
export function wakeOf(world: string, entry: WakeEntry): Wake {
  return { ...writeInputsOf(entry), object: storedId(world, entry.object), serial: entry.serial };
}
