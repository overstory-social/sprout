// A differential fuzzer over the two runtimes. From a seed it builds a play
// of a world one step at a time: a visitor takes the view, and the step is
// a reading the view offered (sometimes a refused one), a line the parser
// will not read, a tick, a wake's worth of time or a new seed. Each step is
// played by the TypeScript runtime, and the play so far is replayed through
// `sproutc` from the same start and the same seeds; the first step on which
// they differ ends the run, and the sequence is written as a transcript,
// `corpus/good/<world>/transcripts/fuzz-<seed>.json`, to be fixed and kept.
//
//   node scripts/fuzz-runtime.mjs <world folder> --seed N [--steps 40]
//        [--visitors 2] [--sproutc path] [--out folder]
//
// While the C runtime answers that a part of itself is not built, the run
// says so and exits 0 with nothing written, since there is nothing yet to
// compare. Switching the fuzzer on is that answer going away. It is not part
// of the gate: it joins when the C runtime can run a turn, and until then
// it is run by hand.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  const flags = { steps: 40, visitors: 2 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i];
    else positional.push(argv[i]);
  }
  return { world: positional[0], flags };
}

/** The step to take next: what a visitor's view offers, or a host event. */
export function nextStep(stage, random) {
  const roll = random.below(100);
  if (roll < 6) return { seed: random.below(4294967296) };
  if (roll < 14) return { tick: true };
  if (roll < 20) return { advance: `${1 + random.below(90)} minutes` };
  const nickname = random.pick([...stage.visits.keys()]);
  if (roll < 28) return { as: nickname, type: random.pick(UNPARSED) };
  const { view } = pollView(stage.state, stage.host, stage.visits.get(nickname));
  // A reading with a slot to fill (`…`) wants a value the view lists as options; the fuzzer leaves those.
  const typable = view.readings.filter((reading) => !reading.typed.includes('…'));
  const refused = typable.filter((reading) => reading.refused !== null);
  const pool = refused.length > 0 && random.chance(0.3) ? refused : typable;
  if (pool.length === 0) return { as: nickname, type: random.pick(UNPARSED) };
  return { as: nickname, type: random.pick(pool).typed };
}

function main() {
  const { world, flags } = argsOf(process.argv.slice(2));
  if (world === undefined || flags.seed === undefined || !/^\d+$/.test(flags.seed)) {
    console.error(
      'fuzz-runtime: write `node scripts/fuzz-runtime.mjs <world folder> --seed N [--steps 40]`.',
    );
    process.exit(2);
  }
  const seed = Number(flags.seed);
  const sproutc = flags.sproutc ?? join(runtimeCBuild, 'sproutc');
  const scratch = mkdtempSync(join(tmpdir(), 'sprout-fuzz-'));
  const cartridge = join(scratch, 'world.sproutworld');
  const script = join(scratch, 'play.json');
  packWorld(world, cartridge);

  const random = generator(seed);
  const stage = freshStage(playableWorld(world));
  const steps = [];
  const play = (step) => {
    const made = playStep(stage, step, `fuzz step ${steps.length + 1}`);
    steps.push(made === null ? step : { ...step, expect: expectationsOf(made) });
  };
  play({ seed: random.below(4294967296) });
  for (const nickname of NICKNAMES.slice(0, Number(flags.visitors))) play({ arrive: nickname });

  let outcome = null;
  for (let i = 0; i < Number(flags.steps) && outcome === null; i++) {
    play(nextStep(stage, random));
    writeFileSync(script, writeScript({ about: `fuzz seed ${seed}`, steps }));
    const result = playAndCompare(sproutc, cartridge, script);
    if (result.how === 'not yet') {
      console.log(
        `fuzz-runtime: seed ${seed}: the C runtime says a part of itself is not built (${result.why}); nothing to compare yet.`,
      );
      rmSync(scratch, { recursive: true, force: true });
      return 0;
    }
    if (result.how !== 'passed') outcome = result;
  }
  if (outcome === null) {
    console.log(`fuzz-runtime: seed ${seed}: ${flags.steps} steps, no divergence.`);
    rmSync(scratch, { recursive: true, force: true });
    return 0;
  }
  const out = flags.out ?? join(world, 'transcripts');
  mkdirSync(out, { recursive: true });
  const file = join(out, `fuzz-${seed}.json`);
  writeFileSync(
    file,
    writeScript({
      about: `fuzz seed ${seed}: the first step on which the runtimes differ is the last.`,
      steps,
    }),
  );
  console.log(
    `fuzz-runtime: seed ${seed}: the runtimes ${outcome.how} after ${steps.length} steps: ${outcome.why}\nwrote ${file}`,
  );
  rmSync(scratch, { recursive: true, force: true });
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
