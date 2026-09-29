import { dueWakes, oldestFirst, type Effect, type VisitKey } from '@overstory/sprout/lang';
import { committedState, runWake } from '@overstory/sprout/core';

import { fanOut, type ServerContext, type WorldRun } from './context.js';

// The host's side of time (docs/design/sprout-server.md, Time; the spec's
// The host contract › Time): every `tick_seconds` of the real clock, each
// place someone stands in is ticked, through core's ticker, and every wake
// due runs, while someone is in its world, or always where the config says
// wakes run while it is empty. Each turn has its own seed, drawn and
// logged. What these turns say reaches whoever reads it; a fault is the
// server's to log.

/** Start the rounds: one every `tick_seconds`, until the returned stop is called. */
export function startClock(context: ServerContext): () => void {
  let running: Promise<void> = Promise.resolve();
  return context.clock.every(context.config.tickSeconds, () => {
    // A round waits for the last to finish, so two never run at once.
    running = running
      .then(() => round(context))
      .catch((error: unknown) => {
        context.log.write('error', `a round of ticks and wakes failed: ${String(error)}`);
      });
  });
}

/** One round: every world's occupied places ticked, then its due wakes run. */
export async function round(context: ServerContext): Promise<void> {
  for (const world of context.worlds.values()) {
    await tick(context, world);
    await wakes(context, world);
  }
}

async function tick(context: ServerContext, world: WorldRun): Promise<void> {
  const { served } = world;
  const now = context.clock.now();
  const ticked = await world.ticker.round(context.store, served.id, served.host, now, () => ({
    seed: context.seed(),
    mayHold: null,
  }));
  for (const one of ticked) {
    if (!('turn' in one)) continue;
    const { turn } = one;
    if ('committed' in turn && turn.committed) await told(context, world, turn.effects, turn.stale);
    else if ('fault' in turn)
      context.log.write(
        'error',
        `a tick faulted, ${turn.fault.name}: ${turn.fault.detail}`,
        served.id,
      );
  }
}

async function wakes(context: ServerContext, world: WorldRun): Promise<void> {
  const { served } = world;
  if (world.connections.size === 0 && !context.config.wakesWhileEmpty) return;
  const now = context.clock.now();
  const state = await committedState(context.store, served.id, served.host);
  for (const due of dueWakes(state, now).sort(oldestFirst)) {
    const turn = await runWake(context.store, served.id, served.host, {
      seed: context.seed(),
      mayHold: null,
      now,
      object: due.object,
      serial: due.serial,
    });
    if (turn.committed) {
      context.log.write('debug', `a wake of \`${due.object}\` delivered`, served.id);
      await told(context, world, turn.effects, turn.stale);
    } else if ('fault' in turn) {
      context.log.write(
        'error',
        `a wake faulted, ${turn.fault.name}: ${turn.fault.detail}`,
        served.id,
      );
    }
  }
}

function told(
  context: ServerContext,
  world: WorldRun,
  effects: readonly Effect[],
  stale: readonly VisitKey[],
): Promise<void> {
  return fanOut(context, world, effects, stale, null);
}
