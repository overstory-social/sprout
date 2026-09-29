import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import type { RunningServer } from '@overstory/sprout-server';

import { connect } from './client.js';
import { serving, tokensFile } from './fixtures/server.js';

let server: RunningServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

/** Streams for `connect`: input a spec writes to, and what it wrote out and to stderr. */
function terminal() {
  const stdin = new PassThrough() as unknown as NodeJS.ReadStream & PassThrough;
  let out = '';
  let err = '';
  const stdout = {
    write: (text: string) => ((out += text), true),
  } as unknown as NodeJS.WriteStream;
  return {
    stdin,
    stdout,
    stderr: { write: (text: string) => (err += text) },
    out: () => out,
    err: () => err,
  };
}

describe('connecting a client', () => {
  it('plays as plain lines from a pipe, and ends with it', async () => {
    server = await serving();
    const t = terminal();
    const done = connect({
      address: `127.0.0.1:${server.port}`,
      nickname: 'Marta',
      tokens: tokensFile(),
      stdin: t.stdin,
      stdout: t.stdout,
      stderr: t.stderr,
    });
    t.stdin.write('take key\n');
    for (let waited = 0; !t.out().includes('You take a key.') && waited < 100; waited++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    t.stdin.end();
    expect(await done).toBe(0);
    expect(t.out()).toContain('You take a key.');
  });

  it('says it cannot connect, and ends 1, where nothing is listening', async () => {
    const t = terminal();
    expect(
      await connect({
        address: '127.0.0.1:1',
        tokens: tokensFile(),
        stdin: t.stdin,
        stdout: t.stdout,
        stderr: t.stderr,
      }),
    ).toBe(1);
    expect(t.err()).toMatch(/^sprout client: Cannot connect to 127\.0\.0\.1:1: /);
  });
});
