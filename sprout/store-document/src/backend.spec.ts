import { describe, expect, it } from 'vitest';

import { KeyLocks, Staging, cloneDoc, memoryBackend, type DocumentReader } from './backend.js';

// The pieces a backend is built from, and the memory backend on them:
// locks by key acquired in order, writes staged until `fn` returns, a
// document that never shares a reference with the caller.

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('KeyLocks', () => {
  it('serializes holders of one key in arrival order, and lets disjoint keys run together', async () => {
    const locks = new KeyLocks();
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = locks.holding(['k'], async () => {
      log.push('a in');
      await gate;
      log.push('a out');
    });
    const b = locks.holding(['k'], async () => {
      log.push('b');
    });
    const c = locks.holding(['other'], async () => {
      log.push('c');
    });
    await tick();
    expect(log).toEqual(['a in', 'c']);
    release();
    await Promise.all([a, b, c]);
    expect(log).toEqual(['a in', 'c', 'a out', 'b']);
  });

  it('two holders of overlapping key sets never deadlock: keys are taken in sorted order', async () => {
    const locks = new KeyLocks();
    const log: string[] = [];
    await Promise.all([
      locks.holding(['b', 'a'], async () => {
        await tick();
        log.push('ba');
      }),
      locks.holding(['a', 'b'], async () => {
        log.push('ab');
      }),
    ]);
    expect(log.sort()).toEqual(['ab', 'ba']);
  });

  it('releases on a throw', async () => {
    const locks = new KeyLocks();
    await expect(
      locks.holding(['k'], async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await locks.holding(['k'], async () => 'free')).toBe('free');
  });
});

describe('Staging', () => {
  const under: DocumentReader = {
    get: async (key) => (key === 'a' ? { v: 1 } : key === 'b' ? { v: 2 } : null),
    list: async (prefix) => ['a', 'b'].filter((k) => k.startsWith(prefix)),
  };

  it('a get sees the staged value first, a delete hides the document, a list merges both', async () => {
    const s = new Staging(under);
    expect(await s.get('a')).toEqual({ v: 1 });
    await s.put('a', { v: 10 });
    await s.put('c', { v: 3 });
    await s.delete('b');
    expect(await s.get('a')).toEqual({ v: 10 });
    expect(await s.get('b')).toBeNull();
    expect(await s.get('c')).toEqual({ v: 3 });
    expect(await s.list('')).toEqual(['a', 'c']);
    expect([...s.writes]).toEqual([
      ['a', { v: 10 }],
      ['c', { v: 3 }],
      ['b', null],
    ]);
  });

  it('what is staged is a copy: the caller’s object may change after the put', async () => {
    const s = new Staging(under);
    const doc = { v: 1, list: [1] };
    await s.put('x', doc);
    doc.v = 2;
    doc.list.push(2);
    expect(await s.get('x')).toEqual({ v: 1, list: [1] });
    expect(cloneDoc(doc)).not.toBe(doc);
  });
});

describe('memoryBackend', () => {
  it('get, put, delete and list by prefix; a document comes back as a copy', async () => {
    const b = memoryBackend();
    expect(await b.get('m/1')).toBeNull();
    const doc = { n: 1, at: '2026-09-18T12:00:00.000Z' };
    await b.put('m/1', doc);
    await b.put('m/2', { n: 2 });
    await b.put('n/1', { n: 3 });
    doc.n = 9;
    expect(await b.get('m/1')).toEqual({ n: 1, at: '2026-09-18T12:00:00.000Z' });
    expect(await b.list('m/')).toEqual(['m/1', 'm/2']);
    expect(b.size).toBe(3);
    await b.delete('m/1');
    expect(await b.get('m/1')).toBeNull();
    expect(b.size).toBe(2);
  });

  it('transact: the writes land together when fn returns, and not at all when it throws', async () => {
    const b = memoryBackend();
    await b.put('k/1', { v: 1 });
    await b
      .transact(['k/1'], async (tx) => {
        await tx.put('k/1', { v: 2 });
        await tx.put('k/2', { v: 2 });
        expect(await tx.get('k/1')).toEqual({ v: 2 });
        // …but nothing has landed yet
        expect(await b.get('k/1')).toEqual({ v: 1 });
        throw new Error('boom');
      })
      .catch(() => undefined);
    expect(await b.get('k/1')).toEqual({ v: 1 });
    expect(await b.get('k/2')).toBeNull();
    const out = await b.transact(['k/1'], async (tx) => {
      await tx.put('k/1', { v: 3 });
      await tx.delete('k/9');
      return 'ok';
    });
    expect(out).toBe('ok');
    expect(await b.get('k/1')).toEqual({ v: 3 });
  });

  it('transact serializes on its keys: a second transaction on the key waits, one on another key does not', async () => {
    const b = memoryBackend();
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = b.transact(['w/objects'], async (tx) => {
      await gate;
      await tx.put('w/objects', { first: true });
      log.push('first');
    });
    const second = b.transact(['w/objects'], async (tx) => {
      const seen = await tx.get('w/objects');
      log.push(`second saw ${JSON.stringify(seen)}`);
    });
    const other = b.transact(['w/actors/a'], async () => {
      log.push('other');
    });
    await tick();
    expect(log).toEqual(['other']);
    release();
    await Promise.all([first, second, other]);
    expect(log).toEqual(['other', 'first', 'second saw {"first":true}']);
  });
});
