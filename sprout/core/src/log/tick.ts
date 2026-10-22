import { z } from 'zod';

import { storedId, type Tick } from '@overstory/sprout/lang';

import {
  LoggedCut,
  LoggedWarning,
  LoggedEffect,
  LoggedFault,
  TurnInputs,
  writeInputsOf,
} from './parts.js';
import { LoggedDigest } from './depth.js';

// A tick in the log (the spec's The runtime › The log; Time › Ticks): the
// place ticked, the turn's inputs, and what it said. A tick that faulted
// is dropped, writing nothing of the world, and is logged with its fault
// and nothing said, so a place whose tick faults every time shows to a
// moderator. A tick whose place was empty by the time its turn opened ran
// nothing and is not logged.

export const TickEntry = TurnInputs.extend({
  kind: z.literal('tick'),
  level: z.literal('info'),
  place: z.string().min(1),
  /** Null where the tick committed; a tick that faulted was dropped. */
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
export type TickEntry = z.infer<typeof TickEntry>;

/** The tick `entry` records, in `world`. */
export function tickOf(world: string, entry: TickEntry): Tick {
  return { ...writeInputsOf(entry), place: storedId(world, entry.place) };
}
