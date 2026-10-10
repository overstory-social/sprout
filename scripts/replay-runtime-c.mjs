// Replays the corpus transcripts through `sproutc` and diffs them against
// what the TypeScript runtime wrote. For every `corpus/good/<world>` with
// transcripts: pack the world, resolve each transcript into the readings the
// TypeScript parser made of it (scripts/resolve-script.mjs), play it with
// `sproutc play --script`, and compare the lines the runtime emitted with
// the lines the transcript expects, step by step.
//
// Compared today: for each step that runs, the lines a reader read, as
// `<reader>: <words>`. A line at a level (the host's own words, faults) and
// a reader line's kind are not yet carried by the host's `emit`, and the
// stored world and the log after each turn have no file to diff, so those
// are not compared; a step whose line the parser answered rather than read
// is skipped on both sides and counted. Each is named in the world's line.
// The comparison itself is player/src/replay.ts.
//
// The views are compared apart from the transcripts (`replayViews`): for every
// `corpus/good` world, the stored world a visitor arrives into is written with
// the TypeScript runtime, `sproutc view` polls the visitor over it, and the page it
// prints is compared byte for byte with the page `sprout view` prints.
//
// Used by scripts/check-runtime-c.mjs, which owns the list of worlds that
// are expected to pass.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { emitCartridge, saveWorld } from '@overstory/sprout/lang';
import { checkWorld, formatCheck, inspectView } from '@overstory/sprout-cli';
import { blocksOf, expectedBlocks, firstDifference, readScript, standIn } from '@overstory/sprout-player';

import { readingsPath, resolveFile } from './resolve-script.mjs';

/** Packs the world folder `dir` into the cartridge `file`, as `sprout pack` does. */
export function packWorld(dir, file) {
  const checked = checkWorld(dir);
  if (checked.bundle === null) throw new Error(formatCheck(checked));
  writeFileSync(file, emitCartridge(checked.bundle));
}

/**
 * Plays the script file `script` (its readings are written beside it) over
 * `cartridge` through `sproutc` and compares it with what the script
 * expects. `how` is `passed`; `not yet`, the runtime saying a part of it is
 * not built, with the step it stopped at and its words in `why`; `differs`,
 * with the first step that said other than the script expects; or `failed`.
 */
export function playAndCompare(sproutc, cartridge, script) {
  const text = resolveFile(cartridge, script);
  writeFileSync(readingsPath(script), text);
  const readings = JSON.parse(text);
  const done = spawnSync(sproutc, ['play', cartridge, '--script', script], { encoding: 'utf8' });
  const { blocks, stoppedOn: faulted } = blocksOf(done.stdout ?? '');
  const stopped = [...blocks.keys()].pop();
  if (done.status === 3) {
    return { how: 'not yet', why: `step ${stopped ?? '?'}: ${faulted ?? 'the runtime said it is not built yet'}` };
  }
  if (done.status !== 0) {
    return { how: 'failed', why: (done.stderr || done.stdout || `exit ${done.status}`).trim() };
  }
  const differs = firstDifference(expectedBlocks(readScript(readFileSync(script, 'utf8'), script), readings), blocks);
  if (differs !== null) return { how: 'differs', why: differs };
  const skipped = readings.steps.filter((s) => s.kind === 'command' && s.turns.some((t) => t.skip)).length;
  return { how: 'passed', why: skipped === 0 ? '' : `${skipped} step(s) the parser answered were not compared` };
}

function replayOne(sproutc, cartridge, world, transcript, scratch) {
  const script = join(scratch, transcript);
  copyFileSync(join(world, 'transcripts', transcript), script);
  return playAndCompare(sproutc, cartridge, script);
}

/**
 * Replays every world with transcripts under `corpus/good`, in order; one
 * result per world: its name, whether every transcript passed, and a
 * sentence about the first that did not (or about what was not compared).
 */
export function replayWorlds(sproutc, scratch, corpus = 'corpus/good') {
  const results = [];
  for (const name of readdirSync(corpus).sort()) {
    const world = join(corpus, name);
    if (!existsSync(join(world, 'transcripts'))) continue;
    const folder = join(scratch, name);
    mkdirSync(folder, { recursive: true });
    const cartridge = join(folder, `${name}.sproutworld`);
    let result;
    try {
      packWorld(world, cartridge);
      const transcripts = readdirSync(join(world, 'transcripts')).filter((f) => f.endsWith('.json')).sort();
      const each = transcripts.map((file) => ({ file, ...replayOne(sproutc, cartridge, world, file, folder) }));
      const bad = each.find((one) => one.how !== 'passed');
      result =
        bad === undefined
          ? { name, passed: true, words: each.map((one) => one.why).filter(Boolean)[0] ?? 'every transcript matches' }
          : { name, passed: false, words: `${bad.how}, ${bad.file}, ${bad.why}` };
    } catch (err) {
      result = { name, passed: false, words: `failed, ${err instanceof Error ? err.message : String(err)}` };
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
        results.push({ name, passed: false, words: `exit ${done.status}: ${(done.stderr || done.stdout).trim()}` });
      } else {
        results.push({ name, passed: differs === null, words: differs ?? 'the same page' });
      }
    } catch (err) {
      results.push({ name, passed: false, words: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
