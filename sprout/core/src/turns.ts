import {
  closedByBundle,
  keptNickname,
  moderated,
  NOT_ADMITTING,
  type Arrival,
  type Command,
  type CommandHost,
  type Departure,
  type NicknameRefused,
  type Tick,
  type TurnHost,
  type Wake,
  type WriteInputs,
} from '@overstory/sprout/lang';

import {
  engineOf,
  type EngineHost,
  type GivenArrival,
  type GivenCommand,
  type GivenCommitted,
  type GivenDeparture,
  type GivenTick,
  type GivenWake,
} from './engine.js';
import type { StoredState } from './records.js';
import type { Step } from './steps.js';
import { atDepth, type LogDepth } from './log/depth.js';
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
// is the host's (Time › Absence). Each turn is the engine's the host names
// (`engine.ts`), the TypeScript runtime's where it names none.

/** What a host adds to the language's to run a world's turns on a store: the depth it keeps the log at, play where it names none, and its engine. */
export interface LogHost extends EngineHost {
  readonly logDepth?: LogDepth;
}

/** Land `step` in `tx`: its changes where it writes, and its entry, at `host`'s depth, where it ran. */
async function landed<T>(tx: StoreTx, step: Step<T>, host: LogHost): Promise<T> {
  if (step.changes !== null) await tx.putState(step.changes);
  if (step.entry !== null) await tx.appendLog(atDepth(step.entry, host.logDepth ?? 'play'));
  return step.turn;
}

/** Run `command` as one command turn on `microworldId`, under its lock. */
export function runCommand(
  store: SproutStore,
  microworldId: string,
  host: CommandHost & LogHost,
  command: Command,
): Promise<GivenCommand> {
  const engine = engineOf(host);
  return store.transaction(microworldId, async (tx) =>
    landed(tx, engine.command(await tx.state(), command), host),
  );
}

/**
 * Run the line `command` typed: each command it holds, and each step an
 * intent planned, as a command turn of its own under the lock, with its
 * own seed from `seed` after the first and its own log entry (the spec's
 * Parsing › Intents; Sequences, again and all). A refusal, `unknown`,
 * `not_here` and a fault each stop the rest, and what ran before stays
 * done. Every turn that ran, in order.
 */
export async function runCommandLine(
  store: SproutStore,
  microworldId: string,
  host: CommandHost & LogHost,
  command: Command,
  seed: () => number,
): Promise<GivenCommand[]> {
  const turns: GivenCommand[] = [];
  const line = engineOf(host).line(command, seed);
  for (let next = line.next(null); next !== null;) {
    const turn = await runCommand(store, microworldId, host, next);
    turns.push(turn);
    next = line.next(turn);
  }
  return turns;
}

/**
 * Run `tick` as one tick turn on `microworldId`, under its lock. A tick
 * that faulted is dropped, and one whose place is empty by then does not
 * run; neither writes anything of the world.
 */
export function runTick(
  store: SproutStore,
  microworldId: string,
  host: TurnHost & LogHost,
  tick: Tick,
): Promise<GivenTick> {
  const engine = engineOf(host);
  return store.transaction(microworldId, async (tx) =>
    landed(tx, engine.tick(await tx.state(), tick), host),
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
  host: TurnHost & LogHost,
  wake: Wake,
): Promise<GivenWake> {
  const engine = engineOf(host);
  return store.transaction(microworldId, async (tx) =>
    landed(tx, engine.wake(await tx.state(), wake), host),
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
  host: TurnHost & LogHost,
  inputs: WriteInputs,
): Promise<GivenCommitted> {
  const engine = engineOf(host);
  return store.transaction(microworldId, async (tx) =>
    landed(tx, engine.maintenance(await tx.state(), inputs), host),
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
  readonly caughtUp: GivenCommitted | null;
  readonly arrived: GivenArrival | NicknameRefusedTurn;
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
  host: TurnHost & LogHost,
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
  const engine = engineOf(host);
  const before = await store.read(microworldId, async (tx) =>
    engine.nicknameRefusal(await tx.state(), arrival.visit, arrival.nickname),
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
  host: TurnHost & LogHost,
  arrival: Arrival,
): Promise<GivenArrival | NicknameRefusedTurn> {
  const engine = engineOf(host);
  return store.transaction(
    microworldId,
    async (tx): Promise<GivenArrival | NicknameRefusedTurn> => {
      const stored = await tx.state();
      const taken = engine.nicknameRefusal(stored, arrival.visit, arrival.nickname);
      if (taken !== null) return { committed: false, nicknameRefused: taken };
      return landed(tx, engine.arrival(stored, arrival), host);
    },
  );
}

/**
 * Run `departure` as one departure turn on `microworldId`, under its
 * lock. A departure that faulted writes the visitor gone away quietly.
 */
export function runDeparture(
  store: SproutStore,
  microworldId: string,
  host: TurnHost & LogHost,
  departure: Departure,
): Promise<GivenDeparture> {
  const engine = engineOf(host);
  return store.transaction(microworldId, async (tx) =>
    landed(tx, engine.departure(await tx.state(), departure), host),
  );
}

/** The last committed state of `microworldId` as the store keeps it, with no lock: what an engine is handed for a poll or a host's question. */
export function committedStored(store: SproutStore, microworldId: string): Promise<StoredState> {
  return store.read(microworldId, (tx) => tx.state());
}
