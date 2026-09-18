import type {
  ActionRecord,
  ActorExport,
  ActorRecord,
  MemoryRecord,
  MicroworldRecord,
  MissRecord,
  ObjectRecord,
} from './records.js';
import type { ReadTx, SproutStore, StoreTx } from './store.js';

// The memory store (the split proposal §5.3): a Map and a promise chain
// per microworld. What core's own specs run on, what the conformance
// suite proves first, and what a host's unit tests use in place of a
// database. A transaction reads a snapshot and BUFFERS its writes until
// `fn` returns, so `fn` running twice (§4.5-2) commits once — the
// conformance suite's re-entrancy wrapper relies on exactly that.

interface World {
  microworld: MicroworldRecord | null;
  spawn: number;
  objects: Map<string, ObjectRecord>;
  actors: Map<string, ActorRecord>;
  memory: Map<string, MemoryRecord>;
  actions: ActionRecord[];
  misses: MissRecord[];
}

const clone = <T>(v: T): T => structuredClone(v);

function emptyWorld(): World {
  return {
    microworld: null,
    spawn: 0,
    objects: new Map(),
    actors: new Map(),
    memory: new Map(),
    actions: [],
    misses: [],
  };
}

function reader(microworldId: string, w: World): ReadTx {
  return {
    microworld: async () => (w.microworld ? clone(w.microworld) : null),
    objects: async () => [...w.objects.values()].map(clone),
    actor: async (id) => {
      const a = w.actors.get(id);
      return a ? clone(a) : null;
    },
    actorsIn: async (room, since) =>
      [...w.actors.values()]
        .filter((a) => a.roomId === room && a.lastSeen.getTime() >= since.getTime())
        .map(clone),
    touchActor: async (id, lastSeen, drained) => {
      const a = w.actors.get(id);
      if (!a) return;
      a.lastSeen = lastSeen;
      if (drained) a.pending = [];
    },
    memory: async (actorId) =>
      clone(w.memory.get(actorId) ?? { microworldId, actorId, byObject: {} }),
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
function writer(microworldId: string, live: World): { tx: StoreTx; commit: () => void } {
  const snap: World = {
    microworld: live.microworld ? clone(live.microworld) : null,
    spawn: live.spawn,
    objects: new Map([...live.objects].map(([k, v]) => [k, clone(v)])),
    actors: new Map([...live.actors].map(([k, v]) => [k, clone(v)])),
    memory: new Map([...live.memory].map(([k, v]) => [k, clone(v)])),
    actions: live.actions.map(clone),
    misses: live.misses.map(clone),
  };
  const tx: StoreTx = {
    ...reader(microworldId, snap),
    putMicroworld: async (m) => {
      snap.microworld = clone(m);
    },
    nextSpawn: async () => ++snap.spawn,
    putObjects: async ({ upsert, remove }) => {
      for (const id of remove) snap.objects.delete(id);
      for (const o of upsert) snap.objects.set(o.id, clone(o));
    },
    clearObjects: async () => {
      snap.objects.clear();
    },
    putActor: async (a) => {
      snap.actors.set(a.id, clone(a));
    },
    putMemory: async (m) => {
      snap.memory.set(m.actorId, clone(m));
    },
    clearMemory: async (actorId) => {
      snap.memory.delete(actorId);
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
      live.spawn = snap.spawn;
      live.objects = snap.objects;
      live.actors = snap.actors;
      live.memory = snap.memory;
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
  return {
    worlds,
    async transaction(microworldId, fn) {
      const previous = chains.get(microworldId) ?? Promise.resolve();
      const run = previous
        .catch(() => undefined)
        .then(async () => {
          const w = world(microworldId);
          const { tx, commit } = writer(microworldId, w);
          const result = await fn(tx);
          commit();
          return result;
        });
      chains.set(microworldId, run);
      try {
        return await run;
      } finally {
        if (chains.get(microworldId) === run) chains.delete(microworldId);
      }
    },
    async read(microworldId, fn) {
      return fn(reader(microworldId, world(microworldId)));
    },
    async trim(before, keepMisses) {
      for (const w of worlds.values()) {
        w.actions = w.actions.filter((a) => a.at.getTime() >= before.getTime());
        if (w.misses.length > keepMisses) w.misses = w.misses.slice(-keepMisses);
      }
    },
    async destroyMicroworld(microworldId) {
      worlds.delete(microworldId);
    },
    async forgetActor(actorId) {
      for (const w of worlds.values()) {
        w.actors.delete(actorId);
        w.memory.delete(actorId);
      }
    },
    async exportActor(actorId) {
      const out: ActorExport = { actorId, actors: [], memory: [] };
      for (const w of worlds.values()) {
        const a = w.actors.get(actorId);
        if (a) out.actors.push(clone(a));
        const m = w.memory.get(actorId);
        if (m) out.memory.push(clone(m));
      }
      return out;
    },
  };
}
