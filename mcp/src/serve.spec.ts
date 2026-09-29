import { PassThrough } from 'node:stream';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';

import { bundleOf, KILN_YARD } from '@overstory/sprout-player/fixtures';

import { serve, type ServeIo } from './serve.js';

const kilnYard = bundleOf('kiln_yard', KILN_YARD);

/** Streams for `serve`, what it wrote to stderr, and a way to stop it. */
function streams() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let err = '';
  stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
  let stop: () => void = () => {};
  const stopped = new Promise<void>((resolve) => (stop = resolve));
  const io: ServeIo = { stdin, stdout, stderr, stopped };
  return { io, stdin, stdout, err: () => err, stop };
}

/** The text a tool call answers with. */
async function said(client: Client, tool: string, args: Record<string, string>): Promise<string> {
  const result = await client.callTool({ name: tool, arguments: args });
  return (result.content as { text: string }[])[0]!.text;
}

describe('serving over HTTP', () => {
  it('puts every client that connects into the one world, each as the visitor it arrives as', async () => {
    const io = streams();
    const served = serve(kilnYard, {}, { host: '127.0.0.1', port: 0 }, io.io);
    let url = '';
    for (let i = 0; i < 100 && url === ''; i++) {
      url = /(http:\/\/\S+\/mcp)/.exec(io.err())?.[1] ?? '';
      if (url === '') await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const client = async () => {
      const one = new Client({ name: 'spec', version: '0' });
      await one.connect(new StreamableHTTPClientTransport(new URL(url)));
      return one;
    };
    const marta = await client();
    const ines = await client();
    expect(await said(marta, 'arrive', { name: 'Marta' })).toBe('A kiln yard.');
    expect(await said(ines, 'arrive', { name: 'Ines' })).toBe('A kiln yard.');
    expect(await said(marta, 'say', { name: 'Marta', line: 'fire kiln' })).toBe(
      'Ines arrives.\nThe chamber takes the flame.',
    );
    expect(await said(ines, 'say', { name: 'Marta', line: 'look' })).toBe(
      'You are Ines here, and act only as Ines.',
    );
    await marta.close();
    await ines.close();
    io.stop();
    expect(await served).toBe(0);
    expect(io.err()).toMatch(/sprout mcp: stopped\n$/);
  });

  it('refuses a request that is not a connection opening, or not for the world', async () => {
    const io = streams();
    const served = serve(kilnYard, {}, { host: '127.0.0.1', port: 0 }, io.io);
    let base = '';
    for (let i = 0; i < 100 && base === ''; i++) {
      base = /(http:\/\/\S+)\/mcp/.exec(io.err())?.[1] ?? '';
      if (base === '') await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const elsewhere = await fetch(`${base}/other`, { method: 'POST', body: '{}' });
    expect(elsewhere.status).toBe(404);
    const unopened = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(unopened.status).toBe(400);
    expect(await unopened.json()).toMatchObject({
      error: { message: 'Initialize a connection first.' },
    });
    io.stop();
    expect(await served).toBe(0);
  });
});

describe('serving over stdio', () => {
  it('answers the protocol on stdout and ends when stdin does', async () => {
    const io = streams();
    const served = serve(kilnYard, {}, { stdio: true }, io.io);
    let out = '';
    io.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    const send = (message: object) => io.stdin.write(`${JSON.stringify(message)}\n`);
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'spec', version: '0' },
      },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'arrive', arguments: { name: 'Marta' } },
    });
    for (let i = 0; i < 100 && !out.includes('"id":2'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const answers = out
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { id: number; result: unknown });
    expect(answers.find((one) => one.id === 2)?.result).toEqual({
      content: [{ type: 'text', text: 'A kiln yard.' }],
    });
    io.stdin.end();
    expect(await served).toBe(0);
    expect(io.err()).toBe('');
  });
});
