import { describe, expect, it } from 'vitest';

import { DEFAULT_LIMITS, dueWakes } from '@overstory/sprout/lang';

import { command, GAUGE, HALL, MARTA, tally } from '../fixtures/tally.js';
import { memoryStore } from '../memory-store.js';
import type { MicroworldRecord } from '../records.js';
import type { SproutStore } from '../store.js';
import {
  committedState,
  runArrival,
  runCommand,
  runDeparture,
  runTick,
  runWake,
  type NicknameHost,
} from '../turns.js';
import { runView } from '../views.js';
import { wholeLog, type Logged } from './entry.js';
import { publishWorld } from './publish.js';
import { replayLog, type ReplayHosts } from './replay.js';

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

/** The host for the bundle a segment names, as the host keeps its bundles by hash. */
const hosts: ReplayHosts = (opening) => {
  if (opening.bundle === first.bundle.hash) return first.host;
  if (opening.bundle === second.bundle.hash) return second.host;
  throw new Error(`no bundle ${opening.bundle}`);
};

/**
 * A world played from its first publish: Marta arrives, types, is
 * ticked and woken, faults twice, leaves, comes back to a catch-up that
 * faults, and plays on after a republish; one poll faults.
 */
async function played(): Promise<SproutStore> {
  const store = memoryStore();
  const { host } = first;
  await publishWorld(store, record, first.bundle, 0);
  await runArrival(store, 'w', host, at(1), { visit: MARTA, nickname: 'Marta', ...at(1) }, OPEN);
  await runCommand(store, 'w', host, command('bump counter', 2));
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
  await runCommand(store, 'w', second.host, command('bump counter', 401));
  const blind = { ...second.host, budgets: { ...second.host.budgets, pollSteps: 1 } };
  await runView(store, 'w', blind, MARTA, 402);
  await runCommand(store, 'w', second.host, command('bump gauge', 403));
  return store;
}

const turnsIn = (log: readonly Logged[]) =>
  log.filter(({ entry }) => !['publish', 'withholding', 'poll-fault'].includes(entry.kind)).length;

describe('replaying the log', () => {
  it('reproduces the world exactly, every turn against the bundle published before it', async () => {
    const store = await played();
    const log = await wholeLog(store, 'w', 4);
    expect(log.map(({ entry }) => entry.kind)).toContain('poll-fault');
    const replayed = replayLog(log, hosts);
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
    expect(replayLog(log, hosts).diverged).toEqual([]);
  });

  it('diverges where a segment is read against a bundle other than the one that produced it', async () => {
    const log = await wholeLog(await played(), 'w', 100);
    const { diverged } = replayLog(log, () => first.host);
    const clacked = log.filter(
      ({ entry }) => entry.kind === 'command' && entry.effects[0]?.paragraphs[0] === 'Clack.',
    );
    expect(clacked).toHaveLength(2);
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
    expect(replayLog(altered, hosts).diverged.map((d) => d.seq)).toEqual([target.seq]);
  });

  it('diverges, and runs nothing, where a turn cannot run again over what the log says came before', async () => {
    const log = await wholeLog(await played(), 'w', 100);
    const arrived = log.find(({ entry }) => entry.kind === 'arrival')!;
    const { diverged } = replayLog(
      log.filter((one) => one.seq !== arrived.seq),
      hosts,
    );
    expect(diverged.length).toBeGreaterThan(0);
    expect(diverged[0]).toMatchObject({ logged: { kind: 'command' }, replayed: null });
  });

  it('refuses a turn logged before any publish', async () => {
    const log = await wholeLog(await played(), 'w', 100);
    expect(() => replayLog(log.slice(1), hosts)).toThrow(
      /entry 2, of kind `maintenance`, comes before any publish/,
    );
  });

  it('never replays a poll’s fault, and writes nothing for it', async () => {
    const log = await wholeLog(await played(), 'w', 100);
    const polls = log.filter(({ entry }) => entry.kind === 'poll-fault');
    expect(polls).toHaveLength(1);
    const without = replayLog(
      log.filter(({ entry }) => entry.kind !== 'poll-fault'),
      hosts,
    );
    expect(without).toEqual(replayLog(log, hosts));
    expect(without.state.instances.find((i) => i.id === GAUGE)).toBeDefined();
  });
});
