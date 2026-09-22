// The document backend: five methods over any
// key → document database — a Map, IndexedDB, Firestore, Mongo, a Durable
// Object's storage. Keys are strings with `/` between segments; a
// document is anything JSON can carry. `transact` is what the store's
// write turn runs in: the keys named are LOCKED against every other
// `transact` naming any of them (serialized, in key order, so two
// transactions never deadlock), the writes made through the `tx` it
// hands `fn` land together or not at all when `fn` returns, and a
// backend MAY run `fn` more than once (Firestore and Mongo do on
// contention) — which is why core's port says a transaction body must
// have no effect outside the tx it is handed. Outside a transaction
// `put` and `delete` are single atomic writes, which is all a read's
// heartbeat needs.
//
// The tx handed to `fn` is how a backend tells this transaction's writes
// from a concurrent heartbeat's — Firestore's `runTransaction(fn(tx))`
// and an IndexedDB transaction have exactly this shape, which is the
// point of the port.

export interface DocumentReader {
  get(key: string): Promise<unknown | null>;
  /** Every key that starts with `prefix`, sorted. */
  list(prefix: string): Promise<string[]>;
}

export interface DocumentWriter extends DocumentReader {
  put(key: string, doc: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface DocumentBackend extends DocumentWriter {
  /**
   * Serialize on `keys`; the writes `fn` makes through `tx` are
   * all-or-nothing; `fn` may be run more than once.
   */
  transact<T>(keys: readonly string[], fn: (tx: DocumentWriter) => Promise<T>): Promise<T>;
}

// --- the pieces a backend is built from --------------------------------------

/** A JSON round trip: what a document database does to a value, so a caller never shares a reference with the store. */
export const cloneDoc = <T>(doc: T): T => JSON.parse(JSON.stringify(doc)) as T;

/**
 * In-process locks by key: one promise chain per key, acquired in sorted
 * order. What the memory backend serializes on, and what the IndexedDB
 * backend falls back to where the Web Locks API is not there (Node).
 */
export class KeyLocks {
  private readonly chains = new Map<string, Promise<void>>();

  /** Hold every key in `keys` while `fn` runs; released in any case. */
  async holding<T>(keys: readonly string[], fn: () => Promise<T>): Promise<T> {
    const sorted = [...new Set(keys)].sort();
    const releases: (() => void)[] = [];
    for (const key of sorted) {
      const previous = this.chains.get(key) ?? Promise.resolve();
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      const mine = previous.then(() => held);
      this.chains.set(key, mine);
      await previous;
      releases.push(() => {
        release();
        if (this.chains.get(key) === mine) this.chains.delete(key);
      });
    }
    try {
      return await fn();
    } finally {
      for (const r of releases) r();
    }
  }
}

/**
 * Writes staged over a reader: what `transact` hands `fn`. A get sees the
 * staged value first; a list merges staged keys in; `commit` says what
 * to apply, in order, and nothing lands until it is asked for.
 */
export class Staging implements DocumentWriter {
  private readonly staged = new Map<string, unknown | null>();

  constructor(private readonly under: DocumentReader) {}

  async get(key: string): Promise<unknown | null> {
    if (this.staged.has(key)) {
      const v = this.staged.get(key);
      return v === null ? null : cloneDoc(v);
    }
    return this.under.get(key);
  }

  async list(prefix: string): Promise<string[]> {
    const keys = new Set(await this.under.list(prefix));
    for (const [key, v] of this.staged) {
      if (!key.startsWith(prefix)) continue;
      if (v === null) keys.delete(key);
      else keys.add(key);
    }
    return [...keys].sort();
  }

  async put(key: string, doc: unknown): Promise<void> {
    this.staged.set(key, cloneDoc(doc));
  }

  async delete(key: string): Promise<void> {
    this.staged.set(key, null);
  }

  /** The writes, in the order they were made: a document, or null for a delete. */
  get writes(): ReadonlyMap<string, unknown | null> {
    return this.staged;
  }
}

// --- the memory backend ------------------------------------------------------

/** A Map and a lock per key: tests, and the CLI's `--store memory`. */
export function memoryBackend(): DocumentBackend & { readonly size: number } {
  const docs = new Map<string, string>();
  const locks = new KeyLocks();
  const reader: DocumentReader = {
    get: async (key) => {
      const raw = docs.get(key);
      return raw === undefined ? null : (JSON.parse(raw) as unknown);
    },
    list: async (prefix) => [...docs.keys()].filter((k) => k.startsWith(prefix)).sort(),
  };
  return {
    ...reader,
    get size() {
      return docs.size;
    },
    put: async (key, doc) => {
      docs.set(key, JSON.stringify(doc));
    },
    delete: async (key) => {
      docs.delete(key);
    },
    transact: (keys, fn) =>
      locks.holding(keys, async () => {
        const tx = new Staging(reader);
        const out = await fn(tx);
        for (const [key, v] of tx.writes) {
          if (v === null) docs.delete(key);
          else docs.set(key, JSON.stringify(v));
        }
        return out;
      }),
  };
}
