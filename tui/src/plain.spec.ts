import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import type { RunningServer } from '@overstory/sprout-server';

import { connected, serving } from './fixtures/server.js';
import { playPlain } from './plain.js';

let server: RunningServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

describe('the client as plain lines', () => {
  it('types each line read, the first the nickname and those after it once in, writes each line shown once and the status where it changes, and ends with its input', async () => {
    server = await serving();
    const session = await connected(server);
    const input = new PassThrough();
    let written = '';
    const played = playPlain(session, input, { write: (text: string) => (written += text) });
    input.write('Marta\n');
    input.write('take key\n');
    for (let waited = 0; !written.includes('You take a key.') && waited < 100; waited++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    input.end();
    await played;
    expect(written.split('\n')).toEqual(
      expect.arrayContaining([
        'You are in sequences as Marta.',
        'There is nothing special about the cellar.',
        '[the cellar]',
        '> take key',
        'You take a key.',
      ]),
    );
  });

  it('answers every line piped in before it ends, however soon the pipe closes', async () => {
    server = await serving();
    const session = await connected(server, 'Marta');
    const input = new PassThrough();
    let written = '';
    const played = playPlain(session, input, { write: (text: string) => (written += text) });
    input.end('take key then take coin\n');
    await played;
    // Every turn of a line of several commands is answered before the visitor leaves.
    expect(written).toContain('You take a key.');
    expect(written).toContain('You take a coin.');
  });
});
