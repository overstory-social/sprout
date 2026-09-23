import {
  codeUnitOrder,
  emptyState,
  type ActionRecord,
  type MicroworldRecord,
  type MissRecord,
  type StoredState,
  type VisitorExport,
} from './records.js';
import { applyChanges } from './state.js';
import type { ReadTx, SproutStore, StoreTx } from './store.js';
import { applyForgetting, forgetting, visitorIn } from './visitors.js';

// The memory store: a Map and a promise chain per microworld. What
// core's own specs run on, what the conformance suite proves first, and
// what a host's unit tests use in place of a database. A transaction
// reads a snapshot and BUFFERS its writes until `fn` returns, so `fn`
// running twice (the port's re-run rule) commits once — the conformance
// suite's re-entrancy wrapper relies on exactly that.

interface World {
  microworld: MicroworldRecord | null;
  state: StoredState;
  actions: ActionRecord[];
  misses: MissRecord[];
}

const clone = <T>(v: T): T => structuredClone(v);

function emptyWorld(): World {
  return { microworld: null, state: emptyState(), actions: [], misses: [] };
}

function snapshotOf(live: World): World {
  return {
    microworld: live.microworld ? clone(live.microworld) : null,
    state: clone(live.state),
    actions: live.actions.map(clone),
    misses: live.misses.map(clone),
  };
}

/** The reads over `w`. */
function reader(w: World): ReadTx {
  return {
    microworld: async () => (w.microworld ? clone(w.microworld) : null),
    state: async () => clone(w.state),
    actions: async ({ since, limit, faultedOnly }) =>
      w.actions
        .filter((a) => (!since || a.at.getTime() >= since.getTime()) && (!faultedOnly || a.faulted))
        .slice(-limit)
        .reverse()
        .map(clone),
    misses: async ({ limit }) => w.misses.slice(-limit).reverse().map(clone),
  };
}

/** A transaction over a snapshot: reads see the snapshot plus this tx's own writes; writes land on commit. */
function writer(live: World): { tx: StoreTx; commit: () => void } {
  const snap = snapshotOf(live);
  const tx: StoreTx = {
    ...reader(snap),
    putMicroworld: async (m) => {
      snap.microworld = clone(m);
    },
    putState: async (changes) => {
      snap.state = applyChanges(snap.state, clone(changes));
    },
    appendAction: async (a) => {
      snap.actions.push(clone(a));
    },
    appendMiss: async (m) => {
      snap.misses.push(clone(m));
    },
  };
  return {
    tx,
    commit: () => {
      live.microworld = snap.microworld;
      live.state = snap.state;
      live.actions = snap.actions;
      live.misses = snap.misses;
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
    async trim(before, keepMisses) {
      for (const w of worlds.values()) {
        w.actions = w.actions.filter((a) => a.at.getTime() >= before.getTime());
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
          if (w && change) w.state = applyForgetting(w.state, change);
        });
      }
    },
    async exportVisitor(visit) {
      const out: VisitorExport = { visit, worlds: [] };
      for (const id of [...worlds.keys()].sort(codeUnitOrder)) {
        const found = visitorIn(id, worlds.get(id)!.state, visit);
        if (found) out.worlds.push(clone(found));
      }
      return out;
    },
  };
}
