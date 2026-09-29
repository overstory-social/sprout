import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { PROTOCOL, ServerMessage } from '@overstory/sprout/core';

import { configFor, corpusWorld, keptLog, manualClock } from './fixtures/server.js';
import { startServer, type RunningServer } from './server.js';

type Message = ServerMessage;
type Of<T extends Message['t']> = Extract<Message, { t: T }>;

/** A client over a real socket that keeps what it is sent, each checked against the protocol. */
class Client {
  private readonly got: Message[] = [];
  private wake: (() => void) | null = null;

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const parsed = ServerMessage.safeParse(JSON.parse(data.toString()));
      if (!parsed.success)
        throw new Error(`the server sent what the protocol does not read: ${data.toString()}`);
      this.got.push(parsed.data as Message);
      this.wake?.();
    });
  }

  static open(port: number): Promise<Client> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, PROTOCOL);
    return new Promise((resolve, reject) => {
      socket.once('open', () => resolve(new Client(socket)));
      socket.once('error', reject);
    });
  }

  send(message: object | string): void {
    this.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  /** The next message of type `t` not yet taken, waited for. */
  async take<T extends Message['t']>(t: T, where?: (message: Of<T>) => boolean): Promise<Of<T>> {
    for (let waited = 0; ; waited++) {
      const at = this.got.findIndex(
        (one) => one.t === t && (where === undefined || where(one as Of<T>)),
      );
      if (at >= 0) return this.got.splice(at, 1)[0] as Of<T>;
      if (waited > 40) throw new Error(`no \`${t}\` came; got ${JSON.stringify(this.got)}`);
      await new Promise<void>((resolve) => {
        this.wake = resolve;
        setTimeout(resolve, 50);
      });
    }
  }

  /** The words of the effects in the next `effects` message with `seq`. */
  async words(seq: number | null): Promise<string[]> {
    const { effects } = await this.take('effects', (one) => one.seq === seq);
    return effects.flatMap((one) => (one.as === 'words' ? one.paragraphs : []));
  }

  close(): void {
    this.socket.close();
  }
}

let running: RunningServer | null = null;
afterEach(async () => {
  await running?.close();
  running = null;
});

const TOKEN_MARTA = 'marta-token-0123456789';
const TOKEN_INES = 'ines-token-0123456789';

async function serve() {
  running = await startServer({
    config: configFor(corpusWorld('sequences')),
    log: keptLog(),
    clock: manualClock(),
    seed: () => 7,
  });
  return running;
}

async function admitted(port: number, token: string, nickname: string): Promise<Client> {
  const client = await Client.open(port);
  client.send({ t: 'hello', protocol: PROTOCOL, client: 'spec', token, renders: [] });
  await client.take('welcome');
  client.send({ t: 'admit', world: 'sequences', nickname });
  await client.take('admitted');
  // The place they came in to, described.
  await client.take('effects');
  return client;
}

describe('the server, over a real socket', () => {
  it('welcomes a client with the worlds it serves, admits it, and runs what it types', async () => {
    const { port } = await serve();
    const marta = await Client.open(port);
    marta.send({ t: 'hello', protocol: PROTOCOL, client: 'spec', token: TOKEN_MARTA, renders: [] });
    expect(await marta.take('welcome')).toEqual({
      t: 'welcome',
      server: 'sprout-server',
      worlds: [{ world: 'sequences', granted: [], declined: [] }],
    });
    marta.send({ t: 'admit', world: 'sequences', nickname: 'Marta' });
    expect(await marta.take('admitted')).toEqual({
      t: 'admitted',
      world: 'sequences',
      nickname: 'Marta',
      returning: false,
    });
    expect(await marta.words(null)).toEqual(['There is nothing special about the cellar.']);
    expect(await marta.take('status')).toMatchObject({ place: 'the cellar', exits: [] });
    expect((await marta.take('offered')).lines).toContain('take key');
    marta.send({ t: 'command', seq: 1, line: 'take key then take coin' });
    const [first, second] = [
      await marta.take('effects', (one) => one.seq === 1),
      await marta.take('effects', (one) => one.seq === 1),
    ];
    // Each turn the line ran, in order, the last of them marked.
    expect([first.last, second.last]).toEqual([false, true]);
    expect(
      [first, second].map((one) =>
        one.effects.flatMap((effect) => (effect.as === 'words' ? effect.paragraphs : [])),
      ),
    ).toEqual([['You take a key.'], ['You take a coin.']]);
    marta.send({ t: 'poll', seq: 2 });
    expect(
      (await marta.take('view', (one) => one.seq === 2)).view.carried.map((one) => one.name),
    ).toEqual(['a key', 'a coin']);
  });

  it('tells everyone in the world what reaches them, and carries chat to those standing together', async () => {
    const { port } = await serve();
    const marta = await admitted(port, TOKEN_MARTA, 'Marta');
    const ines = await admitted(port, TOKEN_INES, 'Ines');
    expect(await marta.words(null)).toEqual(['Ines arrives.']);
    marta.send({ t: 'command', seq: 1, line: 'take key' });
    expect(await ines.words(null)).toEqual(['Marta takes a key.']);
    ines.send({ t: 'chat', line: 'hello there' });
    expect(await marta.take('chat')).toEqual({ t: 'chat', from: 'Ines', line: 'hello there' });
  });

  it('answers a frame it does not read, and one out of order, with words, never silence', async () => {
    const { port } = await serve();
    const client = await Client.open(port);
    client.send('not json');
    expect(await client.take('refused')).toEqual({
      t: 'refused',
      stage: 'hello',
      reason: 'malformed',
      text: 'This frame is not JSON.',
    });
    client.send({ t: 'poll', seq: 1 });
    expect(await client.take('refused')).toMatchObject({ stage: 'hello', reason: 'no-hello' });
    client.send({
      t: 'hello',
      protocol: PROTOCOL,
      client: 'spec',
      token: TOKEN_MARTA,
      renders: [],
    });
    await client.take('welcome');
    client.send({ t: 'command', seq: 1, line: 'look' });
    expect(await client.take('refused')).toMatchObject({ stage: 'frame', reason: 'not-admitted' });
    client.send({ t: 'admit', world: 'nowhere', nickname: 'Marta' });
    expect(await client.take('refused')).toMatchObject({ stage: 'admit', reason: 'no-world' });
  });

  it('refuses a nickname someone present holds, in the world’s words', async () => {
    const { port } = await serve();
    await admitted(port, TOKEN_MARTA, 'Marta');
    const other = await Client.open(port);
    other.send({ t: 'hello', protocol: PROTOCOL, client: 'spec', token: TOKEN_INES, renders: [] });
    await other.take('welcome');
    other.send({ t: 'admit', world: 'sequences', nickname: 'Marta' });
    const refused = await other.take('refused');
    expect(refused).toMatchObject({ stage: 'admit', reason: 'nickname' });
    expect(refused.text.length).toBeGreaterThan(0);
  });

  it('lets a visitor leave, telling the rest, and finds their visit again by their token', async () => {
    const { port } = await serve();
    const marta = await admitted(port, TOKEN_MARTA, 'Marta');
    const ines = await admitted(port, TOKEN_INES, 'Ines');
    marta.send({ t: 'leave' });
    expect(await marta.take('bye')).toMatchObject({ reason: 'left' });
    expect(await ines.words(null)).toEqual(['Marta leaves.']);
    const back = await Client.open(port);
    back.send({ t: 'hello', protocol: PROTOCOL, client: 'spec', token: TOKEN_MARTA, renders: [] });
    await back.take('welcome');
    back.send({ t: 'admit', world: 'sequences', nickname: 'Marta' });
    expect(await back.take('admitted')).toMatchObject({ returning: true });
  });

  it('runs a departure when a connection closes', async () => {
    const { port } = await serve();
    const marta = await admitted(port, TOKEN_MARTA, 'Marta');
    const ines = await admitted(port, TOKEN_INES, 'Ines');
    marta.close();
    expect(await ines.words(null)).toEqual(['Marta leaves.']);
  });
});
