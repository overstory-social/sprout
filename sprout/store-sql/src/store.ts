import {
  MicroworldRecord,
  StoredInstanceSchema,
  StoredVisitorSchema,
  codeUnitOrder,
  emptyState,
  forgetting,
  visitorIn,
  type ActionRecord,
  type MissRecord,
  type ReadTx,
  type SproutStore,
  type StoredInstance,
  type StoredState,
  type StoreTx,
  type VisitorExport,
} from '@overstory/sprout/core';

import { SCHEMA_VERSION, schemaVersionOf } from './migrations.js';

// The SQL adapter: core's store port over the `sprout` schema, for
// node-postgres and PGlite alike — it needs `query(text, params)` and
// detects neither. A world's state is a table per part of the stored
// form, an instance's memory a row per actor; what is read back is
// checked by the language's schema for its record, and handed back in
// code-unit order, which a collation does not promise.
//
// The contract, as this adapter meets it:
//   1. A write transaction takes `pg_advisory_xact_lock(hashtext(id))` —
//      per microworld, exclusive, released with the transaction — so
//      write turns on one microworld serialize and reads never wait.
//   2. `fn` runs once here (Postgres does not re-run a transaction), and
//      writes land directly; the memory store proves the re-run rule.
//   3. A throw inside `fn` rolls the transaction back — the host's, when
//      the host supplied the client, so a host that wraps a turn with its
//      own writes keeps or loses them together.
//   4. `SET LOCAL lock_timeout`: a stuck turn fails fast instead of
//      pinning a connection to a function timeout.
//   5. The host may supply the transaction: `sqlStore({ client })` only
//      locks; `sqlStore({ transaction })` opens its own on a pooled client.
//   6. Housekeeping is set-based statements, not turns; forgetting a
//      visitor takes each world's lock, as a write turn does.
//
// Ids are text; the host's are whatever they are. Never join this schema
// to a host table in SQL (the natural spelling casts the host's column
// and walks into a sequential scan) — render the id in code and bind it.

/** What the adapter needs of a client: `query(text, params)` → rows. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface SqlStoreOptions {
  /** A client already inside the host's transaction: the store only locks. */
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
  /** How long a write waits for the microworld's lock before failing. */
  lockTimeout?: string;
}

/** The default lock timeout. */
export const LOCK_TIMEOUT = '5s';

type Row = Record<string, unknown>;

const date = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const blob = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const rowsOf = (res: { rows: unknown[] }): Row[] => res.rows as Row[];
/** A bigint column as a number; node-postgres hands one back as text. */
const whole = (v: unknown): number | null => (v == null ? null : Number(v));
const byId = (a: { id: string }, b: { id: string }) => codeUnitOrder(a.id, b.id);

/** One instance row and its memory rows, checked as the language's record. */
function instanceOf(r: Row, memory: Row[]): StoredInstance {
  return StoredInstanceSchema.parse({
    id: r.id,
    made: r.made,
    container: r.container ?? null,
    arrival: whole(r.arrival),
    properties: r.properties,
    links: r.links,
    wakes: r.wakes,
    memory: Object.fromEntries(
      memory
        .map((m) => [String(m.actor_id), m.properties] as const)
        .sort(([a], [b]) => codeUnitOrder(a, b)),
    ),
    lastTick: whole(r.last_tick),
  });
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
  const state = blob(r.state);
  return {
    microworldId: String(r.microworld_id),
    at: date(r.at),
    roomId: String(r.room_id),
    input: String(r.input),
    couldSay: strings(r.could_say),
    couldName: strings(r.could_name),
    state: {
      room: StoredInstanceSchema.parse(state.room),
      items: Array.isArray(state.items)
        ? state.items.map((i) => StoredInstanceSchema.parse(i))
        : [],
    },
  };
}

/** A world's whole stored state over `c`: its serial, every instance with its memory, its visitors and tombstones. */
async function stateOf(c: Queryable, microworldId: string): Promise<StoredState> {
  const serial = rowsOf(
    await c.query(`SELECT serial FROM sprout.serial WHERE microworld_id = $1`, [microworldId]),
  )[0];
  const instances = rowsOf(
    await c.query(
      `SELECT id, made, container, arrival, properties, links, wakes, last_tick
       FROM sprout.instance WHERE microworld_id = $1`,
      [microworldId],
    ),
  );
  const memory = rowsOf(
    await c.query(
      `SELECT instance_id, actor_id, properties FROM sprout.memory WHERE microworld_id = $1`,
      [microworldId],
    ),
  );
  const visitors = rowsOf(
    await c.query(
      `SELECT visit, nickname, instance, last_place FROM sprout.visitor WHERE microworld_id = $1`,
      [microworldId],
    ),
  );
  const tombstones = rowsOf(
    await c.query(`SELECT id FROM sprout.tombstone WHERE microworld_id = $1`, [microworldId]),
  );
  if (!serial && instances.length === 0 && visitors.length === 0 && tombstones.length === 0) {
    return emptyState();
  }
  const remembered = new Map<string, Row[]>();
  for (const m of memory) {
    const id = String(m.instance_id);
    remembered.set(id, [...(remembered.get(id) ?? []), m]);
  }
  return {
    serial: whole(serial?.serial) ?? 0,
    instances: instances.map((r) => instanceOf(r, remembered.get(String(r.id)) ?? [])).sort(byId),
    visitors: visitors
      .map((r) =>
        StoredVisitorSchema.parse({
          visit: r.visit,
          nickname: r.nickname,
          instance: r.instance,
          lastPlace: r.last_place ?? null,
        }),
      )
      .sort((a, b) => codeUnitOrder(a.visit, b.visit)),
    tombstones: tombstones.map((r) => String(r.id)).sort(codeUnitOrder),
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

/** The reads over `c`. */
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
    state: () => stateOf(c, microworldId),
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
    async putState({ serial, upsert, remove, tombstones, visitors }) {
      await c.query(
        `INSERT INTO sprout.serial (microworld_id, serial) VALUES ($1, $2)
         ON CONFLICT (microworld_id) DO UPDATE SET serial = EXCLUDED.serial`,
        [microworldId, serial],
      );
      // An upserted record is written whole, so its memory rows go with
      // the removed ones' and come back from the record.
      const replaced = [...remove, ...upsert.map((i) => i.id)];
      if (replaced.length > 0) {
        await c.query(
          `DELETE FROM sprout.memory WHERE microworld_id = $1 AND instance_id = ANY($2::text[])`,
          [microworldId, replaced],
        );
      }
      if (remove.length > 0) {
        await c.query(
          `DELETE FROM sprout.instance WHERE microworld_id = $1 AND id = ANY($2::text[])`,
          [microworldId, remove],
        );
      }
      if (upsert.length > 0) {
        // One statement, one jsonb parameter, however many records.
        await c.query(
          `INSERT INTO sprout.instance
             (microworld_id, id, made, container, arrival, properties, links, wakes, last_tick)
           SELECT $1, e->>'id', e->'made', e->>'container', (e->>'arrival')::bigint,
                  e->'properties', e->'links', e->'wakes', (e->>'lastTick')::bigint
           FROM jsonb_array_elements($2::jsonb) AS e
           ON CONFLICT (microworld_id, id) DO UPDATE
             SET made = EXCLUDED.made, container = EXCLUDED.container,
                 arrival = EXCLUDED.arrival, properties = EXCLUDED.properties,
                 links = EXCLUDED.links, wakes = EXCLUDED.wakes, last_tick = EXCLUDED.last_tick`,
          [microworldId, JSON.stringify(upsert)],
        );
        await c.query(
          `INSERT INTO sprout.memory (microworld_id, instance_id, actor_id, properties)
           SELECT $1, e->>'id', m.key, m.value
           FROM jsonb_array_elements($2::jsonb) AS e, jsonb_each(e->'memory') AS m`,
          [microworldId, JSON.stringify(upsert)],
        );
      }
      if (tombstones.length > 0) {
        await c.query(
          `INSERT INTO sprout.tombstone (microworld_id, id)
           SELECT $1, t FROM unnest($2::text[]) AS t
           ON CONFLICT (microworld_id, id) DO NOTHING`,
          [microworldId, tombstones],
        );
      }
      if (visitors.length > 0) {
        await c.query(
          `INSERT INTO sprout.visitor (microworld_id, visit, nickname, instance, last_place)
           SELECT $1, e->>'visit', e->>'nickname', e->>'instance', e->>'lastPlace'
           FROM jsonb_array_elements($2::jsonb) AS e
           ON CONFLICT (microworld_id, visit) DO UPDATE
             SET nickname = EXCLUDED.nickname, instance = EXCLUDED.instance,
                 last_place = EXCLUDED.last_place`,
          [microworldId, JSON.stringify(visitors)],
        );
      }
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
  ['sprout.serial', 'microworld_id'],
  ['sprout.instance', 'microworld_id'],
  ['sprout.memory', 'microworld_id'],
  ['sprout.visitor', 'microworld_id'],
  ['sprout.tombstone', 'microworld_id'],
  ['sprout.action', 'microworld_id'],
  ['sprout.miss', 'microworld_id'],
];

/** Every microworld holding `visit`, in code-unit order. */
async function worldsHolding(c: Queryable, visit: string): Promise<string[]> {
  const res = await c.query(`SELECT microworld_id FROM sprout.visitor WHERE visit = $1`, [visit]);
  return rowsOf(res)
    .map((r) => String(r.microworld_id))
    .sort(codeUnitOrder);
}

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
        // A consistent snapshot for the read — the transaction's
        // FIRST statement, as Postgres requires.
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
        await c.query(`SET LOCAL lock_timeout = '${lockTimeout}'`);
        await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [microworldId]);
        for (const [table, column] of TABLES) {
          await c.query(`DELETE FROM ${table} WHERE ${column} = $1`, [microworldId]);
        }
      });
    },
    async forgetVisitor(visit) {
      await inTransaction(async (c) => {
        await check(c);
        const worlds = await worldsHolding(c, visit);
        await c.query(`SET LOCAL lock_timeout = '${lockTimeout}'`);
        // Each world's write lock, in one order, so a forget and a turn
        // never deadlock and a turn cannot write back what this takes.
        for (const microworldId of worlds) {
          await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [microworldId]);
        }
        for (const microworldId of worlds) {
          const change = forgetting(await stateOf(c, microworldId), visit);
          if (change === null) continue;
          await c.query(
            `DELETE FROM sprout.memory WHERE microworld_id = $1
               AND (actor_id = $2 OR instance_id = ANY($3::text[]))`,
            [microworldId, change.visitor.instance, change.remove],
          );
          await c.query(
            `DELETE FROM sprout.instance WHERE microworld_id = $1 AND id = ANY($2::text[])`,
            [microworldId, change.remove],
          );
          await c.query(`DELETE FROM sprout.visitor WHERE microworld_id = $1 AND visit = $2`, [
            microworldId,
            visit,
          ]);
        }
      });
    },
    async exportVisitor(visit) {
      return inTransaction(async (c): Promise<VisitorExport> => {
        await check(c);
        const out: VisitorExport = { visit, worlds: [] };
        for (const microworldId of await worldsHolding(c, visit)) {
          const found = visitorIn(microworldId, await stateOf(c, microworldId), visit);
          if (found) out.worlds.push(found);
        }
        return out;
      });
    },
  };
}
