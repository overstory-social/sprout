import {
  arrivalTurn,
  closedByBundle,
  commandTurn,
  departureTurn,
  loadWorld,
  NOT_ADMITTING,
  keptNickname,
  moderated,
  nicknameRefusal,
  type NicknameRefused,
  type NicknameRules,
  type Arrival,
  type ArrivalTurn,
  type Departure,
  type DepartureTurn,
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
 * Run catch-up as one maintenance turn on `microworldId`, under its lock.
 * It writes what it kept, a fault included; `runArrival` runs it before
 * an arriving visitor is admitted, whatever it did.
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

/** What the host decides of a nickname beyond the bundle (the spec's The host contract › Admission and identity). */
export interface NicknameHost {
  readonly rules: NicknameRules;
  /** Whether the host's moderation lets `nickname`, as the world would keep it, be rendered there; asked only of one the world would admit. */
  readonly moderate: (nickname: string) => boolean | Promise<boolean>;
}

/** An arrival that did not open, its nickname refused: the host asks the person for another. */
export interface NicknameRefusedTurn {
  readonly committed: false;
  readonly nicknameRefused: NicknameRefused;
}

/** What admitting one visitor did: the catch-up run first, null where nobody was let in, and the arrival. */
export interface Admission {
  readonly caughtUp: Committed<CaughtUp> | null;
  readonly arrived: ArrivalTurn | NicknameRefusedTurn;
}

/**
 * Admit `arrival`'s visitor to `microworldId`: their nickname checked
 * against the bundle, the world and `nicknames`, then catch-up as a
 * maintenance turn at `catchUp`, committed first, so nobody walks into a
 * place about to rearrange itself, then the arrival as a turn of its own
 * (the spec's The host contract › Time, Admission and identity). A world
 * whose bundle admits no one, or a nickname refused, runs no catch-up.
 */
export async function runArrival(
  store: SproutStore,
  microworldId: string,
  host: TurnHost,
  catchUp: WriteInputs,
  arrival: Arrival,
  nicknames: NicknameHost,
): Promise<Admission> {
  const reason = closedByBundle(host.catalogue);
  if (reason !== null) {
    return {
      caughtUp: null,
      arrived: { committed: false, closed: { reason, words: NOT_ADMITTING } },
    };
  }
  const refusalIn = (state: WorldState): NicknameRefused | null =>
    nicknameRefusal(state, host.catalogue, nicknames.rules, arrival.visit, arrival.nickname);
  const before = await store.read(microworldId, async (tx) =>
    refusalIn(loaded(await tx.state(), host)),
  );
  const refused =
    before ??
    ((await nicknames.moderate(keptNickname(arrival.nickname)))
      ? null
      : moderated(arrival.nickname));
  if (refused !== null) {
    return { caughtUp: null, arrived: { committed: false, nicknameRefused: refused } };
  }
  const caughtUp = await runMaintenance(store, microworldId, host, catchUp);
  const arrived = await store.transaction(
    microworldId,
    async (tx): Promise<ArrivalTurn | NicknameRefusedTurn> => {
      const state = loaded(await tx.state(), host);
      // Someone may have come in under the same nickname since it was checked.
      const taken = refusalIn(state);
      if (taken !== null) return { committed: false, nicknameRefused: taken };
      const turn = arrivalTurn(state, host, arrival);
      if (turn.committed) await tx.putState(turn.changes);
      return turn;
    },
  );
  return { caughtUp, arrived };
}

/**
 * Run `departure` as one departure turn on `microworldId`, under its
 * lock. A departure that faulted writes the visitor gone away quietly.
 */
export function runDeparture(
  store: SproutStore,
  microworldId: string,
  host: TurnHost,
  departure: Departure,
): Promise<DepartureTurn> {
  return store.transaction(microworldId, async (tx) => {
    const turn = departureTurn(loaded(await tx.state(), host), host, departure);
    await tx.putState(turn.committed ? turn.changes : turn.quietly.changes);
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
