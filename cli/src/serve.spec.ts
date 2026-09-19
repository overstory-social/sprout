import { createConnection, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { main } from './cli.js';
import { serve, type Serving } from './serve.js';
import { captured } from './testing.js';

// `sprout serve`: two sockets on one microworld — the second sees the
// first's arrival as it happens (the poll delivers the notice), and each
// walks on their own. Loopback only unless --host says otherwise.

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'sprout-examples');

/** A line-buffered client: `send` a line, `until` a pattern shows in what came back. */
function client(port: number): {
  socket: Socket;
  send(line: string): void;
  until(pattern: RegExp, ms?: number): Promise<string>;
  received(): string;
  close(): void;
} {
  const socket = createConnection({ port, host: '127.0.0.1' });
  let received = '';
  socket.setEncoding('utf8');
  socket.on('data', (c: string) => (received += c));
  return {
    socket,
    send: (line) => socket.write(`${line}\n`),
    until: (pattern, ms = 5000) =>
      new Promise((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          if (pattern.test(received)) resolve(received);
          else if (Date.now() - started > ms)
            reject(new Error(`never saw ${pattern}:\n${received}`));
          else setTimeout(tick, 20);
        };
        tick();
      }),
    received: () => received,
    close: () => socket.end(),
  };
}

let serving: Serving | null = null;
afterEach(async () => {
  await serving?.close();
  serving = null;
});

describe('serve', () => {
  it('two actors: the second sees the first arrive, each takes a turn, quit leaves', async () => {
    serving = await serve({
      archive: join(EXAMPLES, 'pottery-studio'),
      port: 0,
      host: '127.0.0.1',
      store: 'memory',
      pollMs: 50,
    });
    expect(serving.host).toBe('127.0.0.1');
    const marta = client(serving.port);
    await marta.until(/Who are you\?/);
    marta.send('marta');
    await marta.until(/== The Front Room ==/);
    const alba = client(serving.port);
    await alba.until(/Who are you\?/);
    alba.send('alba');
    await alba.until(/Also here: marta\./);
    // marta's poll delivers alba's arrival without marta typing anything
    await marta.until(/\* alba arrives\./);
    alba.send('through to the wheel room');
    await alba.until(/== The Wheel Room ==/);
    await marta.until(/\* alba (goes|leaves|heads)/);
    marta.send('quit');
    await new Promise<void>((r) => marta.socket.once('close', () => r()));
    // …and alba, in the wheel room, is told nothing of a room she is not in; her prompt stands.
    expect(alba.received()).not.toMatch(/marta leaves/);
    expect(alba.received().endsWith('> ')).toBe(true);
    alba.close();
  }, 20_000);

  it('through the command: --port 0 and the spec’s hook; an archive that does not check is refused', async () => {
    const io = captured();
    let handed: Serving | null = null;
    io.onServe = (s) => (handed = s);
    expect(
      await main(
        ['serve', join(EXAMPLES, 'wanderers-shed'), '--port', '0', '--store', 'memory'],
        io,
      ),
    ).toBe(0);
    expect(handed).not.toBeNull();
    serving = handed;
    expect(io.err()).toMatch(/listening on 127\.0\.0\.1:\d+ \(wanderers-shed\)/);
    const bad = captured();
    expect(await main(['serve', join(EXAMPLES, 'nope'), '--store', 'memory'], bad)).toBe(1);
    expect(bad.err()).toContain('no such folder or zip');
  });
});
