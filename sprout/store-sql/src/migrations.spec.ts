import { describe, expect, it } from 'vitest';

import { SCHEMA_VERSION, migrations, runMigrations, schemaVersionOf } from './migrations.js';

// The export a host copies and the runner a host without a ledger uses.
// The real application is `conformance.spec.ts`, on PGlite.

describe('the exported migrations', () => {
  it('are an ordered list under namespaced names, and the last one sets the schema version they claim', () => {
    expect(migrations.map((m) => m.name)).toEqual(['sprout/001_sprout.sql']);
    expect(migrations.at(-1)!.sql).toContain(`('schema_version', '${SCHEMA_VERSION}')`);
    for (const m of migrations) expect(m.sql).toMatch(/^-- @overstory\/sprout-store-sql/);
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
      applied: ['sprout/001_sprout.sql'],
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
