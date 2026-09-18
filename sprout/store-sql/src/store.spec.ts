import { describe, expect, it } from 'vitest';

import type { MicroworldRecord } from '@overstory/sprout-core';

import { LOCK_TIMEOUT, sqlStore, type Queryable } from './store.js';

// The adapter's shape, on a scripted client: the version check once, the
// lock and the timeout, one jsonb parameter for many rows, never a
// foreign column cast. Whether the SQL is right is `conformance.spec.ts`,
// on PGlite.

const NOW = new Date('2026-09-18T12:00:00Z');
const MICROWORLD: MicroworldRecord = {
  id: 'w',
  archive: { files: [{ name: 'a.sprout', source: 'room hall {}' }], manifest: null },
  stamp: 's1',
  level: 1,
  extensions: [],
  limits: {
    rooms: 16,
    objects: 192,
    kinds: 32,
    files: 256,
    sourceBytes: 262144,
    instances: 2000,
    actionDays: 30,
    misses: 500,
  },
  loadedAt: NOW,
};

/** A client that answers the version check and records everything else. */
function scripted(version: string | null = '1') {
  const calls: { text: string; params: unknown[] }[] = [];
  const client: Queryable = {
    async query(text, params = []) {
      calls.push({ text, params });
      if (text.includes("table_name = 'meta'")) return { rows: version === null ? [] : [{ 1: 1 }] };
      if (text.includes("key = 'schema_version'")) return { rows: [{ value: version }] };
      if (text.includes('RETURNING n')) return { rows: [{ n: 3 }] };
      return { rows: [] };
    },
  };
  return { client, calls, texts: () => calls.map((c) => c.text) };
}

describe('sqlStore', () => {
  it('needs a client or a transaction runner', () => {
    expect(() => sqlStore({})).toThrow(/client or a transaction/);
  });

  it('checks the schema version once, then takes the timeout and the advisory lock for a write', async () => {
    const { client, calls, texts } = scripted();
    const store = sqlStore({ client });
    await store.transaction('w', async (tx) => tx.putMicroworld(MICROWORLD));
    await store.transaction('w', async (tx) => tx.nextSpawn());
    const versionChecks = texts().filter((t) => t.includes("key = 'schema_version'"));
    expect(versionChecks).toHaveLength(1);
    const first = texts().findIndex((t) => t.includes('lock_timeout'));
    expect(texts()[first]).toContain(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    expect(texts()[first + 1]).toContain('pg_advisory_xact_lock(hashtext($1))');
    expect(calls[first + 1]!.params).toEqual(['w']);
    const put = calls.find((c) => c.text.includes('INSERT INTO sprout.microworld'))!;
    expect(JSON.parse(String(put.params[1]))).not.toHaveProperty('loadedAt');
    expect(put.params[2]).toEqual(NOW);
  });

  it('a version it was not built for is refused with expected and found; an absent schema too', async () => {
    const stale = sqlStore({ client: scripted('0').client });
    await expect(stale.read('w', async () => 1)).rejects.toThrow(/1 expected, 0 found/);
    const none = sqlStore({ client: scripted(null).client });
    await expect(none.read('w', async () => 1)).rejects.toThrow(/no sprout schema found/);
    const pinned = sqlStore({ client: scripted('1').client, schemaVersion: 2 });
    await expect(pinned.read('w', async () => 1)).rejects.toThrow(/2 expected, 1 found/);
  });

  it('with a transaction runner, a read is its own REPEATABLE READ transaction and never locks', async () => {
    const { client, calls, texts } = scripted();
    const store = sqlStore({
      transaction: async (fn) => {
        calls.push({ text: 'BEGIN', params: [] });
        const out = await fn(client);
        calls.push({ text: 'COMMIT', params: [] });
        return out;
      },
    });
    await store.read('w', async (tx) => tx.objects());
    expect(texts()[0]).toBe('BEGIN');
    expect(texts()[1]).toContain('REPEATABLE READ'); // first in the transaction, as Postgres requires
    expect(texts().some((t) => t.includes('advisory'))).toBe(false);
    expect(texts().at(-1)).toBe('COMMIT');
  });

  it('putObjects: one jsonb parameter for every row, one text[] for the removals; every table of a microworld on destroy', async () => {
    const { client, calls } = scripted();
    const store = sqlStore({ client });
    await store.transaction('w', async (tx) => {
      await tx.putObjects({
        upsert: [
          {
            microworldId: 'w',
            id: 'lamp',
            spawnedFrom: null,
            container: 'hall',
            home: 'hall',
            state: {},
          },
          {
            microworldId: 'w',
            id: 'spawn-1',
            spawnedFrom: 'Lump',
            container: 'hall',
            home: 'hall',
            state: {},
          },
        ],
        remove: ['coin'],
      });
    });
    const del = calls.find((c) => c.text.includes('DELETE FROM sprout.object'))!;
    expect(del.params).toEqual(['w', ['coin']]);
    const ins = calls.find((c) => c.text.includes('jsonb_array_elements($2::jsonb)'))!;
    expect(JSON.parse(String(ins.params[1]))).toHaveLength(2);
    await store.destroyMicroworld('w');
    const deletes = calls.filter(
      (c) => c.text.startsWith('DELETE FROM sprout.') && c.params[0] === 'w',
    );
    expect(deletes.map((c) => c.text.split(' ')[2])).toEqual([
      'sprout.object',
      'sprout.microworld',
      'sprout.spawn_counter',
      'sprout.object',
      'sprout.actor',
      'sprout.memory',
      'sprout.action',
      'sprout.miss',
    ]);
  });

  it('the SQL casts parameters, never a column, and every table is in the sprout schema', async () => {
    const { client, texts } = scripted();
    const store = sqlStore({ client });
    await store.transaction('w', async (tx) => {
      await tx.objects();
      await tx.actor('v');
      await tx.actorsIn('hall', NOW);
      await tx.memory('v');
      await tx.actions({ limit: 5 });
      await tx.misses({ limit: 5 });
    });
    await store.forgetActor('v');
    await store.exportActor('v');
    for (const t of texts().filter(
      (t) => /FROM|INTO|UPDATE/.test(t) && !t.includes('information_schema'),
    )) {
      expect(t).toMatch(/sprout\.(microworld|spawn_counter|object|actor|memory|action|miss|meta)/);
      expect(t).not.toMatch(/\w+::text = ANY/);
    }
  });
});
