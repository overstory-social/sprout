import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PROTOCOL } from '@overstory/sprout/core';

import { contextFor, corpusWorld, keptConnection, manualClock } from './fixtures/server.js';
import { redeploy } from './redeploy.js';
import { frame } from './session.js';
import { deploy } from './worlds.js';

/** A copy of the sequences world, served, with Marta and Ines admitted and Marta holding the key. */
async function running() {
  const dir = join(mkdtempSync(join(tmpdir(), 'sprout-redeploy-')), 'sequences');
  cpSync(corpusWorld('sequences'), dir, { recursive: true });
  const clock = manualClock();
  const context = contextFor(clock, dir);
  const run = context.worlds.get('sequences')!;
  await deploy(context.store, run.served, context.config, clock.now(), new Date(0));
  const people = [];
  for (const nickname of ['Marta', 'Ines']) {
    const connection = keptConnection();
    await frame(
      context,
      connection,
      JSON.stringify({
        t: 'hello',
        protocol: PROTOCOL,
        client: 'spec',
        token: `${nickname}-token-0123456789`,
        renders: [],
      }),
    );
    await frame(context, connection, JSON.stringify({ t: 'admit', world: 'sequences', nickname }));
    people.push(connection);
  }
  const [marta, ines] = people as [
    ReturnType<typeof keptConnection>,
    ReturnType<typeof keptConnection>,
  ];
  await frame(context, marta, JSON.stringify({ t: 'command', seq: 1, line: 'take key' }));
  marta.sent.length = 0;
  ines.sent.length = 0;
  return { dir, context, marta, ines };
}

const carried = async (
  connection: ReturnType<typeof keptConnection>,
  context: Awaited<ReturnType<typeof running>>['context'],
) => {
  await frame(context, connection, JSON.stringify({ t: 'poll', seq: 9 }));
  const view = connection.sent.find((one) => (one as { t: string }).t === 'view') as {
    view: { carried: { name: string }[] };
  };
  return view.view.carried.map((one) => one.name);
};

describe('a world redeployed while the server runs', () => {
  it('starts again from its initial state, everyone connected admitted again carrying nothing', async () => {
    const { dir, context, marta, ines } = await running();
    expect(await redeploy(context, dir)).toBe('redeployed');
    for (const connection of [marta, ines]) {
      expect(connection.sent).toContainEqual(
        expect.objectContaining({ t: 'admitted', world: 'sequences', returning: false }),
      );
      expect(connection.world).toBe(context.worlds.get('sequences'));
    }
    marta.sent.length = 0;
    expect(await carried(marta, context)).toEqual([]);
  });

  it('asks for another nickname of one the new world’s words now claim', async () => {
    const { dir, context, marta, ines } = await running();
    const file = join(dir, 'sequences.sprout');
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace(
        'object coin is Loose',
        'object coin is Loose { grammar { nouns "ines" } }',
      ),
    );
    await redeploy(context, dir);
    expect(marta.sent).toContainEqual(expect.objectContaining({ t: 'admitted' }));
    expect(ines.sent).toContainEqual(
      expect.objectContaining({ t: 'refused', stage: 'admit', reason: 'nickname' }),
    );
    expect(ines.world).toBeNull();
  });

  it('leaves the world running as it was where the change is refused, and logs why', async () => {
    const { dir, context, marta } = await running();
    writeFileSync(join(dir, 'sequences.sprout'), 'world sequences is {');
    expect(await redeploy(context, dir)).toBe('refused');
    expect(await carried(marta, context)).toEqual(['a key']);
    expect((context.log as unknown as { lines: string[] }).lines.at(-1)).toContain(
      'was changed and is refused; it runs as it was',
    );
  });
});
