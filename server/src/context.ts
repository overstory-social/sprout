import { randomInt } from 'node:crypto';

import {
  nicknamesIn,
  objectWords,
  readerOf,
  SEED_MAX,
  type Effect,
  type HostSeconds,
  type Level,
  type VisitKey,
  type WriteInputs,
} from '@overstory/sprout/lang';
import {
  committedState,
  ConversationPace,
  deliver,
  sendView,
  Ticker,
  ViewCache,
  type ClientCapabilities,
  type ClientDeclaration,
  type ServerMessage,
  type SproutStore,
} from '@overstory/sprout/core';

import type { ServerConfig } from './config.js';
import type { ServerLog } from './log.js';
import type { ServedWorld } from './worlds.js';

// What the server holds while it runs (docs/design/sprout-server.md): each
// world it serves with what it keeps of it between turns, each connection
// and who it is, and how what a turn gave reaches every connection that
// reads it. The world's state is the store's; nothing here is a world's.

/** The host's clock: the time now, in whole seconds, and a call repeated every so many seconds until cancelled. */
export interface Clock {
  now(): HostSeconds;
  every(seconds: number, run: () => void): () => void;
}

/** The real clock, which drives the host's side of time and nothing a turn reads. */
export const REAL_CLOCK: Clock = {
  now: () => Math.floor(Date.now() / 1000),
  every: (seconds, run) => {
    const timer = setInterval(run, seconds * 1000);
    return () => clearInterval(timer);
  },
};

/** A seed for a write turn, drawn at random, which the turn's log entry keeps. */
export const randomSeed = (): number => randomInt(0, SEED_MAX + 1);

/** One client connected: its socket's sending end, who it is once it said `hello`, and where it is admitted. */
export interface Connection {
  send(message: ServerMessage): void;
  close(): void;
  /** The person's visit, from a hash of their token; null before `hello`. */
  visit: VisitKey | null;
  /** What it said it renders, which each world's capabilities are negotiated from. */
  renders: ClientDeclaration['renders'];
  /** What it is sent payloads of in each world, by the world's name. */
  capabilities: Map<string, ClientCapabilities>;
  /** The nickname it was admitted under, which the host keeps across a redeploy; null before `admit`. */
  nickname: string | null;
  /** The levels it is sent host records at: prose and errors until it asks. */
  levels: ReadonlySet<Level>;
  /** The world it is admitted to; null before `admit` and after `leave`. */
  world: WorldRun | null;
  /** The status line it was last sent, to send it again only when it changes. */
  lastStatus: string | null;
  lastOffered: string | null;
}

/** A world while the server runs it: what it is, and what the host keeps of it between turns. */
export interface WorldRun {
  readonly served: ServedWorld;
  readonly views: ViewCache;
  readonly ticker: Ticker;
  readonly pace: ConversationPace;
  readonly connections: Set<Connection>;
}

/** What every handler reads: the config, the store, the log, the clock and the seeds, and the worlds. */
export interface ServerContext {
  readonly name: string;
  readonly config: ServerConfig;
  readonly store: SproutStore;
  readonly log: ServerLog;
  readonly clock: Clock;
  readonly seed: () => number;
  /** Each world served, by name; a redeploy replaces its run. */
  readonly worlds: Map<string, WorldRun>;
}

/** A write turn's inputs now: a fresh seed, the host's time, and no bound on instances. */
export function inputsNow(context: ServerContext): WriteInputs {
  return { seed: context.seed(), mayHold: null, now: context.clock.now() };
}

/** A world run afresh for `served`. */
export function worldRun(served: ServedWorld): WorldRun {
  return {
    served,
    views: new ViewCache(),
    ticker: new Ticker(),
    pace: new ConversationPace(),
    connections: new Set(),
  };
}

/**
 * Send what a turn in `world` gave each connection that reads some of it,
 * `seq` to the one whose line it was; name the stale visitors' views
 * stale; and send each of them their status and what they could type, where
 * either changed.
 */
export async function fanOut(
  context: ServerContext,
  world: WorldRun,
  effects: readonly Effect[],
  stale: readonly VisitKey[],
  cause: { readonly connection: Connection; readonly seq: number } | null,
): Promise<void> {
  world.views.stale(world.served.id, stale);
  for (const connection of world.connections) {
    if (connection.visit === null) continue;
    const capabilities = connection.capabilities.get(world.served.id)!;
    const delivered = deliver(effects, connection.visit, capabilities);
    const seq = cause?.connection === connection ? cause.seq : null;
    if (delivered.length > 0 || seq !== null) {
      connection.send({ t: 'effects', seq, effects: delivered });
    }
  }
  for (const connection of world.connections) {
    if (connection.visit !== null && stale.includes(connection.visit)) {
      await sendStatus(context, world, connection);
    }
  }
}

/**
 * Send `connection` its status line, where it stands and the ways out, and
 * the lines it could type now, each only where it changed; and, where
 * `seq` is given, the whole view it polled for.
 */
export async function sendStatus(
  context: ServerContext,
  world: WorldRun,
  connection: Connection,
  seq?: number,
): Promise<void> {
  const visit = connection.visit!;
  const { served } = world;
  const state = await committedState(context.store, served.id, served.host);
  const visitor = state.visitors.get(visit);
  const place =
    visitor === undefined ? null : (state.instances.get(visitor.instance)?.container ?? null);
  if (visitor === undefined || place === null) return;
  const polled = await world.views.view(
    context.store,
    served.id,
    served.host,
    visit,
    context.clock.now(),
  );
  const capabilities = connection.capabilities.get(served.id)!;
  if (seq !== undefined)
    connection.send({ t: 'view', seq, view: sendView(polled.view, capabilities) });
  const naming = { state: readerOf(state), nicknames: nicknamesIn(state) };
  const status = {
    t: 'status',
    place: objectWords(place, visitor.instance, naming),
    exits: polled.view.exits,
  } as const;
  const shown = JSON.stringify(status);
  if (shown !== connection.lastStatus) {
    connection.lastStatus = shown;
    connection.send(status);
  }
  const lines = polled.view.readings.filter((one) => one.refused === null).map((one) => one.typed);
  const offered = JSON.stringify(lines);
  if (offered !== connection.lastOffered) {
    connection.lastOffered = offered;
    connection.send({ t: 'offered', lines });
  }
}

/** Send `connection` a host record at `level`, where it asked for records at that level. */
export function record(
  context: ServerContext,
  connection: Connection,
  level: Level,
  text: string,
): void {
  if (connection.levels.has(level))
    connection.send({ t: 'record', level, text, at: context.clock.now() });
}
