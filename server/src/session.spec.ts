import { describe, expect, it } from 'vitest';

import { PROTOCOL } from '@overstory/sprout/core';

import { contextFor, corpusWorld, keptConnection, manualClock } from './fixtures/server.js';
import { depart, frame, opened, visitOfToken } from './session.js';
import { publish } from './worlds.js';

const HELLO = JSON.stringify({
  t: 'hello',
  protocol: PROTOCOL,
  client: 'spec',
  token: 'marta-token-0123456789',
  renders: [],
});

async function context() {
  const clock = manualClock();
  const made = contextFor(clock, corpusWorld('sequences'));
  const run = [...made.worlds.values()][0]!;
  await publish(made.store, run.served, made.config, clock.now(), new Date(0));
  return made;
}

describe('a connection', () => {
  it('opens as no one, sent prose and errors, in no world', () => {
    const connection = opened(
      () => {},
      () => {},
    );
    expect(connection.visit).toBeNull();
    expect([...connection.levels]).toEqual(['prose', 'error']);
    expect(connection.world).toBeNull();
  });

  it('is its token’s visit, a hash of it, the same for the same token and never the token', () => {
    const one = visitOfToken('marta-token-0123456789');
    expect(one).toBe(visitOfToken('marta-token-0123456789'));
    expect(one).not.toBe(visitOfToken('ines-token-0123456789'));
    expect(one).not.toContain('marta-token');
    expect(one).toMatch(/^token:[0-9a-f]{64}$/);
  });
});

describe('a frame', () => {
  it('refuses a second `hello`, and one malformed after it at the frame', async () => {
    const made = await context();
    const connection = keptConnection();
    await frame(made, connection, HELLO);
    await frame(made, connection, HELLO);
    await frame(made, connection, '{"t":"poll"}');
    expect(connection.sent.slice(1)).toEqual([
      {
        t: 'refused',
        stage: 'hello',
        reason: 'twice',
        text: 'This connection has said `hello` already.',
      },
      expect.objectContaining({ t: 'refused', stage: 'frame', reason: 'malformed' }),
    ]);
  });

  it('sets the levels records are sent at, prose and errors where it names none, and answers a ping with nothing', async () => {
    const made = await context();
    const connection = keptConnection();
    await frame(made, connection, HELLO);
    await frame(made, connection, JSON.stringify({ t: 'levels', show: ['info', 'debug'] }));
    expect([...connection.levels]).toEqual(['info', 'debug']);
    await frame(made, connection, JSON.stringify({ t: 'levels', show: [] }));
    expect([...connection.levels]).toEqual(['prose', 'error']);
    const before = connection.sent.length;
    await frame(made, connection, JSON.stringify({ t: 'ping' }));
    expect(connection.sent).toHaveLength(before);
  });

  it('refuses a second `admit`, and records a step at info to one who asked for it', async () => {
    const made = await context();
    const connection = keptConnection();
    await frame(made, connection, HELLO);
    await frame(
      made,
      connection,
      JSON.stringify({ t: 'admit', world: 'sequences', nickname: 'Marta' }),
    );
    await frame(
      made,
      connection,
      JSON.stringify({ t: 'admit', world: 'sequences', nickname: 'Marta' }),
    );
    expect(connection.sent.at(-1)).toMatchObject({
      t: 'refused',
      stage: 'admit',
      reason: 'admitted',
    });
    await frame(made, connection, JSON.stringify({ t: 'levels', show: ['prose', 'info'] }));
    await frame(made, connection, JSON.stringify({ t: 'command', seq: 1, line: 'take all' }));
    expect(connection.sent.filter((one) => (one as { t: string }).t === 'record')).toEqual([
      expect.objectContaining({ level: 'info', text: 'step: sprout.take' }),
      expect.objectContaining({ level: 'info', text: 'step: sprout.take' }),
    ]);
  });

  it('leaves the world on `leave`, saying so, and departs nothing where it is in none', async () => {
    const made = await context();
    const connection = keptConnection();
    await frame(made, connection, HELLO);
    await depart(made, connection);
    await frame(
      made,
      connection,
      JSON.stringify({ t: 'admit', world: 'sequences', nickname: 'Marta' }),
    );
    await frame(made, connection, JSON.stringify({ t: 'leave' }));
    expect(connection.sent.at(-1)).toEqual({ t: 'bye', reason: 'left', text: 'You leave.' });
    expect(connection.closed).toBe(true);
    expect(connection.world).toBeNull();
  });

  it('answers a frame it fails on, in words, and sends a waiting line its `seq`, logging the failure', async () => {
    const made = await context();
    const connection = keptConnection();
    await frame(made, connection, HELLO);
    await frame(
      made,
      connection,
      JSON.stringify({ t: 'admit', world: 'sequences', nickname: 'Marta' }),
    );
    const failing = {
      ...made,
      store: {
        ...made.store,
        transaction: () => Promise.reject(new Error('the disk is gone')),
      },
    };
    connection.sent.length = 0;
    await frame(failing, connection, JSON.stringify({ t: 'command', seq: 4, line: 'take key' }));
    expect(connection.sent).toEqual([
      {
        t: 'refused',
        stage: 'frame',
        reason: 'failed',
        text: 'The server could not finish answering that. What it did before it failed stands.',
      },
      { t: 'effects', seq: 4, effects: [] },
    ]);
    expect((made.log as unknown as { lines: string[] }).lines.at(-1)).toContain(
      'a frame could not be answered: Error: the disk is gone',
    );
  });
});
