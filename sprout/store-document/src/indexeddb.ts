import { KeyLocks, Staging, type DocumentBackend, type DocumentReader } from './backend.js';

// IndexedDB: a single-player microworld in a
// browser tab, no server at all. One object store of `{ key, doc }`
// rows; `list` is a key range on the prefix. Serialization is the Web
// Locks API where the page has it — held across every tab of the origin
// — and an in-process lock where it does not (Node under test). Writes
// are staged while `fn` runs and land in ONE readwrite transaction when
// it returns, because an IndexedDB transaction closes the moment the
// event loop turns with nothing pending on it, and a turn's body awaits
// things that are not requests on it.

const STORE = 'documents';

/** Everything with this prefix: `[prefix, prefix + U+FFFF)` covers every continuation. */
function rangeOf(prefix: string): IDBKeyRange {
  return IDBKeyRange.bound(prefix, `${prefix}￿`, false, true);
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

interface Row {
  key: string;
  doc: string;
}

/** The two methods of the Web Locks API's `LockManager` this backend uses. */
export interface Locks {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export interface IndexedDbBackendOptions {
  /** The `indexedDB` to use; the global by default (a test hands in fake-indexeddb's). */
  factory?: IDBFactory;
  /**
   * What serializes transactions across the origin's tabs: `navigator.locks`
   * when the page has it (the default), else an in-process lock. Pass
   * `null` to insist on the in-process one.
   */
  locks?: Locks | null;
}

/**
 * A document backend on the IndexedDB database `name`, opened on first
 * use. `close()` releases the connection (a test that opens many).
 */
export function indexedDbBackend(
  name: string,
  options: IndexedDbBackendOptions = {},
): DocumentBackend & { close(): Promise<void> } {
  const factory = options.factory ?? globalThis.indexedDB;
  const locks = new KeyLocks();
  let opening: Promise<IDBDatabase> | null = null;
  const db = (): Promise<IDBDatabase> => {
    opening ??= new Promise((resolve, reject) => {
      const req = factory.open(name, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error(`IndexedDB: cannot open ${name}`));
    });
    return opening;
  };

  const reader: DocumentReader = {
    async get(key) {
      const row = await request<Row | undefined>(
        (await db()).transaction(STORE, 'readonly').objectStore(STORE).get(key),
      );
      return row === undefined ? null : (JSON.parse(row.doc) as unknown);
    },
    async list(prefix) {
      const keys = await request<IDBValidKey[]>(
        (await db()).transaction(STORE, 'readonly').objectStore(STORE).getAllKeys(rangeOf(prefix)),
      );
      return keys.map(String).sort();
    },
  };

  /** Hold `keys` across every tab of the origin where the page can, else in this process. */
  const manager: Locks | null =
    options.locks === undefined
      ? ((globalThis as { navigator?: { locks?: Locks } }).navigator?.locks ?? null)
      : options.locks;
  const holding = async <T>(keys: readonly string[], fn: () => Promise<T>): Promise<T> => {
    if (!manager) return locks.holding(keys, fn);
    const sorted = [...new Set(keys)].sort();
    const nest = async (i: number): Promise<T> =>
      i === sorted.length
        ? fn()
        : manager.request(`sprout-store-document:${name}:${sorted[i]}`, () => nest(i + 1));
    return nest(0);
  };

  return {
    ...reader,
    async put(key, doc) {
      const tx = (await db()).transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ key, doc: JSON.stringify(doc) } satisfies Row);
      await done(tx);
    },
    async delete(key) {
      const tx = (await db()).transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      await done(tx);
    },
    transact: (keys, fn) =>
      holding(keys, async () => {
        const staged = new Staging(reader);
        const out = await fn(staged);
        if (staged.writes.size > 0) {
          const tx = (await db()).transaction(STORE, 'readwrite');
          const store = tx.objectStore(STORE);
          for (const [key, v] of staged.writes) {
            if (v === null) store.delete(key);
            else store.put({ key, doc: JSON.stringify(v) } satisfies Row);
          }
          await done(tx);
        }
        return out;
      }),
    async close() {
      if (!opening) return;
      (await opening).close();
      opening = null;
    },
  };
}
