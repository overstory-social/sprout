import { DEFAULT_LIMITS } from '@overstory/sprout/lang';

import { wholeLog } from '../log/entry.js';
import { publishWorld } from '../log/publish.js';
import { replayLog, type ReplayBundles } from '../log/replay.js';
import { memoryStore } from '../memory-store.js';
import type { MicroworldRecord } from '../records.js';
import type { SproutStore } from '../store.js';
import {
  runArrival,
  runCommand,
  runCommandLine,
  runDeparture,
  runTick,
  runWake,
  type NicknameHost,
} from '../turns.js';
import { equal, ok } from './check.js';
import {
  countOf,
  GAUGE,
  HALL,
  MARTA,
  played,
  storedIn,
  TALLY,
  type EngineCase,
  type EngineWorld,
  type MakeEngine,
} from './worlds.js';

// The suite's replay of a world's log (the spec's The runtime › The log):
// a world played from its publish, every turn handed again to the engine
// with the seed, inputs and words its entry logged, reproduces each entry
// and the stored state the turns wrote.

const OPEN: NicknameHost = { moderate: () => true };
const at = (now: number) => ({ now, seed: now * 7919, mayHold: null });
const command = (text: string, now: number) => ({ visit: MARTA, text, ...at(now) });
const RECORD: MicroworldRecord = {
  id: 'w',
  archive: { files: [], manifest: null },
  stamp: 'stamp-1',
  level: 1,
  extensions: [],
  caps: DEFAULT_LIMITS.caps,
  excepted: false,
  loadedAt: new Date('2026-10-13T12:00:00Z'),
};

/** `world`'s bundle as a replay runs it, on the engines `make` makes under each turn's budgets. */
export const bundleOn =
  (make: MakeEngine, world: EngineWorld): ReplayBundles =>
  () => ({
    catalogue: world.host.catalogue,
    engine: (budgets) => make({ host: { ...world.host, budgets }, cartridge: world.cartridge }),
  });

/**
 * The tally played from its publish at `depth`: Marta arrives, bumps,
 * smashes and faults, faults again under a budget of one step, wrecks the
 * gauge in an intent's three planned steps, rests the counter, is ticked
 * and woken, and leaves.
 */
export async function playedTally(make: MakeEngine, depth: 'play' | 'debug'): Promise<SproutStore> {
  const store = memoryStore();
  const host = played(make, TALLY, { logDepth: depth });
  await publishWorld(store, RECORD, { hash: 'tally' }, 0);
  await runArrival(store, 'w', host, at(1), { visit: MARTA, nickname: 'Marta', ...at(1) }, OPEN);
  await runCommand(store, 'w', host, command('bump counter', 2));
  await runCommand(store, 'w', host, command('smash counter', 3));
  const tight = played(make, TALLY, { budgets: { steps: 1 }, logDepth: depth });
  await runCommand(store, 'w', tight, command('bump gauge', 4));
  let seed = 20;
  await runCommandLine(store, 'w', host, command('wreck gauge', 5), () => (seed += 1));
  await runCommand(store, 'w', host, command('rest counter', 6));
  await runTick(store, 'w', host, { place: HALL, ...at(10) });
  const [due] = host.engine!.dueWakes(await storedIn(store), 70);
  ok(due !== undefined, 'the rest asked for a wake');
  await runWake(store, 'w', host, { object: due.object, serial: due.serial, ...at(70) });
  await runDeparture(store, 'w', host, { visit: MARTA, ...at(90) });
  return store;
}

export const replayCases: EngineCase[] = [
  {
    name: 'a log replays to the world it wrote',
    proves:
      'every turn of a played log, handed again to the engine with the seed, inputs, budgets and words it logged, a planned step among them, reproduces its entry, at debug depth and at play depth, and the stored state',
    async run(make) {
      for (const depth of ['debug', 'play'] as const) {
        const store = await playedTally(make, depth);
        const log = await wholeLog(store, 'w', 100);
        ok(
          log.some(({ entry }) => entry.kind === 'command' && entry.planned !== null),
          `the ${depth} log holds a planned step`,
        );
        const replayed = replayLog(log, bundleOn(make, TALLY));
        equal(replayed.diverged, [], `what diverged at ${depth} depth`);
        equal(replayed.turns, log.length - 1, `the turns replayed at ${depth} depth`);
        equal(replayed.state, await storedIn(store), `the state replayed at ${depth} depth`);
        equal(await countOf(store), 64, 'the counter, which the wake set to the seconds it waited');
        equal(
          await countOf(store, GAUGE),
          1,
          'the gauge, which the wreck bumped once before its smash faulted',
        );
      }
    },
  },
  {
    name: 'a log with a turn altered diverges there',
    proves:
      'a turn whose logged words were changed after the fact is named as diverging, and every other turn still reproduces',
    async run(make) {
      const log = await wholeLog(await playedTally(make, 'debug'), 'w', 100);
      const target = log.find(({ entry }) => entry.kind === 'command' && entry.fault === null);
      ok(target !== undefined && target.entry.kind === 'command', 'a command that committed');
      const entry = target.entry;
      if (entry.kind !== 'command') return;
      const altered = log.map((one) =>
        one.seq === target.seq
          ? {
              seq: one.seq,
              entry: {
                ...entry,
                effects: entry.effects.map((e) => ({ ...e, paragraphs: ['Nothing happened.'] })),
              },
            }
          : one,
      );
      equal(
        replayLog(altered, bundleOn(make, TALLY)).diverged.map((one) => one.seq),
        [target.seq],
        'what diverged',
      );
    },
  },
];
