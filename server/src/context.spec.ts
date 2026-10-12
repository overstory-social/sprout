import { describe, expect, it } from 'vitest';

import { SEED_MAX } from '@overstory/sprout/lang';
import { PROTOCOL } from '@overstory/sprout/core';

import {
  fanOut,
  inputsNow,
  randomSeed,
  REAL_CLOCK,
  record,
  sendReadings,
  sendStatus,
} from './context.js';
import { contextFor, corpusWorld, keptConnection, manualClock } from './fixtures/server.js';
import { frame } from './session.js';
import { publish } from './worlds.js';

async function withTwo() {
  const clock = manualClock();
  const context = contextFor(clock, corpusWorld('sequences'));
  const world = [...context.worlds.values()][0]!;
  await publish(context.store, world.served, context.config, clock.now(), new Date(0));
  const [marta, ines] = [keptConnection(), keptConnection()];
  for (const [connection, nickname] of [
    [marta, 'Marta'],
    [ines, 'Ines'],
  ] as const) {
    await frame(
      context,
      connection,
      JSON.stringify({
        t: 'hello',
        protocol: PROTOCOL,
        client: 'spec',
        token: `${nickname}-token-0123456789`,
        renders: [],
      }),
    );
    await frame(context, connection, JSON.stringify({ t: 'admit', world: 'sequences', nickname }));
  }
  marta.sent.length = 0;
  ines.sent.length = 0;
  return { context, world, marta, ines };
}

describe('what a turn gave, fanned out', () => {
  it('reaches each connection that reads some of it, `seq` only to the one whose line it was', async () => {
    const { context, marta, ines } = await withTwo();
    await frame(context, marta, JSON.stringify({ t: 'command', seq: 5, line: 'take key' }));
    expect(marta.sent.find((one) => (one as { t: string }).t === 'effects')).toMatchObject({
      seq: 5,
    });
    expect(ines.sent.find((one) => (one as { t: string }).t === 'effects')).toMatchObject({
      seq: null,
    });
  });

  it('sends nothing to a connection that reads none of it, and `seq` alone to the one who typed', async () => {
    const { context, world, marta, ines } = await withTwo();
    await fanOut(context, world, [], [], { connection: marta, seq: 9, last: true });
    expect(marta.sent).toEqual([{ t: 'effects', seq: 9, last: true, effects: [] }]);
    expect(ines.sent).toEqual([]);
  });
});

describe('a connection’s status line', () => {
  it('is sent where it stands and the verbs it could use, then again only when either changes', async () => {
    const { context, world, marta } = await withTwo();
    await sendStatus(context, world, marta);
    await sendStatus(context, world, marta);
    expect(marta.sent).toEqual([]);
    marta.lastStatus = null;
    marta.lastVerbs = null;
    await sendStatus(context, world, marta, 3);
    expect(marta.sent.map((one) => (one as { t: string }).t)).toEqual(['view', 'status', 'verbs']);
    const { verbs } = marta.sent[2] as { verbs: { verb: string; phrases: string[] }[] };
    expect(verbs.find((one) => one.verb === 'sprout.take')?.phrases).toContain('take …');
  });

  it('derives no reading after a turn: only the scene, so a verb’s readings wait to be asked for', async () => {
    const { context, world, marta } = await withTwo();
    await frame(context, marta, JSON.stringify({ t: 'command', seq: 1, line: 'take key' }));
    const visit = marta.visit!;
    const { id, host } = { id: world.served.id, host: world.served.host };
    const scene = await world.views.scene(context.store, id, host, visit, 0);
    // The scene is the one the status was sent from, kept; no view was polled.
    expect(await world.views.scene(context.store, id, host, visit, 0)).toBe(scene);
    expect(marta.sent.some((one) => (one as { t: string }).t === 'readings')).toBe(false);
  });

  it('names what else the place holds, the other visitor among it, and never the one it is sent to', async () => {
    const { context, world, marta } = await withTwo();
    marta.lastStatus = null;
    await sendStatus(context, world, marta);
    const status = marta.sent.find((one) => (one as { t: string }).t === 'status') as {
      here: { name: string }[];
    };
    expect(status.here.map((one) => one.name)).toEqual(['a key', 'a coin', 'Ines']);
  });
});

describe('a verb’s readings, asked for', () => {
  it('are sent with the `seq` they were asked with, as the view would offer them', async () => {
    const { context, world, marta } = await withTwo();
    await sendReadings(context, world, marta, 4, 'sprout.take');
    expect(marta.sent).toHaveLength(1);
    expect(marta.sent[0]).toMatchObject({
      t: 'readings',
      seq: 4,
      verb: 'sprout.take',
      faulted: false,
    });
    const { readings } = marta.sent[0] as { readings: { typed: string }[] };
    expect(readings.map((one) => one.typed)).toEqual(
      expect.arrayContaining(['take key', 'take coin']),
    );
  });

  it('are none for a verb the scene does not list, the frame read off the wire', async () => {
    const { context, marta } = await withTwo();
    await frame(context, marta, JSON.stringify({ t: 'readings', seq: 2, verb: 'nowhere.juggle' }));
    expect(marta.sent).toEqual([
      { t: 'readings', seq: 2, verb: 'nowhere.juggle', readings: [], faulted: false },
    ]);
  });
});

describe('a host record', () => {
  it('reaches a connection only at a level it asked for', async () => {
    const { context, marta } = await withTwo();
    record(context, marta, 'info', 'step: sprout.take');
    record(context, marta, 'error', 'a command faulted');
    expect(marta.sent).toEqual([
      { t: 'record', level: 'error', text: 'a command faulted', at: 1000 },
    ]);
  });
});

describe('a turn’s inputs', () => {
  it('are a fresh seed and the host’s time, with no bound on instances', async () => {
    const { context } = await withTwo();
    const [first, second] = [inputsNow(context), inputsNow(context)];
    expect(first).toMatchObject({ now: 1000, mayHold: null });
    expect(second.seed).not.toBe(first.seed);
  });

  it('draw a seed at random within the seeds there are, and read the real clock in whole seconds', () => {
    for (let draw = 0; draw < 50; draw++) {
      const seed = randomSeed();
      expect(Number.isInteger(seed) && seed >= 0 && seed <= SEED_MAX).toBe(true);
    }
    expect(Number.isInteger(REAL_CLOCK.now())).toBe(true);
  });
});
