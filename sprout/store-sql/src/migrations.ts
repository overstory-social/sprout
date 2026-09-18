// The `sprout` schema (the split proposal §5.1): one Postgres schema, one
// table per record type of the store port (@overstory/sprout-core §4.6),
// NO foreign key to anything of the host's — a namespace that makes that
// visible rather than conventional, and the eventual drop auditable. Ids
// are `text` (identifiers and spawn numbers); an actor id is whatever the
// host supplies, so `forgetActor` is served by an index, never a cascade.
//
// Migrations are EXPORTED, not copied: an ordered `{ name, sql }[]` and a
// runner. A host with its own migration ledger (Overstory) holds one
// checked-in migration that carries this SQL, and a gate spec compares
// that file with this export so a version bump that changes the schema
// fails the gate rather than production. The adapter checks the schema
// version on first use (`sqlStore({ …, schemaVersion })`), so a mismatch
// lands in a deploy smoke, not in a visitor's turn.

export interface SqlMigration {
  /** The identity a host records once applied, e.g. `sprout/001_sprout.sql`. */
  name: string;
  sql: string;
}

/** The schema version the current export produces; `sprout.meta` records it. */
export const SCHEMA_VERSION = 1;

export const migrations: readonly SqlMigration[] = [
  {
    name: 'sprout/001_sprout.sql',
    sql: `-- @overstory/sprout-store-sql 001 (schema version 1): the store port's seven
-- record types as tables, in their own schema. No foreign key to any host table.
CREATE SCHEMA IF NOT EXISTS sprout;

-- The schema version, checked by the adapter on first use.
CREATE TABLE sprout.meta (
  key text PRIMARY KEY,
  value text NOT NULL
);
INSERT INTO sprout.meta (key, value) VALUES ('schema_version', '1');

-- MicroworldRecord: the archive as last loaded (files + manifest), its
-- content stamp, the language level, the extensions, the limits — as JSON.
CREATE TABLE sprout.microworld (
  id text PRIMARY KEY,
  record jsonb NOT NULL,
  loaded_at timestamp with time zone NOT NULL
);

-- The spawn counter, off the row a turn reads: a spawn never leaves a
-- dead tuple on the microworld row.
CREATE TABLE sprout.spawn_counter (
  microworld_id text PRIMARY KEY,
  n integer NOT NULL DEFAULT 0
);

-- ObjectRecord: one live thing — a placed object by identifier (absent =
-- at home at its defaults) or a spawned instance. State and position.
CREATE TABLE sprout.object (
  microworld_id text NOT NULL,
  id text NOT NULL,
  spawned_from text,
  container text,
  home text,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (microworld_id, id)
);

-- ActorRecord: where a visitor stands, the name the host last supplied,
-- their last narration and noun, and the lines other actors' turns
-- queued for them. Indexed for actorsIn, and by actor for forgetActor.
CREATE TABLE sprout.actor (
  microworld_id text NOT NULL,
  id text NOT NULL,
  name text NOT NULL,
  room_id text,
  last_seen timestamp with time zone NOT NULL,
  narration jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_noun text,
  pending jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (microworld_id, id)
);
CREATE INDEX actor_room_idx ON sprout.actor (microworld_id, room_id, last_seen DESC);
CREATE INDEX actor_id_idx ON sprout.actor (id);

-- MemoryRecord: what each object remembers about one actor, by object id.
CREATE TABLE sprout.memory (
  microworld_id text NOT NULL,
  actor_id text NOT NULL,
  by_object jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (microworld_id, actor_id)
);
CREATE INDEX memory_actor_idx ON sprout.memory (actor_id);

-- ActionRecord: per write turn. NO actor column, by design.
CREATE TABLE sprout.action (
  id uuid PRIMARY KEY,
  microworld_id text NOT NULL,
  at timestamp with time zone NOT NULL,
  room_id text NOT NULL,
  command text NOT NULL,
  events integer NOT NULL,
  depth integer NOT NULL,
  spawned integer NOT NULL,
  faulted boolean NOT NULL,
  fault jsonb,
  missed boolean NOT NULL,
  duration_ms integer NOT NULL,
  lock_wait_ms integer NOT NULL
);
CREATE INDEX action_microworld_idx ON sprout.action (microworld_id, at DESC);
CREATE INDEX action_at_idx ON sprout.action (at);

-- MissRecord: a donated miss — against the microworld, never a person.
CREATE TABLE sprout.miss (
  id uuid PRIMARY KEY,
  microworld_id text NOT NULL,
  at timestamp with time zone NOT NULL,
  room_id text NOT NULL,
  input text NOT NULL,
  could_say jsonb NOT NULL,
  could_name jsonb NOT NULL,
  state jsonb NOT NULL
);
CREATE INDEX miss_microworld_idx ON sprout.miss (microworld_id, at DESC);
`,
  },
];

/**
 * What the runner needs of a client: `query(text, params)`, and `exec`
 * where the driver has one — PGlite runs `query` as a prepared statement,
 * one command at a time, and a migration is many; node-postgres runs a
 * parameterless `query` as a simple query that takes the whole file.
 */
export interface MigrationQuery {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  exec?(text: string): Promise<unknown>;
}

/**
 * Apply every migration not yet recorded in `sprout.meta` (as
 * `applied:<name>`), in order, each in its own transaction. For a host
 * without a migration ledger of its own — the CLI's PGlite, a test. A
 * host with a ledger applies the exported SQL through it instead.
 */
export async function runMigrations(
  client: MigrationQuery,
): Promise<{ applied: string[]; skipped: string[] }> {
  const applied: string[] = [];
  const skipped: string[] = [];
  const exists = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'sprout' AND table_name = 'meta'`,
  );
  const done = new Set<string>();
  if (exists.rows.length > 0) {
    const res = await client.query(`SELECT key FROM sprout.meta WHERE key LIKE 'applied:%'`);
    for (const row of res.rows as { key: string }[]) done.add(row.key.slice('applied:'.length));
  }
  for (const m of migrations) {
    if (done.has(m.name)) {
      skipped.push(m.name);
      continue;
    }
    await client.query('BEGIN');
    try {
      if (client.exec) await client.exec(m.sql);
      else await client.query(m.sql);
      await client.query(`INSERT INTO sprout.meta (key, value) VALUES ($1, 'applied')`, [
        `applied:${m.name}`,
      ]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`sprout-store-sql: migration ${m.name} failed: ${String(err)}`);
    }
    applied.push(m.name);
  }
  return { applied, skipped };
}

/** The schema version a database holds, or null when the schema is absent. */
export async function schemaVersionOf(client: MigrationQuery): Promise<number | null> {
  const exists = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'sprout' AND table_name = 'meta'`,
  );
  if (exists.rows.length === 0) return null;
  const res = await client.query(`SELECT value FROM sprout.meta WHERE key = 'schema_version'`);
  const row = res.rows[0] as { value?: unknown } | undefined;
  return row?.value == null ? null : Number(row.value);
}
