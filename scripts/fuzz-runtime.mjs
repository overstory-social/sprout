// A differential fuzzer over the two runtimes. From a seed it builds a play of a world one step at a
// time: a visitor takes the view, and the step is a line typed (a reading the view offered, sometimes a
// refused one, as it is or perturbed: its thing named by a pronoun, by its adjectives alone, or left out of
// `all`, two of them chained, a word nobody knows put in, `again`), a line the parser will not read, a tick,
// time moving on (an hour, a night), a visitor leaving or coming back, or a new seed. Both runtimes read
// every typed line themselves. The whole play is run by the TypeScript runtime and then through `sproutc` from the
// same start and the same seeds, and compared as the corpus replay compares a transcript: the lines
// readers read, the entry the log keeps of each turn, and the stored world after each step. The first step
// on which they differ ends the run, and the sequence up to it is written as a transcript,
// `corpus/good/<world>/transcripts/fuzz-<seed>.json`, to be fixed and kept. Where the play agrees, every
// visitor still in the world at its end is polled in parts through `sproutc view`: the scene, and the readings
// of each verb it lists, against the TypeScript runtime's (`comparePolls`); a difference there writes the
// whole play, whose last step leaves the world the polls differ over.
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

import { DEFAULT_LIMITS, saveWorld } from '@overstory/sprout/lang';
import { loaded, tsEngine } from '@overstory/sprout/core';
import {
  expectationsOf,
  freshStage,
  isPresent,
  playStep,
  writeScript,
} from '@overstory/sprout-player';

import { comparePolls, packWorld, playAndCompare } from './replay-runtime-c.mjs';
import { playableWorld } from './resolve-script.mjs';
import { runtimeCBuild } from './runtime-c-build.mjs';

const NICKNAMES = ['Marta', 'Ines', 'Odo', 'Pell'];

// The budgets a play may be held to, so the faults of a turn that spends its figure are fuzzed too: the
// host's defaults, and then figures small enough that a world's own bodies reach them, and a step budget a
// line's reading reaches part way. Both runtimes are set to the same.
const BUDGETS = [
  {},
  { events: 3, cascadeDepth: 2 },
  { output: 90 },
  { spawnsPerTurn: 1, passageDepth: 2 },
  { peoplePerPlace: 1 },
  { setRoleObjects: 2, events: 6 },
  { steps: 400 },
];
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

/**
 * The first way `sproutc`'s polls of each visitor in the world under `stage` differ from the TypeScript
 * runtime's, both under the host's default budgets, which `sproutc view` polls under; null where they agree.
 */
function pollsDiffer(sproutc, cartridge, stage, scratch) {
  const stored = join(scratch, 'end.json');
  writeFileSync(stored, JSON.stringify(saveWorld(loaded(stage.stored, stage.host))));
  const host = { ...stage.host, budgets: DEFAULT_LIMITS.budgets };
  const engine = tsEngine(host);
  for (const nickname of NICKNAMES.filter((one) => isPresent(stage, one))) {
    const visit = stage.visits.get(nickname);
    const place = engine.standing(stage.stored, visit).place.id;
    const { differs } = comparePolls(sproutc, cartridge, stored, {
      stored: stage.stored,
      engine,
      host,
      visit,
      place,
    });
    if (differs !== null) return `for ${nickname}, ${differs}`;
  }
  return null;
}

const PRONOUNS = ['it', 'them', 'her', 'him'];
const JOINERS = [' and ', ', ', ' then ', '. '];

/** What `typed` calls the thing `filler` holds, without its article, where the line writes it; null otherwise. */
function namedIn(typed, filler) {
  if (filler?.binds !== 'object') return null;
  const name = filler.name.toLowerCase().replace(/^(a|an|the|some) /, '');
  return typed.toLowerCase().includes(name) ? name : null;
}

/**
 * `reading`'s line, perturbed one way or another, so the parser is fuzzed past the lines the view writes: its thing
 * named by a pronoun or by its adjectives alone, left out of `all`, chained with `other`'s, a word nobody knows put
 * in, or `again`; the line as written where a way does not apply to it.
 */
export function perturbed(reading, other, random) {
  const typed = reading.typed;
  const filler = reading.fillers.find((one) => namedIn(typed, one) !== null);
  const name = namedIn(typed, filler);
  const at = name === null ? -1 : typed.toLowerCase().indexOf(name);
  const before = at < 0 ? '' : typed.slice(0, at).replace(/\b(a|an|the|some) $/i, '');
  const words = typed.split(' ');
  switch (random.below(6)) {
    case 0:
      return at < 0 ? typed : `${before}${random.pick(PRONOUNS)}${typed.slice(at + name.length)}`;
    case 1: {
      const adjectives = name?.split(' ').slice(0, -1).join(' ') ?? '';
      return adjectives === ''
        ? typed
        : `${typed.slice(0, at)}${adjectives}${typed.slice(at + name.length)}`;
    }
    case 2:
      return at < 0 ? typed : `${before.trim()} all${random.chance(0.7) ? ` except ${name}` : ''}`;
    case 3:
      return `${typed}${random.pick(JOINERS)}${other.typed}`;
    case 4: {
      const where = random.below(words.length + 1);
      return [...words.slice(0, where), 'florble', ...words.slice(where)].join(' ');
    }
    default:
      return random.pick(['again', 'g']);
  }
}

/** The step to take next: what a visitor's view offers, or a host event. */
export function nextStep(stage, random) {
  const here = NICKNAMES.filter((nickname) => isPresent(stage, nickname));
  const away = NICKNAMES.filter((nickname) => !isPresent(stage, nickname));
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
  const { view } = stage.engine.view(stage.stored, stage.visits.get(nickname));
  // A reading with a slot to fill (`…`) wants a value the view lists as options; the fuzzer leaves those.
  const typable = view.readings.filter((reading) => !reading.typed.includes('…'));
  const refused = typable.filter((reading) => reading.refused !== null);
  const pool = refused.length > 0 && random.chance(0.3) ? refused : typable;
  if (pool.length === 0) return { as: nickname, type: random.pick(UNPARSED) };
  const reading = random.pick(pool);
  if (random.chance(0.5)) return { as: nickname, type: reading.typed };
  return { as: nickname, type: perturbed(reading, random.pick(typable), random) };
}

/**
 * One fuzzed play of `world`: up to `steps` steps (and `readings` typed lines, where given) are built with
 * the TypeScript runtime, then compared with `sproutc`. The result says how many readings the play held and,
 * where the runtimes differed, the transcript to keep and the words about it.
 */
export function fuzzWorld(
  world,
  seed,
  { steps, visitors, readings = Infinity, sproutc, budgets = {} },
) {
  const scratch = mkdtempSync(join(tmpdir(), 'sprout-fuzz-'));
  try {
    const cartridge = join(scratch, 'world.sproutworld');
    const script = join(scratch, 'play.json');
    packWorld(world, cartridge);
    const random = generator(seed);
    const stage = freshStage(playableWorld(world), 'ts', budgets);
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
    const result = playAndCompare(sproutc, cartridge, script, false, budgets);
    if (result.how === 'passed') {
      const polls = pollsDiffer(sproutc, cartridge, stage, scratch);
      if (polls === null) return { typed, ran: made.length, differs: null };
      return {
        typed,
        ran: made.length,
        differs: {
          words: `differ in their polls once the last step is over: ${polls}`,
          transcript: writeScript({
            about: `fuzz seed ${seed}${Object.keys(budgets).length === 0 ? '' : ` under the budgets ${JSON.stringify(budgets)}`}: the runtimes' polls differ once the last step is over.`,
            steps: made,
          }),
        },
      };
    }
    const at = /step (\d+)/.exec(result.why);
    const kept = at === null ? made : made.slice(0, Number(at[1]) + 1);
    return {
      typed,
      ran: made.length,
      differs: {
        words: `${result.how}: ${result.why}`,
        transcript: writeScript({
          about: `fuzz seed ${seed}${Object.keys(budgets).length === 0 ? '' : ` under the budgets ${JSON.stringify(budgets)}`}: the first step on which the runtimes differ is the last.`,
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
        budgets: BUDGETS[(base + at) % BUDGETS.length],
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
