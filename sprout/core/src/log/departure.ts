import { z } from 'zod';

import {
  visitKey,
  type Departure,
  type DepartureTurn,
  type TurnHost,
} from '@overstory/sprout/lang';

import {
  inputsOf,
  LoggedCut,
  LoggedEffect,
  loggedCuts,
  LoggedFault,
  loggedEffects,
  loggedFault,
  TurnInputs,
  writeInputsOf,
} from './parts.js';

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
  effects: z.array(LoggedEffect),
  /** Who a line would have taken past their output, each a warning. */
  cutShort: z.array(LoggedCut),
});
export type DepartureEntry = z.infer<typeof DepartureEntry>;

/** What the log keeps of `departure`, run by `host` as `turn`. */
export function departureEntry(
  departure: Departure,
  host: TurnHost,
  turn: DepartureTurn,
): DepartureEntry {
  return {
    kind: 'departure',
    level: 'info',
    ...inputsOf(departure, host),
    visit: departure.visit,
    fault: turn.committed ? null : loggedFault(turn.fault),
    effects: loggedEffects(turn.committed ? turn.effects : turn.quietly.effects),
    cutShort: loggedCuts(turn.committed ? turn.cutShort : turn.quietly.cutShort),
  };
}

/** The departure `entry` records, as the host handed it over. */
export function departureOf(entry: DepartureEntry): Departure {
  return { ...writeInputsOf(entry), visit: visitKey(entry.visit) };
}
