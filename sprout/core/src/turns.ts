import {
  closedByBundle,
  NOT_ADMITTING,
  keptNickname,
  moderated,
  nicknameRefusal,
  pollTurn,
  type Arrival,
  type ArrivalTurn,
  type CaughtUp,
  type Command,
  type CommandHost,
  type CommandTurn,
  type Committed,
  type Departure,
  type DepartureTurn,
  type NicknameRefused,
  type Polled,
  type PollTurn,
  type Tick,
  type TickTurn,
  type TurnHost,
  type Wake,
  type WakeTurn,
  type WorldState,
  type WriteInputs,
} from '@overstory/sprout/lang';

import {
  arrivalStep,
  commandStep,
  departureStep,
  loaded,
  maintenanceStep,
  tickStep,
  wakeStep,
  type Step,
} from './steps.js';
import type { SproutStore, StoreTx } from './store.js';

// A world's turns run against its store (the spec's The runtime › Turns;
// The host contract › Storage). A write turn runs inside the store's
// transaction, under the world's write lock, so write turns on one world
// are serialized: it reads the stored state, runs as the language's turn
// over it, and writes the change set only where the turn committed, so a
// fault writes nothing of the world. Each write turn that ran appends its
// entry to the log in the same transaction, a faulted one included, so a
// turn and its record land together; what each writes and logs is
// `steps.ts`'s, which a replay runs too. A poll reads a snapshot and takes
// no lock. Each is safe to run twice, as the port's re-run rule asks,
// since a turn is a function of the state it read and its inputs. When to
// tick is `ticks.ts`'s, and when to deliver a wake, live or as catch-up,
// is the host's (Time › Absence).

/** Land `step` in `tx`: its changes where it writes, and its entry where it ran. */
async function landed<T>(tx: StoreTx, step: Step<T>): Promise<T> {
  if (step.changes !== null) await tx.putState(step.changes);
  if (step.entry !== null) await tx.appendLog(step.entry);
  return step.turn;
}

/** Run `command` as one command turn on `microworldId`, under its lock. */
export function runCommand(
  store: SproutStore,
  microworldId: string,
  host: CommandHost,
  command: Command,
): Promise<CommandTurn> {
  return store.transaction(microworldId, async (tx) =>
    landed(tx, commandStep(loaded(await tx.state(), host), host, command)),
  );
}

/**
 * Run `tick` as one tick turn on `microworldId`, under its lock. A tick
 * that faulted is dropped, and one whose place is empty by then does not
 * run; neither writes anything of the world.
 */
export function runTick(
  store: SproutStore,
  microworldId: string,
  host: TurnHost,
  tick: Tick,
): Promise<TickTurn> {
  return store.transaction(microworldId, async (tx) =>
    landed(tx, tickStep(loaded(await tx.state(), host), host, tick)),
  );
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
  return store.transaction(microworldId, async (tx) =>
    landed(tx, wakeStep(loaded(await tx.state(), host), host, wake)),
  );
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
  return store.transaction(microworldId, async (tx) =>
    landed(tx, maintenanceStep(loaded(await tx.state(), host), host, inputs)),
  );
}

/** What the host decides of a nickname beyond the bundle and its budgets (the spec's The host contract › Admission and identity). */
export interface NicknameHost {
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
 * against the bundle, the host's budgets, the world and `nicknames`, then catch-up as a
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
    nicknameRefusal(state, host.catalogue, host.budgets, arrival.visit, arrival.nickname);
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
  const arrived = await runArrivalTurn(store, microworldId, host, arrival);
  return { caughtUp, arrived };
}

/**
 * Run `arrival` as one arrival turn on `microworldId`, under its lock,
 * its nickname checked again against the host and the world as the turn
 * finds it, since someone may have come in under it since it was
 * checked. `runArrival` runs it once catch-up has committed.
 */
export function runArrivalTurn(
  store: SproutStore,
  microworldId: string,
  host: TurnHost,
  arrival: Arrival,
): Promise<ArrivalTurn | NicknameRefusedTurn> {
  return store.transaction(microworldId, async (tx): Promise<ArrivalTurn | NicknameRefusedTurn> => {
    const state = loaded(await tx.state(), host);
    const taken = nicknameRefusal(
      state,
      host.catalogue,
      host.budgets,
      arrival.visit,
      arrival.nickname,
    );
    if (taken !== null) return { committed: false, nicknameRefused: taken };
    return landed(tx, arrivalStep(state, host, arrival));
  });
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
  return store.transaction(microworldId, async (tx) =>
    landed(tx, departureStep(loaded(await tx.state(), host), host, departure)),
  );
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
