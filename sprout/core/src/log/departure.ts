import { z } from 'zod';

import { visitKey, type Departure } from '@overstory/sprout/lang';

import {
  LoggedCut,
  LoggedWarning,
  LoggedEffect,
  LoggedFault,
  TurnInputs,
  writeInputsOf,
} from './parts.js';
import { LoggedDigest } from './depth.js';

// A visitor's exit in the log (the spec's The runtime › The log): the
// visit, the turn's inputs, and what it said. One that faulted keeps its
// fault and what the quiet departure after it said, the engine's words to
// the one who left.

export const DepartureEntry = TurnInputs.extend({
  kind: z.literal('departure'),
  level: z.literal('info'),
  visit: z.string().min(1),
  /** Null where the departure committed; one that faulted was made quietly after. */
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
export type DepartureEntry = z.infer<typeof DepartureEntry>;

/** The departure `entry` records, as the host handed it over. */
export function departureOf(entry: DepartureEntry): Departure {
  return { ...writeInputsOf(entry), visit: visitKey(entry.visit) };
}
