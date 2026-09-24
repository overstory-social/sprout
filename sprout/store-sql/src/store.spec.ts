import { describe, expect, it } from 'vitest';

import type { MicroworldRecord, StoredInstance } from '@overstory/sprout/core';

import { LOCK_TIMEOUT, sqlStore, type Queryable } from './store.js';

// The adapter's shape, on a scripted client: the version check once, the
// lock and the timeout, one jsonb parameter for many rows, never a
// foreign column cast. Whether the SQL is right is `conformance.spec.ts`,
// on PGlite.

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

const NOW = new Date('2026-09-18T12:00:00Z');
const MICROWORLD: MicroworldRecord = {
  id: 'w',
  archive: { files: [{ name: 'a.sprout', source: 'room hall {}' }], manifest: null },
  stamp: 's1',
  level: 1,
  extensions: [],
  caps: CAPS,
  excepted: false,
  loadedAt: NOW,
};

/** A client that answers the version check and records everything else. */
function scripted(version: string | null = '2') {
  const calls: { text: string; params: unknown[] }[] = [];
  const client: Queryable = {
    async query(text, params = []) {
      calls.push({ text, params });
      if (text.includes("table_name = 'meta'")) return { rows: version === null ? [] : [{ 1: 1 }] };
      if (text.includes("key = 'schema_version'")) return { rows: [{ value: version }] };
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
    await store.transaction('w', async (tx) => tx.state());
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
    const stale = sqlStore({ client: scripted('1').client });
    await expect(stale.read('w', async () => 1)).rejects.toThrow(/2 expected, 1 found/);
    const none = sqlStore({ client: scripted(null).client });
    await expect(none.read('w', async () => 1)).rejects.toThrow(/no sprout schema found/);
    const pinned = sqlStore({ client: scripted('2').client, schemaVersion: 3 });
    await expect(pinned.read('w', async () => 1)).rejects.toThrow(/3 expected, 2 found/);
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
    await store.read('w', async (tx) => tx.state());
    expect(texts()[0]).toBe('BEGIN');
    expect(texts()[1]).toContain('REPEATABLE READ'); // first in the transaction, as Postgres requires
    expect(texts().some((t) => t.includes('advisory'))).toBe(false);
    expect(texts().at(-1)).toBe('COMMIT');
  });

  it('putState: one jsonb parameter for every record, one text[] for the removals; every table of a microworld on destroy, under its lock', async () => {
    const { client, calls } = scripted();
    const store = sqlStore({ client });
    const record = (id: string, memory: StoredInstance['memory'] = {}): StoredInstance => ({
      id,
      made: { from: 'declared' },
      container: 'shop',
      arrival: null,
      properties: {},
      links: {},
      wakes: [],
      memory,
      lastTick: null,
    });
    await store.transaction('w', async (tx) => {
      await tx.putState({
        serial: 4,
        upsert: [record('shop.lamp', { 'shop#1': {} }), record('shop.coin')],
        remove: ['shop#2'],
        tombstones: ['shop.vase'],
        visitors: [],
      });
    });
    const serial = calls.find((c) => c.text.includes('INSERT INTO sprout.serial'))!;
    expect(serial.params).toEqual(['w', 4]);
    const del = calls.find((c) => c.text.includes('DELETE FROM sprout.instance'))!;
    expect(del.params).toEqual(['w', ['shop#2']]);
    const forget = calls.find((c) => c.text.includes('DELETE FROM sprout.memory'))!;
    expect(forget.params).toEqual(['w', ['shop#2', 'shop.lamp', 'shop.coin']]);
    const ins = calls.filter((c) => c.text.includes('jsonb_array_elements($2::jsonb)'));
    expect(ins.map((c) => c.text.match(/INSERT INTO (sprout\.\w+)/)![1])).toEqual([
      'sprout.instance',
      'sprout.memory',
    ]);
    expect(JSON.parse(String(ins[0]!.params[1]))).toHaveLength(2);
    const tomb = calls.find((c) => c.text.includes('INSERT INTO sprout.tombstone'))!;
    expect(tomb.params).toEqual(['w', ['shop.vase']]);
    expect(calls.some((c) => c.text.includes('INSERT INTO sprout.visitor'))).toBe(false);

    const before = calls.length;
    await store.destroyMicroworld('w');
    const destroy = calls.slice(before);
    expect(destroy[1]!.text).toContain('pg_advisory_xact_lock');
    expect(
      destroy
        .filter((c) => c.text.startsWith('DELETE FROM sprout.'))
        .map((c) => c.text.split(' ')[2]),
    ).toEqual([
      'sprout.microworld',
      'sprout.serial',
      'sprout.instance',
      'sprout.memory',
      'sprout.visitor',
      'sprout.tombstone',
      'sprout.action',
      'sprout.miss',
    ]);
  });

  it('forgetVisitor takes the lock of every world holding the visit, in code-unit order, before it reads one', async () => {
    const calls: string[] = [];
    const client: Queryable = {
      async query(text, params = []) {
        calls.push(`${text.trim().split(/\s+/).slice(0, 3).join(' ')} ${JSON.stringify(params)}`);
        if (text.includes("table_name = 'meta'")) return { rows: [{ 1: 1 }] };
        if (text.includes("key = 'schema_version'")) return { rows: [{ value: '2' }] };
        if (text.includes('SELECT microworld_id FROM sprout.visitor')) {
          return { rows: [{ microworld_id: 'b' }, { microworld_id: 'a' }] };
        }
        return { rows: [] };
      },
    };
    await sqlStore({ client }).forgetVisitor('v-marta');
    const locks = calls.filter((c) => c.includes('pg_advisory_xact_lock'));
    expect(locks.map((c) => c.slice(c.lastIndexOf(' ') + 1))).toEqual(['["a"]', '["b"]']);
    const firstRead = calls.findIndex((c) => c.startsWith('SELECT serial FROM'));
    expect(calls.findIndex((c) => c.includes('pg_advisory_xact_lock'))).toBeLessThan(firstRead);
  });

  it('the SQL casts parameters, never a column, and every table is in the sprout schema', async () => {
    const { client, texts } = scripted();
    const store = sqlStore({ client });
    await store.transaction('w', async (tx) => {
      await tx.state();
      await tx.actions({ limit: 5 });
      await tx.misses({ limit: 5 });
    });
    await store.forgetVisitor('v');
    await store.exportVisitor('v');
    for (const t of texts().filter(
      (t) => /FROM|INTO|UPDATE/.test(t) && !t.includes('information_schema'),
    )) {
      expect(t).toMatch(
        /sprout\.(microworld|serial|instance|memory|visitor|tombstone|action|miss|meta)/,
      );
      expect(t).not.toMatch(/\w+::text = ANY/);
    }
  });
});
