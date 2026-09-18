import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { cannotProve, cases } from '@overstory/sprout-core/conformance';

import { SCHEMA_VERSION, migrations, runMigrations, schemaVersionOf } from './migrations.js';
import { sqlStore, type Queryable } from './store.js';

// The adapter against real Postgres — PGlite, in this process, no daemon
// — running core's conformance suite (the split proposal §4.6): every
// round-trip, atomicity, isolation by microworld, housekeeping. What one
// backend cannot prove is what PGlite cannot do — one connection, one
// queue: the two cases that need a transaction to WAIT on another would
// deadlock here and are skipped by name; `cannotProve` names what is
// proved once against a containerised Postgres in CI instead.

const NEEDS_TWO_BACKENDS = new Set([
  'write turns on one microworld serialize; reads do not wait',
  'a read is a snapshot',
]);

let db: PGlite;

beforeAll(async () => {
  db = await PGlite.create();
  await runMigrations(db);
});
afterAll(() => db.close());
beforeEach(async () => {
  for (const t of ['microworld', 'spawn_counter', 'object', 'actor', 'memory', 'action', 'miss']) {
    await db.query(`DELETE FROM sprout.${t}`);
  }
});

/** PGlite is one connection: a transaction is BEGIN … COMMIT on it. */
function store() {
  return sqlStore({
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
  });
}

describe('the migrations', () => {
  it('apply once, record themselves, and set the schema version', async () => {
    expect(await schemaVersionOf(db)).toBe(SCHEMA_VERSION);
    const again = await runMigrations(db);
    expect(again).toEqual({ applied: [], skipped: migrations.map((m) => m.name) });
  });

  it('the adapter refuses a schema it was not built for, with expected and found', async () => {
    const wrong = sqlStore({ client: db as unknown as Queryable, schemaVersion: 99 });
    await expect(wrong.read('w', async () => 1)).rejects.toThrow(
      /schema version 99 expected, 1 found/,
    );
    const fresh = await PGlite.create();
    const absent = sqlStore({ client: fresh as unknown as Queryable });
    await expect(absent.read('w', async () => 1)).rejects.toThrow(/no sprout schema found/);
    await fresh.close();
  });
});

describe('sqlStore passes the conformance suite on PGlite', () => {
  for (const c of cases) {
    if (NEEDS_TWO_BACKENDS.has(c.name)) {
      it.skip(`${c.name} — needs two backends; PGlite has one`, () => undefined);
      continue;
    }
    it(`${c.name} — ${c.proves}`, async () => {
      await c.run(store);
    });
  }

  it('says what a single backend cannot prove', () => {
    expect(cannotProve).toEqual([
      'real contention: one connection blocking another until commit',
      'lock timeouts firing rather than hanging',
    ]);
  });

  it('a host-supplied client: the lock is transaction-scoped, and the host’s rollback takes core’s writes with it', async () => {
    await db.query('BEGIN');
    const bound = sqlStore({ client: db as unknown as Queryable });
    await bound.transaction('w', async (tx) => {
      await tx.putActor({
        microworldId: 'w',
        id: 'v',
        name: 'vera',
        roomId: 'hall',
        lastSeen: new Date('2026-09-18T12:00:00Z'),
        narration: [],
        lastNoun: null,
        pending: [],
      });
    });
    const held = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()`,
    );
    expect(held.rows[0]!.n).toBeGreaterThanOrEqual(1);
    await db.query('ROLLBACK');
    await store().read('w', async (tx) => expect(await tx.actor('v')).toBeNull());
  });
});
