// Profiles a world run by the C runtime compiled to WebAssembly (runtime-c/wasm/engine.c), the way
// scripts/profile-store.mjs profiles the TypeScript runtime as the server runs it: many visitors
// admitted, then each step one visitor chooses a verb of their scene, its readings are polled, and one
// of them is run as a command, after which every visitor's scene is polled again. The state stays
// live inside the instance; it is saved as the store would keep it only at each sample, to time that.
// Prints, every so many turns, what the engine's page pool holds and has held at most, what the
// instance's memory has grown to (it never shrinks), the JavaScript heap beside it, and the time a
// turn, a scene and a verb's readings took. Lines the TypeScript parser would answer are not run:
// parsing is the host's, and this engine is handed readings.
//
//   node --expose-gc scripts/profile-wasm.mjs <engine.wasm> <world folder> [--turns 1000]
//        [--visitors 8] [--seed 1] [--sample 100] [--json out.json]

import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { DEFAULT_LIMITS, emitCartridge, loadCartridge } from '@overstory/sprout/lang';
import { INSTALLED_EXTENSIONS } from '@overstory/sprout-player';

import { WasmEngine } from '../runtime-c/wasm/engine.mjs';
import { playableWorld } from './resolve-script.mjs';

function argsOf(argv) {
  const flags = { turns: 1000, visitors: 8, seed: 1, sample: 100 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i];
    else positional.push(argv[i]);
  }
  return { wasm: positional[0], world: positional[1], flags };
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
  const { wasm, world, flags } = argsOf(process.argv.slice(2));
  if (wasm === undefined || world === undefined) {
    console.error(
      'profile-wasm: write `node --expose-gc scripts/profile-wasm.mjs <engine.wasm> <world folder>`.',
    );
    return 2;
  }
  const cartridge = emitCartridge(playableWorld(world));
  const worldId = loadCartridge(cartridge, {
    caps: DEFAULT_LIMITS.caps,
    installed: INSTALLED_EXTENSIONS,
  }).world;
  let started = performance.now();
  const engine = await WasmEngine.open(wasm, cartridge, worldId);
  const loadMs = performance.now() - started;
  const loaded = engine.memory();
  console.log(
    `profile-wasm: loaded in ${loadMs.toFixed(0)} ms; the pool holds ${megabytes(loaded.held)} MB ` +
      `(${megabytes(loaded.peak)} MB at most), the instance has grown to ${megabytes(loaded.grown)} MB, ` +
      `the cartridge is ${megabytes(cartridge.length)} MB`,
  );

  const random = generator(Number(flags.seed));
  let now = 0;
  const seed = () => random.below(4294967296);
  const visits = [];
  for (let i = 0; i < Number(flags.visitors); i++) {
    const visit = `visit-${i}`;
    engine.arrive(visit, `V${i}`, seed(), now);
    visits.push(visit);
  }
  const scenes = new Map(visits.map((visit) => [visit, engine.scene(visit)]));
  const base = heapNow();

  const samples = [];
  let spentTurns = 0;
  let spentScenes = 0;
  let spentReadings = 0;
  let scened = 0;
  let ran = 0;
  let faulted = 0;
  const sample = (turn) => {
    const heap = heapNow();
    started = performance.now();
    const saved = engine.save();
    const saveMs = performance.now() - started;
    const memory = engine.memory();
    const row = {
      turn,
      held: memory.held,
      peak: memory.peak,
      grown: memory.grown,
      heap: heap - base,
      msPerTurn: ran === 0 ? 0 : spentTurns / ran,
      msPerScene: scened === 0 ? 0 : spentScenes / scened,
      msPerReadings: ran === 0 ? 0 : spentReadings / ran,
      saveMs,
      savedBytes: saved.length,
      faulted,
    };
    samples.push(row);
    console.log(
      `turn ${turn}: pool ${megabytes(row.held)} MB (peak ${megabytes(row.peak)}), instance ${megabytes(row.grown)} MB, ` +
        `js heap +${megabytes(row.heap)} MB, ${row.msPerTurn.toFixed(2)} ms/turn, ${row.msPerScene.toFixed(2)} ms/scene, ` +
        `${row.msPerReadings.toFixed(2)} ms a verb's readings, save ${megabytes(row.savedBytes)} MB in ${saveMs.toFixed(1)} ms, ` +
        `${faulted} turns faulted`,
    );
    spentTurns = 0;
    spentScenes = 0;
    spentReadings = 0;
    scened = 0;
    ran = 0;
    faulted = 0;
  };
  sample(0);
  for (let turn = 1; turn <= Number(flags.turns); turn++) {
    now += 5;
    const visit = random.pick(visits);
    const { verbs } = scenes.get(visit);
    if (verbs.length > 0) {
      started = performance.now();
      const { readings } = engine.readings(visit, random.pick(verbs));
      spentReadings += performance.now() - started;
      const typable = readings.filter((reading) => !reading.typed.includes('…'));
      if (typable.length > 0) {
        started = performance.now();
        const outcome = engine.command(visit, random.pick(typable), seed(), now);
        spentTurns += performance.now() - started;
        ran++;
        if (outcome.fault !== null) faulted++;
        started = performance.now();
        for (const v of visits) scenes.set(v, engine.scene(v));
        spentScenes += performance.now() - started;
        scened += visits.length;
      }
    }
    if (turn % Number(flags.sample) === 0) sample(turn);
  }
  if (flags.json !== undefined) writeFileSync(flags.json, JSON.stringify(samples, null, 1));
  {
    const usage = (globalThis.gc?.(), process.memoryUsage());
    console.log(
      `process: rss ${megabytes(usage.rss)} MB, js heap ${megabytes(usage.heapUsed)} MB, array buffers ${megabytes(usage.arrayBuffers)} MB`,
    );
  }
  return 0;
}

process.exit(await main());
