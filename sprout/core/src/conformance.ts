import { DEFAULT_BLESSED, DEFAULT_LIMITS, readStoredWorld } from '@overstory/sprout/lang';

import {
  emptyState,
  type ActionRecord,
  type MicroworldRecord,
  type MissRecord,
  type StoredChanges,
  type StoredInstance,
  type StoredProperty,
  type StoredState,
  type StoredVisitor,
} from './records.js';
import type { SproutStore, StoreTx } from './store.js';

// The conformance suite: what every store adapter must prove,
// importing NO test framework — a host runs it under
// vitest, jest, node:test or bun with a three-line loop, and a runtime
// package never carries a test runner. A case throws on failure. Some
// cases a backend cannot truly exercise (real contention on one
// connection); `cannotProve` names them so a green run on a single
// backend does not read as a proof it is not. State is compared as
// JSON with every object's keys sorted: a map's key order is not part
// of the contract, and a list's order is.

export interface ConformanceCase {
  name: string;
  /** What this case proves; the words a host's test runner prints. */
  proves: string;
  run(makeStore: () => SproutStore | Promise<SproutStore>): Promise<void>;
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`conformance: ${message}`);
}

/** `v` with every object's keys in sorted order, a date as its ISO string. */
function canonical(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

function equal(a: unknown, b: unknown, message: string): void {
  const ja = JSON.stringify(canonical(a));
  const jb = JSON.stringify(canonical(b));
  if (ja !== jb) throw new Error(`conformance: ${message}\n  expected ${jb}\n  received ${ja}`);
}

const NOW = new Date('2026-09-18T12:00:00Z');
const microworld = (id: string): MicroworldRecord => ({
  id,
  archive: {
    files: [{ name: 'shop.sprout', source: 'world shop is sprout.World {}' }],
    manifest: null,
  },
  stamp: 'stamp-1',
  level: 1,
  extensions: [],
  caps: DEFAULT_LIMITS.caps,
  excepted: false,
  blessed: [...DEFAULT_BLESSED],
  loadedAt: NOW,
});

// Every fixture is a world called `shop`, so what a store hands back is
// also checked as the language reads it (`readStoredWorld`).

const flag = (value: boolean): StoredProperty => ({ type: 'boolean', value });
const count = (value: number): StoredProperty => ({ type: 'integer', value });

const instance = (
  id: string,
  over: Partial<StoredInstance> & Pick<StoredInstance, 'made'>,
): StoredInstance => ({
  id,
  container: 'shop',
  arrival: null,
  properties: {},
  links: {},
  wakes: [],
  memory: {},
  lastTick: null,
  ...over,
});

const WORLD = instance('shop', { made: { from: 'world' }, container: null });
// A time past a 32-bit integer, so a store that narrows host seconds is caught.
const HALL = instance('shop.hall', {
  made: { from: 'declared' },
  lastTick: 3_000_000_000,
  links: { yard: 'shop.yard', cellar: 'shop#2' },
});
const LAMP = instance('shop.hall.lamp', {
  made: { from: 'declared' },
  container: 'shop.hall',
  properties: {
    lit: flag(true),
    wards: { type: '[shop.Ward]', value: ['oak', 'iron'] },
    grid: { type: '[[integer]]', value: [[1, 2], [], [3]] },
    label: { type: 'string', value: 'Tëst “lamp” \u{1F56F}' },
  },
  memory: { 'shop#1': { seen: flag(true), visits: count(2) }, 'shop#4': { seen: flag(false) } },
});
const MARTA = instance('shop#1', {
  made: { from: 'visitor' },
  container: 'shop.hall',
  arrival: 1,
  properties: { team: { type: 'shop.Team', value: 'it' } },
});
const CELLAR = instance('shop#2', {
  made: { from: 'spawned', kind: 'shop.Cellar' },
  arrival: 2,
  wakes: [{ serial: 5, askedAt: 3_000_000_000, dueAt: 3_000_000_060 }],
});
const COIN = instance('shop#3', {
  made: { from: 'given', kind: 'shop.Purse', path: ['coin'] },
  container: 'shop#1',
  arrival: 3,
});
const INES = instance('shop#4', { made: { from: 'visitor' }, container: null, arrival: 4 });

const visitor = (visit: string, nickname: string, id: string, lastPlace: string | null) => ({
  visit,
  nickname,
  instance: id,
  lastPlace,
});
const V_MARTA: StoredVisitor = visitor('v-marta', 'Marta', 'shop#1', 'shop.hall');
const V_INES: StoredVisitor = visitor('v-ines', 'Ines', 'shop#4', 'shop.yard');

/** The whole fixture world as one turn writes it, out of order, as a draft may list it. */
const FIRST_TURN: StoredChanges = {
  serial: 5,
  upsert: [LAMP, INES, WORLD, COIN, HALL, CELLAR, MARTA],
  remove: [],
  tombstones: ['shop.hall.vase'],
  visitors: [V_MARTA, V_INES],
};

/** The fixture world as a store hands it back: each list in code-unit order. */
const FIRST_STATE: StoredState = {
  serial: 5,
  instances: [WORLD, INES, MARTA, CELLAR, COIN, HALL, LAMP].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  ),
  visitors: [V_INES, V_MARTA],
  tombstones: ['shop.hall.vase'],
};

/** What a store hands back is a world the language can load. */
function loadable(state: StoredState, message: string): void {
  try {
    readStoredWorld({ world: 'shop', ...state });
  } catch (err) {
    throw new Error(`conformance: ${message}: ${String(err)}`);
  }
}

/** One turn that issues the next serial to a spawn in the world, as a draft would. */
async function mintOne(tx: StoreTx): Promise<number> {
  const { serial } = await tx.state();
  const next = serial + 1;
  await tx.putState({
    serial: next,
    upsert: [
      instance(`shop#${next}`, {
        made: { from: 'spawned', kind: 'shop.Clay' },
        container: 'shop',
        arrival: next,
      }),
    ],
    remove: [],
    tombstones: [],
    visitors: [],
  });
  return next;
}

const action = (microworldId: string, at: Date, faulted = false): ActionRecord => ({
  microworldId,
  at,
  roomId: 'shop.hall',
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

const miss = (microworldId: string, at: Date, input: string): MissRecord => ({
  microworldId,
  at,
  roomId: 'shop.hall',
  input,
  couldSay: ['light lamp'],
  couldName: ['lamp'],
  state: { room: HALL, items: [LAMP] },
});

/**
 * Runs `fn` twice, the way Firestore or Mongo would on contention: once
 * in a transaction that is then rolled back, then again for real. The
 * port's re-run rule made mechanical: `fn` must have no effect outside the
 * transaction it is handed, and every serial it issues must follow the
 * one it read inside that invocation — so the second run sees what the
 * first saw, and commits once.
 */
export function reentrant(store: SproutStore): SproutStore {
  const rollback = Symbol('rollback');
  return {
    ...store,
    transaction: async (id, fn) => {
      try {
        await store.transaction(id, async (tx) => {
          await fn(tx);
          throw rollback;
        });
      } catch (err) {
        if (err !== rollback) throw err;
      }
      return store.transaction(id, fn);
    },
  };
}

export const cases: ConformanceCase[] = [
  {
    name: 'round-trips every record',
    proves:
      'a record written in a transaction is read back whole, by a later read and a later transaction, and the state as the language can load it',
    async run(make) {
      const store = await make();
      const m = microworld('w');
      await store.transaction('w', async (tx) => {
        await tx.putMicroworld(m);
        await tx.putState(FIRST_TURN);
        await tx.appendAction(action('w', NOW));
        await tx.appendMiss(miss('w', NOW, 'juggle'));
      });
      await store.read('w', async (tx) => {
        equal(await tx.microworld(), m, 'the microworld record');
        const state = await tx.state();
        equal(state, FIRST_STATE, 'the stored state, each list in code-unit order');
        loadable(state, 'the stored state is a world the language reads');
        equal(await tx.actions({ limit: 10 }), [action('w', NOW)], 'the action');
        equal(await tx.misses({ limit: 10 }), [miss('w', NOW, 'juggle')], 'the miss');
      });
      await store.transaction('w', async (tx) =>
        equal(await tx.state(), FIRST_STATE, 'the state, read by a later transaction'),
      );
      await store.read('nothing', async (tx) => {
        equal(await tx.microworld(), null, 'no such microworld');
        equal(await tx.state(), emptyState(), 'an empty state where nothing is stored');
      });
    },
  },
  {
    name: 'a turn’s changes: removed, upserted, tombstoned, visitors, the serial',
    proves:
      'putState removes before it upserts, replaces a record whole, keeps a tombstone once and for good, upserts a visitor by visit, and sets the serial',
    async run(make) {
      const store = await make();
      const lamp = instance('shop.hall.lamp', {
        made: { from: 'declared' },
        container: 'shop#1',
        arrival: 6,
        properties: { lit: flag(false) },
      });
      const moved = { ...V_MARTA, lastPlace: 'shop.yard' };
      await store.transaction('w', async (tx) => {
        await tx.putMicroworld(microworld('w'));
        await tx.putState(FIRST_TURN);
      });
      await store.transaction('w', async (tx) => {
        await tx.putState({
          serial: 6,
          upsert: [lamp],
          remove: ['shop#2', 'shop.hall.lamp'],
          tombstones: ['shop.hall.vase', 'shop.bench'],
          visitors: [moved],
        });
      });
      await store.read('w', async (tx) => {
        const state = await tx.state();
        equal(
          state,
          {
            serial: 6,
            instances: FIRST_STATE.instances
              .filter((i) => i.id !== 'shop#2')
              .map((i) => (i.id === 'shop.hall.lamp' ? lamp : i)),
            visitors: [V_INES, moved],
            tombstones: ['shop.bench', 'shop.hall.vase'],
          },
          'the state after the second turn',
        );
      });
    },
  },
  {
    name: 're-entrancy: fn invoked twice commits once',
    proves:
      'a transaction body run twice (Firestore, Mongo) reads the same serial both times, and leaves one instance per mint and one row per append',
    async run(make) {
      const store = reentrant(await make());
      const minted: number[] = [];
      await store.transaction('w', async (tx) => {
        await tx.putMicroworld(microworld('w'));
        minted.push(await mintOne(tx));
        await tx.appendAction(action('w', NOW));
      });
      equal(minted, [1, 1], 'the same serial in both invocations (derived from state read inside)');
      await store.read('w', async (tx) => {
        const state = await tx.state();
        equal(state.serial, 1, 'the serial issued once');
        equal(
          state.instances.map((i) => i.id),
          ['shop#1'],
          'one instance after two invocations',
        );
        equal((await tx.actions({ limit: 10 })).length, 1, 'one action after two invocations');
      });
    },
  },
  {
    name: 'write turns on one microworld serialize; reads do not wait',
    proves:
      'two racing transactions each read the serial the other left, and a read during a transaction returns',
    async run(make) {
      const store = await make();
      await store.transaction('w', async (tx) => tx.putMicroworld(microworld('w')));
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let entered!: () => void;
      const inside = new Promise<void>((r) => (entered = r));
      const first = store.transaction('w', async (tx) => {
        entered();
        await gate;
        return mintOne(tx);
      });
      await inside;
      const second = store.transaction('w', async (tx) => mintOne(tx));
      const during = await store.read('w', async (tx) => (await tx.state()).serial);
      equal(during, 0, 'the read did not wait and saw nothing committed');
      release();
      equal(await Promise.all([first, second]), [1, 2], 'the second read what the first wrote');
      await store.read('w', async (tx) => {
        const state = await tx.state();
        equal(state.serial, 2, 'both serials issued');
        equal(
          state.instances.map((i) => i.id),
          ['shop#1', 'shop#2'],
          'both instances landed',
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
        await tx.putState(FIRST_TURN);
      });
      await store.read('w', async (tx) => {
        const before = await tx.state();
        await store.transaction('w', async (wtx) => {
          await wtx.putState({
            serial: 6,
            upsert: [],
            remove: ['shop#2'],
            tombstones: [],
            visitors: [],
          });
        });
        equal(await tx.state(), before, 'the read still sees what it began with');
      });
      await store.read('w', async (tx) =>
        equal((await tx.state()).serial, 6, 'a later read sees the commit'),
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
          await tx.putState(FIRST_TURN);
          await tx.appendAction(action('w', NOW));
          throw new Error('boom');
        })
        .catch(() => undefined);
      await store.read('w', async (tx) => {
        equal(await tx.state(), emptyState(), 'no state');
        equal(await tx.actions({ limit: 10 }), [], 'no action row');
      });
    },
  },
  {
    name: 'state is isolated by microworld',
    proves: "microworld A's state is invisible in B, though every id coincides",
    async run(make) {
      const store = await make();
      await store.transaction('a', async (tx) => {
        await tx.putMicroworld(microworld('a'));
        await tx.putState(FIRST_TURN);
      });
      await store.transaction('b', async (tx) => {
        await tx.putMicroworld(microworld('b'));
        await tx.putState({ ...FIRST_TURN, serial: 1, upsert: [WORLD], visitors: [] });
      });
      await store.read('b', async (tx) => {
        equal(
          await tx.state(),
          { serial: 1, instances: [WORLD], visitors: [], tombstones: ['shop.hall.vase'] },
          "B holds its own state and nothing of A's",
        );
      });
      await store.read('a', async (tx) => equal(await tx.state(), FIRST_STATE, 'A is untouched'));
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
    name: 'housekeeping: trim, destroyMicroworld, forgetVisitor, exportVisitor',
    proves:
      'the four store-level methods reach every microworld and nothing else; forgetting a visitor takes their record, their instance and what it held, and every memory of them',
    async run(make) {
      const store = await make();
      const t = (s: number) => new Date(NOW.getTime() + s * 1000);
      for (const id of ['a', 'b']) {
        await store.transaction(id, async (tx) => {
          await tx.putMicroworld(microworld(id));
          await tx.putState(FIRST_TURN);
          for (let i = 0; i < 3; i++) await tx.appendAction(action(id, t(i)));
          for (let i = 0; i < 3; i++) await tx.appendMiss(miss(id, t(i), `m${i}`));
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

      const kept = (microworldId: string) => ({
        microworldId,
        visitor: V_MARTA,
        instance: MARTA,
        memory: { 'shop.hall.lamp': { seen: flag(true), visits: count(2) } },
      });
      equal(
        await store.exportVisitor('v-marta'),
        { visit: 'v-marta', worlds: [kept('a'), kept('b')] },
        "Marta's record, instance and every memory of her, in both",
      );
      equal(
        await store.exportVisitor('v-nobody'),
        { visit: 'v-nobody', worlds: [] },
        'nothing for a visit no world holds',
      );

      await store.forgetVisitor('v-marta');
      await store.forgetVisitor('v-nobody');
      const forgotten: StoredState = {
        ...FIRST_STATE,
        instances: FIRST_STATE.instances
          .filter((i) => i.id !== 'shop#1' && i.id !== 'shop#3')
          .map((i) =>
            i.id === 'shop.hall.lamp' ? { ...i, memory: { 'shop#4': { seen: flag(false) } } } : i,
          ),
        visitors: [V_INES],
      };
      for (const id of ['a', 'b']) {
        await store.read(id, async (tx) => {
          const state = await tx.state();
          equal(state, forgotten, `Marta forgotten in ${id}, what she held with her, Ines kept`);
          loadable(state, `the state after forgetting, in ${id}`);
        });
      }
      equal(
        await store.exportVisitor('v-marta'),
        { visit: 'v-marta', worlds: [] },
        'nothing left to export',
      );

      await store.destroyMicroworld('a');
      await store.read('a', async (tx) => {
        equal(await tx.microworld(), null, 'a is gone');
        equal(await tx.state(), emptyState(), 'and its state');
        equal(await tx.actions({ limit: 10 }), [], 'and its actions');
      });
      await store.read('b', async (tx) => assert((await tx.microworld()) !== null, 'b stands'));
    },
  },
  {
    name: 'forgetting a visitor waits on the world’s write turns',
    proves:
      'a forget that starts while a turn holds the world lands after it, so the turn cannot write back a memory the forget took',
    async run(make) {
      const store = await make();
      await store.transaction('w', async (tx) => {
        await tx.putMicroworld(microworld('w'));
        await tx.putState(FIRST_TURN);
      });
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let entered!: () => void;
      const inside = new Promise<void>((r) => (entered = r));
      const turn = store.transaction('w', async (tx) => {
        const { serial, instances } = await tx.state();
        entered();
        await gate;
        const lamp = instances.find((i) => i.id === 'shop.hall.lamp')!;
        await tx.putState({
          serial,
          upsert: [{ ...lamp, properties: { ...lamp.properties, lit: flag(false) } }],
          remove: [],
          tombstones: [],
          visitors: [],
        });
      });
      await inside;
      const forget = store.forgetVisitor('v-marta');
      release();
      await Promise.all([turn, forget]);
      await store.read('w', async (tx) => {
        const lamp = (await tx.state()).instances.find((i) => i.id === 'shop.hall.lamp');
        equal(lamp?.properties['lit'], flag(false), 'the turn landed');
        equal(Object.keys(lamp?.memory ?? {}), ['shop#4'], 'and the forget after it');
      });
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
