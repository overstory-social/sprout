import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS } from '@overstory/sprout/lang';

import { ConversationPace, runConversation } from '../conversation.js';
import { CATALOGUE, hallEngine, hallHost, MARTA } from '../fixtures/hall.js';
import { memoryStore } from '../memory-store.js';
import type { MicroworldRecord } from '../records.js';
import type { SproutStore } from '../store.js';
import { runArrival, runCommand, runDeparture } from '../turns.js';
import { runView } from '../views.js';
import type { LogDepth } from './depth.js';
import { wholeLog, type Logged } from './entry.js';
import { publishWorld } from './publish.js';
import { replayLog, type ReplayBundles } from './replay.js';

// Replaying a log, on a stand-in engine whose second bundle words its
// commands otherwise: what reproduces, what diverges, and what is never run
// again. That a real engine reproduces its own log is the engine
// conformance suite's.

const at = (now: number) => ({ now, seed: now * 7919, mayHold: null });
const typed = (text: string, now: number) => ({ visit: MARTA, text, ...at(now) });
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
const clack = (text: string) => `Clack: ${text}.`;

/** Each bundle by its hash: `first` says a command back, `second` says it with a clack. */
const bundles: ReplayBundles = (opening) => ({
  catalogue: CATALOGUE,
  engine: () => hallEngine(opening.bundle === 'second' ? clack : undefined).engine,
});

const OPEN = { moderate: () => true };
const TALK = { rules: { characters: null, pace: null }, moderate: () => true };

/**
 * A world played from its first publish: Marta arrives, types, says
 * something, faults, leaves, and plays on after a republish redeploys it;
 * one poll faults. Its log is kept at `depth`.
 */
async function played(depth: LogDepth = 'debug'): Promise<SproutStore> {
  const store = memoryStore();
  const host = hallHost(depth);
  const again = hallHost(depth, clack);
  await publishWorld(store, record, { hash: 'first' }, 0);
  await runArrival(store, 'w', host, at(1), { visit: MARTA, nickname: 'Marta', ...at(1) }, OPEN);
  await runCommand(store, 'w', host, typed('wave', 2));
  await runConversation(store, 'w', host, TALK, new ConversationPace(), {
    visit: MARTA,
    text: 'one more',
    at: 2,
  });
  await runCommand(store, 'w', host, typed('fault', 3));
  await runDeparture(store, 'w', host, { visit: MARTA, ...at(4) });
  await publishWorld(store, record, { hash: 'second' }, 10);
  await runArrival(store, 'w', again, at(11), { visit: MARTA, nickname: 'Marta', ...at(11) }, OPEN);
  await runCommand(store, 'w', again, typed('bow', 12));
  again.standing.pollsFault = true;
  await runView(store, 'w', again, MARTA, 13);
  await runCommand(store, 'w', again, typed('wave', 14));
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

  it('diverges where a segment is read against a bundle other than the one that produced it', async () => {
    const log = await wholeLog(await played(), 'w', 100);
    const { diverged } = replayLog(log, (opening) => bundles({ ...opening, bundle: 'first' }));
    const clacked = log.filter(
      ({ entry }) =>
        entry.kind === 'command' && entry.effects[0]?.paragraphs[0]?.startsWith('Clack') === true,
    );
    expect(clacked).toHaveLength(2);
    expect(diverged.map((d) => d.seq)).toEqual(clacked.map((one) => one.seq));
    expect(diverged[0]!.replayed).toMatchObject({ effects: [{ paragraphs: ['You bow.'] }] });
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

  it('refuses a turn logged before any publish', async () => {
    const log = await wholeLog(await played(), 'w', 100);
    expect(() => replayLog(log.slice(1), bundles)).toThrow(
      /entry 2, of kind `arrival`, comes before any publish/,
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
    }
  });

  it('at play depth, compares each turn’s effects by their count and digest, and still reproduces the world', async () => {
    const store = await played('play');
    const log = await wholeLog(store, 'w', 100);
    const replayed = replayLog(log, bundles);
    expect(replayed.diverged).toEqual([]);
    expect(replayed.state).toEqual(await store.read('w', (tx) => tx.state()));
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
