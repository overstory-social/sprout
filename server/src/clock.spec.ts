import { describe, expect, it } from 'vitest';

import { PROTOCOL } from '@overstory/sprout/core';

import { round, startClock } from './clock.js';
import type { ServerContext } from './context.js';
import { contextFor, corpusWorld, keptConnection, manualClock } from './fixtures/server.js';
import { frame } from './session.js';
import { publish } from './worlds.js';

/** `world` served afresh on a clock at 1000, published, with Marta connected and standing in it. */
async function served(world: string) {
  const clock = manualClock(1000);
  const context = contextFor(clock, corpusWorld(world));
  const run = [...context.worlds.values()][0]!;
  await publish(context.store, run.served, context.config, clock.now(), new Date(0));
  const marta = keptConnection();
  await frame(
    context,
    marta,
    JSON.stringify({
      t: 'hello',
      protocol: PROTOCOL,
      client: 'spec',
      token: 'marta-token-0123456789',
      renders: [],
    }),
  );
  await frame(context, marta, JSON.stringify({ t: 'admit', world, nickname: 'Marta' }));
  marta.sent.length = 0;
  return { clock, context, marta };
}

const words = (sent: readonly unknown[]): string[] =>
  sent.flatMap((message) => {
    const one = message as { t: string; effects?: { as: string; paragraphs?: string[] }[] };
    return one.t === 'effects' ? one.effects!.flatMap((effect) => effect.paragraphs ?? []) : [];
  });

describe('a round of the host’s clock', () => {
  it('ticks each place someone stands in, and tells them what the tick said', async () => {
    const { clock, context, marta } = await served('ticks');
    // The first tick of a place counts from nothing; the next hands it the seconds since.
    await round(context);
    clock.at += 31;
    await round(context);
    expect(words(marta.sent)).toContain('The wind picks up in the eaves.');
  });

  it('runs a wake that falls due while someone is in its world, and waits while nobody is', async () => {
    const { clock, context, marta } = await served('wakes');
    await frame(context, marta, JSON.stringify({ t: 'command', seq: 1, line: 'fire kiln' }));
    expect(words(marta.sent)).toContain('The chamber takes the flame.');
    clock.at += 3 * 3600;
    await round(context);
    expect(logged(context)).toContain('a wake of `wakes.yard.kiln` delivered');

    const empty = await served('wakes');
    await frame(
      empty.context,
      empty.marta,
      JSON.stringify({ t: 'command', seq: 1, line: 'fire kiln' }),
    );
    await frame(empty.context, empty.marta, JSON.stringify({ t: 'leave' }));
    empty.clock.at += 3 * 3600;
    await round(empty.context);
    expect(logged(empty.context)).not.toContain('delivered');
  });

  it('runs every `tick_seconds` of the clock, until it is stopped', async () => {
    const { clock, context } = await served('ticks');
    const stop = startClock(context);
    clock.advance(12);
    expect(clock.rounds).toBe(2);
    stop();
    clock.advance(12);
    expect(clock.rounds).toBe(2);
  });
});

function logged(context: ServerContext): string {
  return (context.log as unknown as { lines: string[] }).lines.join('\n');
}
