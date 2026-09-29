import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';

import { bundleOf, KILN_YARD } from '@overstory/sprout-player/fixtures';

import { worldServer } from './server.js';
import { openSession, type Session } from './session.js';

const kilnYard = bundleOf('kiln_yard', KILN_YARD);

/** A client connected to its own server over `session`. */
async function connected(session: Session): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await worldServer(session).connect(serverSide);
  const client = new Client({ name: 'spec', version: '0' });
  await client.connect(clientSide);
  return client;
}

/** What calling `tool` with `args` gives: its text, and whether it was refused. */
async function call(client: Client, tool: string, args: Record<string, string>) {
  const result = await client.callTool({ name: tool, arguments: args });
  const [first] = result.content as { type: string; text: string }[];
  return { text: first!.text, refused: result.isError === true };
}

describe('a world served as tools', () => {
  it('offers arrive, say and leave, and nothing else', async () => {
    const client = await connected(openSession(kilnYard));
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(['arrive', 'say', 'leave']);
    expect(client.getInstructions()).toMatch(/^You are a visitor in a place made of words\./);
  });

  it('names no file, path, declaration or command in anything it describes itself with', async () => {
    const client = await connected(openSession(kilnYard));
    const { tools } = await client.listTools();
    const told = [
      client.getInstructions() ?? '',
      ...tools.map((tool) => JSON.stringify(tool)),
    ].join(' ');
    expect(
      told.match(/\.sprout|\.json|kiln_yard|\b(sprout|debug|script|record|seed)\b/i)?.[0] ?? null,
    ).toBeNull();
  });

  it('plays a visitor: what they read, and a refusal as an error', async () => {
    const client = await connected(openSession(kilnYard));
    expect(await call(client, 'arrive', { name: 'Marta' })).toEqual({
      text: 'A kiln yard.',
      refused: false,
    });
    expect(await call(client, 'say', { name: 'Marta', line: 'fire kiln' })).toEqual({
      text: 'The chamber takes the flame.',
      refused: false,
    });
    expect(await call(client, 'leave', { name: 'Marta' })).toEqual({
      text: 'You leave, and take what you carry with you.',
      refused: false,
    });
    expect((await call(client, 'say', { name: 'Marta', line: 'look' })).refused).toBe(true);
  });

  it('binds a connection to the visitor it arrived as, so it acts as nobody else', async () => {
    const session = openSession(kilnYard);
    const marta = await connected(session);
    const ines = await connected(session);
    await call(marta, 'arrive', { name: 'Marta' });
    await call(ines, 'arrive', { name: 'Ines' });
    expect(await call(marta, 'say', { name: 'Ines', line: 'go in' })).toEqual({
      text: 'You are Marta here, and act only as Marta.',
      refused: true,
    });
    expect((await call(marta, 'arrive', { name: 'Olga' })).refused).toBe(true);
    // Each reads what the other's turns wrote to them.
    await call(ines, 'say', { name: 'Ines', line: 'go in' });
    expect((await call(marta, 'say', { name: 'Marta', line: 'look' })).text).toBe(
      'Ines arrives.\nInes leaves for a shed.\nA kiln yard.',
    );
  });

  it('binds nobody to a name the host turned away at the door', async () => {
    const client = await connected(openSession(kilnYard));
    expect((await call(client, 'arrive', { name: 'kiln' })).refused).toBe(true);
    expect((await call(client, 'arrive', { name: 'Marta' })).refused).toBe(false);
  });
});
