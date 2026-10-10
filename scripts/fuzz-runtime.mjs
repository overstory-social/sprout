// A differential fuzzer over the two runtimes. From a seed it builds a play of a world one step at a
// time: a visitor takes the view, and the step is a reading the view offered (sometimes a refused one), a
// line the parser will not read, a tick, time moving on (an hour, a night), a visitor leaving or coming
// back, or a new seed. The whole play is run by the TypeScript runtime and then through `sproutc` from the
// same start and the same seeds, and compared as the corpus replay compares a transcript: the lines
// readers read, the entry the log keeps of each turn, and the stored world after each step. The first step
// on which they differ ends the run, and the sequence up to it is written as a transcript,
// `corpus/good/<world>/transcripts/fuzz-<seed>.json`, to be fixed and kept.
//
//   node scripts/fuzz-runtime.mjs <world folder> --seed N [--steps 40] [--visitors 2]
//        [--sproutc path] [--out folder]
//   node scripts/fuzz-runtime.mjs --corpus [--readings 2000] [--seed 1] [--steps 60]
//        [--sproutc path] [--out folder]
//
// The second form fuzzes every world under `corpus/good`, each for its share of the readings asked for,
// and reports the total; it is what the end-to-end run does, for a fixed seed, so it is the same play
// every time. Exit 0 when nothing differed, 1 when something did.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pollView } from '@overstory/sprout/lang';
import { expectationsOf, freshStage, playStep, writeScript } from '@overstory/sprout-player';

import { packWorld, playAndCompare } from './replay-runtime-c.mjs';
import { playableWorld } from './resolve-script.mjs';
import { runtimeCBuild } from './runtime-c-build.mjs';

const NICKNAMES = ['Marta', 'Ines', 'Odo', 'Pell'];
const UNPARSED = ['xyzzy', 'dance wildly', 'take', 'go sideways', 'again and again'];

/** A small deterministic generator: the same seed gives the same play. */
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

function argsOf(argv) {
  const flags = { steps: 40, visitors: 2, readings: 2000 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--corpus') flags.corpus = true;
    else if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i];
    else positional.push(argv[i]);
  }
  return { world: positional[0], flags };
}

/** Whether `nickname` stands in the world under `stage` now. */
function present(stage, nickname) {
  const visit = stage.visits.get(nickname);
  const record = visit === undefined ? undefined : stage.state.visitors.get(visit);
  return record !== undefined && Boolean(stage.state.instances.get(record.instance)?.container);
}

/** The step to take next: what a visitor's view offers, or a host event. */
export function nextStep(stage, random) {
  const here = NICKNAMES.filter((nickname) => present(stage, nickname));
  const away = NICKNAMES.filter((nickname) => !present(stage, nickname));
  const roll = random.below(100);
  if (here.length === 0) return { arrive: random.pick(NICKNAMES) };
  if (roll < 4) return { seed: random.below(4294967296) };
  if (roll < 10) return { tick: true };
  if (roll < 16) return { advance: `${1 + random.below(90)} minutes` };
  if (roll < 19) return { advance: `${1 + random.below(30)} hours` };
  if (roll < 23) return { leave: random.pick(here) };
  if (roll < 27 && away.length > 0) return { arrive: random.pick(away) };
  const nickname = random.pick(here);
  if (roll < 34) return { as: nickname, type: random.pick(UNPARSED) };
  const { view } = pollView(stage.state, stage.host, stage.visits.get(nickname));
  // A reading with a slot to fill (`…`) wants a value the view lists as options; the fuzzer leaves those.
  const typable = view.readings.filter((reading) => !reading.typed.includes('…'));
  const refused = typable.filter((reading) => reading.refused !== null);
  const pool = refused.length > 0 && random.chance(0.3) ? refused : typable;
  if (pool.length === 0) return { as: nickname, type: random.pick(UNPARSED) };
  return { as: nickname, type: random.pick(pool).typed };
}

/**
 * One fuzzed play of `world`: up to `steps` steps (and `readings` typed lines, where given) are built with
 * the TypeScript runtime, then compared with `sproutc`. The result says how many readings the play held and,
 * where the runtimes differed, the transcript to keep and the words about it.
 */
export function fuzzWorld(world, seed, { steps, visitors, readings = Infinity, sproutc }) {
  const scratch = mkdtempSync(join(tmpdir(), 'sprout-fuzz-'));
  try {
    const cartridge = join(scratch, 'world.sproutworld');
    const script = join(scratch, 'play.json');
    packWorld(world, cartridge);
    const random = generator(seed);
    const stage = freshStage(playableWorld(world));
    const made = [];
    let typed = 0;
    const play = (step) => {
      const lines = playStep(stage, step, `fuzz step ${made.length + 1}`);
      made.push(lines === null ? step : { ...step, expect: expectationsOf(lines) });
      if ('as' in step) typed++;
    };
    play({ seed: random.below(4294967296) });
    for (const nickname of NICKNAMES.slice(0, Number(visitors))) play({ arrive: nickname });
    for (let i = 0; i < Number(steps) && typed < readings; i++) play(nextStep(stage, random));
    writeFileSync(script, writeScript({ about: `fuzz seed ${seed}`, steps: made }));
    const result = playAndCompare(sproutc, cartridge, script);
    if (result.how === 'passed') return { typed, ran: made.length, differs: null };
    const at = /step (\d+)/.exec(result.why);
    const kept = at === null ? made : made.slice(0, Number(at[1]) + 1);
    return {
      typed,
      ran: made.length,
      differs: {
        words: `${result.how}: ${result.why}`,
        transcript: writeScript({
          about: `fuzz seed ${seed}: the first step on which the runtimes differ is the last.`,
          steps: kept,
        }),
      },
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function usage() {
  console.error(
    'fuzz-runtime: write `node scripts/fuzz-runtime.mjs <world folder> --seed N [--steps 40]`, or `node scripts/fuzz-runtime.mjs --corpus [--readings 2000]`.',
  );
  process.exit(2);
}

function main() {
  const { world, flags } = argsOf(process.argv.slice(2));
  const sproutc = flags.sproutc ?? join(runtimeCBuild, 'sproutc');
  const options = { steps: flags.steps, visitors: flags.visitors, sproutc };
  if (flags.corpus === true) {
    const base = flags.seed === undefined ? 1 : Number(flags.seed);
    const worlds = readdirSync('corpus/good').sort();
    const share = Math.ceil(Number(flags.readings) / worlds.length);
    let total = 0;
    let failed = 0;
    for (const [at, name] of worlds.entries()) {
      const folder = join('corpus/good', name);
      const result = fuzzWorld(folder, base + at, {
        ...options,
        steps: Math.max(Number(flags.steps), share * 4),
        readings: share,
      });
      total += result.typed;
      if (result.differs === null) continue;
      failed++;
      const out = flags.out ?? join(folder, 'transcripts');
      mkdirSync(out, { recursive: true });
      const file = join(out, `fuzz-${base + at}.json`);
      writeFileSync(file, result.differs.transcript);
      console.log(
        `fuzz-runtime: ${name}, seed ${base + at}: ${result.differs.words}\nwrote ${file}`,
      );
    }
    console.log(
      `fuzz-runtime: ${worlds.length} worlds, ${total} readings, ${failed === 0 ? 'no divergence' : `${failed} world${failed === 1 ? '' : 's'} diverged`}.`,
    );
    return failed === 0 ? 0 : 1;
  }
  if (world === undefined || flags.seed === undefined || !/^\d+$/.test(flags.seed)) usage();
  const seed = Number(flags.seed);
  const result = fuzzWorld(world, seed, options);
  if (result.differs === null) {
    console.log(
      `fuzz-runtime: seed ${seed}: ${result.ran} steps, ${result.typed} readings, no divergence.`,
    );
    return 0;
  }
  const out = flags.out ?? join(world, 'transcripts');
  if (!existsSync(out)) mkdirSync(out, { recursive: true });
  const file = join(out, `fuzz-${seed}.json`);
  writeFileSync(file, result.differs.transcript);
  console.log(`fuzz-runtime: seed ${seed}: the runtimes ${result.differs.words}\nwrote ${file}`);
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
