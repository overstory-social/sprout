import type {
  ActionRecord,
  ActorExport,
  ActorRecord,
  MemoryRecord,
  MicroworldRecord,
  MissRecord,
  ObjectRecord,
} from './records.js';

// The store port: small on purpose — six methods on the store,
// seventeen on a transaction, over seven record types. No query
// language, no joins, no filters beyond the ones the runtime needs (a
// room, a date, a limit). The contract every adapter must meet:
//
//   1. Write turns on one microworld are serialized; read turns are not.
//   2. `fn` may be invoked more than once — it must have no effect
//      outside the tx it is handed, and every id it mints must derive
//      from state it read inside that same invocation.
//   3. A turn's writes land together or not at all; a fault writes
//      nothing of the world — only its action record, and the actor's
//      own row as a read turn would touch it.
//   4. Locks have timeouts and are not tuples.
//   5. The host may supply the transaction.
//   6. Housekeeping is not a turn.
//
// The conformance suite (`conformance.ts`) proves an adapter keeps it.

/** The reads, and the ONE write a read transaction may make: the actor's own row. */
export interface ReadTx {
  microworld(): Promise<MicroworldRecord | null>;
  /** Every object row; `rootedAt` is an ignorable hint an adapter may honour later. */
  objects(hint?: { rootedAt?: string[] }): Promise<ObjectRecord[]>;
  actor(id: string): Promise<ActorRecord | null>;
  /** Actors who stood in `room` and were seen since `since`. */
  actorsIn(room: string, since: Date): Promise<ActorRecord[]>;
  /**
   * The heartbeat, and draining `pending`: the one write a ReadTx may
   * make — the actor's own row, never contended.
   */
  touchActor(id: string, lastSeen: Date, drained: boolean): Promise<void>;
  memory(actorId: string): Promise<MemoryRecord>;
  actions(opts: { since?: Date; limit: number; faultedOnly?: boolean }): Promise<ActionRecord[]>;
  misses(opts: { limit: number }): Promise<MissRecord[]>;
}

export interface StoreTx extends ReadTx {
  putMicroworld(m: MicroworldRecord): Promise<void>;
  /** A fresh spawn number, off the locked row. */
  nextSpawn(): Promise<number>;
  /** One call: what changed and what left (`destroy self` needs `remove`). */
  putObjects(change: { upsert: ObjectRecord[]; remove: string[] }): Promise<void>;
  /** Reset: every object row goes; placed things are at home at their defaults again. */
  clearObjects(): Promise<void>;
  putActor(a: ActorRecord): Promise<void>;
  putMemory(m: MemoryRecord): Promise<void>;
  clearMemory(actorId: string): Promise<void>;
  appendAction(a: ActionRecord): Promise<void>;
  appendMiss(m: MissRecord): Promise<void>;
}

export interface SproutStore {
  /** Run `fn` with the microworld locked against every other WRITE on it. */
  transaction<T>(
    microworldId: string,
    fn: (tx: StoreTx) => Promise<T>,
    opts?: { rooms?: string[] },
  ): Promise<T>;
  /** Run `fn` on a consistent snapshot with no lock — what `look` and `complete` use. */
  read<T>(microworldId: string, fn: (tx: ReadTx) => Promise<T>): Promise<T>;
  // --- housekeeping, off the turn path ---
  /** Drop action records older than `before`, and misses past the newest `keepMisses`, in every microworld. */
  trim(before: Date, keepMisses: number): Promise<void>;
  /** Everything of this microworld: archive, objects, actors, memory, actions, misses. */
  destroyMicroworld(microworldId: string): Promise<void>;
  /** Every microworld: the actor's rows, their memory, their pending lines. */
  forgetActor(actorId: string): Promise<void>;
  /** The same rows, for takeout. */
  exportActor(actorId: string): Promise<ActorExport>;
}
