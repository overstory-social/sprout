import {
  commandTurn,
  loadWorld,
  pollTurn,
  writeTurn,
  type CommandHost,
  type CommandTurn,
  type Command,
  type Polled,
  type PollTurn,
  type TurnHost,
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
// turn in the log is B40's.

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
