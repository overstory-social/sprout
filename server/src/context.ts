import { randomInt } from 'node:crypto';

import {
  SEED_MAX,
  type Effect,
  type HostSeconds,
  type Level,
  type VisitKey,
  type WriteInputs,
} from '@overstory/sprout/lang';
import {
  committedStored,
  ConversationPace,
  engineOf,
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
  /** The status line and the verbs it was last sent, to send each again only when it changes. */
  lastStatus: string | null;
  lastVerbs: string | null;
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
 * `seq` to the one whose line it was, with whether it is that line's last
 * turn; name the stale visitors' views
 * stale; and send each of them their status and the verbs they could use,
 * where either changed.
 */
export async function fanOut(
  context: ServerContext,
  world: WorldRun,
  effects: readonly Effect[],
  stale: readonly VisitKey[],
  cause: { readonly connection: Connection; readonly seq: number; readonly last: boolean } | null,
): Promise<void> {
  world.views.stale(world.served.id, stale);
  for (const connection of world.connections) {
    if (connection.visit === null) continue;
    const capabilities = connection.capabilities.get(world.served.id)!;
    const delivered = deliver(effects, connection.visit, capabilities);
    const asked = cause?.connection === connection ? cause : null;
    if (delivered.length > 0 || asked !== null) {
      connection.send({
        t: 'effects',
        seq: asked?.seq ?? null,
        last: asked?.last ?? true,
        effects: delivered,
      });
    }
  }
  for (const connection of world.connections) {
    if (connection.visit !== null && stale.includes(connection.visit)) {
      await sendStatus(context, world, connection);
    }
  }
}

/**
 * Send `connection` its status, where it stands, what else the place holds
 * and the ways out, and the verbs it could use now, each only where it
 * changed, from its scene; and, where `seq` is given, the whole view it
 * polled for. A verb's readings are sent only when asked for, by
 * `sendReadings`, so a turn never derives every reading of every visitor
 * it names stale.
 */
export async function sendStatus(
  context: ServerContext,
  world: WorldRun,
  connection: Connection,
  seq?: number,
): Promise<void> {
  const visit = connection.visit!;
  const { served } = world;
  const standing = engineOf(served.host).standing(
    await committedStored(context.store, served.id),
    visit,
  );
  if (standing === null) return;
  const now = context.clock.now();
  if (seq !== undefined) {
    const polled = await world.views.view(context.store, served.id, served.host, visit, now);
    const capabilities = connection.capabilities.get(served.id)!;
    connection.send({ t: 'view', seq, view: sendView(polled.view, capabilities) });
  }
  const { scene } = await world.views.scene(context.store, served.id, served.host, visit, now);
  const status = {
    t: 'status',
    place: standing.place.name,
    here: standing.here,
    exits: scene.exits,
  } as const;
  const shown = JSON.stringify(status);
  if (shown !== connection.lastStatus) {
    connection.lastStatus = shown;
    connection.send(status);
  }
  const verbs = JSON.stringify(scene.verbs);
  if (verbs !== connection.lastVerbs) {
    connection.lastVerbs = verbs;
    connection.send({ t: 'verbs', verbs: scene.verbs });
  }
}

/** Send `connection` the readings of `verb` it asked for with `seq`: none where its scene lists no such verb. */
export async function sendReadings(
  context: ServerContext,
  world: WorldRun,
  connection: Connection,
  seq: number,
  verb: string,
): Promise<void> {
  const visit = connection.visit!;
  const { served } = world;
  const stored = await committedStored(context.store, served.id);
  const away = engineOf(served.host).standing(stored, visit) === null;
  const polled = away
    ? null
    : await world.views.readings(
        context.store,
        served.id,
        served.host,
        visit,
        verb,
        context.clock.now(),
      );
  connection.send({
    t: 'readings',
    seq,
    verb,
    readings: polled?.readings ?? [],
    faulted: polled !== null && polled.fault !== null,
  });
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
