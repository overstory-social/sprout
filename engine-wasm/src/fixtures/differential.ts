import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  compileBundle,
  DEFAULT_LIMITS,
  emitCartridge,
  loadCartridge,
  oldestFirst,
  parseCommand,
  renderEffects,
  visitKey,
  type CommandHost,
  type InstanceId,
  type VisitKey,
} from '@overstory/sprout/lang';
import {
  memoryStore,
  readLog,
  runArrival,
  runCommandLine,
  runDeparture,
  runWake,
  Ticker,
  tsEngine,
  type Engine,
  type LogHost,
  type SproutStore,
  type StoredState,
} from '@overstory/sprout/core';
import {
  INSTALLED_EXTENSIONS,
  plays,
  readScript,
  readWorld,
  secondsOf,
  type Step,
} from '@overstory/sprout-player';

import { wasmEngine } from '../engine.js';

// The corpus played through both engines, for the differential spec: each
// script of a `corpus/good` world driven step by step through core's turns
// over a memory store of each engine's own, the two given the same inputs,
// and after each step what a host reads compared: every turn's given, the
// log's entries at debug depth, the stored world, and every poll and
// question a host asks of it. The driver is the same for both engines, so
// how it plays a script (its seeds, when wakes fall due) is its own and
// needs no other host's agreement.

/** One world's two hosts, each naming its engine, and the store each plays into. */
interface Pair {
  readonly ts: CommandHost & LogHost;
  readonly wasm: CommandHost & LogHost;
  readonly stores: { readonly ts: SproutStore; readonly wasm: SproutStore };
}

/** What the corpus world in `dir` is, compiled as a host publishes it, or the words of why it is not. */
export function compiledWorld(dir: string) {
  const read = readWorld(dir);
  if (read.source === null) return null;
  const { bundle } = compileBundle(read.source, {
    mode: 'publish',
    limits: DEFAULT_LIMITS,
    extensions: INSTALLED_EXTENSIONS,
  });
  if (bundle === null) return null;
  const cartridge = emitCartridge(bundle);
  const catalogue = loadCartridge(cartridge, {
    caps: DEFAULT_LIMITS.caps,
    installed: INSTALLED_EXTENSIONS,
  });
  return { cartridge, catalogue };
}

/** The scripts of the world in `dir`: its transcripts and its tests, by file. */
export function scriptsOf(dir: string): string[] {
  return ['transcripts', 'tests'].flatMap((folder) => {
    try {
      return readdirSync(join(dir, folder))
        .filter((file) => file.endsWith('.json'))
        .sort()
        .map((file) => join(dir, folder, file));
    } catch {
      return [];
    }
  });
}

/** `value` as JSON with every object's keys sorted and nothing undefined, so two engines' answers compare by what they hold. */
function shown(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(canonical(value));
}

/** What a host reads of a turn, whichever engine gave it: never what one engine's turn holds beside it. */
function given(turn: unknown): unknown {
  if (turn === null || typeof turn !== 'object') return turn;
  const one = turn as Record<string, unknown>;
  const read: Record<string, unknown> = { committed: one['committed'] };
  for (const key of [
    'effects',
    'stale',
    'cutShort',
    'fault',
    'unoccupied',
    'unwoken',
    'closed',
    'words',
    'nicknameRefused',
  ])
    if (key in one) read[key] = one[key];
  if ('refused' in one) read['refused'] = true;
  const value = one['value'];
  if (value !== null && typeof value === 'object') {
    const notes = value as Record<string, unknown>;
    if ('returning' in notes) read['returning'] = notes['returning'];
    else if ('answered' in notes) read['answered'] = true;
    else if ('displaced' in notes) read['displaced'] = true;
    else if ('step' in notes || 'drawn' in notes) {
      const step = notes['step'] as { verb: { library: string; name: string } } | null;
      const drawn = notes['drawn'] as { among: number } | null;
      read['step'] = step === null ? null : `${step.verb.library}.${step.verb.name}`;
      read['drawn'] = drawn === null ? null : drawn.among;
    }
  }
  return read;
}

/** The first way `ts` and `wasm` differ, named `what`; null where they hold the same. */
function differs(what: string, ts: unknown, wasm: unknown): string | null {
  const a = shown(ts);
  const b = shown(wasm);
  return a === b
    ? null
    : `${what}: the TypeScript engine gives ${a.slice(0, 600)} and the WebAssembly engine ${b.slice(0, 600)}`;
}

/** What `run` gives, or that it threw: the two engines word a host's defect each its own way. */
async function attempt<T>(run: () => Promise<T>): Promise<T | { readonly threw: true }> {
  try {
    return await run();
  } catch {
    return { threw: true };
  }
}

/** Each engine's answers to every poll and question a host asks of `stored` at `now`. */
function asked(engine: Engine, stored: StoredState, now: number): unknown {
  const visits = stored.visitors.map((one) => one.visit as VisitKey);
  const tried = <T>(run: () => T): T | { threw: true } => {
    try {
      return run();
    } catch {
      return { threw: true };
    }
  };
  return {
    occupied: engine.occupiedPlaces(stored),
    due: engine.dueWakes(stored, now),
    visitors: visits.map((visit) => {
      const standing = engine.standing(stored, visit);
      const scene = standing === null ? null : tried(() => engine.scene(stored, visit));
      const verbs =
        scene !== null && 'scene' in scene ? scene.scene.verbs.map((one) => one.verb) : [];
      return {
        visit,
        standing,
        hearers: engine.hearers(stored, visit),
        nickname: stored.visitors.map((other) =>
          engine.nicknameRefusal(stored, visit, other.nickname),
        ),
        view: standing === null ? null : tried(() => engine.view(stored, visit)),
        scene,
        readings: verbs.map((verb) => tried(() => engine.readings(stored, visit, verb))),
      };
    }),
  };
}

/** A deterministic seed for `place` in the step under `seed`, the same for both engines. */
const seedFor = (seed: number, place: InstanceId) =>
  [...place].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) >>> 0, seed) % 2 ** 32;

/**
 * Plays the script in `file` through both engines of the world `world`; every difference, by step, in words.
 * A world's script ends at the first step whose difference is found, since every later one follows from it.
 */
export async function playBoth(
  world: NonNullable<ReturnType<typeof compiledWorld>>,
  file: string,
): Promise<string[]> {
  const base: CommandHost & LogHost = {
    catalogue: world.catalogue,
    budgets: DEFAULT_LIMITS.budgets,
    parse: parseCommand,
    render: renderEffects,
    logDepth: 'debug',
  };
  const pair: Pair = {
    ts: { ...base, engine: tsEngine(base) },
    wasm: {
      ...base,
      engine: wasmEngine({
        cartridge: world.cartridge,
        catalogue: world.catalogue,
        budgets: base.budgets,
      }),
    },
    stores: { ts: memoryStore(), wasm: memoryStore() },
  };
  const script = readScript(readFileSync(file, 'utf8'), file);
  const tickers = { ts: new Ticker(), wasm: new Ticker() };
  let seed = 1;
  let now = 0;
  const problems: string[] = [];
  for (const [index, step] of script.steps.entries()) {
    if ('seed' in step) seed = step.seed;
    if (!plays(step)) continue;
    const stepSeed = seed++;
    const turns = { ts: [] as unknown[], wasm: [] as unknown[] };
    for (const which of ['ts', 'wasm'] as const) {
      turns[which] = await playStep(
        pair[which],
        pair.stores[which],
        tickers[which],
        step,
        stepSeed,
        now,
      );
    }
    if ('advance' in step) now += secondsOf(step.advance) ?? 0;
    const where = `step ${index + 1}`;
    const storedTs = await pair.stores.ts.read('w', (tx) => tx.state());
    const storedWasm = await pair.stores.wasm.read('w', (tx) => tx.state());
    const found =
      differs(`${where}'s turns`, turns.ts.map(given), turns.wasm.map(given)) ??
      differs(
        `${where}'s log`,
        await readLog(pair.stores.ts, 'w', { limit: 10_000 }),
        await readLog(pair.stores.wasm, 'w', { limit: 10_000 }),
      ) ??
      differs(`${where}'s stored world`, storedTs, storedWasm) ??
      differs(
        `${where}'s polls and questions`,
        asked(pair.ts.engine!, storedTs, now),
        asked(pair.wasm.engine!, storedWasm, now),
      );
    if (found !== null) {
      problems.push(found);
      break;
    }
  }
  return problems;
}

/** One step of a script through one engine's host and store: the turns it ran, each as core gave it. */
async function playStep(
  host: CommandHost & LogHost,
  store: SproutStore,
  ticker: Ticker,
  step: Exclude<Step, { readonly comment: string } | { readonly seed: number }>,
  seed: number,
  now: number,
): Promise<unknown[]> {
  const at = { seed, mayHold: null, now };
  const visitOf = (nickname: string) => visitKey(`visit:${nickname}`);
  if ('arrive' in step) {
    const admitted = await attempt(() =>
      runArrival(
        store,
        'w',
        host,
        at,
        { ...at, visit: visitOf(step.arrive), nickname: step.arrive },
        {
          moderate: () => true,
        },
      ),
    );
    return 'threw' in admitted ? [admitted] : [admitted.caughtUp, admitted.arrived];
  }
  if ('leave' in step)
    return [
      await attempt(() => runDeparture(store, 'w', host, { ...at, visit: visitOf(step.leave) })),
    ];
  if ('as' in step) {
    let next = seed;
    const turns = await attempt(() =>
      runCommandLine(
        store,
        'w',
        host,
        { ...at, visit: visitOf(step.as), text: step.type },
        () => (next = (next + 1) % 2 ** 32),
      ),
    );
    return 'threw' in turns ? [turns] : turns;
  }
  if ('tick' in step) {
    const round = await attempt(() =>
      ticker.round(store, 'w', host, now, (place) => ({
        seed: seedFor(seed, place),
        mayHold: null,
      })),
    );
    return 'threw' in round ? [round] : round.map((one) => ('skipped' in one ? one : one.turn));
  }
  // An advance: every wake that falls due by its end, oldest first, each at the instant it fell due.
  const until = now + (secondsOf(step.advance) ?? 0);
  const woke: unknown[] = [];
  for (let rounds = 0; rounds < 256; rounds++) {
    const stored = await store.read('w', (tx) => tx.state());
    const [due] = host.engine!.dueWakes(stored, until).sort(oldestFirst);
    if (due === undefined) break;
    woke.push(
      await attempt(() =>
        runWake(store, 'w', host, {
          object: due.object,
          serial: due.serial,
          seed: seedFor(seed, due.object),
          mayHold: null,
          now: Math.max(now, due.dueAt),
        }),
      ),
    );
  }
  return woke;
}
