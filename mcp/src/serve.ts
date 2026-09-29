import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Readable, Writable } from 'node:stream';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Bundle } from '@overstory/sprout/lang';

import { worldServer } from './server.js';
import { openSession, type Session, type SessionOptions } from './session.js';

// `sprout mcp <dir>`: one session served until it ends. Over stdio it is
// one connection, one visitor, and it ends when the client closes it.
// Over Streamable HTTP (`--http host:port`) every client that initializes
// is a connection of its own onto the same session, each bound to the
// visitor it arrives as, and it ends when the host is stopped. The host's
// own words go to stderr: over stdio, stdout is the protocol's.

/** The streams a session is served on, and when the host is told to stop. */
export interface ServeIo {
  readonly stdin: Readable;
  readonly stdout: Writable;
  readonly stderr: Writable;
  /** Resolves when the host is stopped, as by Ctrl-C. */
  readonly stopped: Promise<unknown>;
}

/** Where to serve: over stdio, or over HTTP at a host and port. */
export type Listen = { readonly stdio: true } | { readonly host: string; readonly port: number };

/** Serve a session over `bundle`'s world at `listen` until it ends; the exit code. */
export async function serve(
  bundle: Bundle,
  options: SessionOptions,
  listen: Listen,
  io: ServeIo,
): Promise<number> {
  const session = openSession(bundle, options, (words) =>
    io.stderr.write(`sprout mcp: ${words}\n`),
  );
  if ('stdio' in listen) return serveStdio(session, io);
  return serveHttp(session, listen, io);
}

async function serveStdio(session: Session, io: ServeIo): Promise<number> {
  const transport = new StdioServerTransport(io.stdin, io.stdout);
  const closed = new Promise<void>((resolve) => (transport.onclose = resolve));
  await worldServer(session).connect(transport);
  io.stdin.once('end', () => void transport.close());
  await Promise.race([closed, io.stopped]);
  await transport.close();
  return 0;
}

/** The most a request's body may hold: far more than any call to a tool needs. */
const MOST_BODY = 1024 * 1024;

/** The body of `req`, as JSON; undefined where there is none, and thrown past `MOST_BODY`. */
async function bodyOf(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MOST_BODY) throw new Error('A request may hold at most a megabyte.');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? undefined : JSON.parse(text);
}

/** The names a browser may reach a loopback host by; null for any other host, which is its operator's to guard. */
function loopbackHosts(host: string, port: number): string[] | null {
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) return null;
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
}

/** A JSON-RPC error with no request to answer, as the protocol writes one. */
function rejected(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

async function serveHttp(
  session: Session,
  listen: { readonly host: string; readonly port: number },
  io: ServeIo,
): Promise<number> {
  const connections = new Map<string, StreamableHTTPServerTransport>();
  let port = listen.port;
  const http = createServer((req, res) => {
    void (async () => {
      if (new URL(req.url ?? '/', 'http://host').pathname !== '/mcp') {
        return rejected(res, 404, 'The world is served at /mcp.');
      }
      const id = req.headers['mcp-session-id'];
      const known = typeof id === 'string' ? connections.get(id) : undefined;
      const body = req.method === 'POST' ? await bodyOf(req) : undefined;
      if (known !== undefined) return known.handleRequest(req, res, body);
      if (req.method !== 'POST' || !isInitializeRequest(body)) {
        return rejected(res, 400, 'Initialize a connection first.');
      }
      const hosts = loopbackHosts(listen.host, port);
      // On loopback, a page some browser loaded may not reach the world by another name (DNS rebinding).
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (opened) => void connections.set(opened, transport),
        ...(hosts === null ? {} : { allowedHosts: hosts, enableDnsRebindingProtection: true }),
      });
      transport.onclose = () => {
        if (transport.sessionId !== undefined) connections.delete(transport.sessionId);
      };
      await worldServer(session).connect(transport);
      return transport.handleRequest(req, res, body);
    })().catch((error: unknown) => {
      if (!res.headersSent)
        rejected(res, 400, error instanceof Error ? error.message : String(error));
    });
  });
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(listen.port, listen.host, resolve);
  });
  const address = http.address();
  if (typeof address === 'object' && address !== null) port = address.port;
  io.stderr.write(`sprout mcp: serving the world at http://${listen.host}:${port}/mcp\n`);
  await io.stopped;
  for (const transport of connections.values()) await transport.close();
  await new Promise<void>((resolve) => http.close(() => resolve()));
  io.stderr.write('sprout mcp: stopped\n');
  return 0;
}
