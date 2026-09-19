import 'fake-indexeddb/auto';

import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';

import { indexedDbBackend } from './indexeddb.js';

// The IndexedDB backend under fake-indexeddb: one object store, a key
// range for the prefix, a transaction's writes landing in one readwrite
// transaction — and the connection opened once and closable.

const open: { close(): Promise<void> }[] = [];
let n = 0;
const make = (factory?: IDBFactory) => {
  const b = indexedDbBackend(`idb-${n++}`, factory ? { factory } : {});
  open.push(b);
  return b;
};
afterEach(async () => {
  for (const b of open.splice(0)) await b.close();
});

describe('indexedDbBackend', () => {
  it('get, put, delete and list by prefix (the range covers every continuation, not a sibling prefix)', async () => {
    const b = make();
    expect(await b.get('m/1')).toBeNull();
    await b.put('m/1', { n: 1 });
    await b.put('m/10', { n: 10 });
    await b.put('m/2', { n: 2 });
    await b.put('mm/1', { n: 3 });
    expect(await b.get('m/1')).toEqual({ n: 1 });
    expect(await b.list('m/')).toEqual(['m/1', 'm/10', 'm/2']);
    expect(await b.list('m/1')).toEqual(['m/1', 'm/10']);
    await b.delete('m/1');
    expect(await b.get('m/1')).toBeNull();
    expect(await b.list('m/')).toEqual(['m/10', 'm/2']);
  });

  it('a document survives a close and a reopen of the same database', async () => {
    const factory = new IDBFactory();
    const first = indexedDbBackend('kept', { factory });
    await first.put('k', { v: 1 });
    await first.close();
    const again = indexedDbBackend('kept', { factory });
    open.push(again);
    expect(await again.get('k')).toEqual({ v: 1 });
    // closing twice is fine
    await again.close();
    await again.close();
  });

  it('transact: the writes land in one transaction when fn returns, and not at all when it throws', async () => {
    const b = make();
    await b.put('k/1', { v: 1 });
    await b
      .transact(['k/1'], async (tx) => {
        await tx.put('k/1', { v: 2 });
        await tx.put('k/2', { v: 2 });
        expect(await tx.get('k/2')).toEqual({ v: 2 });
        expect(await b.get('k/2')).toBeNull();
        throw new Error('boom');
      })
      .catch(() => undefined);
    expect(await b.get('k/1')).toEqual({ v: 1 });
    expect(await b.get('k/2')).toBeNull();
    expect(
      await b.transact(['k/1'], async (tx) => {
        await tx.put('k/1', { v: 3 });
        await tx.delete('k/1');
        await tx.put('k/1', { v: 4 });
        await tx.put('k/2', { v: 2 });
        return 'ok';
      }),
    ).toBe('ok');
    expect(await b.get('k/1')).toEqual({ v: 4 });
    expect(await b.get('k/2')).toEqual({ v: 2 });
    // a transaction that writes nothing opens no readwrite transaction
    expect(await b.transact(['k/1'], async (tx) => tx.get('k/1'))).toEqual({ v: 4 });
  });

  it('transact serializes on its keys in this process when the page has no Web Locks', async () => {
    const b = make();
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = b.transact(['w/objects'], async (tx) => {
      await gate;
      await tx.put('w/objects', { first: true });
      log.push('first');
    });
    const second = b.transact(['w/objects'], async (tx) => {
      log.push(`second saw ${JSON.stringify(await tx.get('w/objects'))}`);
    });
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(log).toEqual([]);
    release();
    await Promise.all([first, second]);
    expect(log).toEqual(['first', 'second saw {"first":true}']);
  });

  it('uses the Web Locks API when the page has it (or is handed one), one lock per key in order', async () => {
    const requested: string[] = [];
    const locks = {
      request: async <T>(name: string, cb: () => Promise<T>) => {
        requested.push(name);
        return cb();
      },
    };
    const b = indexedDbBackend('locked', { locks });
    open.push(b);
    await b.transact(['b', 'a', 'b'], async (tx) => tx.put('a', { v: 1 }));
    expect(requested).toEqual(['sprout-store-document:locked:a', 'sprout-store-document:locked:b']);
    expect(await b.get('a')).toEqual({ v: 1 });
  });
});
