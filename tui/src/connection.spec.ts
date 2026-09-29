import { readFileSync, statSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import type { RunningServer } from '@overstory/sprout-server';

import { link, tokenFor } from './connection.js';
import { serving, tokensFile } from './fixtures/server.js';

let server: RunningServer | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

describe('a person’s token', () => {
  it('is made on first contact with a server, kept by its address in a file of their own, and the same after', () => {
    const file = tokensFile();
    const first = tokenFor('127.0.0.1:4700', file);
    expect(first).toMatch(/^[0-9a-f]{48}$/);
    expect(tokenFor('127.0.0.1:4700', file)).toBe(first);
    expect(tokenFor('example.org:4700', file)).not.toBe(first);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      '127.0.0.1:4700': first,
      'example.org:4700': expect.any(String),
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe('a connection', () => {
  it('reads every frame the server sends against the protocol', async () => {
    server = await serving();
    const got: string[] = [];
    const opened = await link(`127.0.0.1:${server.port}`, {
      message: (message) => got.push(message.t),
      malformed: () => got.push('malformed'),
      closed: () => got.push('closed'),
    });
    opened.send({
      t: 'hello',
      protocol: 'sprout.1',
      client: 'spec',
      token: 'a-token-0123456789abcdef',
      renders: [],
    });
    for (let waited = 0; got.length === 0 && waited < 50; waited++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    expect(got).toEqual(['welcome']);
    opened.close();
  });

  it('is refused, in words naming where, where nothing is listening', async () => {
    await expect(
      link('127.0.0.1:1', { message: () => {}, malformed: () => {}, closed: () => {} }),
    ).rejects.toThrow(/^Cannot connect to 127\.0\.0\.1:1: /);
  });
});
