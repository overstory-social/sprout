import { DEFAULT_LIMITS } from '@overstory/sprout/lang';

import type {
  ActionRecord,
  ActorRecord,
  MemoryRecord,
  MicroworldRecord,
  ObjectRecord,
} from './records.js';
import type { SproutStore, StoreTx } from './store.js';

// The conformance suite: what every store adapter must prove,
// importing NO test framework — a host runs it under
// vitest, jest, node:test or bun with a three-line loop, and a runtime
// package never carries a test runner. A case throws on failure. Some
// cases a backend cannot truly exercise (real contention on one
// connection); `cannotProve` names them so a green run on a single
// backend does not read as a proof it is not.

export interface ConformanceCase {
  name: string;
  /** What this case proves; the words a host's test runner prints. */
  proves: string;
  run(makeStore: () => SproutStore | Promise<SproutStore>): Promise<void>;
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`conformance: ${message}`);
}

function equal(a: unknown, b: unknown, message: string): void {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`conformance: ${message}\n  expected ${jb}\n  received ${ja}`);
}

const NOW = new Date('2026-09-18T12:00:00Z');
const microworld = (id: string): MicroworldRecord => ({
  id,
  archive: { files: [{ name: 'a.sprout', source: 'room hall {}' }], manifest: null },
  stamp: 'stamp-1',
  level: 1,
  extensions: [],
  caps: DEFAULT_LIMITS.caps,
  excepted: false,
  loadedAt: NOW,
});
const object = (
  microworldId: string,
  id: string,
  state: Record<string, unknown> = {},
): ObjectRecord => ({
  microworldId,
  id,
  spawnedFrom: null,
  container: 'hall',
  home: 'hall',
  state: state as ObjectRecord['state'],
});
const actor = (microworldId: string, id: string, room = 'hall'): ActorRecord => ({
  microworldId,
  id,
  name: id,
  roomId: room,
  lastSeen: NOW,
  narration: [],
  lastNoun: null,
  pending: [],
});
const action = (microworldId: string, at: Date, faulted = false): ActionRecord => ({
  microworldId,
  at,
  roomId: 'hall',
  command: 'poke',
  events: 1,
  depth: 0,
  spawned: 0,
  faulted,
  fault: faulted ? { message: 'tangled', chain: [] } : null,
  missed: false,
  durationMs: 1,
  lockWaitMs: 0,
});

/**
 * Runs `fn` twice, the way Firestore or Mongo would on contention: once
 * in a transaction that is then rolled back, then again for real. The
 * port's re-run rule made mechanical: `fn` must have no effect outside the
 * transaction it is handed, and every id it mints must derive from state
 * it read inside that invocation — so the second run sees what the
 * first saw, and commits once.
 */
export function reentrant(store: SproutStore): SproutStore {
  const rollback = Symbol('rollback');
  return {
    ...store,
    transaction: async (id, fn, opts) => {
      try {
        await store.transaction(
          id,
          async (tx) => {
            await fn(tx);
            throw rollback;
          },
          opts,
        );
      } catch (err) {
        if (err !== rollback) throw err;
      }
      return store.transaction(id, fn, opts);
    },
  };
}

export const cases: ConformanceCase[] = [
  {
    name: 'round-trips every record',
    proves:
      'a record written in a transaction is read back whole, by a later read and a later transaction',
    async run(make) {
      const store = await make();
      const m = microworld('w');
      const memory: MemoryRecord = {
        microworldId: 'w',
        actorId: 'a',
        byObject: { lamp: { seen: true } },
      };
      await store.transaction('w', async (tx) => {
        await tx.putMicroworld(m);
        await tx.putObjects({ upsert: [object('w', 'lamp', { lit: true })], remove: [] });
        await tx.putActor(actor('w', 'a'));
        await tx.putMemory(memory);
        await tx.appendAction(action('w', NOW));
        await tx.appendMiss({
          microworldId: 'w',
          at: NOW,
          roomId: 'hall',
          input: 'juggle',
          couldSay: ['light lamp'],
          couldName: ['lamp'],
          state: { room: {}, items: {} },
        });
      });
      await store.read('w', async (tx) => {
        equal(await tx.microworld(), m, 'the microworld record');
        equal(await tx.objects(), [object('w', 'lamp', { lit: true })], 'the object rows');
        equal(await tx.actor('a'), actor('w', 'a'), 'the actor row');
        equal(await tx.memory('a'), memory, 'the memory row');
        equal((await tx.actions({ limit: 10 })).length, 1, 'one action');
        equal((await tx.misses({ limit: 10 }))[0]?.input, 'juggle', 'the miss');
        equal(
          await tx.memory('nobody'),
          { microworldId: 'w', actorId: 'nobody', byObject: {} },
          'an empty memory',
        );
        equal(await tx.actor('nobody'), null, 'no such actor');
      });
    },
  },
  {
    name: 're-entrancy: fn invoked twice commits once',
    proves:
      'a transaction body run twice (Firestore, Mongo) leaves exactly one row per write and one spawn number per mint',
    async run(make) {
      const store = reentrant(await make());
      const spawns: number[] = [];
      await store.transaction('w', async (tx) => {
        await tx.putMicroworld(microworld('w'));
        spawns.push(await tx.nextSpawn());
        await tx.appendAction(action('w', NOW));
        await tx.putObjects({ upsert: [object('w', 'lamp')], remove: [] });
      });
      await store.read('w', async (tx) => {
        equal((await tx.actions({ limit: 10 })).length, 1, 'one action after two invocations');
        equal((await tx.objects()).length, 1, 'one object after two invocations');
      });
      equal(
        spawns,
        [1, 1],
        'the same spawn number in both invocations (derived from state read inside)',
      );
    },
  },
  {
    name: 'write turns on one microworld serialize; reads do not wait',
    proves: 'two racing transactions land in order, and a read during a transaction returns',
    async run(make) {
      const store = await make();
      await store.transaction('w', async (tx) => tx.putMicroworld(microworld('w')));
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const first = store.transaction('w', async (tx) => {
        await gate;
        await tx.putObjects({ upsert: [object('w', 'first')], remove: [] });
      });
      const second = store.transaction('w', async (tx) => {
        await tx.putObjects({ upsert: [object('w', 'second')], remove: [] });
      });
      // a read while the first transaction waits
      const during = await store.read('w', async (tx) => (await tx.objects()).length);
      equal(during, 0, 'the read did not wait and saw nothing committed');
      release();
      await Promise.all([first, second]);
      await store.read('w', async (tx) => {
        equal(
          (await tx.objects()).map((o) => o.id),
          ['first', 'second'],
          'landed in order',
        );
      });
    },
  },
  {
    name: 'a read is a snapshot',
    proves:
      'a read that spans a concurrent commit on the same microworld sees the world as it was when the read began',
    async run(make) {
      const store = await make();
      await store.transaction('w', async (tx) => {
        await tx.putMicroworld(microworld('w'));
        await tx.putObjects({ upsert: [object('w', 'lamp')], remove: [] });
      });
      await store.read('w', async (tx) => {
        const before = await tx.objects();
        await store.transaction('w', async (wtx) => {
          await wtx.putObjects({ upsert: [object('w', 'coin')], remove: ['lamp'] });
        });
        equal(await tx.objects(), before, 'the read still sees what it began with');
      });
      await store.read('w', async (tx) =>
        equal(
          (await tx.objects()).map((o) => o.id),
          ['coin'],
          'a later read sees the commit',
        ),
      );
    },
  },
  {
    name: 'a failed transaction writes nothing',
    proves:
      "a throw inside fn leaves the store as it was — the turn's writes land together or not at all",
    async run(make) {
      const store = await make();
      await store.transaction('w', async (tx) => tx.putMicroworld(microworld('w')));
      await store
        .transaction('w', async (tx) => {
          await tx.putObjects({ upsert: [object('w', 'ghost')], remove: [] });
          await tx.appendAction(action('w', NOW));
          throw new Error('boom');
        })
        .catch(() => undefined);
      await store.read('w', async (tx) => {
        equal(await tx.objects(), [], 'no object row');
        equal(await tx.actions({ limit: 10 }), [], 'no action row');
      });
    },
  },
  {
    name: 'memory is isolated by microworld',
    proves: "microworld A's memory of an actor is invisible in B, though the object ids coincide",
    async run(make) {
      const store = await make();
      await store.transaction('a', async (tx) => {
        await tx.putMicroworld(microworld('a'));
        await tx.putMemory({
          microworldId: 'a',
          actorId: 'v',
          byObject: { torch: { seen: true } },
        });
      });
      await store.transaction('b', async (tx) => tx.putMicroworld(microworld('b')));
      await store.read('b', async (tx) => {
        equal(
          await tx.memory('v'),
          { microworldId: 'b', actorId: 'v', byObject: {} },
          "B knows nothing of A's memory",
        );
      });
    },
  },
  {
    name: 'objects: upsert, remove, clear',
    proves: 'putObjects upserts and removes in one call; clearObjects empties the microworld',
    async run(make) {
      const store = await make();
      await store.transaction('w', async (tx) => {
        await tx.putMicroworld(microworld('w'));
        await tx.putObjects({ upsert: [object('w', 'a'), object('w', 'b')], remove: [] });
        await tx.putObjects({ upsert: [object('w', 'a', { x: 1 })], remove: ['b'] });
      });
      await store.read('w', async (tx) =>
        equal(await tx.objects(), [object('w', 'a', { x: 1 })], 'upsert + remove'),
      );
      await store.transaction('w', async (tx) => tx.clearObjects());
      await store.read('w', async (tx) => equal(await tx.objects(), [], 'cleared'));
    },
  },
  {
    name: 'actors: presence, the heartbeat, pending lines',
    proves:
      'actorsIn answers by room and last-seen; touchActor moves lastSeen and drains pending without a write transaction',
    async run(make) {
      const store = await make();
      const old = new Date(NOW.getTime() - 60_000);
      await store.transaction('w', async (tx) => {
        await tx.putMicroworld(microworld('w'));
        await tx.putActor({ ...actor('w', 'a'), pending: ['marta arrives.'] });
        await tx.putActor({ ...actor('w', 'b'), lastSeen: old });
        await tx.putActor(actor('w', 'c', 'cellar'));
      });
      await store.read('w', async (tx) => {
        equal(
          (await tx.actorsIn('hall', new Date(NOW.getTime() - 30_000))).map((a) => a.id),
          ['a'],
          'only the one seen lately, in this room',
        );
        await tx.touchActor('b', NOW, true);
        await tx.touchActor('a', NOW, true);
      });
      await store.read('w', async (tx) => {
        equal(
          (await tx.actorsIn('hall', new Date(NOW.getTime() - 30_000))).map((a) => a.id).sort(),
          ['a', 'b'],
          'the heartbeat brought b back',
        );
        equal((await tx.actor('a'))?.pending, [], 'drained');
      });
    },
  },
  {
    name: 'actions and misses: newest first, bounded, filtered',
    proves:
      'actions({ since, limit, faultedOnly }) and misses({ limit }) answer newest first within the limit',
    async run(make) {
      const store = await make();
      const t = (s: number) => new Date(NOW.getTime() + s * 1000);
      await store.transaction('w', async (tx) => {
        await tx.putMicroworld(microworld('w'));
        for (let i = 0; i < 5; i++) await tx.appendAction(action('w', t(i), i % 2 === 0));
      });
      await store.read('w', async (tx) => {
        equal(
          (await tx.actions({ limit: 2 })).map((a) => a.at.getTime()),
          [t(4).getTime(), t(3).getTime()],
          'newest two',
        );
        equal((await tx.actions({ limit: 10, faultedOnly: true })).length, 3, 'the faulted ones');
        equal((await tx.actions({ limit: 10, since: t(3) })).length, 2, 'since');
      });
    },
  },
  {
    name: 'housekeeping: trim, destroyMicroworld, forgetActor, exportActor',
    proves: 'the four store-level methods reach every microworld and nothing else',
    async run(make) {
      const store = await make();
      const t = (s: number) => new Date(NOW.getTime() + s * 1000);
      for (const id of ['a', 'b']) {
        await store.transaction(id, async (tx) => {
          await tx.putMicroworld(microworld(id));
          await tx.putActor(actor(id, 'v'));
          await tx.putActor(actor(id, 'w'));
          await tx.putMemory({ microworldId: id, actorId: 'v', byObject: { x: { seen: true } } });
          for (let i = 0; i < 3; i++) await tx.appendAction(action(id, t(i)));
          for (let i = 0; i < 3; i++) {
            await tx.appendMiss({
              microworldId: id,
              at: t(i),
              roomId: 'hall',
              input: `m${i}`,
              couldSay: [],
              couldName: [],
              state: { room: {}, items: {} },
            });
          }
        });
      }
      await store.trim(t(1), 2);
      await store.read('a', async (tx) => {
        equal((await tx.actions({ limit: 10 })).length, 2, 'actions older than `before` are gone');
        equal(
          (await tx.misses({ limit: 10 })).map((m) => m.input),
          ['m2', 'm1'],
          'the newest misses kept',
        );
      });
      const exported = await store.exportActor('v');
      equal(exported.actors.map((a) => a.microworldId).sort(), ['a', 'b'], "v's presence in both");
      equal(exported.memory.length, 2, "v's memory in both");
      await store.forgetActor('v');
      await store.read('a', async (tx) => {
        equal(await tx.actor('v'), null, 'v forgotten');
        equal(await tx.actor('w'), actor('a', 'w'), 'w untouched');
        equal(
          await tx.memory('v'),
          { microworldId: 'a', actorId: 'v', byObject: {} },
          "v's memory gone",
        );
      });
      await store.destroyMicroworld('a');
      await store.read('a', async (tx) => {
        equal(await tx.microworld(), null, 'a is gone');
        equal(await tx.objects(), [], 'and its objects');
      });
      await store.read('b', async (tx) => assert((await tx.microworld()) !== null, 'b stands'));
    },
  },
];

/**
 * What a single-backend run cannot prove and a host should not read
 * into a green suite: real lock contention (one connection blocking
 * another until commit) and `lock_timeout` firing rather than hanging.
 * Those are proved once against a real Postgres.
 */
export const cannotProve: readonly string[] = [
  'real contention: one connection blocking another until commit',
  'lock timeouts firing rather than hanging',
];

/** A helper for the three-line loop: run every case against a store factory, throwing on the first failure. */
export async function runConformance(
  makeStore: () => SproutStore | Promise<SproutStore>,
): Promise<void> {
  for (const c of cases) await c.run(makeStore);
}

export type { StoreTx };
