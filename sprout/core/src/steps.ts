import {
  arrivalTurn,
  commandTurn,
  departureTurn,
  loadWorld,
  maintenanceTurn,
  tickTurn,
  wakeTurn,
  type Arrival,
  type ArrivalTurn,
  type CaughtUp,
  type Command,
  type CommandHost,
  type CommandTurn,
  type Committed,
  type Departure,
  type DepartureTurn,
  type StoredChanges,
  type Tick,
  type TickTurn,
  type TurnHost,
  type Wake,
  type WakeTurn,
  type WorldState,
  type WriteInputs,
} from '@overstory/sprout/lang';

import { arrivalEntry } from './log/arrival.js';
import { commandEntry } from './log/command.js';
import { departureEntry } from './log/departure.js';
import type { TurnEntry } from './log/entry.js';
import { maintenanceEntry } from './log/maintenance.js';
import { tickEntry } from './log/tick.js';
import { wakeEntry } from './log/wake.js';
import type { StoredState } from './records.js';

// One write turn over a world's stored state, as the language runs it
// (the spec's The runtime › Turns, The log): what it did, what the store
// writes, and the entry the log appends, so that running a turn against a
// store (`turns.ts`) and replaying it from the log (`log/replay.ts`) are
// the same function of the same inputs. A turn that ran nothing, a tick
// whose place is empty, a wake no longer pending or an arrival to a world
// that admits no one, writes nothing and has no entry.

/** What one write turn did, what it writes, and its log entry; null for either where there is none. */
export interface Step<T> {
  readonly turn: T;
  readonly changes: StoredChanges | null;
  readonly entry: TurnEntry | null;
}

/** `stored`, read against the bundle `host` runs. */
export function loaded(stored: StoredState, host: TurnHost): WorldState {
  return loadWorld({ world: host.catalogue.world, ...stored }, host.catalogue).state;
}

/** `command` as one command turn over `state`: a fault writes nothing of the world, and is logged. */
export function commandStep(
  state: WorldState,
  host: CommandHost,
  command: Command,
): Step<CommandTurn> {
  const turn = commandTurn(state, host, command);
  return {
    turn,
    changes: turn.committed ? turn.changes : null,
    entry: commandEntry(command, host, turn),
  };
}

/** `tick` as one tick turn over `state`: a fault drops it and is logged; an empty place runs nothing. */
export function tickStep(state: WorldState, host: TurnHost, tick: Tick): Step<TickTurn> {
  const turn = tickTurn(state, host, tick);
  if ('unoccupied' in turn) return { turn, changes: null, entry: null };
  return {
    turn,
    changes: turn.committed ? turn.changes : null,
    entry: tickEntry(tick, host, turn),
  };
}

/** `wake` as one wake turn over `state`: a fault writes only its consumption; one no longer pending runs nothing. */
export function wakeStep(state: WorldState, host: TurnHost, wake: Wake): Step<WakeTurn> {
  const turn = wakeTurn(state, host, wake);
  if ('unwoken' in turn) return { turn, changes: null, entry: null };
  return {
    turn,
    changes: turn.committed ? turn.changes : turn.consumed.changes,
    entry: wakeEntry(wake, host, turn),
  };
}

/** Catch-up at `inputs` as one maintenance turn over `state`, which writes what it kept, a fault included. */
export function maintenanceStep(
  state: WorldState,
  host: TurnHost,
  inputs: WriteInputs,
): Step<Committed<CaughtUp>> {
  const turn = maintenanceTurn(state, host, inputs);
  return { turn, changes: turn.changes, entry: maintenanceEntry(inputs, host, turn) };
}

/** `arrival` as one arrival turn over `state`: only an admission writes; a world that admits no one runs nothing. */
export function arrivalStep(
  state: WorldState,
  host: TurnHost,
  arrival: Arrival,
): Step<ArrivalTurn> {
  const turn = arrivalTurn(state, host, arrival);
  if ('closed' in turn) return { turn, changes: null, entry: null };
  return {
    turn,
    changes: turn.committed ? turn.changes : null,
    entry: arrivalEntry(arrival, host, turn),
  };
}

/** `departure` as one departure turn over `state`: one that faulted writes the visitor gone quietly. */
export function departureStep(
  state: WorldState,
  host: TurnHost,
  departure: Departure,
): Step<DepartureTurn> {
  const turn = departureTurn(state, host, departure);
  return {
    turn,
    changes: turn.committed ? turn.changes : turn.quietly.changes,
    entry: departureEntry(departure, host, turn),
  };
}
