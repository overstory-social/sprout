import {
  commandTurn,
  loadWorld,
  maintenanceTurn,
  pollTurn,
  tickTurn,
  wakeTurn,
  writeTurn,
  type CaughtUp,
  type CommandHost,
  type CommandTurn,
  type Command,
  type Committed,
  type Polled,
  type PollTurn,
  type Tick,
  type TickTurn,
  type TurnHost,
  type Wake,
  type WakeTurn,
  type WorldState,
  type WriteInputs,
  type WriteTurn,
  type WriteTurnKind,
  type Written,
} from '@overstory/sprout/lang';

import type { StoredState } from './records.js';
import type { SproutStore } from './store.js';

// A world's turns run against its store (the spec's The runtime › Turns;
// The host contract › Storage). A write turn runs inside the store's
// transaction, under the world's write lock, so write turns on one world
// are serialized: it reads the stored state, runs as the language's turn
// over it, and writes the change set only where the turn committed, so a
// fault writes nothing of the world. A poll reads a snapshot and takes no
// lock. Each is safe to run twice, as the port's re-run rule asks, since
// a turn is a function of the state it read and its inputs. Recording a
// turn in the log is B40's; when to tick is `ticks.ts`'s, and when to
// deliver a wake, live or as catch-up, is the host's (Time › Absence).

/** The stored state, read against the bundle the host runs. */
function loaded(stored: StoredState, host: TurnHost): WorldState {
  return loadWorld({ world: host.catalogue.world, ...stored }, host.catalogue).state;
}

/** Run `body` as one write turn of `kind` on `microworldId`, under its lock. */
export function runWriteTurn<T>(
  store: SproutStore,
  microworldId: string,
  kind: WriteTurnKind,
  host: TurnHost,
  inputs: WriteInputs,
  body: (turn: WriteTurn) => T,
): Promise<Written<T>> {
  return store.transaction(microworldId, async (tx) => {
    const turn = writeTurn(loaded(await tx.state(), host), kind, host, inputs, body);
    if (turn.committed) await tx.putState(turn.changes);
    return turn;
  });
}

/** Run `command` as one command turn on `microworldId`, under its lock. */
export function runCommand(
  store: SproutStore,
  microworldId: string,
  host: CommandHost,
  command: Command,
): Promise<CommandTurn> {
  return store.transaction(microworldId, async (tx) => {
    const turn = commandTurn(loaded(await tx.state(), host), host, command);
    if (turn.committed) await tx.putState(turn.changes);
    return turn;
  });
}

/**
 * Run `tick` as one tick turn on `microworldId`, under its lock. A tick
 * that faulted is dropped, and one whose place is empty by then does not
 * run; neither writes anything.
 */
export function runTick(
  store: SproutStore,
  microworldId: string,
  host: TurnHost,
  tick: Tick,
): Promise<TickTurn> {
  return store.transaction(microworldId, async (tx) => {
    const turn = tickTurn(loaded(await tx.state(), host), host, tick);
    if (turn.committed) await tx.putState(turn.changes);
    return turn;
  });
}

/**
 * Run `wake` as one wake turn on `microworldId`, under its lock. A wake
 * that faulted writes only its consumption, and one no longer pending
 * writes nothing.
 */
export function runWake(
  store: SproutStore,
  microworldId: string,
  host: TurnHost,
  wake: Wake,
): Promise<WakeTurn> {
  return store.transaction(microworldId, async (tx) => {
    const turn = wakeTurn(loaded(await tx.state(), host), host, wake);
    if (turn.committed) await tx.putState(turn.changes);
    else if ('consumed' in turn) await tx.putState(turn.consumed.changes);
    return turn;
  });
}

/**
 * Run catch-up as one maintenance turn on `microworldId`, under its lock,
 * before an arriving visitor is admitted. It writes what it kept, a fault
 * included, and the host admits the visitor once it resolves, whatever it
 * did (B42 admits).
 */
export function runMaintenance(
  store: SproutStore,
  microworldId: string,
  host: TurnHost,
  inputs: WriteInputs,
): Promise<Committed<CaughtUp>> {
  return store.transaction(microworldId, async (tx) => {
    const turn = maintenanceTurn(loaded(await tx.state(), host), host, inputs);
    await tx.putState(turn.changes);
    return turn;
  });
}

/** The last committed state of `microworldId`, read against the bundle the host runs, with no lock. */
export function committedState(
  store: SproutStore,
  microworldId: string,
  host: TurnHost,
): Promise<WorldState> {
  return store.read(microworldId, async (tx) => loaded(await tx.state(), host));
}

/** Run `look` as a poll of `microworldId`, on the last committed state, with no lock. */
export function runPoll<T>(
  store: SproutStore,
  microworldId: string,
  host: TurnHost,
  look: (turn: PollTurn) => T,
): Promise<Polled<T>> {
  return store.read(microworldId, async (tx) =>
    pollTurn(loaded(await tx.state(), host), host, look),
  );
}
