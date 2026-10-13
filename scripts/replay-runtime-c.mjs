// Replays the corpus through `sproutc` and diffs it against what the TypeScript runtime does. For every
// `corpus/good/<world>` with transcripts or tests: pack the world, resolve each script into the readings the
// TypeScript parser made of it and what the TypeScript runtime left behind each step (scripts/resolve-script.mjs),
// play it with `sproutc play --script --trace`, and compare, step by step, the lines readers read, the entry the
// log keeps of each turn that ran, and the stored world (player/src/replay.ts). Each turn's entry carries what
// a host is given beside it, whose views it made stale and what the store writes, and, for every kind but a
// command, the entry in core's own form at play depth, its digest included, which core's builders make from
// what the TypeScript runtime did. A transcript's own expected lines are compared too, so a runtime that
// agrees with the TypeScript one and not with the transcript fails.
//
// A turn the TypeScript parser answered rather than read is not the runtime's to run (the parser is the host's);
// `sproutc` echoes what was recorded for it, and counts it. Each world's line says how many it echoed.
//
// The views are compared apart from the scripts (`replayViews`): for every `corpus/good` world, the stored
// world a visitor arrives into is written with the TypeScript runtime, `sproutc view` polls the visitor over it,
// and the page it prints is compared byte for byte with the page `sprout view` prints; then the scene's page
// (`--scene`), and the readings of each verb the TypeScript runtime's scene lists (`--verb`), each with the page
// `sprout view` prints for it (`comparePolls`).
//
// The parser is compared apart too (`replayParses`): for every script, `sproutc parse` reads each line the
// TypeScript parser read, over the stored world its turn began from, under the turn's seed, and compares what it
// read with what the TypeScript parser read (player/src/parsed.ts), turn by turn.
//
// Used by scripts/check-runtime-c.mjs, which owns the lists of worlds that are expected to pass.

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

import {
  arrivalEntry,
  atDepth,
  departureEntry,
  maintenanceEntry,
  tickEntry,
  wakeEntry,
} from '@overstory/sprout/core';
import { DEFAULT_LIMITS, emitCartridge, pollScene, saveWorld } from '@overstory/sprout/lang';
import {
  checkWorld,
  formatCheck,
  inspectReadings,
  inspectScene,
  inspectView,
} from '@overstory/sprout-cli';
import { firstDifference, readScript, standIn, traceOf } from '@overstory/sprout-player';

import { readingsPath, resolveFile } from './resolve-script.mjs';

/** Packs the world folder `dir` into the cartridge `file`, as `sprout pack` does. */
export function packWorld(dir, file) {
  const checked = checkWorld(dir);
  if (checked.bundle === null) throw new Error(formatCheck(checked));
  writeFileSync(file, emitCartridge(checked.bundle));
}

/**
 * The entry core's log keeps of `turn`, a turn the TypeScript runtime ran under the host's default budgets
 * less `budgets`, as core's builders make it at play depth; undefined for a command, whose entry keeps what
 * the host's parser read, which the C runtime is handed and does not keep until it parses (#624).
 */
export function loggedEntryOf(turn, budgets = {}) {
  const host = { budgets: { ...DEFAULT_LIMITS.budgets, ...budgets } };
  const inputs = { seed: turn.seed, mayHold: null, now: turn.seconds };
  const said = { committed: true, effects: turn.effects, cutShort: turn.cutShort };
  const faulted = { committed: false, fault: turn.fault };
  const entry = (() => {
    switch (turn.kind) {
      case 'tick':
        return tickEntry({ ...inputs, place: turn.who }, host, turn.fault ? faulted : said);
      case 'wake':
        return wakeEntry(
          { ...inputs, object: turn.who, serial: turn.wake },
          host,
          turn.fault ? faulted : said,
        );
      case 'maintenance':
        return maintenanceEntry(inputs, host, {
          value: {
            delivered: turn.delivered,
            faulted: turn.faulted.map(({ object, serial, fault }) => ({
              wake: { object, serial },
              fault,
            })),
            abandoned: turn.abandoned,
          },
        });
      case 'arrival':
        return arrivalEntry(
          { ...inputs, visit: turn.who, nickname: turn.nickname },
          host,
          turn.outcome === 'refused'
            ? { committed: false, refused: {}, effects: turn.effects }
            : turn.fault
              ? faulted
              : said,
        );
      case 'departure':
        return departureEntry(
          { ...inputs, visit: turn.who },
          host,
          turn.fault
            ? { ...faulted, quietly: { effects: turn.effects, cutShort: turn.cutShort } }
            : said,
        );
      default:
        return undefined;
    }
  })();
  return entry === undefined ? undefined : atDepth(entry, 'play');
}

/**
 * `readings` with each turn that ran beside the entry core's log keeps of it, as `loggedEntryOf` makes it,
 * under the readings' budgets and then `budgets`, which only a poll reads, so the turns ran the same.
 */
export function withLoggedEntries(readings, budgets = {}) {
  return {
    ...readings,
    steps: readings.steps.map((step) =>
      step.after === undefined
        ? step
        : {
            ...step,
            after: {
              ...step.after,
              turns: step.after.turns.map((turn) => {
                const logged = loggedEntryOf(turn, { ...readings.budgets, ...budgets });
                return logged === undefined ? turn : { ...turn, logged };
              }),
            },
          },
    ),
  };
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
 * itself expects, under the host's default budgets less any `budgets` given. With `offered`, the view is
 * polled before each command under `pollSteps` (the host's default where unset) and must offer the reading,
 * as the Playdate's sentence builder needs it to; `widest` is then the most steps a poll spent; `prefix` is
 * the words a sanitized `sproutc` is launched behind (player/src/aslr.ts). `how` is
 * `passed`; `differs`, with the first step that went another way in `why`; or `failed`. `echoed` is how many
 * turns the parser answered and the play echoed.
 */
export function playAndCompare(
  sproutc,
  cartridge,
  script,
  transcript = false,
  budgets = {},
  { offered = false, pollSteps = undefined, prefix = [] } = {},
) {
  const text = resolveFile(cartridge, script, budgets);
  writeFileSync(readingsPath(script), text);
  const readings = JSON.parse(text);
  const tracePath = `${script}.trace`;
  const args = ['play', cartridge, '--script', script, '--trace', tracePath];
  if (offered) args.push('--offered');
  if (pollSteps !== undefined) args.push('--poll-steps', String(pollSteps));
  const [command, ...before] = [...prefix, sproutc];
  const done = spawnSync(command, [...before, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const widest = Number(
    /^--- offered: .* the widest poll (\d+) steps$/m.exec(done.stdout ?? '')?.[1] ?? 0,
  );
  if (done.status !== 0) {
    return {
      how: 'failed',
      why: (done.stderr || done.stdout || `exit ${done.status}`).trim(),
      echoed: 0,
      widest,
    };
  }
  const trace = traceOf(existsSync(tracePath) ? readFileSync(tracePath, 'utf8') : '');
  const polled = pollSteps === undefined ? {} : { pollSteps };
  const differs = firstDifference(withLoggedEntries(readings, polled), trace);
  const echoed = readings.steps.reduce(
    (sum, step) =>
      sum + (step.kind === 'command' ? step.turns.filter((turn) => turn.skip).length : 0),
    0,
  );
  if (differs !== null) return { how: 'differs', why: differs, echoed, widest };
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
          widest,
        };
      }
    }
  }
  return { how: 'passed', why: '', echoed, widest };
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
 * Polls `standing`'s visitor through `sproutc view` (with `flags` after it) over the stored world in the file
 * `stored`, and compares the page and the exit code with `expected`, the page `sprout view` prints; null where
 * they agree, or a sentence about the first line that does not, which `what` names.
 */
function pollDiffers(sproutc, cartridge, stored, standing, flags, expected, what) {
  const done = spawnSync(
    sproutc,
    ['view', cartridge, '--state', stored, '--visit', standing.visit, ...flags],
    { encoding: 'utf8' },
  );
  if (done.status !== (expected.ok ? 0 : 1)) {
    return `${what}: exit ${done.status}: ${(done.stderr || done.stdout).trim()}`;
  }
  const differs = firstLineDifference(expected.page, done.stdout ?? '');
  return differs === null ? null : `${what}: ${differs}`;
}

/**
 * Compares the scene of `standing`'s visitor, over the stored world in the file `stored`, as `sproutc view
 * --scene` prints it with the page `sprout view --scene` prints; then, for each verb the TypeScript runtime's
 * scene lists, `sproutc view --verb`'s page with `sprout view --verb`'s. `standing`'s host must hold the host's
 * default budgets, which `sproutc` polls under. The first difference in words, or null; `verbs` is how many
 * verbs' readings were compared.
 */
export function comparePolls(sproutc, cartridge, stored, standing) {
  const scene = inspectScene(standing);
  const sceneDiffers = pollDiffers(
    sproutc,
    cartridge,
    stored,
    standing,
    ['--scene'],
    scene,
    'the scene',
  );
  if (sceneDiffers !== null) return { differs: sceneDiffers, verbs: 0 };
  const verbs = pollScene(standing.state, standing.host, standing.visit).scene.verbs.map(
    (one) => one.verb,
  );
  for (const verb of verbs) {
    const differs = pollDiffers(
      sproutc,
      cartridge,
      stored,
      standing,
      ['--verb', verb],
      inspectReadings(standing, verb),
      `the readings of ${verb}`,
    );
    if (differs !== null) return { differs, verbs: verbs.length };
  }
  return { differs: null, verbs: verbs.length };
}

/**
 * Polls the visitor who arrives in every world under `corpus/good` through `sproutc view` and compares
 * the page with `sprout view`'s, then the scene's page and each of its verbs' readings (`comparePolls`); one
 * result per world: its name, whether every page is the same, and a sentence about the first line that is not.
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
      const differs = pollDiffers(
        sproutc,
        cartridge,
        stored,
        standing,
        [],
        inspectView(standing),
        'the view',
      );
      const polls = differs === null ? comparePolls(sproutc, cartridge, stored, standing) : null;
      const words = differs ?? polls.differs;
      results.push({
        name,
        passed: words === null,
        words:
          words ??
          `the same view, scene and readings of ${polls.verbs} verb${polls.verbs === 1 ? '' : 's'}`,
      });
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

/** Whether the TypeScript parser answered a turn with the engine's `unknown`. */
function answeredUnknown(turn) {
  return turn.parsed?.answered?.line?.passage === 'unknown';
}

/**
 * Reads every line of the script file `script` through `sproutc parse --each` over `cartridge`, its readings
 * resolved beside it, and tallies the verdicts: how many turns agree, differ, and read no words (`planned`); of
 * the TypeScript parser's `unknown` answers, how many there were and how many agree; and the first difference in
 * words, or null.
 */
export function compareParses(sproutc, cartridge, script) {
  const text = resolveFile(cartridge, script);
  writeFileSync(readingsPath(script), text);
  const readings = JSON.parse(text);
  const done = spawnSync(
    sproutc,
    ['parse', cartridge, '--readings', readingsPath(script), '--each'],
    {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    },
  );
  const counts = /^parsed: (\d+) agree, (\d+) differ, (\d+) planned$/m.exec(done.stdout ?? '');
  if (done.status === 2 || counts === null) {
    throw new Error((done.stderr || done.stdout || `exit ${done.status}`).trim());
  }
  const agreed = new Set(
    [...(done.stdout ?? '').matchAll(/^agree: step (\d+), turn (\d+)$/gm)].map(
      ([, s, t]) => `${s}:${t}`,
    ),
  );
  const unknown = readings.steps.flatMap((step) =>
    step.kind === 'command'
      ? step.turns.flatMap((turn, k) => (answeredUnknown(turn) ? [`${step.index}:${k + 1}`] : []))
      : [],
  );
  return {
    agree: Number(counts[1]),
    differ: Number(counts[2]),
    planned: Number(counts[3]),
    unknown: unknown.length,
    unknownAlike: unknown.filter((key) => agreed.has(key)).length,
    first: /^differ: (.*)$/m.exec(done.stdout ?? '')?.[1] ?? null,
  };
}

/**
 * Holds `sproutc parse` to the TypeScript parser over every script under `transcripts` and `tests` of every world
 * under `corpus` (`compareParses`); one result per world: its name, the turns that agree, differ and were planned,
 * the TypeScript parser's `unknown` answers and how many of them agree, and the first difference, or the words
 * of what stopped it. `only` names the worlds to compare; the default is every one.
 */
export function replayParses(sproutc, scratch, corpus = 'corpus/good', only = null) {
  const results = [];
  for (const name of readdirSync(corpus).sort()) {
    if (only !== null && !only.includes(name)) continue;
    const world = join(corpus, name);
    const folders = ['transcripts', 'tests'].filter((folder) => existsSync(join(world, folder)));
    if (folders.length === 0) continue;
    const folder = join(scratch, `${name}-parse`);
    mkdirSync(folder, { recursive: true });
    const cartridge = join(folder, `${name}.sproutworld`);
    const result = {
      name,
      agree: 0,
      differ: 0,
      planned: 0,
      unknown: 0,
      unknownAlike: 0,
      first: null,
    };
    try {
      packWorld(world, cartridge);
      for (const kind of folders) {
        for (const file of readdirSync(join(world, kind))
          .filter((f) => f.endsWith('.json'))
          .sort()) {
          const script = join(folder, `${kind}-${file}`);
          copyFileSync(join(world, kind, file), script);
          const one = compareParses(sproutc, cartridge, script);
          for (const key of ['agree', 'differ', 'planned', 'unknown', 'unknownAlike'])
            result[key] += one[key];
          if (result.first === null && one.first !== null)
            result.first = `${kind}/${file}, ${one.first}`;
        }
      }
    } catch (err) {
      result.failed = err instanceof Error ? err.message : String(err);
    }
    results.push(result);
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
