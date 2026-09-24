import { z } from 'zod';

import { visitKey, type Arrival, type ArrivalTurn, type TurnHost } from '@overstory/sprout/lang';

import {
  inputsOf,
  LoggedEffect,
  LoggedFault,
  loggedEffects,
  loggedFault,
  TurnInputs,
  writeInputsOf,
} from './parts.js';

// A visitor's entry in the log (the spec's The runtime › The log; The
// host contract › Admission and identity): the visit, the nickname they
// came in with, which is how the log keeps every nickname, since a
// visitor is given one only as they arrive, the turn's inputs, and what
// it said. An entry the place refused keeps the refusal it said; one that
// faulted keeps its fault, and says nothing in the world. A world that
// admits no one, and a nickname refused, open no turn and are not logged.

export const ArrivalEntry = TurnInputs.extend({
  kind: z.literal('arrival'),
  visit: z.string().min(1),
  nickname: z.string().min(1),
  outcome: z.enum(['admitted', 'refused', 'faulted']),
  /** Null unless it faulted. */
  fault: LoggedFault.nullable(),
  effects: z.array(LoggedEffect),
});
export type ArrivalEntry = z.infer<typeof ArrivalEntry>;

/** An arrival turn that ran: every outcome but a world that admits no one. */
export type RanArrival = Exclude<ArrivalTurn, { readonly closed: unknown }>;

/** What the log keeps of `arrival`, run by `host` as `turn`. */
export function arrivalEntry(arrival: Arrival, host: TurnHost, turn: RanArrival): ArrivalEntry {
  const base = {
    kind: 'arrival' as const,
    ...inputsOf(arrival, host),
    visit: arrival.visit,
    nickname: arrival.nickname,
  };
  if (turn.committed) {
    return { ...base, outcome: 'admitted', fault: null, effects: loggedEffects(turn.effects) };
  }
  if ('refused' in turn) {
    return { ...base, outcome: 'refused', fault: null, effects: loggedEffects(turn.effects) };
  }
  return { ...base, outcome: 'faulted', fault: loggedFault(turn.fault), effects: [] };
}

/** The arrival `entry` records, as the host handed it over. */
export function arrivalOf(entry: ArrivalEntry): Arrival {
  return { ...writeInputsOf(entry), visit: visitKey(entry.visit), nickname: entry.nickname };
}
