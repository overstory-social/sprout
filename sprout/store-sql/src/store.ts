import {
  MicroworldRecord,
  type ActionRecord,
  type ActorExport,
  type ActorRecord,
  type MemoryRecord,
  type MissRecord,
  type ObjectRecord,
  type ReadTx,
  type SproutStore,
  type StoreTx,
} from '@overstory/sprout/core';

import { SCHEMA_VERSION, schemaVersionOf } from './migrations.js';

// The SQL adapter (the split proposal §4.5, §4.6, §5.1): core's store port
// over the `sprout` schema, one record type per table, for node-postgres
// and PGlite alike — it needs `query(text, params)` and detects neither.
//
// The contract, as this adapter meets it:
//   1. A write transaction takes `pg_advisory_xact_lock(hashtext(id))` —
//      per microworld, exclusive, released with the transaction — so
//      write turns on one microworld serialize and reads never wait.
//   2. `fn` runs once here (Postgres does not re-run a transaction), and
//      writes land directly; the memory store proves the re-run rule.
//   3. A throw inside `fn` rolls the transaction back — the host's, when
//      the host supplied the client, so a host that wraps a turn with its
//      own writes keeps or loses them together (§4.5-3).
//   4. `SET LOCAL lock_timeout`: a stuck turn fails fast instead of
//      pinning a connection to a function timeout (§4.5-4).
//   5. The host may supply the transaction: `sqlStore({ client })` only
//      locks; `sqlStore({ transaction })` opens its own on a pooled client.
//   6. Housekeeping is set-based statements, not turns.
//
// Ids are text; the host's are whatever they are. Never join this schema
// to a host table in SQL (the natural spelling casts the host's column
// and walks into a sequential scan) — render the id in code and bind it.

/** What the adapter needs of a client: `query(text, params)` → rows. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface SqlStoreOptions {
  /** A client already inside the host's transaction (§4.5-5): the store only locks. */
  client?: Queryable;
  /** Otherwise: run `fn` inside a fresh transaction on a pooled client (BEGIN … COMMIT/ROLLBACK). */
  transaction?: <T>(fn: (client: Queryable) => Promise<T>) => Promise<T>;
  /**
   * The schema version the caller was built against; checked ONCE, on
   * first use, against `sprout.meta` — a mismatch throws with expected
   * and found, so it lands in a deploy smoke and not in a visitor's turn.
   * Default: this package's own.
   */
  schemaVersion?: number;
  /** How long a write waits for the microworld's lock before failing (§4.5-4). */
  lockTimeout?: string;
}

/** The default lock timeout (§4.5-4). */
export const LOCK_TIMEOUT = '5s';

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (v == null ? null : String(v));
const date = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const blob = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const rowsOf = (res: { rows: unknown[] }): Row[] => res.rows as Row[];

function objectOf(r: Row): ObjectRecord {
  return {
    microworldId: String(r.microworld_id),
    id: String(r.id),
    spawnedFrom: str(r.spawned_from),
    container: str(r.container),
    home: str(r.home),
    state: blob(r.state) as ObjectRecord['state'],
  };
}

function actorOf(r: Row): ActorRecord {
  return {
    microworldId: String(r.microworld_id),
    id: String(r.id),
    name: String(r.name),
    roomId: str(r.room_id),
    lastSeen: date(r.last_seen),
    narration: strings(r.narration),
    lastNoun: str(r.last_noun),
    pending: strings(r.pending),
  };
}

function memoryOf(r: Row): MemoryRecord {
  return {
    microworldId: String(r.microworld_id),
    actorId: String(r.actor_id),
    byObject: blob(r.by_object) as MemoryRecord['byObject'],
  };
}

function actionOf(r: Row): ActionRecord {
  return {
    microworldId: String(r.microworld_id),
    at: date(r.at),
    roomId: String(r.room_id),
    command: String(r.command),
    events: Number(r.events),
    depth: Number(r.depth),
    spawned: Number(r.spawned),
    faulted: r.faulted === true,
    fault: r.fault == null ? null : (r.fault as ActionRecord['fault']),
    missed: r.missed === true,
    durationMs: Number(r.duration_ms),
    lockWaitMs: Number(r.lock_wait_ms),
  };
}

function missOf(r: Row): MissRecord {
  return {
    microworldId: String(r.microworld_id),
    at: date(r.at),
    roomId: String(r.room_id),
    input: String(r.input),
    couldSay: strings(r.could_say),
    couldName: strings(r.could_name),
    state: r.state as MissRecord['state'],
  };
}

/** A row id for an append: no crypto import, no host clock — the row is never read by id. */
function rowId(): string {
  const hex = () =>
    Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, '0');
  const h = Array.from({ length: 8 }, hex).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** The reads over `c`, and the heartbeat — the one write a read may make. */
function reader(c: Queryable, microworldId: string): ReadTx {
  return {
    async microworld() {
      const res = await c.query(`SELECT record, loaded_at FROM sprout.microworld WHERE id = $1`, [
        microworldId,
      ]);
      const row = rowsOf(res)[0];
      if (!row) return null;
      return MicroworldRecord.parse({
        ...blob(row.record),
        id: microworldId,
        loadedAt: date(row.loaded_at),
      });
    },
    async objects() {
      const res = await c.query(
        `SELECT microworld_id, id, spawned_from, container, home, state
         FROM sprout.object WHERE microworld_id = $1 ORDER BY id ASC`,
        [microworldId],
      );
      return rowsOf(res).map(objectOf);
    },
    async actor(id) {
      const res = await c.query(
        `SELECT microworld_id, id, name, room_id, last_seen, narration, last_noun, pending
         FROM sprout.actor WHERE microworld_id = $1 AND id = $2`,
        [microworldId, id],
      );
      const row = rowsOf(res)[0];
      return row ? actorOf(row) : null;
    },
    async actorsIn(room, since) {
      const res = await c.query(
        `SELECT microworld_id, id, name, room_id, last_seen, narration, last_noun, pending
         FROM sprout.actor
         WHERE microworld_id = $1 AND room_id = $2 AND last_seen >= $3
         ORDER BY name ASC, id ASC`,
        [microworldId, room, since],
      );
      return rowsOf(res).map(actorOf);
    },
    async touchActor(id, lastSeen, drained) {
      await c.query(
        `UPDATE sprout.actor
         SET last_seen = $3, pending = CASE WHEN $4 THEN '[]'::jsonb ELSE pending END
         WHERE microworld_id = $1 AND id = $2`,
        [microworldId, id, lastSeen, drained],
      );
    },
    async memory(actorId) {
      const res = await c.query(
        `SELECT microworld_id, actor_id, by_object FROM sprout.memory
         WHERE microworld_id = $1 AND actor_id = $2`,
        [microworldId, actorId],
      );
      const row = rowsOf(res)[0];
      return row ? memoryOf(row) : { microworldId, actorId, byObject: {} };
    },
    async actions({ since, limit, faultedOnly }) {
      const res = await c.query(
        `SELECT microworld_id, at, room_id, command, events, depth, spawned, faulted, fault,
                missed, duration_ms, lock_wait_ms
         FROM sprout.action
         WHERE microworld_id = $1
           AND ($2::timestamptz IS NULL OR at >= $2)
           AND (NOT $3 OR faulted)
         ORDER BY at DESC, id DESC
         LIMIT $4`,
        [microworldId, since ?? null, faultedOnly === true, limit],
      );
      return rowsOf(res).map(actionOf);
    },
    async misses({ limit }) {
      const res = await c.query(
        `SELECT microworld_id, at, room_id, input, could_say, could_name, state
         FROM sprout.miss WHERE microworld_id = $1
         ORDER BY at DESC, id DESC
         LIMIT $2`,
        [microworldId, limit],
      );
      return rowsOf(res).map(missOf);
    },
  };
}

/** The writes over `c`, inside a transaction that holds the microworld's lock. */
function writer(c: Queryable, microworldId: string): StoreTx {
  return {
    ...reader(c, microworldId),
    async putMicroworld(m) {
      const { id: _id, loadedAt, ...record } = m;
      await c.query(
        `INSERT INTO sprout.microworld (id, record, loaded_at) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET record = EXCLUDED.record, loaded_at = EXCLUDED.loaded_at`,
        [microworldId, JSON.stringify(record), loadedAt],
      );
    },
    async nextSpawn() {
      const res = await c.query(
        `INSERT INTO sprout.spawn_counter (microworld_id, n) VALUES ($1, 1)
         ON CONFLICT (microworld_id) DO UPDATE SET n = sprout.spawn_counter.n + 1
         RETURNING n`,
        [microworldId],
      );
      return Number(rowsOf(res)[0]!.n);
    },
    async putObjects({ upsert, remove }) {
      if (remove.length > 0) {
        await c.query(
          `DELETE FROM sprout.object WHERE microworld_id = $1 AND id = ANY($2::text[])`,
          [microworldId, remove],
        );
      }
      if (upsert.length > 0) {
        // One statement, one jsonb parameter, however many rows (§5.1).
        await c.query(
          `INSERT INTO sprout.object (microworld_id, id, spawned_from, container, home, state)
           SELECT $1, e->>'id', e->>'spawnedFrom', e->>'container', e->>'home',
                  coalesce(e->'state', '{}'::jsonb)
           FROM jsonb_array_elements($2::jsonb) AS e
           ON CONFLICT (microworld_id, id) DO UPDATE
             SET spawned_from = EXCLUDED.spawned_from, container = EXCLUDED.container,
                 home = EXCLUDED.home, state = EXCLUDED.state`,
          [microworldId, JSON.stringify(upsert)],
        );
      }
    },
    async clearObjects() {
      await c.query(`DELETE FROM sprout.object WHERE microworld_id = $1`, [microworldId]);
    },
    async putActor(a) {
      await c.query(
        `INSERT INTO sprout.actor
           (microworld_id, id, name, room_id, last_seen, narration, last_noun, pending)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (microworld_id, id) DO UPDATE
           SET name = EXCLUDED.name, room_id = EXCLUDED.room_id, last_seen = EXCLUDED.last_seen,
               narration = EXCLUDED.narration, last_noun = EXCLUDED.last_noun,
               pending = EXCLUDED.pending`,
        [
          microworldId,
          a.id,
          a.name,
          a.roomId,
          a.lastSeen,
          JSON.stringify(a.narration),
          a.lastNoun,
          JSON.stringify(a.pending),
        ],
      );
    },
    async putMemory(m) {
      await c.query(
        `INSERT INTO sprout.memory (microworld_id, actor_id, by_object) VALUES ($1, $2, $3)
         ON CONFLICT (microworld_id, actor_id) DO UPDATE SET by_object = EXCLUDED.by_object`,
        [microworldId, m.actorId, JSON.stringify(m.byObject)],
      );
    },
    async clearMemory(actorId) {
      await c.query(`DELETE FROM sprout.memory WHERE microworld_id = $1 AND actor_id = $2`, [
        microworldId,
        actorId,
      ]);
    },
    async appendAction(a) {
      await c.query(
        `INSERT INTO sprout.action
           (id, microworld_id, at, room_id, command, events, depth, spawned, faulted, fault,
            missed, duration_ms, lock_wait_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          rowId(),
          microworldId,
          a.at,
          a.roomId,
          a.command,
          a.events,
          a.depth,
          a.spawned,
          a.faulted,
          a.fault ? JSON.stringify(a.fault) : null,
          a.missed,
          a.durationMs,
          a.lockWaitMs,
        ],
      );
    },
    async appendMiss(m) {
      await c.query(
        `INSERT INTO sprout.miss (id, microworld_id, at, room_id, input, could_say, could_name, state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          rowId(),
          microworldId,
          m.at,
          m.roomId,
          m.input,
          JSON.stringify(m.couldSay),
          JSON.stringify(m.couldName),
          JSON.stringify(m.state),
        ],
      );
    },
  };
}

/** Every table of a microworld, with the column that names it. */
const TABLES: readonly [table: string, column: string][] = [
  ['sprout.microworld', 'id'],
  ['sprout.spawn_counter', 'microworld_id'],
  ['sprout.object', 'microworld_id'],
  ['sprout.actor', 'microworld_id'],
  ['sprout.memory', 'microworld_id'],
  ['sprout.action', 'microworld_id'],
  ['sprout.miss', 'microworld_id'],
];

export function sqlStore(options: SqlStoreOptions): SproutStore {
  if (!options.client && !options.transaction) {
    throw new Error('sqlStore: a client or a transaction runner is required');
  }
  const expected = options.schemaVersion ?? SCHEMA_VERSION;
  const lockTimeout = options.lockTimeout ?? LOCK_TIMEOUT;
  let checked = false;
  /** The schema version, once: expected and found in the error when they differ. */
  const check = async (c: Queryable) => {
    if (checked) return;
    const found = await schemaVersionOf(c);
    if (found !== expected) {
      throw new Error(
        `sprout-store-sql: schema version ${expected} expected, ${found === null ? 'no sprout schema' : found} found`,
      );
    }
    checked = true;
  };
  /** Run `fn` on the host's client, or inside a transaction of our own. */
  const inTransaction = <T>(fn: (c: Queryable) => Promise<T>): Promise<T> =>
    options.client ? fn(options.client) : options.transaction!(fn);

  return {
    async transaction(microworldId, fn) {
      return inTransaction(async (c) => {
        await check(c);
        await c.query(`SET LOCAL lock_timeout = '${lockTimeout}'`);
        await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [microworldId]);
        return fn(writer(c, microworldId));
      });
    },
    async read(microworldId, fn) {
      if (options.client) {
        await check(options.client);
        return fn(reader(options.client, microworldId));
      }
      return options.transaction!(async (c) => {
        // A consistent snapshot for the read (§4.5-1) — the transaction's
        // FIRST statement, as Postgres requires; the heartbeat's write is
        // the actor's own row and never contended.
        await c.query(`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
        await check(c);
        return fn(reader(c, microworldId));
      });
    },
    async trim(before, keepMisses) {
      await inTransaction(async (c) => {
        await check(c);
        await c.query(`DELETE FROM sprout.action WHERE at < $1`, [before]);
        await c.query(
          `DELETE FROM sprout.miss WHERE id IN (
             SELECT id FROM (
               SELECT id, row_number() OVER (PARTITION BY microworld_id ORDER BY at DESC, id DESC) AS n
               FROM sprout.miss
             ) ranked WHERE n > $1
           )`,
          [keepMisses],
        );
      });
    },
    async destroyMicroworld(microworldId) {
      await inTransaction(async (c) => {
        await check(c);
        for (const [table, column] of TABLES) {
          await c.query(`DELETE FROM ${table} WHERE ${column} = $1`, [microworldId]);
        }
      });
    },
    async forgetActor(actorId) {
      await inTransaction(async (c) => {
        await check(c);
        await c.query(`DELETE FROM sprout.actor WHERE id = $1`, [actorId]);
        await c.query(`DELETE FROM sprout.memory WHERE actor_id = $1`, [actorId]);
      });
    },
    async exportActor(actorId) {
      return inTransaction(async (c): Promise<ActorExport> => {
        await check(c);
        const actors = await c.query(
          `SELECT microworld_id, id, name, room_id, last_seen, narration, last_noun, pending
           FROM sprout.actor WHERE id = $1 ORDER BY microworld_id ASC`,
          [actorId],
        );
        const memory = await c.query(
          `SELECT microworld_id, actor_id, by_object FROM sprout.memory
           WHERE actor_id = $1 ORDER BY microworld_id ASC`,
          [actorId],
        );
        return {
          actorId,
          actors: rowsOf(actors).map(actorOf),
          memory: rowsOf(memory).map(memoryOf),
        };
      });
    },
  };
}
