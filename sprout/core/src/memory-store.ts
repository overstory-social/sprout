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
// after them, which join the log when it commits.

interface World {
  microworld: MicroworldRecord | null;
  state: StoredState;
  /** Every entry, in order; entry `i` is numbered `i + 1`. Only ever appended to. */
  log: Logged[];
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
  return { microworld: null, state: deepFreeze(emptyState()), log: [], misses: [] };
}

/** What a snapshot reads: the world as it was, and the log's length then. */
interface Snapshot {
  microworld: MicroworldRecord | null;
  state: StoredState;
  readonly log: readonly Logged[];
  readonly logged: number;
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
      const seen = snap.log.slice(Math.min(after, snap.logged), snap.logged);
      return [...seen, ...snap.appended.filter((logged) => logged.seq > after)].slice(0, limit);
    },
    misses: async ({ limit }) => [...snap.misses, ...snap.missed].slice(-limit).reverse(),
  };
}

/** A transaction over a snapshot: reads see the snapshot plus this tx's own writes; writes land on commit. */
function writer(live: World): { tx: StoreTx; commit: () => void } {
  const snap = snapshotOf(live);
  const lastSeq = (): number => snap.appended.at(-1)?.seq ?? snap.log[snap.logged - 1]?.seq ?? 0;
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
      if (snap.missed.length > 0) live.misses = [...live.misses, ...snap.missed];
    },
  };
}

export function memoryStore(): SproutStore & { readonly worlds: ReadonlyMap<string, unknown> } {
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
        const { tx, commit } = writer(world(microworldId));
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
