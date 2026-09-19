import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { memoryStore, type SproutStore } from '@overstory/sprout-core';
import { runMigrations, sqlStore, type Queryable } from '@overstory/sprout-store-sql';

// Where a play keeps its state (the split proposal §6): `.sprout/db`
// beside the folder, a PGlite database through `@overstory/sprout-store-sql`
// — so a session survives the process — or core's memory store, for a
// run that leaves nothing behind (`--store memory`, and the specs).

export type StoreKind = 'pglite' | 'memory';

export interface OpenStore {
  store: SproutStore;
  close(): Promise<void>;
}

export async function openStore(kind: StoreKind, stateDir: string): Promise<OpenStore> {
  if (kind === 'memory') return { store: memoryStore(), close: async () => undefined };
  mkdirSync(stateDir, { recursive: true });
  const db = await PGlite.create(join(stateDir, 'db'));
  await runMigrations(db);
  return {
    // PGlite is one connection: a transaction is BEGIN … COMMIT on it.
    store: sqlStore({
      transaction: async (fn) => {
        await db.query('BEGIN');
        try {
          const out = await fn(db as unknown as Queryable);
          await db.query('COMMIT');
          return out;
        } catch (err) {
          await db.query('ROLLBACK');
          throw err;
        }
      },
    }),
    close: () => db.close(),
  };
}
