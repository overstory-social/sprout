import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { cannotProve, cases } from '@overstory/sprout/conformance';

import { runMigrations } from './migrations.js';
import { sqlStore, type Queryable } from './store.js';

// What PGlite cannot prove (`cannotProve`): real contention — one
// connection blocking another until commit — and a lock timeout FIRING
// rather than hanging. This runs against a real Postgres, a pool of
// connections, only where `DATABASE_URL` is set. It is the two conformance
// cases `conformance.spec.ts` skips by name, plus the timeout, on a
// store whose every transaction is its own connection.

/** The spec's default caps, as a publish under a host that set none of its own records them. */
const CAPS = {
  optionsPerEnum: 100,
  rolesPerVerb: 8,
  phrasesPerVerb: 8,
  phraseCharacters: 80,
  nounsPerObject: 8,
  nounCharacters: 40,
  exitsPerPlace: 8,
  listElements: 16,
  literalCharacters: 600,
  places: null,
  objects: null,
  kinds: null,
  files: null,
  sourceBytes: null,
};

const url = process.env['DATABASE_URL'];

interface Pool {
  connect(): Promise<Queryable & { release(): void }>;
  end(): Promise<void>;
}

const TABLES = ['microworld', 'spawn_counter', 'object', 'actor', 'memory', 'action', 'miss'];

describe.skipIf(!url)('sqlStore on a real Postgres (contention)', () => {
  let pool: Pool;
  beforeAll(async () => {
    // pg is a dev dependency of the workspace, loaded only where this runs.
    const { default: pg } = await import('pg');
    pool = new pg.Pool({ connectionString: url, max: 5 }) as unknown as Pool;
    const c = await pool.connect();
    try {
      await runMigrations(c);
    } finally {
      c.release();
    }
  }, 60_000);
  afterAll(async () => pool?.end());
  beforeEach(async () => {
    const c = await pool.connect();
    try {
      for (const t of TABLES) await c.query(`DELETE FROM sprout.${t}`);
    } finally {
      c.release();
    }
  });

  /** Every transaction on its own pooled connection: two turns can truly wait on each other. */
  const store = (lockTimeout?: string) =>
    sqlStore({
      lockTimeout,
      transaction: async (fn) => {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const out = await fn(c);
          await c.query('COMMIT');
          return out;
        } catch (err) {
          await c.query('ROLLBACK');
          throw err;
        } finally {
          c.release();
        }
      },
    });

  const needsTwo = cases.filter(
    (c) =>
      c.name === 'write turns on one microworld serialize; reads do not wait' ||
      c.name === 'a read is a snapshot',
  );
  it('the two cases exist to run', () => expect(needsTwo).toHaveLength(2));
  for (const c of needsTwo) {
    it(`${c.name} — ${c.proves}`, async () => {
      await c.run(store);
    }, 30_000);
  }

  it('a lock timeout fires rather than hanging: the second writer fails within the timeout', async () => {
    const s = store('300ms');
    await s.transaction('w', async (tx) =>
      tx.putMicroworld({
        id: 'w',
        archive: { files: [], manifest: null },
        stamp: 's',
        level: 1,
        extensions: [],
        caps: CAPS,
        excepted: false,
        loadedAt: new Date('2026-09-18T12:00:00Z'),
      }),
    );
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inside = new Promise<void>((r) => (entered = r));
    const first = s.transaction('w', async (tx) => {
      await tx.nextSpawn(); // takes the microworld's lock
      entered();
      await held;
    });
    await inside;
    const started = Date.now();
    await expect(s.transaction('w', async (tx) => tx.nextSpawn())).rejects.toThrow(
      /lock timeout|canceling statement/i,
    );
    expect(Date.now() - started).toBeLessThan(5000);
    release();
    await first;
  }, 30_000);

  it('is exactly what a single backend says it cannot prove', () => {
    expect(cannotProve).toEqual([
      'real contention: one connection blocking another until commit',
      'lock timeouts firing rather than hanging',
    ]);
  });
});
