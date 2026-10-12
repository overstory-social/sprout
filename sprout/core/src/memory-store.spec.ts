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
