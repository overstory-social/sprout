import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION, migrations, runMigrations, schemaVersionOf } from './migrations.js';

// The export a host copies and the runner a host without a ledger uses.
// The real application is `conformance.spec.ts`, on PGlite.

describe('the exported migrations', () => {
  it('are an ordered list under namespaced names, and the last one sets the schema version they claim', () => {
    expect(migrations.map((m) => m.name)).toEqual([
      'sprout/001_sprout.sql',
      'sprout/002_stored_state.sql',
      'sprout/003_log.sql',
    ]);
    expect(migrations.at(-1)!.sql).toContain(
      `SET value = '${SCHEMA_VERSION}' WHERE key = 'schema_version'`,
    );
    for (const m of migrations) expect(m.sql).toMatch(/^-- @overstory\/sprout-store-sql/);
  });

  it('keeps a world’s state in the stored form, and nothing of the state model before it', () => {
    const last = migrations[1]!.sql;
    for (const table of ['serial', 'instance', 'memory', 'visitor', 'tombstone']) {
      expect(last).toContain(`CREATE TABLE sprout.${table} (`);
    }
    for (const table of ['object', 'actor', 'memory', 'spawn_counter']) {
      expect(last).toContain(`DROP TABLE sprout.${table};`);
    }
    // Host seconds and serials pass a 32-bit integer.
    expect(last).toMatch(/last_tick bigint/);
    expect(last).toMatch(/serial bigint NOT NULL/);
  });

  it('keeps the log as one row per entry, numbered per world, and nothing of the action record', () => {
    const last = migrations.at(-1)!.sql;
    expect(last).toContain('DROP TABLE sprout.action;');
    expect(last).toContain('CREATE TABLE sprout.log (');
    expect(last).toMatch(/seq bigint NOT NULL/);
    expect(last).toMatch(/entry jsonb NOT NULL/);
    expect(last).toMatch(/PRIMARY KEY \(microworld_id, seq\)/);
  });

  it('the runner records each applied migration in sprout.meta and rolls a failure back by name', async () => {
    const calls: string[] = [];
    let metaExists = false;
    const client = {
      async query(text: string) {
        calls.push(text);
        if (text.includes("table_name = 'meta'")) return { rows: metaExists ? [{ 1: 1 }] : [] };
        if (text.includes("LIKE 'applied:%'")) return { rows: [] };
        if (text.startsWith('-- @overstory')) metaExists = true;
        return { rows: [] };
      },
    };
    expect(await runMigrations(client)).toEqual({
      applied: ['sprout/001_sprout.sql', 'sprout/002_stored_state.sql', 'sprout/003_log.sql'],
      skipped: [],
    });
    expect(calls).toContain('BEGIN');
    expect(calls.at(-1)).toBe('COMMIT');
    expect(
      calls.some((c) => c.includes(`INSERT INTO sprout.meta (key, value) VALUES ($1, 'applied')`)),
    ).toBe(true);

    const failing = {
      async query(text: string) {
        if (text.includes("table_name = 'meta'")) return { rows: [] };
        if (text.startsWith('-- @overstory')) throw new Error('syntax error near boom');
        return { rows: [] };
      },
    };
    await expect(runMigrations(failing)).rejects.toThrow(
      /migration sprout\/001_sprout.sql failed: .*boom/,
    );
  });

  it('schemaVersionOf: null without the schema, the recorded number with it', async () => {
    const absent = {
      async query() {
        return { rows: [] };
      },
    };
    expect(await schemaVersionOf(absent)).toBeNull();
    const present = {
      async query(text: string) {
        return { rows: text.includes('schema_version') ? [{ value: '1' }] : [{ 1: 1 }] };
      },
    };
    expect(await schemaVersionOf(present)).toBe(1);
  });
});
