import { z } from 'zod';

import {
  storedId,
  type Committed,
  type Faulted,
  type Tick,
  type Ticked,
  type TurnHost,
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

// A tick in the log (the spec's The runtime › The log; Time › Ticks): the
// place ticked, the turn's inputs, and what it said. A tick that faulted
// is dropped, writing nothing of the world, and is logged with its fault
// and nothing said, so a place whose tick faults every time shows to a
// moderator. A tick whose place was empty by the time its turn opened ran
// nothing and is not logged.

export const TickEntry = TurnInputs.extend({
  kind: z.literal('tick'),
  place: z.string().min(1),
  /** Null where the tick committed; a tick that faulted was dropped. */
  fault: LoggedFault.nullable(),
  effects: z.array(LoggedEffect),
});
export type TickEntry = z.infer<typeof TickEntry>;

/** What the log keeps of `tick`, run by `host` as `turn`. */
export function tickEntry(
  tick: Tick,
  host: TurnHost,
  turn: Committed<Ticked> | Faulted,
): TickEntry {
  return {
    kind: 'tick',
    ...inputsOf(tick, host),
    place: tick.place,
    fault: turn.committed ? null : loggedFault(turn.fault),
    effects: turn.committed ? loggedEffects(turn.effects) : [],
  };
}

/** The tick `entry` records, in `world`. */
export function tickOf(world: string, entry: TickEntry): Tick {
  return { ...writeInputsOf(entry), place: storedId(world, entry.place) };
}
