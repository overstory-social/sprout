import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { DEFAULT_BLESSED, DEFAULT_LIMITS } from '@overstory/sprout/lang';
import { serverLog, startServer } from '@overstory/sprout-server';

import { bundleOf, KILN_YARD } from '@overstory/sprout-player/fixtures';

import { clientConnect, mcpServe, serverStart } from './peers.js';

/** A terminal a spec types into and reads back. */
function io() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = '';
  let err = '';
  stdout.on('data', (chunk) => (out += String(chunk)));
  stderr.on('data', (chunk) => (err += String(chunk)));
  return { stdin, stdout, stderr, out: () => out, err: () => err };
}

const CORPUS = join(import.meta.dirname, '..', '..', 'corpus', 'good', 'sequences');

describe('`sprout client`', () => {
  it('says how to connect where it is not told where', async () => {
    const t = io();
    expect(await clientConnect(['connect'], {}, t)).toBe(1);
    expect(t.err()).toContain('sprout client connect localhost:4700');
  });

  it('plays on a server as plain lines, through the terminal client', async () => {
    const running = await startServer({
      config: {
        host: '127.0.0.1',
        port: 0,
        logLevel: 'error',
        tickSeconds: 3600,
        wakesWhileEmpty: false,
        worlds: [CORPUS],
        limits: DEFAULT_LIMITS,
        blessed: DEFAULT_BLESSED,
      },
      log: serverLog(
        'error',
        'text',
        () => 0,
        () => {},
      ),
    });
    const t = io();
    process.env['HOME'] = mkdtempSync(join(tmpdir(), 'sprout-home-'));
    const done = clientConnect(
      ['connect', `127.0.0.1:${running.port}`],
      { as: 'Marta', plain: true },
      t,
    );
    t.stdin.write('take key\n');
    for (let waited = 0; !t.out().includes('You take a key.') && waited < 100; waited++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    t.stdin.end();
    expect(await done).toBe(0);
    expect(t.out()).toContain('You take a key.');
    await running.close();
  });
});

describe('`sprout server`', () => {
  it('hands its arguments to the server’s own command, which says what is missing', async () => {
    const t = io();
    expect(await serverStart(['start'], t)).toBe(1);
    expect(t.err()).toContain('--config server.toml');
  });
});

describe('`sprout mcp`', () => {
  it('serves the world over stdio until stdin ends, saying nothing on stderr', async () => {
    const t = io();
    const served = mcpServe(bundleOf('kiln_yard', KILN_YARD), {}, t);
    t.stdin.end();
    expect(await served).toBe(0);
    expect(t.err()).toBe('');
  });

  it('refuses what the host is told that it cannot use, in words that say what to write', async () => {
    const t = io();
    expect(await mcpServe(bundleOf('kiln_yard', KILN_YARD), { 'turn-cap': 'lots' }, t)).toBe(1);
    expect(t.err()).toBe('sprout: --turn-cap wants a whole number from 1: --turn-cap 200\n');
  });
});
