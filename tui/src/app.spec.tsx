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
/** Everything the app has written, every frame and its scrollback. */
const screen = (frames: readonly string[]): string => frames.join('\n');

describe('the client on a terminal', () => {
  it('shows the transcript, the status line and the line being typed, and sends it on return', async () => {
    server = await serving();
    const session = await connected(server, 'Marta');
    await until(session, () => session.state.status !== null);
    const app = render(<App session={session} />);
    await settle();
    expect(app.lastFrame()?.split('\n')).toContain(' the cellar');
    app.stdin.write('take key');
    await settle();
    expect(app.lastFrame()).toContain('> take key');
    app.stdin.write('\r');
    await until(session, () => shows(session, 'You take a key.'));
    await settle();
    expect(screen(app.frames)).toContain('You take a key.');
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
