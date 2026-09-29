import { afterEach, describe, expect, it } from 'vitest';

import type { RunningServer } from '@overstory/sprout-server';

import { connected, serving, shows, tokensFile, until } from './fixtures/server.js';

let server: RunningServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

describe('a session with a server', () => {
  it('asks for a nickname where none is given, and comes in under the one typed', async () => {
    server = await serving();
    const session = await connected(server);
    await until(session, () => shows(session, 'Type the nickname to be known by here.'));
    await session.type('Marta');
    await until(session, () => session.state.world === 'sequences');
    expect(session.state.nickname).toBe('Marta');
    await until(session, () => shows(session, 'There is nothing special about the cellar.'));
    expect(session.state.status).toEqual({ place: 'the cellar', exits: [] });
  });

  it('sends each line as a command, and shows what it said', async () => {
    server = await serving();
    const session = await connected(server, 'Marta');
    await until(session, () => session.state.world !== null);
    await session.type('take key then take coin');
    await until(session, () => shows(session, 'You take a coin.'));
    expect(session.state.lines.map((line) => line.text)).toEqual(
      expect.arrayContaining(['> take key then take coin', 'You take a key.', 'You take a coin.']),
    );
  });

  it('carries `/say` to the others standing there, and asks again for a nickname taken', async () => {
    server = await serving();
    const marta = await connected(server, 'Marta');
    await until(marta, () => marta.state.world !== null);
    const other = await connected(server, 'Marta');
    await until(other, () => shows(other, 'Type another nickname.'));
    await other.type('Ines');
    await until(other, () => other.state.world !== null);
    await other.type('/say hello there');
    await until(marta, () => shows(marta, 'Ines: hello there'));
  });

  it('shows and hides the host’s records at a level with `/log`, and lists its commands with `/help`', async () => {
    server = await serving();
    const session = await connected(server, 'Marta');
    await until(session, () => session.state.world !== null);
    await session.type('/log info');
    expect([...session.shown]).toEqual(['prose', 'error', 'info']);
    await session.type('take all');
    await until(session, () =>
      session.state.lines.some(
        (line) => line.kind === 'record' && line.text === 'step: sprout.take',
      ),
    );
    await session.type('/log info');
    expect(session.shown.has('info')).toBe(false);
    await session.type('/help');
    expect(shows(session, '/quit — leave the world and close the client')).toBe(true);
  });

  it('comes back as the same visitor on `/reconnect`, and leaves on `/quit`', async () => {
    server = await serving();
    const tokens = tokensFile();
    const session = await connected(server, 'Marta', tokens);
    await until(session, () => session.state.world !== null);
    await session.type('take key');
    await until(session, () => shows(session, 'You take a key.'));
    await session.type('/reconnect');
    await until(
      session,
      () =>
        session.state.lines.filter((line) => line.text === 'You are in sequences as Marta.')
          .length === 2,
    );
    expect(await session.type('/quit')).toBe(false);
    await until(session, () => session.state.closed === 'left');
  });

  it('says so, and sends nothing, when it is not connected', async () => {
    server = await serving();
    const session = await connected(server, 'Marta');
    await until(session, () => session.state.world !== null);
    await server.close();
    server = null;
    await until(session, () => session.state.closed !== null);
    await session.type('look');
    expect(shows(session, 'Not connected: /reconnect to connect again, or /quit.')).toBe(true);
  });

  it('tells the visitor a connection lost, and answers a `/reconnect` that cannot connect in words', async () => {
    server = await serving();
    const session = await connected(server, 'Marta');
    await until(session, () => session.state.world !== null);
    // The server's socket closed under the client, with no `bye`.
    (
      server.context as unknown as { worlds: Map<string, { connections: Set<{ close(): void }> }> }
    ).worlds
      .get('sequences')!
      .connections.forEach((connection) => connection.close());
    await until(session, () =>
      shows(
        session,
        'The connection to the server was lost: /reconnect to connect again, or /quit.',
      ),
    );
    await server.close();
    server = null;
    expect(await session.type('/reconnect')).toBe(true);
    expect(session.state.lines.at(-1)!.text).toMatch(
      /^Cannot connect to 127\.0\.0\.1:\d+: .*: \/reconnect to try again, or \/quit\.$/,
    );
  });

  it('says so where lines typed while coming in are not sent, its nickname refused', async () => {
    server = await serving();
    const marta = await connected(server, 'Marta');
    await until(marta, () => marta.state.world !== null);
    const other = await connected(server, 'Marta');
    await other.type('look');
    await until(other, () =>
      other.state.lines.some((line) => line.text.startsWith('Type another nickname.')),
    );
    expect(shows(other, 'Type another nickname. The line typed meanwhile was not sent.')).toBe(
      true,
    );
  });
});
