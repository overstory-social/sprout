// The WebAssembly engine (engine/, driven by @overstory/sprout-engine-wasm's WasmInstance) checked against the
// frozen goldens (corpus/goldens/stored-worlds.json), and libc.c against the C standard (libc.test.c). Every corpus
// world opens empty to the state the golden holds for it; every transcript is played through the engine by the
// player's own host (player/src/play.ts), each step making what the transcript expects of it, and after each step
// the golden pins, the stored world is the golden's. Then the export layer's edges: loading and opening again,
// input it cannot read, a reading built from chips, an entry at debug depth, and an arrival to a world that admits
// no one, which still has words for the person.
//
//   node runtime-c/wasm/engine.test.mjs <out folder of build.sh> [corpus/good]
//
// scripts/check-runtime-c.mjs runs it after building with build.sh.

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { atDepth, loggedEffects } from '@overstory/sprout/core';
import { DEFAULT_LIMITS, emitCartridge, readCartridge } from '@overstory/sprout/lang';
import { WasmInstance, wasmEngine } from '@overstory/sprout-engine-wasm';
import { checkWorld, formatCheck } from '@overstory/sprout-cli';
import { expectationsOf, freshStage, playStep, plays, readScript } from '@overstory/sprout-player';

const GOLDEN = fileURLToPath(new URL('../../corpus/goldens/stored-worlds.json', import.meta.url));

/** A fresh instance of the engine `module`, with `cartridge` loaded and a new state for `worldId`, under `budgets`. */
function opened(module, cartridge, worldId, budgets = {}) {
  const engine = new WasmInstance(module);
  engine.load(cartridge);
  engine.budgets({ ...DEFAULT_LIMITS.budgets, ...budgets }, DEFAULT_LIMITS.caps.listElements);
  engine.openEmpty(worldId);
  return engine;
}

/** The checks that are not a world's, each of which must have run. */
const EXPECTED_CHECKS = ['libc.c', 'edges', 'closed arrival', 'debug depth'];

/** Seed 0 at the instant 0, for the checks that run a turn for what it says rather than what it draws. */
const AT = { seed: 0, now: 0 };

/** The stored world `stored` as the engine writes it back, having opened it. */
function rewritten(instance, worldId, stored) {
  instance.open(JSON.stringify({ world: worldId, ...stored }));
  return JSON.parse(instance.save());
}

/**
 * Plays the transcript `file` of the world compiled as `bundle` through the engine `module`, by the player's
 * host; the first way it differs from what the transcript expects or from the stored worlds `pinned` holds
 * for it, by step, in words, or null; and how many pinned states it compared.
 */
function playTranscript(module, bundle, cartridge, file, pinned) {
  const base = freshStage(bundle);
  const stage = {
    ...base,
    engine: wasmEngine({
      cartridge,
      catalogue: base.host.catalogue,
      budgets: base.host.budgets,
      module,
    }),
  };
  const worldId = base.host.catalogue.world;
  const instance = opened(module, cartridge, worldId);
  const script = readScript(readFileSync(file, 'utf8'), file);
  let compared = 0;
  for (const [i, step] of script.steps.entries()) {
    const made = playStep(stage, step, `${file}, step ${i + 1}`);
    if (made !== null && plays(step) && step.expect !== undefined) {
      const got = expectationsOf(made);
      if (!isDeepStrictEqual(got, step.expect)) {
        return {
          differs: `step ${i + 1} made ${JSON.stringify(got)} where the transcript expects ${JSON.stringify(step.expect)}`,
          compared,
        };
      }
    }
    const golden = pinned.get(i + 1);
    if (golden === undefined) continue;
    compared++;
    if (!isDeepStrictEqual(rewritten(instance, worldId, stage.stored), golden)) {
      return { differs: `step ${i + 1}: the stored world is not the golden's`, compared };
    }
  }
  return { differs: null, compared };
}

/** libc.c's checks: how many failed. */
async function libcFailures(out) {
  const module = await WebAssembly.compile(readFileSync(join(out, 'libc.test.wasm')));
  const instance = await WebAssembly.instantiate(module, {});
  return instance.exports.sw_libc_failures();
}

/** The export layer's edges, over one packed world; each problem in words. */
async function edges(module, cartridge, worldId) {
  const problems = [];
  const engine = opened(module, cartridge, worldId);
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
async function closedArrival(module, cartridge, worldId, arrivalPlace) {
  const engine = opened(module, cartridge, worldId);
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
async function debugDepth(module, cartridge, worldId) {
  const arrive = async (depth) => {
    const engine = opened(module, cartridge, worldId);
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

/**
 * Checks the engine in `out` over every world in `corpus` against the stored-worlds golden; one result per world,
 * the edges' and libc's, and one that every state the golden holds was compared.
 */
export async function testEngine(out, corpus = 'corpus/good') {
  const module = new WebAssembly.Module(readFileSync(join(out, 'engine.wasm')));
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  const results = [];
  let initial = 0;
  let pinned = 0;
  const failures = await libcFailures(out);
  results.push({ name: 'libc.c', passed: failures === 0, words: `${failures} checks failed` });
  for (const name of readdirSync(corpus).sort()) {
    const world = join(corpus, name);
    const checked = checkWorld(world);
    if (checked.bundle === null) {
      results.push({ name, passed: false, words: formatCheck(checked) });
      continue;
    }
    const cartridge = emitCartridge(checked.bundle);
    const worldId = readCartridge(cartridge).header.namespace;
    const problems = [];
    const empty = JSON.parse(opened(module, cartridge, worldId).save());
    if (golden.initial[name] !== undefined) initial++;
    if (!isDeepStrictEqual(empty, golden.initial[name]))
      problems.push('the state it opens empty to is not the golden’s');
    const folder = join(world, 'transcripts');
    const transcripts = existsSync(folder)
      ? readdirSync(folder)
          .filter((file) => file.endsWith('.json'))
          .sort()
      : [];
    for (const transcript of transcripts) {
      const steps = new Map(
        golden.played
          .filter((one) => one.world === name && one.transcript === transcript)
          .map((one) => [one.step, one.stored]),
      );
      try {
        const played = playTranscript(
          module,
          checked.bundle,
          cartridge,
          join(folder, transcript),
          steps,
        );
        pinned += played.compared;
        if (played.differs !== null) problems.push(`${transcript}: ${played.differs}`);
      } catch (err) {
        problems.push(`${transcript}: the engine refused it: ${err.message}`);
      }
    }
    results.push({
      name,
      passed: problems.length === 0,
      words: problems.join('; ') || `${transcripts.length} transcripts`,
    });
    if (name === 'printers_shop') {
      const edgeProblems = await edges(module, cartridge, worldId);
      results.push({
        name: 'edges',
        passed: edgeProblems.length === 0,
        words: edgeProblems.join('; ') || 'held',
      });
    }
    if (name === 'brief') {
      const closed = await closedArrival(module, cartridge, worldId, 'brief.west_of_house');
      results.push({
        name: 'closed arrival',
        passed: closed.length === 0,
        words: closed.join('; ') || 'told',
      });
      const depth = await debugDepth(module, cartridge, worldId);
      results.push({
        name: 'debug depth',
        passed: depth.length === 0,
        words: depth.join('; ') || 'kept',
      });
    }
  }
  const missing = EXPECTED_CHECKS.filter((name) => !results.some((one) => one.name === name));
  const held = Object.keys(golden.initial).length;
  results.push({
    name: 'what was compared',
    passed: missing.length === 0 && initial === held && pinned === golden.played.length,
    words:
      missing.length > 0
        ? `the checks ${missing.join(', ')} did not run`
        : `${initial} of the golden's ${held} initial states and ${pinned} of its ${golden.played.length} played states were compared; a world or a transcript the golden holds is not in ${corpus}`,
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
