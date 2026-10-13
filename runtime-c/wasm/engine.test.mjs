// The WebAssembly engine (engine.c, driven by engine.mjs) checked against the TypeScript runtime, and
// libc.c against the C standard (libc.test.c). Every corpus script made only of arrivals, departures and
// commands is resolved by the TypeScript parser into the readings it read (scripts/resolve-script.mjs)
// and played through the engine from the turns the TypeScript runtime logged: each step's lines, by
// reader, and the stored world after it must be what the TypeScript runtime left. A turn the parser
// answered is not the engine's to run, and its lines are the parser's. Then the export layer's edges:
// loading and opening again, input it cannot read, and an arrival to a world that admits no one, which
// still has words for the person.
//
//   node runtime-c/wasm/engine.test.mjs <out folder of build.sh> [corpus/good]
//
// scripts/check-runtime-c.mjs runs it after building with build.sh.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { DEFAULT_LIMITS, loadCartridge } from '@overstory/sprout/lang';
import { INSTALLED_EXTENSIONS } from '@overstory/sprout-player';

import { packWorld } from '../../scripts/replay-runtime-c.mjs';
import { resolveFile } from '../../scripts/resolve-script.mjs';
import { WasmEngine } from './engine.mjs';

/**
 * The corpus worlds whose scripts the engine plays, sorted: every one with a script of arrivals, departures
 * and commands alone. A world that comes or goes from this list is a change to say so of.
 */
const EXPECTED_WORLDS = [
  'all-in-order',
  'all-leaves-out-refused',
  'allowed-first',
  'arrival-order',
  'brief',
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
  'runs',
  'sequences',
  'shut-contents',
  'standard-library',
  'synonyms',
  'take-from',
  'teashop',
  'troll_room',
  'unknown-word',
  'value-first',
  'visitor-contents',
];

/** The checks that are not a world's, each of which must have run. */
const EXPECTED_CHECKS = ['libc.c', 'edges', 'closed arrival'];

/** The steps the engine can play: what a host runs as an arrival, a departure or a command. */
const PLAYABLE = new Set(['comment', 'seed', 'arrive', 'leave', 'command']);

const visitOf = (nickname) => `visit:${nickname}`;

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

/** Plays `readings` through a fresh engine; the first difference from the TypeScript runtime, or null. */
async function playReadings(wasm, cartridge, worldId, readings) {
  const engine = await WasmEngine.open(wasm, cartridge, worldId);
  for (const step of readings.steps) {
    const lines = [];
    if (step.kind === 'arrive' || step.kind === 'leave') {
      for (const turn of step.after.turns) {
        const at = turn.seconds;
        const outcome =
          turn.kind === 'maintenance'
            ? engine.maintenance(turn.seed, at)
            : turn.kind === 'arrival'
              ? engine.arrive(visitOf(step.nickname), step.nickname, turn.seed, at)
              : engine.depart(visitOf(step.nickname), turn.seed, at);
        lines.push(...outcome.lines.map(said));
      }
    } else if (step.kind === 'command') {
      for (const turn of step.turns) {
        if (turn.skip) {
          lines.push(...turn.says);
          continue;
        }
        const outcome = engine.command(visitOf(step.nickname), turn, turn.seed, step.atSeconds);
        lines.push(...outcome.lines.map(said));
      }
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
  const engine = await WasmEngine.open(wasm, cartridge, worldId);
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
    'a command with no verb',
    () => engine.command('visit:nobody', { fillers: [], typed: '' }, 0, 0),
    /names its visit, verb/,
  );
  expectThrow(
    'a command for nobody here',
    () => engine.command('visit:nobody', { verb: 'sprout.look', fillers: [], typed: 'look' }, 0, 0),
    /No visitor/,
  );
  expectThrow('a scene for nobody here', () => engine.scene('visit:nobody'), /\S/);
  const held = engine.memory().held;
  for (let again = 0; again < 3; again++) {
    const [length] = engine.put([new TextEncoder().encode(worldId)]);
    engine.call('sw_open', 0, length);
  }
  if (engine.memory().held > held)
    problems.push(`opening again holds ${engine.memory().held - held} more bytes`);
  expectThrow(
    'a visit with a NUL in it',
    () => engine.command('v0\u0000junk', { verb: 'sprout.look', fillers: [], typed: 'look' }, 0, 0),
    /names its visit, verb/,
  );
  expectThrow(
    'a draw below one',
    () =>
      engine.command(
        'visit:nobody',
        { verb: 'sprout.look', fillers: [], typed: 'look', draws: [-1] },
        0,
        0,
      ),
    /No visitor|whole number/,
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
  engine.maintenance(0, 0);
  engine.arrive('visit:Marta', 'Marta', 0, 0);
  expectThrow(
    'a cartridge that is not one',
    () => engine.call('sw_load', ...engine.put([new TextEncoder().encode('nonsense')])),
    /^(?![\s\S]*Load a cartridge)[\s\S]*\S/,
  );
  try {
    if (engine.scene('visit:Marta').verbs.length === 0)
      problems.push('after a refused load Marta is offered nothing');
  } catch (err) {
    problems.push(`after a refused load the world is gone: ${err.message}`);
  }
  return problems;
}

/** A world whose arrival place is gone admits no one, and says so in words for the person. */
async function closedArrival(wasm, cartridge, worldId, arrivalPlace) {
  const engine = await WasmEngine.open(wasm, cartridge, worldId);
  const stored = JSON.parse(engine.save());
  stored.instances = stored.instances.filter((one) => one.id !== arrivalPlace);
  stored.tombstones = [...stored.tombstones, arrivalPlace].sort();
  const [length] = engine.put([new TextEncoder().encode(JSON.stringify(stored))]);
  engine.call('sw_open', length, 0);
  const outcome = engine.arrive('visit:Marta', 'Marta', 0, 0);
  if (outcome.result !== 'closed')
    return [`an arrival to a world with no arrival place came to ${outcome.result}`];
  if (typeof outcome.words !== 'string' || outcome.words === '')
    return ['a closed arrival has no words for the person'];
  return [];
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
      const worldId = loadCartridge(cartridge, {
        caps: DEFAULT_LIMITS.caps,
        installed: INSTALLED_EXTENSIONS,
      }).world;
      let played = 0;
      let differs = null;
      for (const script of scripts) {
        const readings = JSON.parse(resolveFile(cartridgeFile, script));
        if (!readings.steps.every((step) => PLAYABLE.has(step.kind))) continue;
        if (
          readings.steps.some(
            (step) => (step.kind === 'arrive' || step.kind === 'leave') && step.after === undefined,
          )
        )
          continue;
        played++;
        try {
          differs = await playReadings(wasm, cartridge, worldId, readings);
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
