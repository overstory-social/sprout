import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS, dueWakes } from '@overstory/sprout/lang';

import { ConversationPace, runConversation } from '../conversation.js';
import { tsEngine } from '../engine.js';
import { command, GAUGE, HALL, MARTA, tally } from '../fixtures/tally.js';
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
import { committedState } from '../fixtures/committed.js';
import { runView } from '../views.js';
import type { LogDepth } from './depth.js';
import { wholeLog, type Logged } from './entry.js';
import { publishWorld } from './publish.js';
import { replayLog, type ReplayBundle, type ReplayBundles } from './replay.js';

const first = tally();
const second = tally('Clack.');
const OPEN: NicknameHost = { moderate: () => true };
const at = (now: number) => ({ now, seed: now * 7919, mayHold: null });
const record: MicroworldRecord = {
  id: 'w',
  archive: { files: [], manifest: null },
  stamp: 'stamp-1',
  level: 1,
  extensions: [],
  caps: DEFAULT_LIMITS.caps,
  excepted: false,
  loadedAt: new Date('2026-09-18T12:00:00Z'),
};

/** `host`'s bundle on the TypeScript runtime's engine. */
const onEngine = (host: typeof first.host): ReplayBundle => ({
  catalogue: host.catalogue,
  engine: (budgets) => tsEngine({ ...host, budgets }),
});

/** The bundle a segment names, as the host keeps its bundles by hash. */
const bundles: ReplayBundles = (opening) => {
  if (opening.bundle === first.bundle.hash) return onEngine(first.host);
  if (opening.bundle === second.bundle.hash) return onEngine(second.host);
  throw new Error(`no bundle ${opening.bundle}`);
};

const TALK = { rules: { characters: null, pace: null }, moderate: () => true };

/**
 * A world played from its first publish: Marta arrives, types, says
 * something, is ticked and woken, faults twice, leaves, comes back to a
 * catch-up that faults, and plays on after a republish redeploys it, one line running
 * an intent's two steps; one poll faults. Its log is kept at `depth`, debug
 * unless a test says otherwise, so what each turn said can be read back.
 */
async function played(depth: LogDepth = 'debug'): Promise<SproutStore> {
  const store = memoryStore();
  const host = { ...first.host, logDepth: depth };
  const again = { ...second.host, logDepth: depth };
  await publishWorld(store, record, first.bundle, 0);
  await runArrival(store, 'w', host, at(1), { visit: MARTA, nickname: 'Marta', ...at(1) }, OPEN);
  await runCommand(store, 'w', host, command('bump counter', 2));
  await runConversation(store, 'w', host, TALK, new ConversationPace(), {
    visit: MARTA,
    text: 'one more',
    at: 2,
  });
  await runCommand(store, 'w', host, command('smash counter', 3));
  const tight = { ...host, budgets: { ...host.budgets, steps: 1 } };
  await runCommand(store, 'w', tight, command('bump gauge', 4));
  await runCommand(store, 'w', host, command('rest gauge', 5));
  await runTick(store, 'w', host, { place: HALL, ...at(10) });
  const [due] = dueWakes(await committedState(store, 'w', host), 70);
  await runWake(store, 'w', host, { object: due!.object, serial: due!.serial, ...at(70) });
  await runCommand(store, 'w', host, command('rest counter', 80));
  await runDeparture(store, 'w', host, { visit: MARTA, ...at(90) });
  await runArrival(
    store,
    'w',
    host,
    at(300),
    { visit: MARTA, nickname: 'Marta', ...at(300) },
    OPEN,
  );
  await publishWorld(store, record, second.bundle, 400);
  // The republish redeployed the world, and the host admits everyone present again.
  await runArrival(
    store,
    'w',
    again,
    at(400),
    { visit: MARTA, nickname: 'Marta', ...at(400) },
    OPEN,
  );
  await runCommand(store, 'w', again, command('bump counter', 401));
  const blind = { ...again, budgets: { ...again.budgets, pollSteps: 1 } };
  await runView(store, 'w', blind, MARTA, 402);
  await runCommand(store, 'w', again, command('bump gauge', 403));
  let seed = 20;
  await runCommandLine(store, 'w', again, command('twice gauge', 404), () => (seed += 1));
  return store;
}

const NOT_TURNS = ['publish', 'withholding', 'said', 'poll-fault'];
const turnsIn = (log: readonly Logged[]) =>
  log.filter(({ entry }) => !NOT_TURNS.includes(entry.kind)).length;

describe('replaying the log', () => {
  it('reproduces the world exactly, every turn against the bundle published before it', async () => {
    const store = await played();
    const log = await wholeLog(store, 'w', 4);
    expect(log.map(({ entry }) => entry.kind)).toEqual(
      expect.arrayContaining(['said', 'poll-fault']),
    );
    const replayed = replayLog(log, bundles);
    expect(replayed.diverged).toEqual([]);
    expect(replayed.turns).toBe(turnsIn(log));
    expect(replayed.state).toEqual(await store.read('w', (tx) => tx.state()));
  });

  it('reproduces a turn that faulted under the budgets it was logged with, whatever the replaying host’s', async () => {
    const log = await wholeLog(await played(), 'w', 100);
    const starved = log.find(
      ({ entry }) => entry.kind === 'command' && entry.fault?.name === 'BudgetExhausted',
    );
    expect(starved?.entry).toMatchObject({ budgets: { steps: 1 } });
    expect(replayLog(log, bundles).diverged).toEqual([]);
  });

  it('diverges where a segment is read against a bundle other than the one that produced it', async () => {
    const log = await wholeLog(await played(), 'w', 100);
    const { diverged } = replayLog(log, () => onEngine(first.host));
    const clacked = log.filter(
      ({ entry }) => entry.kind === 'command' && entry.effects[0]?.paragraphs[0] === 'Clack.',
    );
    expect(clacked).toHaveLength(4);
    expect(diverged.map((d) => d.seq)).toEqual(clacked.map((one) => one.seq));
    expect(diverged[0]!.replayed).toMatchObject({ effects: [{ paragraphs: ['Click.'] }] });
  });

  it('diverges where what a turn said was changed after the fact', async () => {
    const log = await wholeLog(await played(), 'w', 100);
    const target = log.find(({ entry }) => entry.kind === 'command' && entry.fault === null)!;
    if (target.entry.kind !== 'command') throw new Error('not a command');
    const said = target.entry.effects.map((e) => ({ ...e, paragraphs: ['Nothing happened.'] }));
    const altered: Logged[] = log.map((one) =>
      one.seq === target.seq ? { seq: one.seq, entry: { ...target.entry, effects: said } } : one,
    );
    expect(replayLog(altered, bundles).diverged.map((d) => d.seq)).toEqual([target.seq]);
  });

  it('diverges, and runs nothing, where a turn cannot run again over what the log says came before', async () => {
    const log = await wholeLog(await played(), 'w', 100);
    const arrived = log.find(({ entry }) => entry.kind === 'arrival')!;
    const { diverged } = replayLog(
      log.filter((one) => one.seq !== arrived.seq),
      bundles,
    );
    expect(diverged.length).toBeGreaterThan(0);
    expect(diverged[0]).toMatchObject({ logged: { kind: 'command' }, replayed: null });
  });

  it('refuses a turn logged before any publish', async () => {
    const log = await wholeLog(await played(), 'w', 100);
    expect(() => replayLog(log.slice(1), bundles)).toThrow(
      /entry 2, of kind `maintenance`, comes before any publish/,
    );
  });

  it('never replays a poll’s fault or a line said, and writes nothing for either', async () => {
    const log = await wholeLog(await played(), 'w', 100);
    for (const kind of ['poll-fault', 'said']) {
      expect(log.filter(({ entry }) => entry.kind === kind)).toHaveLength(1);
      const without = replayLog(
        log.filter(({ entry }) => entry.kind !== kind),
        bundles,
      );
      expect(without).toEqual(replayLog(log, bundles));
      expect(without.state.instances.find((i) => i.id === GAUGE)).toBeDefined();
    }
  });
  it('at play depth, keeps each turn’s effects as their count and digest, and still reproduces the world', async () => {
    const store = await played('play');
    const log = await wholeLog(store, 'w', 100);
    const said = log.filter(({ entry }) => 'effects' in entry);
    const maintenance = log.filter(({ entry }) => entry.kind === 'maintenance').length;
    expect(said.length).toBe(turnsIn(log) - maintenance);
    for (const { entry } of said) {
      if (!('effects' in entry)) continue;
      expect(entry.effects).toEqual([]);
      expect(entry.digest).toMatchObject({ sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    }
    expect(said.some(({ entry }) => 'digest' in entry && entry.digest!.count > 0)).toBe(true);
    const replayed = replayLog(log, bundles);
    expect(replayed.diverged).toEqual([]);
    expect(replayed.state).toEqual(await store.read('w', (tx) => tx.state()));
  });

  it('at play depth, diverges where a turn’s digest says it said otherwise', async () => {
    const log = await wholeLog(await played('play'), 'w', 100);
    const target = log.find(({ entry }) => entry.kind === 'command' && entry.fault === null)!;
    if (target.entry.kind !== 'command') throw new Error('not a command');
    const { count, sha256 } = target.entry.digest!;
    const flipped = `${sha256[0] === '0' ? '1' : '0'}${sha256.slice(1)}`;
    for (const digest of [
      { count: count + 1, sha256 },
      { count, sha256: flipped },
    ]) {
      const altered: Logged[] = log.map((one) =>
        one.seq === target.seq ? { seq: one.seq, entry: { ...target.entry, digest } } : one,
      );
      expect(replayLog(altered, bundles).diverged.map((d) => d.seq)).toEqual([target.seq]);
    }
  });
});
