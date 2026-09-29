import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { corpusWorld } from './fixtures/server.js';
import { main } from './main.js';

/** `main` run with `argv`, stopping as soon as `stop` says: what it wrote, and its exit code. */
async function run(argv: string[], stop: Promise<unknown> = Promise.resolve()) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, {
    stdout: { write: (text: string) => out.push(text) },
    stderr: { write: (text: string) => err.push(text) },
    stopped: stop,
  });
  return { code, out: out.join(''), err: err.join('') };
}

/** A config file serving `worlds` on any free port. */
function configFile(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sprout-server-'));
  const path = join(dir, 'server.toml');
  writeFileSync(path, text);
  return path;
}

describe('`sprout-server`', () => {
  it('serves every world its config names until it is stopped, logging as it goes', async () => {
    const path = configFile(
      `listen = "127.0.0.1:0"\n[[worlds]]\npath = "${corpusWorld('sequences')}"\n`,
    );
    const { code, out } = await run(['start', '--config', path]);
    expect(code).toBe(0);
    expect(out).toMatch(/ info sequences: serving the world in .*sequences, bundle /);
    expect(out).toMatch(/ info: listening on 127\.0\.0\.1:\d+\n/);
    expect(out).toMatch(/ info: stopped\n$/);
  });

  it('writes its log as JSON where it is asked to', async () => {
    const path = configFile(
      `listen = "127.0.0.1:0"\n[[worlds]]\npath = "${corpusWorld('sequences')}"\n`,
    );
    const { out } = await run(['start', '--config', path, '--log-format', 'json']);
    for (const line of out.trim().split('\n'))
      expect(JSON.parse(line)).toMatchObject({ level: 'info' });
  });

  it('says what is wrong, and does not start, for a missing flag, file or world, or a config it refuses', async () => {
    expect(await run(['start'])).toMatchObject({
      code: 1,
      err: expect.stringContaining('--config server.toml'),
    });
    expect(await run(['start', '--config', '/nowhere/server.toml'])).toMatchObject({
      code: 1,
      err: 'sprout-server: there is no config at /nowhere/server.toml.\n',
    });
    const refused = await run(['start', '--config', configFile('tick_seconds = 0\n')]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('`tick_seconds`');
    const empty = await run([
      'start',
      '--config',
      configFile('listen = "127.0.0.1:0"\n[[worlds]]\npath = "/nowhere"\n'),
    ]);
    expect(empty).toMatchObject({
      code: 1,
      err: expect.stringContaining('No world the config names could be served'),
    });
    expect(await run(['serve'])).toMatchObject({
      code: 1,
      err: expect.stringContaining('no such command "serve"'),
    });
    expect(await run(['start', '--config', '--log-format', 'json'])).toMatchObject({
      code: 1,
      err: expect.stringContaining('--config server.toml'),
    });
    expect(await run(['help'])).toMatchObject({
      code: 0,
      out: expect.stringContaining('sprout-server start'),
      err: '',
    });
  });
});
