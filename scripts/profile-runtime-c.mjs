// Profiles the C runtime over a long play of one world, as the console plays it: one visitor, played through
// `sproutc play --profile`, which writes the bytes the runtime holds after each step and the most it held
// during it. The play is a script, played over and over,
// or a random one built a step at a time from what the visitor's view offers, with ticks, time moving on, the
// visitor leaving and coming back. A held figure that keeps climbing while the world does not is a leak.
//
//   node scripts/profile-runtime-c.mjs <world folder> [--steps 2000] [--seed 1] [--script play.json]
//        [--sproutc path] [--keep folder]
//
// Prints the loaded world's bytes and the most loading it held, the state's, and the held and peak figures
// over the play.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { emitCartridge } from '@overstory/sprout/lang';
import { checkWorld, formatCheck } from '@overstory/sprout-cli';
import { freshStage, isPresent, playStep, readScript, writeScript } from '@overstory/sprout-player';

import { runtimeCBuild } from './runtime-c-build.mjs';

const VISITOR = 'Marta';
const UNPARSED = ['xyzzy', 'dance wildly', 'take', 'go sideways'];

function argsOf(argv) {
  const flags = { steps: 2000, seed: 1 };
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

/** The next step of a one-visitor play: what the view offers, mostly, and now and then the host's events. */
function nextStep(stage, random) {
  if (!isPresent(stage, VISITOR)) return { arrive: VISITOR };
  const roll = random.below(100);
  if (roll < 5) return { tick: true };
  if (roll < 9) return { advance: `${1 + random.below(90)} minutes` };
  if (roll < 10) return { advance: `${1 + random.below(30)} hours` };
  if (roll < 11) return { leave: VISITOR };
  if (roll < 16) return { as: VISITOR, type: random.pick(UNPARSED) };
  const { view } = stage.engine.view(stage.stored, stage.visits.get(VISITOR));
  const typable = view.readings.filter((reading) => !reading.typed.includes('…'));
  if (typable.length === 0) return { as: VISITOR, type: random.pick(UNPARSED) };
  return { as: VISITOR, type: random.pick(typable).typed };
}

/** A random play of `steps` steps over `playable`, as a script. */
function randomScript(playable, steps, seed) {
  const random = generator(seed);
  const stage = freshStage(playable);
  const made = [{ seed: random.below(4294967296) }, { arrive: VISITOR }];
  for (const step of made) playStep(stage, step, 'profile');
  for (let i = 0; i < steps; i++) {
    const step = nextStep(stage, random);
    playStep(stage, step, `profile step ${i + 1}`);
    stage.turns.length = 0;
    made.push(step);
  }
  return { about: `profile seed ${seed}`, steps: made };
}

const megabytes = (bytes) => (bytes / 1048576).toFixed(2);

function main() {
  const { world, flags } = argsOf(process.argv.slice(2));
  if (world === undefined) {
    console.error('profile-runtime-c: write `node scripts/profile-runtime-c.mjs <world folder>`.');
    return 2;
  }
  const sproutc = flags.sproutc ?? join(runtimeCBuild, 'sproutc');
  const scratch = flags.keep ?? mkdtempSync(join(tmpdir(), 'sprout-profile-'));
  try {
    const checked = checkWorld(world);
    if (checked.bundle === null) {
      console.error(formatCheck(checked));
      return 1;
    }
    const playable = checked.bundle;
    const script =
      flags.script === undefined
        ? randomScript(playable, Number(flags.steps), Number(flags.seed))
        : readScript(readFileSync(flags.script, 'utf8'), flags.script);
    const cartridge = join(scratch, 'world.sproutworld');
    const scriptFile = join(scratch, 'play.json');
    const profile = join(scratch, 'profile.jsonl');
    writeFileSync(cartridge, emitCartridge(playable));
    writeFileSync(scriptFile, writeScript(script));
    const ran = spawnSync(
      sproutc,
      ['play', cartridge, '--script', scriptFile, '--profile', profile],
      {
        encoding: 'utf8',
        maxBuffer: 1 << 30,
      },
    );
    if (ran.status !== 0) {
      console.error(
        `profile-runtime-c: sproutc failed: ${ran.stderr.trim().split('\n').slice(-3).join(' ')}`,
      );
      return 1;
    }
    const rows = readFileSync(profile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const [loaded, ...steps] = rows;
    // The first turn lets go of pages the state opened with, so growth is measured from what it settles at.
    const settled = steps[0].held;
    const held = steps.map((row) => row.held - settled);
    const over = steps.map((row) => row.peak - row.held).sort((a, b) => a - b);
    const tenth = Math.max(1, Math.floor(steps.length / 10));
    console.log(
      `profile-runtime-c: world ${megabytes(loaded.world)} MB (loading it held at most ${megabytes(loaded.loadPeak)} MB), state ${megabytes(loaded.state)} MB as opened, ` +
        `${megabytes(loaded.state - (loaded.loaded - settled))} MB settled after the first step; ${steps.length} steps.`,
    );
    console.log(
      `  held beyond the first step's: first tenth ${megabytes(held.slice(0, tenth).reduce((a, b) => Math.max(a, b), -Infinity))} MB, ` +
        `last tenth ${megabytes(held.slice(-tenth).reduce((a, b) => Math.max(a, b), -Infinity))} MB, end ${megabytes(held.at(-1))} MB`,
    );
    console.log(
      `  a step's peak over what it held: median ${megabytes(over[Math.floor(over.length / 2)])} MB, ` +
        `p90 ${megabytes(over[Math.floor(over.length * 0.9)])} MB, max ${megabytes(over.at(-1))} MB`,
    );
    return 0;
  } finally {
    if (flags.keep === undefined) rmSync(scratch, { recursive: true, force: true });
  }
}

process.exit(main());
