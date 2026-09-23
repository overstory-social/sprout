import { z } from 'zod';

import {
  ActionRecord,
  MicroworldRecord,
  MissRecord,
  StoredInstanceSchema,
  StoredVisitorSchema,
  applyChanges,
  applyForgetting,
  codeUnitOrder,
  forgetting,
  visitorIn,
  type ReadTx,
  type SproutStore,
  type StoredState,
  type StoreTx,
  type VisitorExport,
} from '@overstory/sprout/core';

import type { DocumentBackend, DocumentReader, DocumentWriter } from './backend.js';

// The store port over a document backend. The layout is split along the
// WRITE-RATE seam, not the read seam: a world's instances and tombstones
// are one document written only when a turn changes something, held as
// an opaque serialized string (a map of two thousand small records would
// blow a document database's index-entry ceiling); each visitor is a
// small document of its own, found by its visit; the archive is one; and
// actions and misses are COLLECTIONS, one document per record, never a
// dated document appended to. Serialization is `transact` on the state
// key; atomicity is the backend's single commit; re-entrancy is core's
// re-run rule, which is why every number a turn issues (the serial, a
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
  state: (w: string) => `microworld/${enc(w)}/state`,
  counters: (w: string) => `microworld/${enc(w)}/counters`,
  visitors: (w: string) => `microworld/${enc(w)}/visitors/`,
  visitor: (w: string, visit: string) => `microworld/${enc(w)}/visitors/${enc(visit)}`,
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
// JSON carries no dates: the date fields travel as ISO strings and come
// back through the record's own schema, so what an adapter reads is
// validated.

const Counters = z.object({
  serial: z.number().int().nonnegative(),
  actions: z.number().int().nonnegative(),
  misses: z.number().int().nonnegative(),
});
type Counters = z.infer<typeof Counters>;
const NO_COUNTERS: Counters = { serial: 0, actions: 0, misses: 0 };

/** The state document: instances and tombstones as ONE opaque string, never a map the backend would index. */
const StateDoc = z.object({ blob: z.string() });
const StateBlob = z.object({
  instances: z.array(StoredInstanceSchema),
  tombstones: z.array(z.string()),
});
type StateBlob = z.infer<typeof StateBlob>;

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
const ActionDoc = dated(ActionRecord, 'at');
const MissDoc = dated(MissRecord, 'at');

function parseOr<T>(schema: z.ZodType<T>, doc: unknown, key: string): T {
  const r = schema.safeParse(doc);
  if (!r.success) throw new Error(`sprout-store-document: ${key} is not the record it should be`);
  return r.data;
}

const blobOf = (doc: unknown, key: string): StateBlob => {
  if (doc === null) return { instances: [], tombstones: [] };
  const { blob } = parseOr(StateDoc, doc, key);
  return parseOr(StateBlob, JSON.parse(blob), key);
};

const countersOf = (doc: unknown, key: string): Counters =>
  doc === null ? { ...NO_COUNTERS } : parseOr(Counters, doc, key);

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

/** Every document under `prefix`, each checked by `schema`. */
async function each<T>(r: DocumentReader, prefix: string, schema: z.ZodType<T>): Promise<T[]> {
  const ks = await r.list(prefix);
  const docs = await Promise.all(ks.map((k) => r.get(k)));
  return docs.flatMap((d, i) => (d === null ? [] : [parseOr(schema, d, ks[i]!)]));
}

/** A world's whole stored state over `r`, each list in code-unit order. */
async function stateOf(w: string, r: DocumentReader): Promise<StoredState> {
  const { instances, tombstones } = blobOf(await r.get(keys.state(w)), keys.state(w));
  const { serial } = countersOf(await r.get(keys.counters(w)), keys.counters(w));
  const visitors = await each(r, keys.visitors(w), StoredVisitorSchema);
  return {
    serial,
    instances: instances.sort((a, b) => codeUnitOrder(a.id, b.id)),
    visitors: visitors.sort((a, b) => codeUnitOrder(a.visit, b.visit)),
    tombstones: tombstones.sort(codeUnitOrder),
  };
}

/** The state document holding `state`'s instances and tombstones. */
function stateDoc(state: StoredState): { blob: string } {
  const blob: StateBlob = { instances: state.instances, tombstones: state.tombstones };
  return { blob: JSON.stringify(blob) };
}

/** The reads, over any reader — a snapshot for a read turn, the staging for a write turn. */
function reads(w: string, r: DocumentReader): ReadTx {
  return {
    microworld: async () => {
      const doc = await r.get(keys.archive(w));
      return doc === null ? null : parseOr(MicroworldDoc, doc, keys.archive(w));
    },
    state: () => stateOf(w, r),
    // Newest first is the collection's order reversed: the sequence in the key.
    actions: async ({ since, limit, faultedOnly }) =>
      (await each(r, keys.actions(w), ActionDoc))
        .filter((a) => (!since || a.at.getTime() >= since.getTime()) && (!faultedOnly || a.faulted))
        .slice(-limit)
        .reverse(),
    misses: async ({ limit }) => (await each(r, keys.misses(w), MissDoc)).slice(-limit).reverse(),
  };
}

/** The writes, staged on `tx`; the counters read once, inside. */
function writes(w: string, tx: DocumentWriter): StoreTx {
  let counters: Promise<Counters> | null = null;
  const count = async (): Promise<Counters> => {
    counters ??= tx.get(keys.counters(w)).then((doc) => countersOf(doc, keys.counters(w)));
    return counters;
  };
  const bump = async (field: 'actions' | 'misses'): Promise<number> => {
    const c = await count();
    c[field] += 1;
    await tx.put(keys.counters(w), c);
    return c[field];
  };
  return {
    ...reads(w, tx),
    putMicroworld: async (m) => tx.put(keys.archive(w), m),
    // The state document and the counters, and only the visitor documents the turn wrote.
    putState: async (changes) => {
      const c = await count();
      await tx.put(keys.state(w), stateDoc(applyChanges(await stateOf(w, tx), changes)));
      for (const v of changes.visitors) await tx.put(keys.visitor(w, v.visit), v);
      c.serial = changes.serial;
      await tx.put(keys.counters(w), c);
    },
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
  return [...ids].sort(codeUnitOrder);
}

/** Every microworld holding a visitor document for `visit`, in code-unit order. */
async function worldsHolding(backend: DocumentReader, visit: string): Promise<string[]> {
  const out = new Set<string>();
  for (const key of await backend.list('microworld/')) {
    const p = parseKey(key);
    if (p && p.collection === 'visitors' && p.member === visit) out.add(p.microworldId);
  }
  return [...out].sort(codeUnitOrder);
}

/** The store port over a document backend. */
export function documentStore(backend: DocumentBackend): SproutStore {
  return {
    transaction: (w, fn) => backend.transact([keys.state(w)], (tx) => fn(writes(w, tx))),
    read: async (w, fn) => fn(reads(w, memoised(backend))),
    async trim(before, keepMisses) {
      for (const w of await microworldIds(backend)) {
        await backend.transact([keys.state(w)], async (tx) => {
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
      backend.transact([keys.state(w)], async (tx) => {
        for (const k of await tx.list(keys.microworld(w))) await tx.delete(k);
      }),
    // Each world under its state key, as a write turn holds it, so a turn
    // that read the visitor's memory cannot write it back afterwards.
    async forgetVisitor(visit) {
      for (const w of await worldsHolding(backend, visit)) {
        await backend.transact([keys.state(w)], async (tx) => {
          const state = await stateOf(w, tx);
          const change = forgetting(state, visit);
          if (change === null) return;
          await tx.put(keys.state(w), stateDoc(applyForgetting(state, change)));
          await tx.delete(keys.visitor(w, visit));
        });
      }
    },
    async exportVisitor(visit) {
      const out: VisitorExport = { visit, worlds: [] };
      for (const w of await worldsHolding(backend, visit)) {
        const found = await backend.transact([keys.state(w)], async (tx) =>
          visitorIn(w, await stateOf(w, tx), visit),
        );
        if (found) out.worlds.push(found);
      }
      return out;
    },
  };
}
