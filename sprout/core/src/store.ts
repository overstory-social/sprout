import type {
  ActionRecord,
  MicroworldRecord,
  MissRecord,
  StoredChanges,
  StoredState,
  VisitorExport,
} from './records.js';

// The store port: small on purpose — six methods on the store, eight on
// a transaction. No query language, no joins, no filters beyond the ones
// the runtime needs (a date, a limit). A world's state goes in and out
// in the language's stored form: a load reads all of it, and a turn
// writes exactly the change set its draft made. The contract every
// adapter must meet:
//
//   1. Write turns on one microworld are serialized; read turns are not.
//   2. `fn` may be invoked more than once — it must have no effect
//      outside the tx it is handed, and every serial it issues must
//      follow the one it read inside that same invocation.
//   3. A turn's writes land together or not at all; a fault writes
//      nothing of the world, only its action record.
//   4. Locks have timeouts and are not tuples.
//   5. The host may supply the transaction.
//   6. Housekeeping is not a turn; what of it writes a world's state
//      waits on that world's lock.
//
// The conformance suite (`conformance.ts`) proves an adapter keeps it.

/** The reads. A read writes nothing, as a poll writes nothing (the spec's The runtime › Turns). */
export interface ReadTx {
  microworld(): Promise<MicroworldRecord | null>;
  /** The world's stored state, each list in code-unit order of its key; `emptyState()` where nothing is stored. */
  state(): Promise<StoredState>;
  actions(opts: { since?: Date; limit: number; faultedOnly?: boolean }): Promise<ActionRecord[]>;
  misses(opts: { limit: number }): Promise<MissRecord[]>;
}

export interface StoreTx extends ReadTx {
  putMicroworld(m: MicroworldRecord): Promise<void>;
  /**
   * One committed turn's changes, as the language's `storedChanges` gives
   * them: the serial set, instances removed then upserted, tombstones
   * added, visitors upserted by visit.
   */
  putState(changes: StoredChanges): Promise<void>;
  appendAction(a: ActionRecord): Promise<void>;
  appendMiss(m: MissRecord): Promise<void>;
}

export interface SproutStore {
  /** Run `fn` with the microworld locked against every other WRITE on it. */
  transaction<T>(microworldId: string, fn: (tx: StoreTx) => Promise<T>): Promise<T>;
  /** Run `fn` on a consistent snapshot with no lock — what a poll uses. */
  read<T>(microworldId: string, fn: (tx: ReadTx) => Promise<T>): Promise<T>;
  // --- housekeeping, off the turn path ---
  /** Drop action records older than `before`, and misses past the newest `keepMisses`, in every microworld. */
  trim(before: Date, keepMisses: number): Promise<void>;
  /** Everything of this microworld: archive, state, actions, misses. */
  destroyMicroworld(microworldId: string): Promise<void>;
  /**
   * In every microworld that holds `visit`: its visitor record, its
   * instance and everything stored inside that instance, and every
   * instance's memory of it (the spec's The host contract › Moderation
   * and takedown).
   */
  forgetVisitor(visit: string): Promise<void>;
  /** The visitor records, instances and memory `forgetVisitor` erases, for takeout; not what their instance held. */
  exportVisitor(visit: string): Promise<VisitorExport>;
}
