import { z } from 'zod';

import { storedId, type Wake } from '@overstory/sprout/lang';

import {
  LoggedCut,
  LoggedWarning,
  LoggedEffect,
  LoggedFault,
  TurnInputs,
  writeInputsOf,
} from './parts.js';
import { LoggedDigest } from './depth.js';

// A wake in the log (the spec's The runtime › The log, Faults; Time ›
// Wakes): the object woken and the serial it asked under, the turn's
// inputs, and what it said. A wake that faulted is consumed and logged
// with its fault and nothing said. A wake no longer pending when its turn
// opened ran nothing and is not logged.

export const WakeEntry = TurnInputs.extend({
  kind: z.literal('wake'),
  level: z.literal('info'),
  object: z.string().min(1),
  serial: z.number().int().positive(),
  /** Null where the wake committed; a wake that faulted was consumed. */
  fault: LoggedFault.nullable(),
  /** Every effect at debug depth; none at play depth, where `digest` stands for them. */
  effects: z.array(LoggedEffect),
  /** At play depth, how many effects there were and their digest; absent at debug depth. */
  digest: LoggedDigest.optional(),
  /** Who a line would have taken past their output, each a warning. */
  cutShort: z.array(LoggedCut),
  /** What its bodies did that nobody was told of, each a warning. */
  warnings: z.array(LoggedWarning),
});
export type WakeEntry = z.infer<typeof WakeEntry>;

/** The wake `entry` records, in `world`. */
export function wakeOf(world: string, entry: WakeEntry): Wake {
  return { ...writeInputsOf(entry), object: storedId(world, entry.object), serial: entry.serial };
}
