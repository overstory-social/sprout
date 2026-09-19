import { z } from 'zod';

import {
  ActionRecord,
  ActorRecord,
  MemoryRecord,
  MicroworldRecord,
  MissRecord,
  ObjectRecord,
  type ActorExport,
  type ReadTx,
  type SproutStore,
  type StoreTx,
} from '@overstory/sprout-core';

import type { DocumentBackend, DocumentReader, DocumentWriter } from './backend.js';

// The store port over a document backend (the split proposal §5.2). The
// layout is split along the WRITE-RATE seam, not the read seam: the
// objects of a microworld are one document written only when a turn
// changes something, holding the rows as an opaque serialized string (a
// map of two thousand small objects would blow a document database's
// index-entry ceiling); each actor is a small document of its own,
// written every poll; the archive is one; memory is one per actor; and
// actions and misses are COLLECTIONS, one document per record, never a
// dated document appended to. Serialization is `transact` on the objects
// key; atomicity is the backend's single commit; re-entrancy is core's
// §4.5-2 rule, which is why every number a turn mints (a spawn, a
// record's sequence) is read from the `counters` document inside the
// transaction.
//
// Every key starts with the microworld, URL-encoded: a microworld id may
// carry a `/` (`<zone>/draft`), and `microworld/<zone>/` must not list
// the draft's documents as the zone's.

const enc = (id: string): string => encodeURIComponent(id);
const dec = (segment: string): string => decodeURIComponent(segment);
const pad = (n: number): string => String(n).padStart(12, '0');

/** The keys, in one place — the README's table. */
export const keys = {
  microworld: (w: string) => `microworld/${enc(w)}/`,
  archive: (w: string) => `microworld/${enc(w)}/archive`,
  objects: (w: string) => `microworld/${enc(w)}/objects`,
  counters: (w: string) => `microworld/${enc(w)}/counters`,
  actors: (w: string) => `microworld/${enc(w)}/actors/`,
  actor: (w: string, a: string) => `microworld/${enc(w)}/actors/${enc(a)}`,
  memories: (w: string) => `microworld/${enc(w)}/memory/`,
  memory: (w: string, a: string) => `microworld/${enc(w)}/memory/${enc(a)}`,
  actions: (w: string) => `microworld/${enc(w)}/actions/`,
  action: (w: string, n: number) => `microworld/${enc(w)}/actions/${pad(n)}`,
  misses: (w: string) => `microworld/${enc(w)}/misses/`,
  miss: (w: string, n: number) => `microworld/${enc(w)}/misses/${pad(n)}`,
};

/** `microworld/<id>/<collection>/<member>` → its parts, or null for a key that is not one. */
export function parseKey(
  key: string,
): { microworldId: string; collection: string; member: string | null } | null {
  const parts = key.split('/');
  if (parts[0] !== 'microworld' || parts.length < 3) return null;
  return {
    microworldId: dec(parts[1]!),
    collection: parts[2]!,
    member: parts.length > 3 ? dec(parts.slice(3).join('/')) : null,
  };
}

// --- documents ↔ records --------------------------------------------------
//
// JSON carries no dates: the four date fields travel as ISO strings and
// come back through the record's own schema, so what an adapter reads is
// validated (§4.6: "a document adapter validates what it reads back").

const Counters = z.object({
  spawn: z.number().int().nonnegative(),
  actions: z.number().int().nonnegative(),
  misses: z.number().int().nonnegative(),
});
type Counters = z.infer<typeof Counters>;
const NO_COUNTERS: Counters = { spawn: 0, actions: 0, misses: 0 };

/** The objects document: the rows as ONE opaque string, never a map the backend would index. */
const ObjectsDoc = z.object({ blob: z.string() });

const dated = <T extends z.ZodObject>(schema: T, field: string) =>
  z.preprocess((doc) => {
    if (
      doc &&
      typeof doc === 'object' &&
      typeof (doc as Record<string, unknown>)[field] === 'string'
    ) {
      return { ...doc, [field]: new Date((doc as Record<string, string>)[field]!) };
    }
    return doc;
  }, schema);

const MicroworldDoc = dated(MicroworldRecord, 'loadedAt');
const ActorDoc = dated(ActorRecord, 'lastSeen');
const ActionDoc = dated(ActionRecord, 'at');
const MissDoc = dated(MissRecord, 'at');

function parseOr<T>(schema: z.ZodType<T>, doc: unknown, key: string): T {
  const r = schema.safeParse(doc);
  if (!r.success) throw new Error(`sprout-store-document: ${key} is not the record it should be`);
  return r.data;
}

const objectsOf = (doc: unknown, key: string): ObjectRecord[] => {
  if (doc === null) return [];
  const { blob } = parseOr(ObjectsDoc, doc, key);
  return parseOr(z.array(ObjectRecord), JSON.parse(blob), key);
};

/** A reader that answers each key and each prefix once: the snapshot a read turn sees. */
function memoised(under: DocumentReader): DocumentReader {
  const gets = new Map<string, Promise<unknown | null>>();
  const lists = new Map<string, Promise<string[]>>();
  return {
    get(key) {
      let p = gets.get(key);
      if (!p) {
        p = under.get(key);
        gets.set(key, p);
      }
      return p;
    },
    list(prefix) {
      let p = lists.get(prefix);
      if (!p) {
        p = under.list(prefix);
        lists.set(prefix, p);
      }
      return p;
    },
  };
}

/** The reads, over any reader — a snapshot for a read turn, the staging for a write turn. */
function reads(w: string, r: DocumentReader): Omit<ReadTx, 'touchActor'> {
  const each = async <T>(prefix: string, schema: z.ZodType<T>): Promise<T[]> => {
    const ks = await r.list(prefix);
    const docs = await Promise.all(ks.map((k) => r.get(k)));
    return docs.flatMap((d, i) => (d === null ? [] : [parseOr(schema, d, ks[i]!)]));
  };
  return {
    microworld: async () => {
      const doc = await r.get(keys.archive(w));
      return doc === null ? null : parseOr(MicroworldDoc, doc, keys.archive(w));
    },
    objects: async () => objectsOf(await r.get(keys.objects(w)), keys.objects(w)),
    actor: async (id) => {
      const doc = await r.get(keys.actor(w, id));
      return doc === null ? null : parseOr(ActorDoc, doc, keys.actor(w, id));
    },
    actorsIn: async (room, since) =>
      (await each(keys.actors(w), ActorDoc)).filter(
        (a) => a.roomId === room && a.lastSeen.getTime() >= since.getTime(),
      ),
    memory: async (actorId) => {
      const doc = await r.get(keys.memory(w, actorId));
      return doc === null
        ? { microworldId: w, actorId, byObject: {} }
        : parseOr(MemoryRecord, doc, keys.memory(w, actorId));
    },
    // Newest first is the collection's order reversed: the sequence in the key.
    actions: async ({ since, limit, faultedOnly }) =>
      (await each(keys.actions(w), ActionDoc))
        .filter((a) => (!since || a.at.getTime() >= since.getTime()) && (!faultedOnly || a.faulted))
        .slice(-limit)
        .reverse(),
    misses: async ({ limit }) => (await each(keys.misses(w), MissDoc)).slice(-limit).reverse(),
  };
}

/** The writes, staged on `tx`; the counters read once, inside. */
function writes(w: string, tx: DocumentWriter): StoreTx {
  let counters: Promise<Counters> | null = null;
  const count = async (): Promise<Counters> => {
    counters ??= tx
      .get(keys.counters(w))
      .then((doc) =>
        doc === null ? { ...NO_COUNTERS } : parseOr(Counters, doc, keys.counters(w)),
      );
    return counters;
  };
  const bump = async (field: keyof Counters): Promise<number> => {
    const c = await count();
    c[field] += 1;
    await tx.put(keys.counters(w), c);
    return c[field];
  };
  return {
    ...reads(w, tx),
    touchActor: async (id, lastSeen, drained) => {
      const doc = await tx.get(keys.actor(w, id));
      if (doc === null) return;
      const a = parseOr(ActorDoc, doc, keys.actor(w, id));
      await tx.put(keys.actor(w, id), { ...a, lastSeen, pending: drained ? [] : a.pending });
    },
    putMicroworld: async (m) => tx.put(keys.archive(w), m),
    nextSpawn: () => bump('spawn'),
    putObjects: async ({ upsert, remove }) => {
      const rows = new Map(
        objectsOf(await tx.get(keys.objects(w)), keys.objects(w)).map((o) => [o.id, o]),
      );
      for (const id of remove) rows.delete(id);
      for (const o of upsert) rows.set(o.id, o);
      await tx.put(keys.objects(w), { blob: JSON.stringify([...rows.values()]) });
    },
    clearObjects: async () => tx.put(keys.objects(w), { blob: '[]' }),
    putActor: async (a) => tx.put(keys.actor(w, a.id), a),
    putMemory: async (m) => tx.put(keys.memory(w, m.actorId), m),
    clearMemory: async (actorId) => tx.delete(keys.memory(w, actorId)),
    appendAction: async (a) => tx.put(keys.action(w, await bump('actions')), a),
    appendMiss: async (m) => tx.put(keys.miss(w, await bump('misses')), m),
  };
}

/** Every microworld id the backend holds a document for. */
async function microworldIds(backend: DocumentReader): Promise<string[]> {
  const ids = new Set<string>();
  for (const k of await backend.list('microworld/')) {
    const parsed = parseKey(k);
    if (parsed) ids.add(parsed.microworldId);
  }
  return [...ids].sort();
}

/** An actor's documents across every microworld: `[key, microworldId, collection]`. */
async function actorKeys(
  backend: DocumentReader,
  actorId: string,
): Promise<{ key: string; microworldId: string; collection: string }[]> {
  const out: { key: string; microworldId: string; collection: string }[] = [];
  for (const key of await backend.list('microworld/')) {
    const p = parseKey(key);
    if (p && p.member === actorId && (p.collection === 'actors' || p.collection === 'memory')) {
      out.push({ key, microworldId: p.microworldId, collection: p.collection });
    }
  }
  return out;
}

/** The store port over a document backend. */
export function documentStore(backend: DocumentBackend): SproutStore {
  return {
    transaction: (w, fn) => backend.transact([keys.objects(w)], (tx) => fn(writes(w, tx))),
    read: async (w, fn) => {
      const snapshot = memoised(backend);
      return fn({
        ...reads(w, snapshot),
        // The one write a read may make: the actor's own row, atomically, waiting on no turn.
        touchActor: (id, lastSeen, drained) =>
          backend.transact([keys.actor(w, id)], async (tx) => {
            const doc = await tx.get(keys.actor(w, id));
            if (doc === null) return;
            const a = parseOr(ActorDoc, doc, keys.actor(w, id));
            await tx.put(keys.actor(w, id), { ...a, lastSeen, pending: drained ? [] : a.pending });
          }),
      });
    },
    async trim(before, keepMisses) {
      for (const w of await microworldIds(backend)) {
        await backend.transact([keys.objects(w)], async (tx) => {
          for (const k of await tx.list(keys.actions(w))) {
            const doc = await tx.get(k);
            if (doc !== null && parseOr(ActionDoc, doc, k).at.getTime() < before.getTime()) {
              await tx.delete(k);
            }
          }
          const misses = await tx.list(keys.misses(w));
          for (const k of misses.slice(0, Math.max(0, misses.length - keepMisses))) {
            await tx.delete(k);
          }
        });
      }
    },
    destroyMicroworld: (w) =>
      backend.transact([keys.objects(w)], async (tx) => {
        for (const k of await tx.list(keys.microworld(w))) await tx.delete(k);
      }),
    async forgetActor(actorId) {
      for (const { key } of await actorKeys(backend, actorId)) await backend.delete(key);
    },
    async exportActor(actorId) {
      const out: ActorExport = { actorId, actors: [], memory: [] };
      for (const { key, collection } of await actorKeys(backend, actorId)) {
        const doc = await backend.get(key);
        if (doc === null) continue;
        if (collection === 'actors') out.actors.push(parseOr(ActorDoc, doc, key));
        else out.memory.push(parseOr(MemoryRecord, doc, key));
      }
      return out;
    },
  };
}
