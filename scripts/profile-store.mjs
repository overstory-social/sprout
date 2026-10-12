// Profiles a world served as the server serves it: published into core's memory store, many visitors
// admitted, and each command a write turn under the world's lock with every stale view polled again
// afterwards, as a client is sent its view. Prints, every so many turns, the heap after a forced collection,
// the time a turn and its views took, and the length of the world's log, so the cost of each visitor and of a
// long-running world shows.
//
//   node --expose-gc scripts/profile-store.mjs <world folder> [--turns 1000] [--visitors 8] [--seed 1]
//        [--sample 100] [--views 1] [--json out.json]
//
// --views 0 skips polling the stale views, to tell a turn's cost from its views'.

import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import {
  memoryStore,
  publishWorld,
  runArrival,
  runCommandLine,
  runView,
} from '@overstory/sprout/core';
import { DEFAULT_LIMITS, catalogueOf, parseCommand, renderEffects } from '@overstory/sprout/lang';

import { playableWorld } from './resolve-script.mjs';

const UNPARSED = ['xyzzy', 'dance wildly', 'take', 'go sideways'];

function argsOf(argv) {
  const flags = { turns: 1000, visitors: 8, seed: 1, sample: 100, views: 1 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i];
    else positional.push(argv[i]);
  }
  return { world: positional[0], flags };
}

function generator(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    below: (n) => Math.floor(next() * n),
    pick: (list) => list[Math.floor(next() * list.length)],
  };
}

const megabytes = (bytes) => (bytes / 1048576).toFixed(2);

function heapNow() {
  globalThis.gc?.();
  globalThis.gc?.();
  return process.memoryUsage().heapUsed;
}

async function main() {
  const { world, flags } = argsOf(process.argv.slice(2));
  if (world === undefined) {
    console.error(
      'profile-store: write `node --expose-gc scripts/profile-store.mjs <world folder>`.',
    );
    return 2;
  }
  const bundle = playableWorld(world);
  const catalogue = catalogueOf(bundle, DEFAULT_LIMITS.caps);
  const host = {
    catalogue,
    budgets: DEFAULT_LIMITS.budgets,
    render: renderEffects,
    parse: parseCommand,
  };
  const id = catalogue.world;
  const base = heapNow();
  const store = memoryStore();
  const record = {
    id,
    archive: { files: [], manifest: null },
    stamp: bundle.hash,
    level: bundle.level,
    extensions: bundle.extensions.map((one) => one.name),
    caps: DEFAULT_LIMITS.caps,
    excepted: false,
    loadedAt: new Date(0),
  };
  let now = 0;
  await publishWorld(store, record, bundle, now);
  const random = generator(Number(flags.seed));
  const inputs = () => ({ seed: random.below(4294967296), mayHold: null, now });
  const visits = [];
  for (let i = 0; i < Number(flags.visitors); i++) {
    const visit = `visit-${i}`;
    await runArrival(
      store,
      id,
      host,
      inputs(),
      { ...inputs(), visit, nickname: `V${i}` },
      {
        moderate: () => true,
      },
    );
    visits.push(visit);
  }
  const views = new Map();
  for (const visit of visits) views.set(visit, (await runView(store, id, host, visit, now)).view);
  const samples = [];
  let spentTurns = 0;
  let spentViews = 0;
  let polled = 0;
  const sample = (turn) => {
    const heap = heapNow();
    const live = store.worlds.get(id);
    const row = {
      turn,
      heap: heap - base,
      log: live.log.length,
      msPerTurn: spentTurns / Number(flags.sample),
      msPerView: polled === 0 ? 0 : spentViews / polled,
      viewsPerTurn: polled / Number(flags.sample),
    };
    samples.push(row);
    console.log(
      `turn ${turn}: heap ${megabytes(row.heap)} MB, log ${row.log} entries, ${row.msPerTurn.toFixed(2)} ms/turn, ` +
        `${row.viewsPerTurn.toFixed(1)} views/turn at ${row.msPerView.toFixed(2)} ms each`,
    );
    spentTurns = 0;
    spentViews = 0;
    polled = 0;
  };
  sample(0);
  for (let turn = 1; turn <= Number(flags.turns); turn++) {
    now += 5;
    const visit = random.pick(visits);
    const view = views.get(visit);
    const typable =
      view === null ? [] : view.readings.filter((reading) => !reading.typed.includes('…'));
    const text =
      typable.length === 0 || random.below(10) === 0
        ? random.pick(UNPARSED)
        : random.pick(typable).typed;
    let started = performance.now();
    const ran = await runCommandLine(store, id, host, { ...inputs(), visit, text }, () =>
      random.below(4294967296),
    );
    spentTurns += performance.now() - started;
    const stale = new Set();
    for (const one of ran) if (one.committed) for (const v of one.stale) stale.add(v);
    if (Number(flags.views) !== 0) {
      started = performance.now();
      for (const v of stale) {
        if (!visits.includes(v)) continue;
        views.set(v, (await runView(store, id, host, v, now)).view);
        polled++;
      }
      spentViews += performance.now() - started;
    } else if (stale.has(visit))
      views.set(visit, (await runView(store, id, host, visit, now)).view);
    if (turn % Number(flags.sample) === 0) sample(turn);
  }
  if (flags.json !== undefined) writeFileSync(flags.json, JSON.stringify(samples, null, 1));
  return 0;
}

process.exit(await main());
