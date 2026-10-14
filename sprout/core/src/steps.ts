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
  type Ran,
  type Said,
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

// One write turn over a world's stored state, as the TypeScript runtime
// runs it for its engine (`engine.ts`; the spec's The runtime › Turns,
// The log): what it did, what the store writes, and the entry the log
// appends, so that running a turn against a store (`turns.ts`) and
// replaying it from the log (`log/replay.ts`) hand the engine the same
// inputs and get the same step. A turn that ran nothing, a tick
// whose place is empty, a wake no longer pending or an arrival to a world
// that admits no one, writes nothing and has no entry.

/**
 * What a turn ran, as a report of a playthrough reads it: each handler and
 * hook in the order it ran, the engine line the parser answered a command
 * with, by its passage's name or its words, and whether the consent pass
 * refused the command's reading.
 */
export interface Account {
  readonly ran: readonly Ran[];
  readonly answered: string | null;
  readonly refused: boolean;
}

/** What one write turn did, what it writes, its log entry and its account; null for any it has none of, or the engine does not say. */
export interface Step<T> {
  readonly turn: T;
  readonly changes: StoredChanges | null;
  readonly entry: TurnEntry | null;
  readonly account: Account | null;
}

/** An account of a turn that ran `ran` and is no command. */
function ranOnly(ran: readonly Ran[]): Account {
  return { ran, answered: null, refused: false };
}

/** The engine line `said` names: its passage's name, or its words where they are a string. */
function answeredBy(said: Said): string {
  const { said: speech } = said;
  if ('passage' in speech) return speech.passage.name;
  if ('text' in speech) return speech.text;
  return 'absent' in speech ? speech.absent : speech.recorded.transcript;
}

/** What a command turn ran, answered with, or refused. */
function commandAccount(turn: CommandTurn): Account {
  if (!turn.committed) return ranOnly([]);
  const { value } = turn;
  return {
    ran: 'drained' in value ? value.drained.ran : [],
    answered: 'answered' in value ? answeredBy(value.answered) : null,
    refused: 'refused' in value,
  };
}

/**
 * Each stored state already read, by the state a store handed back and the catalogue it was read against: a
 * store that hands back the same stored value until it changes (as the memory store does) has it read once,
 * however many turns and polls read it. A stored state is never written in place, so the reading stays true.
 */
const decoded = new WeakMap<
  StoredState,
  { readonly catalogue: object; readonly state: WorldState }
>();

/**
 * Note `state`, the world a turn left, as what `stored`, the stored state
 * its changes landed as, reads as under `host`, so the next turn runs on
 * it as it is rather than reading it afresh.
 */
export function kept(stored: StoredState, host: TurnHost, state: WorldState): void {
  decoded.set(stored, { catalogue: host.catalogue, state });
}

/** `stored`, read against the bundle `host` runs. */
export function loaded(stored: StoredState, host: TurnHost): WorldState {
  const known = decoded.get(stored);
  if (known !== undefined && known.catalogue === host.catalogue) return known.state;
  const state = loadWorld({ world: host.catalogue.world, ...stored }, host.catalogue).state;
  decoded.set(stored, { catalogue: host.catalogue, state });
  return state;
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
    account: commandAccount(turn),
  };
}

/** `tick` as one tick turn over `state`: a fault drops it and is logged; an empty place runs nothing. */
export function tickStep(state: WorldState, host: TurnHost, tick: Tick): Step<TickTurn> {
  const turn = tickTurn(state, host, tick);
  if ('unoccupied' in turn) return { turn, changes: null, entry: null, account: null };
  return {
    turn,
    changes: turn.committed ? turn.changes : null,
    entry: tickEntry(tick, host, turn),
    account: ranOnly(turn.committed ? turn.value.drained.ran : []),
  };
}

/** `wake` as one wake turn over `state`: a fault writes only its consumption; one no longer pending runs nothing. */
export function wakeStep(state: WorldState, host: TurnHost, wake: Wake): Step<WakeTurn> {
  const turn = wakeTurn(state, host, wake);
  if ('unwoken' in turn) return { turn, changes: null, entry: null, account: null };
  return {
    turn,
    changes: turn.committed ? turn.changes : turn.consumed.changes,
    entry: wakeEntry(wake, host, turn),
    account: ranOnly(turn.committed ? turn.value.drained.ran : []),
  };
}

/** Catch-up at `inputs` as one maintenance turn over `state`, which writes what it kept, a fault included. */
export function maintenanceStep(
  state: WorldState,
  host: TurnHost,
  inputs: WriteInputs,
): Step<Committed<CaughtUp>> {
  const turn = maintenanceTurn(state, host, inputs);
  return {
    turn,
    changes: turn.changes,
    entry: maintenanceEntry(inputs, host, turn),
    account: ranOnly(turn.value.ran),
  };
}

/** `arrival` as one arrival turn over `state`: only an admission writes; a world that admits no one runs nothing. */
export function arrivalStep(
  state: WorldState,
  host: TurnHost,
  arrival: Arrival,
): Step<ArrivalTurn> {
  const turn = arrivalTurn(state, host, arrival);
  if ('closed' in turn) return { turn, changes: null, entry: null, account: null };
  return {
    turn,
    changes: turn.committed ? turn.changes : null,
    entry: arrivalEntry(arrival, host, turn),
    account: ranOnly(turn.committed ? turn.value.drained.ran : []),
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
    account: ranOnly(turn.committed ? (turn.value.drained?.ran ?? []) : []),
  };
}
