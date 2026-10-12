import { describe, expect, it } from 'vitest';

import { cannotProve, cases, runConformance } from './conformance.js';
import { memoryStore } from './memory-store.js';

// The memory store proves the conformance suite first — the
// three-line loop a host writes, here as vitest cases so a failing case
// names itself.

describe('memoryStore passes the conformance suite', () => {
  for (const c of cases) {
    it(`${c.name} — ${c.proves}`, async () => {
      await c.run(() => memoryStore());
    });
  }

  it('runConformance runs them all', async () => {
    await expect(runConformance(() => memoryStore())).resolves.toBeUndefined();
  });

  it('says what a single backend cannot prove', () => {
    expect(cannotProve).toEqual([
      'real contention: one connection blocking another until commit',
      'lock timeouts firing rather than hanging',
    ]);
  });
});

describe('memoryStore keeps what it holds frozen, and shares it', () => {
  const changes = {
    serial: 1,
    upsert: [
      {
        id: 'w.hall',
        made: { from: 'declared' as const },
        container: 'w',
        arrival: null,
        properties: {},
        links: {},
        wakes: [],
        memory: {},
        lastTick: null,
      },
    ],
    remove: [],
    visitors: [],
    tombstones: [],
  };

  it('hands back the stored state itself, frozen, until a write replaces it', async () => {
    const store = memoryStore();
    await store.transaction('w', (tx) => tx.putState(changes));
    const once = await store.read('w', (tx) => tx.state());
    const again = await store.read('w', (tx) => tx.state());
    expect(again).toBe(once);
    expect(Object.isFrozen(once)).toBe(true);
    expect(Object.isFrozen(once.instances[0])).toBe(true);
    await store.transaction('w', (tx) => tx.putState({ ...changes, serial: 2, upsert: [] }));
    const after = await store.read('w', (tx) => tx.state());
    expect(after).not.toBe(once);
    // A record the write did not touch is the same record.
    expect(after.instances[0]).toBe(once.instances[0]);
  });

  it('keeps what it was handed apart from whoever handed it over', async () => {
    const store = memoryStore();
    const handed = structuredClone(changes);
    await store.transaction('w', (tx) => tx.putState(handed));
    handed.upsert[0]!.container = 'elsewhere';
    expect((await store.read('w', (tx) => tx.state())).instances[0]!.container).toBe('w');
  });

  it('shows a transaction its own appends after what was logged before it, and a read begun before the commit none of them', async () => {
    const store = memoryStore();
    const entry = (n: number) => ({ kind: 'redeploy', level: 'info', seconds: n }) as never;
    await store.transaction('w', (tx) => tx.appendLog(entry(1)));
    let during: number[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const reading = store.read('w', async (tx) => {
      await held;
      return (await tx.log({ limit: 10 })).map((logged) => logged.seq);
    });
    await store.transaction('w', async (tx) => {
      await tx.appendLog(entry(2));
      during = (await tx.log({ after: 0, limit: 10 })).map((logged) => logged.seq);
    });
    release();
    expect(during).toEqual([1, 2]);
    expect(await reading).toEqual([1]);
    expect(
      (await store.read('w', (tx) => tx.log({ after: 1, limit: 10 }))).map((l) => l.seq),
    ).toEqual([2]);
  });
});

describe('memoryStore made with keepLog keeps only the newest part of each world’s log', () => {
  const entry = (n: number) => ({ kind: 'redeploy', level: 'info', seconds: n }) as never;
  const seqs = async (store: ReturnType<typeof memoryStore>, after = 0) =>
    (await store.read('w', (tx) => tx.log({ after, limit: 1000 }))).map((logged) => logged.seq);

  it('keeps at least the newest entries it was asked to, numbered as they always were', async () => {
    const store = memoryStore({ keepLog: 8 });
    for (let n = 1; n <= 100; n++) await store.transaction('w', (tx) => tx.appendLog(entry(n)));
    const kept = await seqs(store);
    expect(kept.length).toBeGreaterThanOrEqual(8);
    expect(kept.length).toBeLessThanOrEqual(9);
    expect(kept.at(-1)).toBe(100);
    expect(kept).toEqual(kept.map((_, i) => 100 - kept.length + 1 + i));
    expect(await seqs(store, 95)).toEqual([96, 97, 98, 99, 100]);
    await store.transaction('w', (tx) => tx.appendLog(entry(101)));
    expect((await seqs(store)).at(-1)).toBe(101);
  });

  it('reads from the first entry kept for any cursor before it, a negative one included', async () => {
    const store = memoryStore({ keepLog: 8 });
    for (let n = 1; n <= 3; n++) await store.transaction('w', (tx) => tx.appendLog(entry(n)));
    expect(await seqs(store, -1)).toEqual([1, 2, 3]);
    for (let n = 4; n <= 30; n++) await store.transaction('w', (tx) => tx.appendLog(entry(n)));
    expect((await seqs(store, -1))[0]).toBe((await seqs(store))[0]);
  });

  it('keeps a world’s whole log where it was given no bound, and refuses a bound that is not a count', async () => {
    const store = memoryStore();
    for (let n = 1; n <= 50; n++) await store.transaction('w', (tx) => tx.appendLog(entry(n)));
    expect(await seqs(store)).toHaveLength(50);
    expect(() => memoryStore({ keepLog: 0 })).toThrow(/at least 1, not 0/);
    expect(() => memoryStore({ keepLog: 2.5 })).toThrow(/whole number/);
  });

  it('lets a read begun before a cut see the log as it was', async () => {
    const store = memoryStore({ keepLog: 2 });
    for (let n = 1; n <= 3; n++) await store.transaction('w', (tx) => tx.appendLog(entry(n)));
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const reading = store.read('w', async (tx) => {
      const before = (await tx.log({ limit: 10 })).map((logged) => logged.seq);
      await held;
      return [before, (await tx.log({ limit: 10 })).map((logged) => logged.seq)];
    });
    for (let n = 4; n <= 10; n++) await store.transaction('w', (tx) => tx.appendLog(entry(n)));
    release();
    const [before, after] = await reading;
    expect(after).toEqual(before);
    expect((await seqs(store)).at(-1)).toBe(10);
  });
});
