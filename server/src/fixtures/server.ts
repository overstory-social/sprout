import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_BLESSED, DEFAULT_LIMITS } from '@overstory/sprout/lang';
import { memoryStore } from '@overstory/sprout/core';

import type { ServerConfig } from '../config.js';
import { worldRun, type Clock, type Connection, type ServerContext } from '../context.js';
import { serverLog, type ServerLog } from '../log.js';
import { opened } from '../session.js';
import { compileWorld } from '../worlds.js';

// What the server's specs share: a corpus world's folder, a config serving
// it on any free port, a clock that moves only when a spec says, and a
// connection that keeps what it was sent. Spec support: the package build
// leaves it out.

/** The corpus world `good/<name>`'s folder. */
export const corpusWorld = (name: string): string =>
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'corpus', 'good', name);

/** A config serving `worlds` on any free port, at the spec's limits, logging everything. */
export const configFor = (...worlds: string[]): ServerConfig => ({
  host: '127.0.0.1',
  port: 0,
  logLevel: 'debug',
  tickSeconds: 5,
  wakesWhileEmpty: false,
  worlds,
  limits: DEFAULT_LIMITS,
  blessed: DEFAULT_BLESSED,
});

/** A clock at `now` that moves only when `advance` says, running each round asked for then. */
export function manualClock(
  start = 1000,
): Clock & { at: number; advance(seconds: number): void; rounds: number } {
  const runs: { every: number; run: () => void; last: number }[] = [];
  const clock = {
    at: start,
    rounds: 0,
    now: () => clock.at,
    every: (seconds: number, run: () => void) => {
      const entry = { every: seconds, run, last: clock.at };
      runs.push(entry);
      return () => runs.splice(runs.indexOf(entry), 1);
    },
    advance(seconds: number) {
      clock.at += seconds;
      for (const entry of runs) {
        while (entry.last + entry.every <= clock.at) {
          entry.last += entry.every;
          clock.rounds += 1;
          entry.run();
        }
      }
    },
  };
  return clock;
}

/** A log that keeps what it is written. */
export function keptLog(): ServerLog & { readonly lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    ...serverLog(
      'debug',
      'text',
      () => 0,
      (line) => lines.push(line),
    ),
  };
}

/** A server's context over `worlds`, compiled and not yet published, in a memory store. */
export function contextFor(clock: Clock, ...worlds: string[]): ServerContext {
  const config = configFor(...worlds);
  let seed = 0;
  return {
    name: 'test-server',
    config,
    store: memoryStore(),
    log: keptLog(),
    clock,
    seed: () => (seed += 1),
    worlds: new Map(
      worlds.map((dir) => {
        const compiled = compileWorld(dir, config);
        if ('refused' in compiled) throw new Error(compiled.refused);
        return [compiled.world.id, worldRun(compiled.world)];
      }),
    ),
  };
}

/** A connection that keeps every message it is sent, and whether it was closed. */
export function keptConnection(): Connection & { readonly sent: unknown[]; closed: boolean } {
  const sent: unknown[] = [];
  const kept = Object.assign(
    opened(
      (message) => sent.push(message),
      () => (kept.closed = true),
    ),
    {
      sent,
      closed: false,
    },
  );
  return kept;
}
