import {
  codeUnitOrder,
  emptyState,
  type MicroworldRecord,
  type MissRecord,
  type StoredState,
  type VisitorExport,
} from './records.js';
import type { Logged } from './log/entry.js';
import { applyChanges } from './state.js';
import type { ReadTx, SproutStore, StoreTx } from './store.js';
import { applyForgetting, forgetting, visitorIn } from './visitors.js';

// The memory store: a Map and a promise chain per microworld. What
// core's own specs run on, what the conformance suite proves first, and
// what a host's unit tests use in place of a database. A transaction
// reads a snapshot and BUFFERS its writes until `fn` returns, so `fn`
// running twice (the port's re-run rule) commits once — the conformance
// suite's re-entrancy wrapper relies on exactly that.
//
// What it keeps is frozen as it is written, so a snapshot shares it rather
// than copying it, and a read hands back the stored value itself: taking a
// snapshot costs nothing however long the world has run. A write copies
// only what it is handed. The log is append-only: a snapshot sees the
// entries there were when it was taken, and a transaction's own appended
// after them, which join the log when it commits. A store made with
// `keepLog` keeps only the newest part of each world's log (the spec's
// The log › Depth, for a host that keeps a world only in memory): at
// least that many entries, numbered as they always were.

interface World {
  microworld: MicroworldRecord | null;
  state: StoredState;
  /** Every entry kept, in order; entry `i` is numbered `dropped + i + 1`. Appended to, and cut from the front. */
  log: Logged[];
  /** How many of the oldest entries are no longer kept. */
  dropped: number;
  misses: MissRecord[];
}

/** `value`, copied away from whoever handed it over and frozen all the way down. */
function kept<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

/** `value` frozen all the way down, stopping at what is frozen already, so freezing a state costs only its new records. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

function emptyWorld(): World {
  return { microworld: null, state: deepFreeze(emptyState()), log: [], dropped: 0, misses: [] };
}

/** What a snapshot reads: the world as it was, and the log's length then. */
interface Snapshot {
  microworld: MicroworldRecord | null;
  state: StoredState;
  readonly log: readonly Logged[];
  readonly logged: number;
  readonly dropped: number;
  /** This transaction's own appends, after the snapshot's. */
  readonly appended: Logged[];
  misses: readonly MissRecord[];
  readonly missed: MissRecord[];
}

function snapshotOf(live: World): Snapshot {
  return {
    microworld: live.microworld,
    state: live.state,
    log: live.log,
    logged: live.log.length,
    dropped: live.dropped,
    appended: [],
    misses: live.misses,
    missed: [],
  };
}

/** The reads over `snap`: what it saw, and what its own transaction wrote since. */
function reader(snap: Snapshot): ReadTx {
  return {
    microworld: async () => snap.microworld,
    state: async () => snap.state,
    log: async ({ after = 0, limit }) => {
      const from = Math.min(Math.max(after - snap.dropped, 0), snap.logged);
      const seen = snap.log.slice(from, snap.logged);
      return [...seen, ...snap.appended.filter((logged) => logged.seq > after)].slice(0, limit);
    },
    misses: async ({ limit }) => [...snap.misses, ...snap.missed].slice(-limit).reverse(),
  };
}

/** A transaction over a snapshot: reads see the snapshot plus this tx's own writes; writes land on commit. */
function writer(live: World, keepLog: number): { tx: StoreTx; commit: () => void } {
  const snap = snapshotOf(live);
  const lastSeq = (): number => snap.appended.at(-1)?.seq ?? snap.dropped + snap.logged;
  const tx: StoreTx = {
    ...reader(snap),
    putMicroworld: async (m) => {
      snap.microworld = kept(m);
    },
    putState: async (changes) => {
      snap.state = deepFreeze(applyChanges(snap.state, kept(changes)));
    },
    resetState: async () => {
      snap.state = deepFreeze(emptyState());
    },
    appendLog: async (entry) => {
      snap.appended.push(Object.freeze({ seq: lastSeq() + 1, entry: kept(entry) }));
    },
    appendMiss: async (m) => {
      snap.missed.push(kept(m));
    },
  };
  return {
    tx,
    commit: () => {
      live.microworld = snap.microworld;
      live.state = snap.state;
      live.log.push(...snap.appended);
      cut(live, keepLog);
      if (snap.missed.length > 0) live.misses = [...live.misses, ...snap.missed];
    },
  };
}

/**
 * Drop the oldest of `w`'s entries past the newest `keepLog`, once there are an eighth more than
 * that, so a cut is rare; a new array, since a snapshot taken before still reads the old one.
 */
function cut(w: World, keepLog: number): void {
  if (w.log.length <= keepLog + Math.ceil(keepLog / 8)) return;
  const excess = w.log.length - keepLog;
  w.log = w.log.slice(excess);
  w.dropped += excess;
}

/** What a memory store is made with: how many of each world's newest log entries it keeps at least, all where unsaid. */
export interface MemoryStoreOptions {
  readonly keepLog?: number;
}

export function memoryStore(
  options: MemoryStoreOptions = {},
): SproutStore & { readonly worlds: ReadonlyMap<string, unknown> } {
  const keepLog = options.keepLog ?? Infinity;
  if (keepLog !== Infinity && !(Number.isSafeInteger(keepLog) && keepLog >= 1)) {
    throw new Error(
      `A memory store keeps a whole number of log entries, at least 1, not ${keepLog}.`,
    );
  }
  const worlds = new Map<string, World>();
  const chains = new Map<string, Promise<unknown>>();
  const world = (id: string): World => {
    let w = worlds.get(id);
    if (!w) {
      w = emptyWorld();
      worlds.set(id, w);
    }
    return w;
  };
  /** Run `fn` after every write queued on `microworldId`, holding its place in the queue. */
  const queued = async <T>(microworldId: string, fn: () => Promise<T>): Promise<T> => {
    const previous = chains.get(microworldId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(fn);
    chains.set(microworldId, run);
    try {
      return await run;
    } finally {
      if (chains.get(microworldId) === run) chains.delete(microworldId);
    }
  };
  return {
    worlds,
    transaction: (microworldId, fn) =>
      queued(microworldId, async () => {
        const { tx, commit } = writer(world(microworldId), keepLog);
        const result = await fn(tx);
        commit();
        return result;
      }),
    async read(microworldId, fn) {
      // A consistent snapshot at entry: a commit that lands while `fn` awaits is not seen mid-read.
      return fn(reader(snapshotOf(world(microworldId))));
    },
    async trim(keepMisses) {
      for (const w of worlds.values()) {
        if (w.misses.length > keepMisses) w.misses = w.misses.slice(-keepMisses);
      }
    },
    async destroyMicroworld(microworldId) {
      await queued(microworldId, async () => {
        worlds.delete(microworldId);
      });
    },
    async forgetVisitor(visit) {
      for (const id of [...worlds.keys()]) {
        await queued(id, async () => {
          const w = worlds.get(id);
          const change = w ? forgetting(w.state, visit) : null;
          if (w && change) w.state = deepFreeze(applyForgetting(w.state, change));
        });
      }
    },
    async exportVisitor(visit) {
      const out: VisitorExport = { visit, worlds: [] };
      for (const id of [...worlds.keys()].sort(codeUnitOrder)) {
        const found = visitorIn(id, worlds.get(id)!.state, visit);
        if (found) out.worlds.push(structuredClone(found));
      }
      return out;
    },
  };
}
