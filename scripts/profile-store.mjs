// Profiles a world served as the server serves it: published into core's memory store, many visitors
// admitted, and each command a write turn under the world's lock with every stale scene polled again
// afterwards, as a client is sent its status and verbs. Each command is chosen as a client completing a line
// would: one verb of the visitor's scene, and that verb's readings polled. Prints, every so many turns, the
// heap after a forced collection, the time a turn, its scenes and its readings took, how many polls ran out of
// budget, and the length of the world's log, so the cost of each visitor and of a long-running world shows,
// beside what the world itself holds as the server serves it.
//
//   node --expose-gc scripts/profile-store.mjs <world folder> [--turns 1000] [--visitors 8] [--seed 1]
//        [--sample 100] [--views 1] [--depth play|debug] [--keep-log N] [--json out.json]
//
// --views 0 skips polling the stale scenes, to tell a turn's cost from its scenes'. --depth is the log's
// depth (play unless said); --keep-log bounds each world's log as the server's memory store does, and
// keeps it whole unless said.

import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import {
  memoryStore,
  publishWorld,
  runArrival,
  runCommandLine,
  runReadings,
  runScene,
} from '@overstory/sprout/core';
import {
  DEFAULT_LIMITS,
  emitCartridge,
  loadCartridge,
  parseCommand,
  renderEffects,
} from '@overstory/sprout/lang';

import { INSTALLED_EXTENSIONS } from '@overstory/sprout-player';

import { playableWorld } from './resolve-script.mjs';

const UNPARSED = ['xyzzy', 'dance wildly', 'take', 'go sideways'];

function argsOf(argv) {
  const flags = { turns: 1000, visitors: 8, seed: 1, sample: 100, views: 1, depth: 'play' };
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

/** What the server keeps of a compiled world: the catalogue its cartridge reads back, and its bundle's stamp. */
function served(bundle) {
  const { hash, level, extensions } = bundle;
  return {
    catalogue: loadCartridge(emitCartridge(bundle), {
      caps: DEFAULT_LIMITS.caps,
      installed: INSTALLED_EXTENSIONS,
    }),
    stamp: { hash, level, extensions },
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
  const before = heapNow();
  // The server runs a world from the catalogue its cartridge reads back, and keeps the bundle's stamp alone.
  const { catalogue, stamp } = served(playableWorld(world));
  const host = {
    catalogue,
    budgets: DEFAULT_LIMITS.budgets,
    render: renderEffects,
    parse: parseCommand,
    logDepth: flags.depth,
  };
  const id = catalogue.world;
  const base = heapNow();
  console.log(`profile-store: the world as served holds ${megabytes(base - before)} MB`);
  const store = memoryStore(
    flags['keep-log'] === undefined ? {} : { keepLog: Number(flags['keep-log']) },
  );
  const record = {
    id,
    archive: { files: [], manifest: null },
    stamp: stamp.hash,
    level: stamp.level,
    extensions: stamp.extensions.map((one) => one.name),
    caps: DEFAULT_LIMITS.caps,
    excepted: false,
    loadedAt: new Date(0),
  };
  let now = 0;
  await publishWorld(store, record, stamp, now);
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
  const scenes = new Map();
  for (const visit of visits)
    scenes.set(visit, (await runScene(store, id, host, visit, now)).scene);
  const samples = [];
  let spentTurns = 0;
  let spentScenes = 0;
  let spentReadings = 0;
  let polled = 0;
  let faulted = 0;
  const sample = (turn) => {
    const heap = heapNow();
    const live = store.worlds.get(id);
    const per = Number(flags.sample);
    const row = {
      turn,
      heap: heap - base,
      log: live.dropped + live.log.length,
      kept: live.log.length,
      msPerTurn: spentTurns / per,
      msPerScene: polled === 0 ? 0 : spentScenes / polled,
      scenesPerTurn: polled / per,
      msPerReadings: spentReadings / per,
      faulted,
    };
    samples.push(row);
    console.log(
      `turn ${turn}: heap ${megabytes(row.heap)} MB, log ${row.log} entries (${row.kept} kept), ${row.msPerTurn.toFixed(2)} ms/turn, ` +
        `${row.scenesPerTurn.toFixed(1)} scenes/turn at ${row.msPerScene.toFixed(2)} ms each, ` +
        `${row.msPerReadings.toFixed(2)} ms a verb's readings, ${faulted} polls ran out`,
    );
    spentTurns = 0;
    spentScenes = 0;
    spentReadings = 0;
    polled = 0;
    faulted = 0;
  };
  sample(0);
  for (let turn = 1; turn <= Number(flags.turns); turn++) {
    now += 5;
    const visit = random.pick(visits);
    const { verbs } = scenes.get(visit);
    let typable = [];
    if (verbs.length > 0) {
      const started = performance.now();
      const asked = await runReadings(store, id, host, visit, random.pick(verbs).verb, now);
      spentReadings += performance.now() - started;
      if (asked.fault !== null) faulted++;
      typable = asked.readings.filter((reading) => !reading.typed.includes('…'));
    }
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
    const rescene = async (v) => {
      const polledScene = await runScene(store, id, host, v, now);
      if (polledScene.fault !== null) faulted++;
      scenes.set(v, polledScene.scene);
    };
    if (Number(flags.views) !== 0) {
      started = performance.now();
      for (const v of stale) {
        if (!visits.includes(v)) continue;
        await rescene(v);
        polled++;
      }
      spentScenes += performance.now() - started;
    } else if (stale.has(visit)) await rescene(visit);
    if (turn % Number(flags.sample) === 0) sample(turn);
  }
  if (flags.json !== undefined) writeFileSync(flags.json, JSON.stringify(samples, null, 1));
  return 0;
}

process.exit(await main());
