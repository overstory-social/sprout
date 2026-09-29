import { createHash } from 'node:crypto';

import { visitKey, type CommandTurn, type Level, type VisitKey } from '@overstory/sprout/lang';
import {
  clientMessageOf,
  negotiate,
  runArrival,
  runCommandLine,
  runConversation,
  runDeparture,
  TEXT_ONLY,
  type ClientMessage,
} from '@overstory/sprout/core';

import {
  fanOut,
  inputsNow,
  record,
  sendStatus,
  type Connection,
  type ServerContext,
  type WorldRun,
} from './context.js';

// One connection's side of the protocol (docs/design/sprout-server.md, The
// protocol, Who a visitor is): each frame read and answered, `hello` first,
// then `admit`, then commands, polls and chat, until `leave` or the
// connection closes, which is a departure. A frame the protocol does not
// read is answered with `refused`, never dropped; every turn's effects go
// to every connection in the world that reads them.

/** A connection just opened, as yet no one. */
export function opened(send: Connection['send'], close: Connection['close']): Connection {
  return {
    send,
    close,
    visit: null,
    capabilities: new Map(),
    levels: new Set<Level>(['prose', 'error']),
    world: null,
    lastStatus: null,
    lastOffered: null,
  };
}

/** The visit a person's token stands for: a hash of it, so the token itself is never kept. */
export function visitOfToken(token: string): VisitKey {
  return visitKey(`token:${createHash('sha256').update(token).digest('hex')}`);
}

/** Read one frame from `connection` and answer it. */
export async function frame(
  context: ServerContext,
  connection: Connection,
  text: string,
): Promise<void> {
  const read = clientMessageOf(text);
  if ('malformed' in read) {
    connection.send({
      t: 'refused',
      stage: connection.visit === null ? 'hello' : 'frame',
      reason: 'malformed',
      text: read.malformed,
    });
    return;
  }
  const message = read.message;
  if (message.t === 'hello') return hello(context, connection, message);
  if (connection.visit === null) {
    connection.send({
      t: 'refused',
      stage: 'hello',
      reason: 'no-hello',
      text: 'Say `hello` first, with the protocol and your token.',
    });
    return;
  }
  switch (message.t) {
    case 'admit':
      return admit(context, connection, message);
    case 'levels':
      connection.levels = new Set(message.show.length === 0 ? ['prose', 'error'] : message.show);
      return;
    case 'ping':
      return;
  }
  const world = connection.world;
  if (world === null) {
    connection.send({
      t: 'refused',
      stage: 'frame',
      reason: 'not-admitted',
      text: 'Come into a world first, with `admit`.',
    });
    return;
  }
  switch (message.t) {
    case 'command':
      return command(context, connection, world, message.seq, message.line);
    case 'poll':
      return sendStatus(context, world, connection, message.seq);
    case 'chat':
      return chat(context, connection, world, message.line);
    case 'leave':
      await depart(context, connection);
      connection.send({ t: 'bye', reason: 'left', text: 'You leave.' });
      connection.close();
      return;
  }
}

/** `hello`: who the person is, and what they are sent payloads of in each world. */
function hello(
  context: ServerContext,
  connection: Connection,
  message: Extract<ClientMessage, { t: 'hello' }>,
): void {
  if (connection.visit !== null) {
    connection.send({
      t: 'refused',
      stage: 'hello',
      reason: 'twice',
      text: 'This connection has said `hello` already.',
    });
    return;
  }
  connection.visit = visitOfToken(message.token);
  const worlds = [...context.worlds.values()].map((world) => {
    const negotiated = negotiate(
      { renders: message.renders },
      world.served.host.catalogue.extensions,
    );
    const capabilities = negotiated.accepted ? negotiated.capabilities : TEXT_ONLY;
    connection.capabilities.set(world.served.id, capabilities);
    return {
      world: world.served.id,
      granted: negotiated.accepted ? negotiated.granted : [],
      declined: negotiated.accepted ? negotiated.declined : [],
    };
  });
  connection.send({ t: 'welcome', server: context.name, worlds });
}

/** `admit`: come into a world under a nickname, after its catch-up. */
async function admit(
  context: ServerContext,
  connection: Connection,
  message: Extract<ClientMessage, { t: 'admit' }>,
): Promise<void> {
  const world = context.worlds.get(message.world);
  if (world === undefined) {
    const served = [...context.worlds.keys()].map((one) => `\`${one}\``).join(', ');
    connection.send({
      t: 'refused',
      stage: 'admit',
      reason: 'no-world',
      text: `This server serves no world \`${message.world}\`; it serves ${served}.`,
    });
    return;
  }
  if (connection.world !== null) {
    connection.send({
      t: 'refused',
      stage: 'admit',
      reason: 'admitted',
      text: 'You are in a world already; `leave` it first.',
    });
    return;
  }
  const { served } = world;
  const visit = connection.visit!;
  const admission = await runArrival(
    context.store,
    served.id,
    served.host,
    inputsNow(context),
    { ...inputsNow(context), visit, nickname: message.nickname },
    { moderate: () => true },
  );
  if (admission.caughtUp !== null) {
    await fanOut(context, world, admission.caughtUp.effects, admission.caughtUp.stale, null);
  }
  const arrived = admission.arrived;
  if ('nicknameRefused' in arrived) {
    connection.send({
      t: 'refused',
      stage: 'admit',
      reason: 'nickname',
      text: arrived.nicknameRefused.words,
    });
    return;
  }
  if ('closed' in arrived) {
    connection.send({ t: 'refused', stage: 'admit', reason: 'closed', text: arrived.closed.words });
    return;
  }
  if (!arrived.committed) {
    const text = 'words' in arrived ? arrived.words : 'You cannot come in just now.';
    connection.send({ t: 'refused', stage: 'admit', reason: 'refused', text });
    return;
  }
  connection.world = world;
  world.connections.add(connection);
  connection.send({
    t: 'admitted',
    world: served.id,
    nickname: message.nickname,
    returning: arrived.value.returning,
  });
  context.log.write('info', `${message.nickname} arrives`, served.id);
  await fanOut(context, world, arrived.effects, [...arrived.stale, visit], null);
}

/** `command`: the line as every turn it runs, each turn's effects to everyone who reads them. */
async function command(
  context: ServerContext,
  connection: Connection,
  world: WorldRun,
  seq: number,
  line: string,
): Promise<void> {
  const { served } = world;
  const turns = await runCommandLine(
    context.store,
    served.id,
    served.host,
    { ...inputsNow(context), visit: connection.visit!, text: line },
    context.seed,
  );
  for (const turn of turns) {
    notes(context, connection, turn);
    const stale = turn.committed ? turn.stale : [];
    await fanOut(context, world, turn.effects, stale, { connection, seq });
  }
}

/** What the host logs of one command turn, and tells the one who typed it at the levels they asked for. */
function notes(context: ServerContext, connection: Connection, turn: CommandTurn): void {
  const world = connection.world!.served.id;
  if (!turn.committed) {
    const text = `a command faulted, ${turn.fault.name}: ${turn.fault.detail}`;
    context.log.write('error', text, world);
    record(context, connection, 'error', text);
    return;
  }
  const done = turn.value;
  if ('step' in done && done.step !== null) {
    record(context, connection, 'info', `step: ${done.step.verb.library}.${done.step.verb.name}`);
  }
  if ('drawn' in done && done.drawn !== null) {
    const text = `drawn: the line read ${done.drawn.among} ways that tied, and one was drawn`;
    context.log.write('warning', text, world);
    record(context, connection, 'warning', text);
  }
}

/** `chat`: said to everyone standing with the speaker, beside the world and never in it. */
async function chat(
  context: ServerContext,
  connection: Connection,
  world: WorldRun,
  line: string,
): Promise<void> {
  const { served } = world;
  const said = await runConversation(
    context.store,
    served.id,
    served.host,
    { rules: { characters: null, pace: null }, moderate: () => true },
    world.pace,
    { visit: connection.visit!, text: line, at: context.clock.now() },
  );
  if (!said.said) {
    connection.send({ t: 'refused', stage: 'frame', reason: said.reason, text: said.words });
    return;
  }
  for (const other of world.connections) {
    if (other.visit !== null && said.to.includes(other.visit)) {
      other.send({ t: 'chat', from: said.nickname, line: said.text });
    }
  }
}

/** The connection's visitor leaves its world, as a departure turn; nothing where it is in none. */
export async function depart(context: ServerContext, connection: Connection): Promise<void> {
  const world = connection.world;
  if (world === null) return;
  connection.world = null;
  world.connections.delete(connection);
  const { served } = world;
  const visit = connection.visit!;
  const turn = await runDeparture(context.store, served.id, served.host, {
    ...inputsNow(context),
    visit,
  });
  world.views.stale(served.id, [visit]);
  if (turn.committed) await fanOut(context, world, turn.effects, turn.stale, null);
}
