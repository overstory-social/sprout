import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';

import type { RunningServer } from '@overstory/sprout-server';

import { App } from './app.js';
import { connected, serving, shows, until } from './fixtures/server.js';

let server: RunningServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
/** A frame without its colours, each row without the spaces that pad it. */
const plain = (frame: string | undefined): string =>
  (frame ?? '')
    .replace(/\u001B\[[0-9;]*m/g, '')
    .split('\n')
    .map((row) => row.trimEnd())
    .join('\n');

describe('the client on a terminal', () => {
  it('fills the window: the header on top, the transcript, the input between rules, the place at the foot', async () => {
    server = await serving();
    const session = await connected(server, 'Marta');
    await until(session, () => session.state.status !== null);
    const app = render(<App session={session} />);
    await settle();
    const rows = plain(app.lastFrame()).split('\n');
    expect(rows).toHaveLength(24);
    expect(rows[0]).toBe(`● connected  ${session.address}  ·  sequences as Marta`);
    // The transcript sits at the foot of its space, the newest line last.
    expect(rows.slice(1, 17).every((row) => row === '')).toBe(true);
    expect(rows.slice(17, 19)).toEqual([
      'You are in sequences as Marta.',
      'There is nothing special about the cellar.',
    ]);
    expect(rows[19]).toMatch(/^─+$/);
    expect(rows[20]).toBe('>');
    expect(rows[21]).toMatch(/^─+$/);
    expect(rows[22]).toBe('the cellar   here a key, a coin');
    expect(rows[23]).toBe('             exits —');
    app.unmount();
  });

  it('sends the line being typed on return, and shows what the world said', async () => {
    server = await serving();
    const session = await connected(server, 'Marta');
    await until(session, () => session.state.status !== null);
    const app = render(<App session={session} />);
    await settle();
    app.stdin.write('take key');
    await settle();
    expect(app.lastFrame()).toContain('> take key');
    app.stdin.write('\r');
    await until(session, () => shows(session, 'You take a key.'));
    await settle();
    const rows = plain(app.lastFrame()).split('\n');
    expect(rows.slice(15, 19)).toEqual([
      'You are in sequences as Marta.',
      'There is nothing special about the cellar.',
      '> take key',
      'You take a key.',
    ]);
    expect(rows[22]).toBe('the cellar   here a coin');
    app.unmount();
  });

  it('scrolls back a page on PgUp, says how much is below, and comes back to the newest on PgDn', async () => {
    server = await serving();
    const session = await connected(server, 'Marta');
    await until(session, () => session.state.status !== null);
    for (let n = 0; n < 20; n++) await session.type('look');
    await session.idle();
    const app = render(<App session={session} />);
    await settle();
    const newest = plain(app.lastFrame()).split('\n')[18];
    expect(newest).toBe('There is nothing special about the cellar.');
    app.stdin.write('\u001B[5~');
    await settle();
    const back = plain(app.lastFrame()).split('\n');
    expect(back[1]).not.toBe('');
    expect(back[19]).toMatch(/^── 17 more below — PgDn ─+$/);
    // A line arriving while scrolled back leaves the rows in view where they are.
    await session.type('look');
    await session.idle();
    await settle();
    const after = plain(app.lastFrame()).split('\n');
    expect(after.slice(1, 19)).toEqual(back.slice(1, 19));
    expect(after[19]).toMatch(/^── 19 more below — PgDn ─+$/);
    app.stdin.write('\u001B[6~');
    app.stdin.write('\u001B[6~');
    await settle();
    expect(plain(app.lastFrame()).split('\n')[19]).toMatch(/^─+$/);
    app.unmount();
  });

  it('marks the connection troubled after a frame is refused, and lost when the server goes', async () => {
    server = await serving();
    const session = await connected(server);
    await until(session, () => session.state.worlds.length > 0);
    const app = render(<App session={session} />);
    // Chat before coming into a world is a frame out of order.
    await session.type('/say hello');
    await until(session, () => session.state.troubledAt !== null);
    await settle();
    expect(plain(app.lastFrame()).split('\n')[0]).toMatch(/^● errors lately/);
    await server.close();
    server = null;
    await until(session, () => session.state.closed !== null);
    await settle();
    expect(plain(app.lastFrame()).split('\n')[0]).toMatch(/^● disconnected/);
    app.unmount();
  });

  it('walks back through the lines typed on up, and completes from the world’s lines on tab', async () => {
    server = await serving();
    const session = await connected(server, 'Marta');
    await until(session, () => session.state.offered.length > 0);
    const app = render(<App session={session} />);
    await settle();
    app.stdin.write('look');
    app.stdin.write('\r');
    await settle();
    app.stdin.write('\u001B[A');
    await settle();
    expect(app.lastFrame()).toContain('> look');
    app.stdin.write('\u007F\u007F\u007F\u007F');
    app.stdin.write('take co');
    app.stdin.write('\t');
    await settle();
    expect(app.lastFrame()).toContain('> take coin');
    app.unmount();
  });

  it('shows the client’s commands while a `/` is being typed', async () => {
    server = await serving();
    const session = await connected(server, 'Marta');
    await until(session, () => session.state.world !== null);
    const app = render(<App session={session} />);
    app.stdin.write('/');
    await settle();
    const frame = app.lastFrame() ?? '';
    for (const usage of ['/say words', '/log level', '/reconnect', '/help', '/quit'])
      expect(frame).toContain(usage);
    app.stdin.write('l');
    await settle();
    expect(app.lastFrame()).not.toContain('/say words');
    app.unmount();
  });
});
