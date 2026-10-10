// Replays the corpus through `sproutc` and diffs it against what the TypeScript runtime does. For every
// `corpus/good/<world>` with transcripts or tests: pack the world, resolve each script into the readings the
// TypeScript parser made of it and what the TypeScript runtime left behind each step (scripts/resolve-script.mjs),
// play it with `sproutc play --script --trace`, and compare, step by step, the lines readers read, the entry the
// log keeps of each turn that ran, and the stored world (player/src/replay.ts). A transcript's own expected
// lines are compared too, so a runtime that agrees with the TypeScript one and not with the transcript fails.
//
// A turn the TypeScript parser answered rather than read is not the runtime's to run (the parser is the host's);
// `sproutc` echoes what was recorded for it, and counts it. Each world's line says how many it echoed.
//
// The views are compared apart from the scripts (`replayViews`): for every `corpus/good` world, the stored
// world a visitor arrives into is written with the TypeScript runtime, `sproutc view` polls the visitor over it,
// and the page it prints is compared byte for byte with the page `sprout view` prints.
//
// Used by scripts/check-runtime-c.mjs, which owns the list of worlds that are expected to pass.

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { emitCartridge, saveWorld } from '@overstory/sprout/lang';
import { checkWorld, formatCheck, inspectView } from '@overstory/sprout-cli';
import { firstDifference, readScript, standIn, traceOf } from '@overstory/sprout-player';

import { readingsPath, resolveFile } from './resolve-script.mjs';

/** Packs the world folder `dir` into the cartridge `file`, as `sprout pack` does. */
export function packWorld(dir, file) {
  const checked = checkWorld(dir);
  if (checked.bundle === null) throw new Error(formatCheck(checked));
  writeFileSync(file, emitCartridge(checked.bundle));
}

/** What the transcript `script` expects each step to say, as `<reader> (<kind>): <words>`, by step index. */
function transcriptSays(script) {
  const lines = new Map();
  script.steps.forEach((step, index) => {
    if (!('expect' in step) || step.expect === undefined) return;
    lines.set(
      index,
      step.expect
        .filter((one) => 'reader' in one)
        .map((one) => `${one.reader} (${one.kind}): ${one.words}`),
    );
  });
  return lines;
}

/**
 * Plays the script file `script` (its readings are written beside it) over `cartridge` through `sproutc` and
 * compares it with what the TypeScript runtime did, and, where `transcript` is set, with what the script
 * itself expects, under the host's default budgets less any `budgets` given. `how` is `passed`; `differs`, with the first step that went another way in `why`; or
 * `failed`. `echoed` is how many turns the parser answered and the play echoed.
 */
export function playAndCompare(sproutc, cartridge, script, transcript = false, budgets = {}) {
  const text = resolveFile(cartridge, script, budgets);
  writeFileSync(readingsPath(script), text);
  const readings = JSON.parse(text);
  const tracePath = `${script}.trace`;
  const done = spawnSync(sproutc, ['play', cartridge, '--script', script, '--trace', tracePath], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  if (done.status !== 0) {
    return {
      how: 'failed',
      why: (done.stderr || done.stdout || `exit ${done.status}`).trim(),
      echoed: 0,
    };
  }
  const trace = traceOf(existsSync(tracePath) ? readFileSync(tracePath, 'utf8') : '');
  const differs = firstDifference(readings, trace);
  const echoed = readings.steps.reduce(
    (sum, step) =>
      sum + (step.kind === 'command' ? step.turns.filter((turn) => turn.skip).length : 0),
    0,
  );
  if (differs !== null) return { how: 'differs', why: differs, echoed };
  if (transcript) {
    const wanted = transcriptSays(readScript(readFileSync(script, 'utf8'), script));
    for (const [index, lines] of wanted) {
      const got = (trace.get(index)?.says ?? []).map(
        (one) => `${one.reader} (${one.kind}): ${one.words}`,
      );
      if (lines.join('\n') !== got.join('\n')) {
        return {
          how: 'differs',
          why: `step ${index} said\n${got.join('\n') || '(nothing)'}\nand the transcript has\n${lines.join('\n') || '(nothing)'}`,
          echoed,
        };
      }
    }
  }
  return { how: 'passed', why: '', echoed };
}

function replayOne(sproutc, cartridge, world, folder, file, scratch) {
  const script = join(scratch, `${folder}-${file}`);
  copyFileSync(join(world, folder, file), script);
  return playAndCompare(sproutc, cartridge, script, folder === 'transcripts');
}

/**
 * Replays every script under `transcripts` and `tests` of every world under `corpus/good`, in order; one result
 * per world: its name, whether every script passed, and a sentence about the first that did not (or about how
 * many turns the parser answered). `only` names the worlds to replay; the default is every one.
 */
export function replayWorlds(sproutc, scratch, corpus = 'corpus/good', only = null) {
  const results = [];
  for (const name of readdirSync(corpus).sort()) {
    if (only !== null && !only.includes(name)) continue;
    const world = join(corpus, name);
    const folders = ['transcripts', 'tests'].filter((folder) => existsSync(join(world, folder)));
    if (folders.length === 0) continue;
    const folder = join(scratch, name);
    mkdirSync(folder, { recursive: true });
    const cartridge = join(folder, `${name}.sproutworld`);
    let result;
    try {
      packWorld(world, cartridge);
      const each = folders.flatMap((kind) =>
        readdirSync(join(world, kind))
          .filter((f) => f.endsWith('.json'))
          .sort()
          .map((file) => ({
            file: `${kind}/${file}`,
            ...replayOne(sproutc, cartridge, world, kind, file, folder),
          })),
      );
      const bad = each.find((one) => one.how !== 'passed');
      const echoed = each.reduce((sum, one) => sum + one.echoed, 0);
      result =
        bad === undefined
          ? {
              name,
              passed: true,
              words: `${each.length} script${each.length === 1 ? '' : 's'} match${echoed === 0 ? '' : `, ${echoed} turn${echoed === 1 ? '' : 's'} the parser answered echoed`}`,
            }
          : { name, passed: false, words: `${bad.how}, ${bad.file}, ${bad.why}` };
    } catch (err) {
      result = {
        name,
        passed: false,
        words: `failed, ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    results.push(result);
  }
  return results;
}

/** The first line two pages differ at, in words; null where they are the same page. */
function firstLineDifference(expected, got) {
  const wanted = expected.split('\n');
  const given = got.split('\n');
  for (let at = 0; at < Math.max(wanted.length, given.length); at++) {
    if (wanted[at] !== given[at]) {
      return `line ${at + 1}: sprout view says ${JSON.stringify(wanted[at] ?? '(nothing)')}, sproutc view says ${JSON.stringify(given[at] ?? '(nothing)')}`;
    }
  }
  return null;
}

/**
 * Polls the visitor who arrives in every world under `corpus/good` through `sproutc view` and compares
 * the page with `sprout view`'s; one result per world: its name, whether the pages are the same, and
 * a sentence about the first line that is not.
 */
export function replayViews(sproutc, scratch, corpus = 'corpus/good') {
  const results = [];
  for (const name of readdirSync(corpus).sort()) {
    const folder = join(scratch, `${name}-view`);
    mkdirSync(folder, { recursive: true });
    const cartridge = join(folder, `${name}.sproutworld`);
    const stored = join(folder, 'world.json');
    try {
      const world = join(corpus, name);
      packWorld(world, cartridge);
      const standing = standIn(checkWorld(world).bundle);
      writeFileSync(stored, JSON.stringify(saveWorld(standing.state)));
      const expected = inspectView(standing);
      const done = spawnSync(sproutc, ['view', cartridge, '--state', stored], { encoding: 'utf8' });
      const differs = firstLineDifference(expected.page, done.stdout ?? '');
      if (done.status !== (expected.ok ? 0 : 1)) {
        results.push({
          name,
          passed: false,
          words: `exit ${done.status}: ${(done.stderr || done.stdout).trim()}`,
        });
      } else {
        results.push({ name, passed: differs === null, words: differs ?? 'the same page' });
      }
    } catch (err) {
      results.push({
        name,
        passed: false,
        words: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

// `node scripts/replay-runtime-c.mjs <sproutc> <scratch folder> [world...]` replays the named worlds, or all.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [sproutc, scratch, ...only] = process.argv.slice(2);
  mkdirSync(scratch, { recursive: true });
  for (const result of replayWorlds(
    sproutc,
    scratch,
    'corpus/good',
    only.length > 0 ? only : null,
  )) {
    console.log(`${result.name}: ${result.passed ? 'passes' : 'fails'}, ${result.words}`);
  }
}
