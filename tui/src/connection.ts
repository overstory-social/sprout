import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import WebSocket from 'ws';

import { PROTOCOL, ServerMessage, type ClientMessage } from '@overstory/sprout/core';

// A client's connection to a server (docs/design/sprout-server.md, Who a
// visitor is, The protocol): the person's token, made on first contact
// with a server and kept by its address in a file of the person's own, and
// one WebSocket speaking `sprout.1`, every frame the server sends checked
// against the protocol before the client reads it.

/** Where a person's tokens are kept, one for each server by its address. */
export const TOKEN_FILE = join(homedir(), '.config', 'sprout', 'tokens.json');

/** The token for `server`: the one kept in `file`, or a new one, kept there. */
export function tokenFor(server: string, file = TOKEN_FILE): string {
  let kept: Record<string, string> = {};
  try {
    const read: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (read !== null && typeof read === 'object') kept = read as Record<string, string>;
  } catch {
    // No file yet, or one that is not JSON: a new one is written.
  }
  const found = kept[server];
  if (typeof found === 'string' && found.length >= 16) return found;
  const made = randomBytes(24).toString('hex');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...kept, [server]: made }, null, 2)}\n`);
  chmodSync(file, 0o600);
  return made;
}

/** What the connection tells the client. */
export interface LinkEvents {
  message(message: ServerMessage): void;
  /** The server sent what the protocol does not read, in words. */
  malformed(words: string): void;
  closed(): void;
}

/** An open connection. */
export interface Link {
  send(message: ClientMessage): void;
  close(): void;
}

/** Connect to `address`, `host:port`, over `ws://` for a local server and `wss://` for one given with it. */
export function link(address: string, events: LinkEvents): Promise<Link> {
  const url = /^wss?:\/\//.test(address) ? address : `ws://${address}`;
  const socket = new WebSocket(url, PROTOCOL);
  socket.on('message', (data) => {
    let json: unknown;
    try {
      json = JSON.parse(data.toString());
    } catch {
      events.malformed('The server sent a frame that is not JSON.');
      return;
    }
    const parsed = ServerMessage.safeParse(json);
    if (parsed.success) events.message(parsed.data);
    else
      events.malformed(
        `The server sent a frame the protocol does not read: ${parsed.error.issues[0]!.message}.`,
      );
  });
  socket.on('close', () => events.closed());
  return new Promise((resolve, reject) => {
    socket.once('open', () =>
      resolve({
        send: (message) => socket.send(JSON.stringify(message)),
        close: () => socket.close(),
      }),
    );
    socket.once('error', (error) =>
      reject(new Error(`Cannot connect to ${address}: ${error.message}`)),
    );
  });
}
