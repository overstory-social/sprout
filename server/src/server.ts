import type { AddressInfo } from 'node:net';

import { WebSocketServer, type WebSocket } from 'ws';

import { memoryStore, PROTOCOL, type SproutStore } from '@overstory/sprout/core';

import { startClock } from './clock.js';
import type { ServerConfig } from './config.js';
import {
  randomSeed,
  REAL_CLOCK,
  worldRun,
  type Clock,
  type ServerContext,
  type WorldRun,
} from './context.js';
import type { ServerLog } from './log.js';
import { depart, frame, opened } from './session.js';
import { compileWorld, publish } from './worlds.js';

// `sprout-server start` (docs/design/sprout-server.md): every world the
// config names compiled strictly and published, a world refused logged and
// not served while the rest start; a WebSocket server speaking `sprout.1`,
// one connection one visitor; and the clock's rounds of ticks and wakes.
// A connection that closes, or stops answering pings, leaves its world as
// a departure turn.

/** What starting the server takes beyond its config: its log, and where tests put their own store, clock and seeds. */
export interface ServerOptions {
  readonly config: ServerConfig;
  readonly log: ServerLog;
  readonly name?: string;
  readonly store?: SproutStore;
  readonly clock?: Clock;
  readonly seed?: () => number;
  /** How often a connection is pinged, in seconds; one that has not answered the last is dropped. */
  readonly pingSeconds?: number;
}

/** A server running: the port it listens on, the worlds it serves, and how to stop it. */
export interface RunningServer {
  readonly port: number;
  readonly context: ServerContext;
  close(): Promise<void>;
}

/** Start the server: its worlds published, its socket listening, its clock running. */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const { config, log } = options;
  const clock = options.clock ?? REAL_CLOCK;
  const store = options.store ?? memoryStore();
  const worlds = new Map<string, WorldRun>();
  for (const dir of config.worlds) {
    const compiled = compileWorld(dir, config);
    if ('refused' in compiled) {
      log.write('error', `the world in ${dir} is refused, and not served:\n${compiled.refused}`);
      continue;
    }
    const { world } = compiled;
    await publish(store, world, config, clock.now(), new Date(clock.now() * 1000));
    worlds.set(world.id, worldRun(world));
    log.write('info', `serving the world in ${dir}, bundle ${world.bundle.hash}`, world.id);
  }
  if (worlds.size === 0) throw new Error('No world the config names could be served; see the log.');
  const context: ServerContext = {
    name: options.name ?? 'sprout-server',
    config,
    store,
    log,
    clock,
    seed: options.seed ?? randomSeed,
    worlds,
  };

  const sockets = new WebSocketServer({
    host: config.host,
    port: config.port,
    handleProtocols: (protocols) => (protocols.has(PROTOCOL) ? PROTOCOL : false),
  });
  await new Promise<void>((resolve, reject) => {
    sockets.once('listening', resolve);
    sockets.once('error', reject);
  });
  const alive = new WeakSet<WebSocket>();
  sockets.on('connection', (socket) => {
    alive.add(socket);
    socket.on('pong', () => alive.add(socket));
    const connection = opened(
      (message) => socket.send(JSON.stringify(message)),
      () => socket.close(),
    );
    // Frames are read one at a time, in order, so a turn never races the next line.
    let reading: Promise<void> = Promise.resolve();
    socket.on('message', (data) => {
      // `frame` answers even a frame it fails on, so nothing waits in silence.
      reading = reading.then(() => frame(context, connection, data.toString()));
    });
    socket.on('close', () => {
      reading = reading
        .then(() => depart(context, connection))
        .catch((error: unknown) => {
          log.write('error', `a departure could not be run: ${String(error)}`);
        });
    });
  });
  const stopPings = setInterval(
    () => {
      for (const socket of sockets.clients) {
        if (!alive.has(socket)) {
          socket.terminate();
          continue;
        }
        alive.delete(socket);
        socket.ping();
      }
    },
    (options.pingSeconds ?? 30) * 1000,
  );
  const stopClock = startClock(context);
  const { port } = sockets.address() as AddressInfo;
  log.write('info', `listening on ${config.host}:${port}`);

  return {
    port,
    context,
    async close() {
      stopClock();
      clearInterval(stopPings);
      for (const socket of sockets.clients) {
        socket.send(
          JSON.stringify({ t: 'bye', reason: 'stopping', text: 'The server is stopping.' }),
        );
        socket.close();
      }
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
    },
  };
}
