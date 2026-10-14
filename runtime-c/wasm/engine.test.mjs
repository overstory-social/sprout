// The WebAssembly engine (engine/, driven by @overstory/sprout-engine-wasm's WasmInstance) checked against the TypeScript runtime, and
// libc.c against the C standard (libc.test.c). Every corpus script is played by the TypeScript runtime
// (scripts/resolve-script.mjs) and then through the engine: arrivals, departures, ticks and wakes from the
// turns the TypeScript runtime logged, and each typed line as the engine reads it, the line handing out each
// command turn it runs (`line`, `lineNext`), each tick and wake under the seed the TypeScript runtime logged for it.
// Each step's lines, by reader, and the stored world after it must
// be what the TypeScript runtime left, and each turn must give what the TypeScript runtime's did: its effects,
// fault and who it cut short, whose views it made stale, what the store writes, and the entry core's log keeps
// at play depth, as core's builders make it, a command's with its words, the step a line planned and its draw.
// After each step, every visitor in the world is polled in parts (the spec's The runtime > The view): the
// scene, then the readings of each verb it lists, which must be the TypeScript runtime's `pollScene` and
// `pollReadings` over the same stored world. Then the export layer's edges: loading and opening again, input it
// cannot read, a reading built from chips, an entry at debug depth, and an arrival to a world that admits no
// one, which still has words for the person.
//
//   node runtime-c/wasm/engine.test.mjs <out folder of build.sh> [corpus/good]
//
// scripts/check-runtime-c.mjs runs it after building with build.sh.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { atDepth, loggedEffects } from '@overstory/sprout/core';
import {
  DEFAULT_LIMITS,
  loadCartridge,
  loadWorld,
  pollReadings,
  pollScene,
  renderEffects,
} from '@overstory/sprout/lang';
import { WasmInstance } from '@overstory/sprout-engine-wasm';
import { INSTALLED_EXTENSIONS } from '@overstory/sprout-player';

import { loggedEntryOf, packWorld } from '../../scripts/replay-runtime-c.mjs';
import { resolveFile } from '../../scripts/resolve-script.mjs';

/** A fresh instance of the engine at `wasm`, with `cartridge` loaded and a new state for `worldId`, under `budgets`. */
function opened(wasm, cartridge, worldId, budgets = {}) {
  const engine = new WasmInstance(new WebAssembly.Module(readFileSync(wasm)));
  engine.load(cartridge);
  engine.budgets({ ...DEFAULT_LIMITS.budgets, ...budgets }, DEFAULT_LIMITS.caps.listElements);
  engine.openEmpty(worldId);
  return engine;
}

/**
 * The corpus worlds whose scripts the engine plays, sorted: every one with a script. A world that comes or
 * goes from this list is a change to say so of.
 */
const EXPECTED_WORLDS = [
  'all-in-order',
  'all-leaves-out-refused',
  'allowed-first',
  'arrival-order',
  'brief',
  'cancel-wakes',
  'cannot',
  'carried',
  'carried-across',
  'chip-tree',
  'comma-commands',
  'darkness',
  'destroy-declared',
  'dotted-paths',
  'drop-here',
  'embedded-passage',
  'engine_lines',
  'exit-labels',
  'exit-say',
  'help_and_wait',
  'imports',
  'instance-scope',
  'intents',
  'media-room',
  'move',
  'moved-out-of-destroyed',
  'narrowing-and',
  'nested-offers',
  'no-way',
  'notices-through-gate',
  'out-of-reach-exit',
  'out-of-reach-synonym',
  'own-place',
  'printers_shop',
  'pronouns',
  'refusal-hands',
  'relatives',
  'requires-held',
  'roaming',
  'rounds',
  'runs',
  'sequences',
  'shut-contents',
  'standard-library',
  'synonyms',
  'take-from',
  'teashop',
  'troll_room',
  'turn-faults',
  'unknown-word',
  'value-first',
  'visitor-contents',
];

/** The checks that are not a world's, each of which must have run. */
const EXPECTED_CHECKS = ['libc.c', 'edges', 'closed arrival', 'debug depth'];

const visitOf = (nickname) => `visit:${nickname}`;

/** Seed 0 at the instant 0, for the checks that run a turn for what it says rather than what it draws. */
const AT = { seed: 0, now: 0 };

/** An engine's line as the readings file writes one. */
function said([visit, kind, words]) {
  return { reader: visit.startsWith('visit:') ? visit.slice(6) : visit, kind, words };
}

const lineOf = (one) => `${one.reader} (${one.kind}): ${one.words}`;

/** The first way `got` differs from `want`, line by line, in words; null where they agree. */
function linesDiffer(want, got) {
  for (let at = 0; at < Math.max(want.length, got.length); at++) {
    const a = want[at] === undefined ? '(nothing)' : lineOf(want[at]);
    const b = got[at] === undefined ? '(nothing)' : lineOf(got[at]);
    if (a !== b) return `line ${at + 1}: the engine says ${b} and the TypeScript runtime says ${a}`;
  }
  return null;
}

/** What a turn gave the host, as the TypeScript runtime's entry `want` has it: the fields both give. */
const GIVEN = ['fault', 'effects', 'cutShort', 'stale', 'changes'];

/** The first way the engine's `outcome` differs from the TypeScript runtime's turn `want`, in words; null where it agrees. */
function turnDiffers(want, outcome, budgets) {
  for (const field of GIVEN) {
    if (!isDeepStrictEqual(outcome[field], want[field])) {
      return `its ${field} is ${JSON.stringify(outcome[field])} where the TypeScript runtime's is ${JSON.stringify(want[field])}`;
    }
  }
  const entry = loggedEntryOf(want, budgets) ?? null;
  if (!isDeepStrictEqual(outcome.entry, entry)) {
    return `its entry is ${JSON.stringify(outcome.entry)} where core's is ${JSON.stringify(entry)}`;
  }
  return null;
}

/**
 * The turns `step` ran, each run through `engine` beside the TypeScript runtime's entry for it: `{ want, outcome }`. A
 * typed line's turns are the ones the engine's line hands out, the first under the step's seed and each after it the
 * next; one the TypeScript runtime did not run has no `want`.
 */
function playStep(engine, step) {
  const ran = [];
  if (step.kind === 'command') {
    const visit = visitOf(step.nickname);
    for (
      let command = engine.line(visit, step.typed);
      command !== null;
      command = engine.lineNext(command.line)
    ) {
      const seed = (step.seed + ran.length) % 2 ** 32;
      const outcome = engine.command(command, { seed, now: step.atSeconds });
      ran.push({ want: step.after?.turns[ran.length], outcome });
    }
    return ran;
  }
  for (const want of step.after?.turns ?? []) {
    const at = { seed: want.seed, now: want.seconds };
    let outcome;
    if (want.kind === 'maintenance') outcome = engine.maintenance(at);
    else if (want.kind === 'arrival') outcome = engine.arrive(want.who, want.nickname, at);
    else if (want.kind === 'departure') outcome = engine.depart(want.who, at);
    else if (want.kind === 'tick') outcome = engine.tick(want.who, at);
    else outcome = engine.wake(want.who, want.wake, at);
    ran.push({ want, outcome });
  }
  return ran;
}

/**
 * The first way the engine's polls of every visitor in the stored world `stored` differ from the TypeScript
 * runtime's under `host`, in words; null where they agree: the scene, its verbs with their phrases among it, then
 * each verb's readings.
 */
function pollsDiffer(engine, host, stored) {
  const { state } = loadWorld(stored, host.catalogue);
  const present = [...state.visitors.values()]
    .filter((visitor) => (state.instances.get(visitor.instance)?.container ?? null) !== null)
    .map((visitor) => visitor.visit)
    .sort();
  for (const visit of present) {
    const want = pollScene(state, host, visit).scene;
    const got = engine.scene(visit).scene;
    if (!isDeepStrictEqual(got, want)) {
      return `${visit}'s scene is ${JSON.stringify(got)} where the TypeScript runtime's is ${JSON.stringify(want)}`;
    }
    const verbs = want.verbs.map((one) => one.verb);
    for (const verb of verbs) {
      const readings = pollReadings(state, host, visit, verb).readings;
      const given = engine.readings(visit, verb).readings;
      if (!isDeepStrictEqual(given, readings)) {
        return `${visit}'s readings of ${verb} are ${JSON.stringify(given)} where the TypeScript runtime's are ${JSON.stringify(readings)}`;
      }
    }
  }
  return null;
}

/** Plays `readings` through a fresh engine; the first difference from the TypeScript runtime, or null. */
async function playReadings(wasm, cartridge, worldId, readings, host) {
  const engine = opened(wasm, cartridge, worldId, readings.budgets);
  for (const step of readings.steps) {
    const lines = [];
    const ran = playStep(engine, step);
    if (step.after !== undefined && ran.length !== step.after.turns.length) {
      return `step ${step.index} (${step.line}): the engine ran ${ran.length} turns and the TypeScript runtime ${step.after.turns.length}`;
    }
    for (const [at, one] of ran.entries()) {
      lines.push(...one.outcome.lines.map(said));
      if (one.want === undefined) continue;
      const differs = turnDiffers(one.want, one.outcome, readings.budgets);
      if (differs !== null)
        return `step ${step.index} (${step.line}), turn ${at + 1} (${one.want.kind}): ${differs}`;
    }
    if (step.after === undefined) continue;
    const differs = linesDiffer(step.after.says, lines);
    if (differs !== null) return `step ${step.index} (${step.line}), ${differs}`;
    if (
      step.after.world !== undefined &&
      !isDeepStrictEqual(JSON.parse(engine.save()), step.after.world)
    ) {
      return `step ${step.index} (${step.line}): the stored world is not the TypeScript runtime's`;
    }
    const polls =
      step.after.world === undefined ? null : pollsDiffer(engine, host, step.after.world);
    if (polls !== null) return `step ${step.index} (${step.line}): ${polls}`;
  }
  return null;
}

/** libc.c's checks: how many failed. */
async function libcFailures(out) {
  const module = await WebAssembly.compile(readFileSync(join(out, 'libc.test.wasm')));
  const instance = await WebAssembly.instantiate(module, {});
  return instance.exports.sw_libc_failures();
}

/** The export layer's edges, over one packed world; each problem in words. */
async function edges(wasm, cartridge, worldId) {
  const problems = [];
  const engine = opened(wasm, cartridge, worldId);
  const expectThrow = (what, run, words) => {
    try {
      run();
      problems.push(`${what} was taken`);
    } catch (err) {
      if (!words.test(err.message)) problems.push(`${what} was refused as ${err.message}`);
    }
  };
  expectThrow(
    'a command that is not JSON',
    () => {
      const [length] = engine.put([new TextEncoder().encode('not json')]);
      engine.call('sw_command', length, 0n, 0n);
    },
    /not JSON/,
  );
  expectThrow(
    'a command with neither words nor a verb',
    () => engine.command({ visit: 'visit:nobody', fillers: [], typed: '' }, AT),
    /names its visit and the words typed/,
  );
  expectThrow(
    'a typed command for nobody here',
    () => engine.command({ visit: 'visit:nobody', text: 'look' }, AT),
    /never visited/,
  );
  expectThrow(
    'a planned step that is not a reading',
    () =>
      engine.command({ visit: 'visit:nobody', text: 'look', planned: { verb: 'sprout.look' } }, AT),
    /names its verb and who performs it/,
  );
  expectThrow(
    'a command for nobody here',
    () =>
      engine.command(
        { visit: 'visit:nobody', verb: 'sprout.look', fillers: [], typed: 'look' },
        AT,
      ),
    /No visitor/,
  );
  expectThrow('a scene for nobody here', () => engine.scene('visit:nobody'), /\S/);
  const held = engine.memory().held;
  for (let again = 0; again < 3; again++) engine.openEmpty(worldId);
  if (engine.memory().held > held)
    problems.push(`opening again holds ${engine.memory().held - held} more bytes`);
  expectThrow(
    'a visit with a NUL in it',
    () =>
      engine.command(
        { visit: 'v0\u0000junk', verb: 'sprout.look', fillers: [], typed: 'look' },
        AT,
      ),
    /names its visit, verb/,
  );
  expectThrow(
    'a line that is not JSON',
    () => engine.call('sw_line', ...engine.put([new TextEncoder().encode('{')])),
    /not JSON/,
  );
  expectThrow(
    'readings whose verb runs past the input',
    () => {
      const [length] = engine.put([new TextEncoder().encode('visit:nobody')]);
      engine.call('sw_readings', length, 0xffffffff);
    },
    /through sw_input/,
  );
  expectThrow(
    'a state whose world id runs past the input',
    () => {
      engine.put([new TextEncoder().encode('x')]);
      engine.call('sw_open', 0, 1 << 20);
    },
    /through sw_input/,
  );
  // Someone in the world, then a cartridge that is not one: the world and its state stay as they were.
  engine.maintenance(AT);
  engine.arrive('visit:Marta', 'Marta', AT);
  expectThrow(
    'a cartridge that is not one',
    () => engine.call('sw_load', ...engine.put([new TextEncoder().encode('nonsense')])),
    /^(?![\s\S]*Load a cartridge)[\s\S]*\S/,
  );
  try {
    if (engine.scene('visit:Marta').scene.verbs.length === 0)
      problems.push('after a refused load Marta is offered nothing');
  } catch (err) {
    problems.push(`after a refused load the world is gone: ${err.message}`);
  }
  // A reading built from chips runs as it is, and a line hands out its next command only once the last one ran.
  const chosen = engine.command(
    { visit: 'visit:Marta', verb: 'sprout.look', fillers: [], typed: 'look' },
    AT,
  );
  if (!chosen.changed || chosen.lines.length === 0)
    problems.push('a reading built from chips told nothing');
  if (chosen.entry?.kind !== 'command' || chosen.entry.text !== 'look')
    problems.push(`a reading built from chips logged ${JSON.stringify(chosen.entry)}`);
  const first = engine.line('visit:Marta', 'look then look');
  if (first?.text !== 'look') problems.push(`a line began with ${JSON.stringify(first)}`);
  expectThrow(
    'the next command before the last ran',
    () => engine.lineNext(first.line),
    /before asking for the next/,
  );
  // Another visitor's command between two of a line's is not the line's: the line still waits on its own.
  engine.command({ visit: 'visit:Marta', text: 'look' }, AT);
  expectThrow(
    'the next command after another visitor’s turn',
    () => engine.lineNext(first.line),
    /before asking for the next/,
  );
  engine.command(first, AT);
  if (engine.lineNext(first.line)?.text !== 'look')
    problems.push('a line of two commands handed out one');
  expectThrow('a line’s command run twice', () => engine.command(first, AT), /handed out once/);
  return problems;
}

/** A world whose arrival place is gone admits no one, and says so in words for the person. */
async function closedArrival(wasm, cartridge, worldId, arrivalPlace) {
  const engine = opened(wasm, cartridge, worldId);
  const stored = JSON.parse(engine.save());
  stored.instances = stored.instances.filter((one) => one.id !== arrivalPlace);
  stored.tombstones = [...stored.tombstones, arrivalPlace].sort();
  engine.open(JSON.stringify(stored));
  const outcome = engine.arrive('visit:Marta', 'Marta', AT);
  if (outcome.result !== 'closed')
    return [`an arrival to a world with no arrival place came to ${outcome.result}`];
  if (typeof outcome.words !== 'string' || outcome.words === '')
    return ['a closed arrival has no words for the person'];
  return [];
}

/**
 * An arrival's entry at debug depth keeps every effect as the log keeps it and no digest, and is the
 * play-depth entry once core takes it to play depth.
 */
async function debugDepth(wasm, cartridge, worldId) {
  const arrive = async (depth) => {
    const engine = opened(wasm, cartridge, worldId);
    engine.logDepth(depth);
    engine.maintenance(AT);
    return engine.arrive('visit:Marta', 'Marta', AT);
  };
  const played = await arrive('play');
  const debugged = await arrive('debug');
  const problems = [];
  if (debugged.entry.digest !== undefined) problems.push('a debug-depth entry has a digest');
  if (!isDeepStrictEqual(debugged.entry.effects, loggedEffects(debugged.effects)))
    problems.push('a debug-depth entry does not keep the effects the turn gave');
  if (debugged.entry.effects.length === 0) problems.push('the arrival said nothing to keep');
  if (!isDeepStrictEqual(atDepth(debugged.entry, 'play'), played.entry))
    problems.push('the debug-depth entry taken to play depth is not the play-depth entry');
  return problems;
}

/** Checks the engine in `out` over every world in `corpus`; one result per world, and the edges' and libc's. */
export async function testEngine(out, corpus = 'corpus/good') {
  const wasm = join(out, 'engine.wasm');
  const scratch = mkdtempSync(join(tmpdir(), 'sprout-wasm-'));
  const results = [];
  try {
    const failures = await libcFailures(out);
    results.push({ name: 'libc.c', passed: failures === 0, words: `${failures} checks failed` });
    for (const name of readdirSync(corpus).sort()) {
      const world = join(corpus, name);
      const scripts = ['transcripts', 'tests'].flatMap((folder) => {
        const dir = join(world, folder);
        try {
          return readdirSync(dir)
            .filter((file) => file.endsWith('.json'))
            .map((file) => join(dir, file));
        } catch {
          return [];
        }
      });
      if (scripts.length === 0) continue;
      const cartridgeFile = join(scratch, `${name}.sproutworld`);
      packWorld(world, cartridgeFile);
      const cartridge = readFileSync(cartridgeFile);
      const loaded = loadCartridge(cartridge, {
        caps: DEFAULT_LIMITS.caps,
        installed: INSTALLED_EXTENSIONS,
      });
      const worldId = loaded.world;
      // The engine polls under the host's default budgets, as the corpus scripts are played.
      const host = {
        catalogue: loaded,
        budgets: DEFAULT_LIMITS.budgets,
        render: renderEffects,
      };
      let played = 0;
      let differs = null;
      for (const script of scripts) {
        const readings = JSON.parse(resolveFile(cartridgeFile, script));
        played++;
        try {
          differs = await playReadings(wasm, cartridge, worldId, readings, host);
        } catch (err) {
          differs = `the engine refused it: ${err.message}`;
        }
        if (differs !== null) {
          differs = `${script}: ${differs}`;
          break;
        }
      }
      if (played > 0)
        results.push({ name, passed: differs === null, words: differs ?? `${played} scripts` });
      if (name === 'printers_shop') {
        const problems = await edges(wasm, cartridge, worldId);
        results.push({
          name: 'edges',
          passed: problems.length === 0,
          words: problems.join('; ') || 'held',
        });
      }
      if (name === 'brief') {
        const problems = await closedArrival(wasm, cartridge, worldId, 'brief.west_of_house');
        results.push({
          name: 'closed arrival',
          passed: problems.length === 0,
          words: problems.join('; ') || 'told',
        });
        const depth = await debugDepth(wasm, cartridge, worldId);
        results.push({
          name: 'debug depth',
          passed: depth.length === 0,
          words: depth.join('; ') || 'kept',
        });
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const played = results
    .filter((one) => !EXPECTED_CHECKS.includes(one.name))
    .map((one) => one.name);
  const missing = EXPECTED_CHECKS.filter((name) => !results.some((one) => one.name === name));
  results.push({
    name: 'what was played',
    passed: played.join(',') === EXPECTED_WORLDS.join(',') && missing.length === 0,
    words:
      missing.length > 0
        ? `the checks ${missing.join(', ')} did not run`
        : `the worlds played are ${played.join(', ')}; update EXPECTED_WORLDS in runtime-c/wasm/engine.test.mjs if the change is meant`,
  });
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [out, corpus] = process.argv.slice(2);
  if (out === undefined) {
    console.error(
      'engine.test: write `node runtime-c/wasm/engine.test.mjs <out folder of build.sh> [corpus/good]`.',
    );
    process.exit(2);
  }
  mkdirSync(out, { recursive: true });
  const results = await testEngine(out, corpus);
  const failed = results.filter((one) => !one.passed);
  for (const one of failed) console.log(`runtime-c wasm: ${one.name}: fails, ${one.words}`);
  console.log(`runtime-c wasm: ${results.length - failed.length} of ${results.length} checks pass`);
  process.exit(failed.length === 0 ? 0 : 1);
}
