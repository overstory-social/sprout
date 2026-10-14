// Profiles the TypeScript runtime over a long play of one world: the heap after a forced collection every
// so many steps, the time each turn took, how many handlers ran, and the world's own size, so a leak shows as a
// heap that keeps climbing while the world does not. The play is a script, played over and over, or a
// random one built as the fuzzer builds its plays, a step at a time from what each visitor's view offers.
// Nothing the play makes is kept beyond the sample, so what grows is the runtime's.
//
//   node --expose-gc scripts/profile-runtime.mjs <world folder> [--steps 2000] [--visitors 2] [--seed 1]
//        [--sample 100] [--script play.json] [--json out.json] [--snapshot 1000,6000 --snapshot-dir dir]
//
// --visitors is how many arrive at the start; a random play may bring others of the fuzzer's four in and
// out after. Prints one line per sample and a summary, with how many steps of a script could not be played
// and the first one's words; --json writes every sample; --snapshot writes a V8 heap snapshot after each
// step it names, into --snapshot-dir, to diff.

import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { writeHeapSnapshot } from 'node:v8';

import { loaded } from '@overstory/sprout/core';
import { saveWorld } from '@overstory/sprout/lang';
import { freshStage, playStep, readScript } from '@overstory/sprout-player';

import { nextStep } from './fuzz-runtime.mjs';
import { playableWorld } from './resolve-script.mjs';

const NICKNAMES = ['Marta', 'Ines', 'Odo', 'Pell'];

function argsOf(argv) {
  const flags = { steps: 2000, visitors: 2, seed: 1, sample: 100 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i];
    else positional.push(argv[i]);
  }
  return { world: positional[0], flags };
}

/** The same deterministic generator the fuzzer uses, so a seed is the same play. */
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
    chance: (p) => next() < p,
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

function main() {
  const { world, flags } = argsOf(process.argv.slice(2));
  if (world === undefined) {
    console.error(
      'profile-runtime: write `node --expose-gc scripts/profile-runtime.mjs <world folder>`.',
    );
    return 2;
  }
  if (globalThis.gc === undefined)
    console.error('profile-runtime: run node with --expose-gc for heap figures.');
  const playable = playableWorld(world);
  const base = heapNow();
  let stage = freshStage(playable, 'ts');
  const random = generator(Number(flags.seed));
  const script =
    flags.script === undefined
      ? null
      : readScript(readFileSync(flags.script, 'utf8'), flags.script);
  const samples = [];
  let at = 0;
  let turns = 0;
  let handlers = 0;
  let slowest = 0;
  let spent = 0;
  let unplayed = 0;
  let firstUnplayed = null;
  const play = (step) => {
    const started = performance.now();
    playStep(stage, step, `profile step ${at + 1}`);
    const took = performance.now() - started;
    spent += took;
    slowest = Math.max(slowest, took);
    for (const traced of stage.turns) {
      turns++;
      handlers += traced.account?.ran.length ?? 0;
    }
    stage.turns.length = 0;
    at++;
  };
  if (script === null) {
    play({ seed: random.below(4294967296) });
    for (const nickname of NICKNAMES.slice(0, Number(flags.visitors))) play({ arrive: nickname });
  }
  const sample = () => {
    const heap = heapNow();
    const state = loaded(stage.stored, stage.host);
    const stored = JSON.stringify(saveWorld(state)).length;
    const row = {
      step: at,
      turns,
      handlers,
      heap: heap - base,
      instances: state.instances.size,
      visitors: state.visitors.size,
      stored,
      msPerStep: spent / Math.max(1, Number(flags.sample)),
      slowest,
    };
    samples.push(row);
    console.log(
      `step ${row.step}: heap ${megabytes(row.heap)} MB, ${row.instances} instances, stored ${megabytes(stored)} MB, ` +
        `${row.turns} turns, ${row.handlers} handlers, ${row.msPerStep.toFixed(2)} ms/step (slowest ${slowest.toFixed(1)})`,
    );
    spent = 0;
    slowest = 0;
  };
  sample();
  for (let i = 0; i < Number(flags.steps); i++) {
    if (script !== null) {
      const step = script.steps[i % script.steps.length];
      if (i > 0 && i % script.steps.length === 0) {
        // Each pass of a script starts afresh, world, clock and seed, as a new play would: what grows across passes leaked.
        stage = freshStage(playable, 'ts');
      }
      try {
        play(step);
      } catch (error) {
        unplayed++;
        firstUnplayed ??= error instanceof Error ? error.message : String(error);
        at++;
      }
    } else play(nextStep(stage, random));
    if ((i + 1) % Number(flags.sample) === 0) sample();
    if (flags.snapshot !== undefined && flags.snapshot.split(',').includes(String(i + 1))) {
      heapNow();
      console.log(
        `wrote ${writeHeapSnapshot(`${flags['snapshot-dir'] ?? '.'}/step-${i + 1}.heapsnapshot`)}`,
      );
    }
  }
  const first = samples[1] ?? samples[0];
  const last = samples.at(-1);
  console.log(
    `profile-runtime: ${at} steps, ${turns} turns; heap ${megabytes(first.heap)} → ${megabytes(last.heap)} MB, ` +
      `peak ${megabytes(Math.max(...samples.map((s) => s.heap)))} MB.`,
  );
  if (unplayed > 0)
    console.log(
      `profile-runtime: ${unplayed} steps could not be played; the first: ${firstUnplayed}`,
    );
  if (flags.json !== undefined) writeFileSync(flags.json, JSON.stringify(samples, null, 1));
  return 0;
}

process.exit(main());
