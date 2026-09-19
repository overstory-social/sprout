import { createServer, type Server, type Socket } from 'node:net';

import { readArchive, stateDirOf } from './archive.js';
import { checkArchive, formatCheck } from './check.js';
import { QUIT } from './play.js';
import { openSession } from './session.js';
import { openStore, type StoreKind } from './store.js';
import { renderTurn } from './transcript.js';

// `sprout serve` (the split proposal §6): the same microworld on a TCP
// line protocol — one runtime, one store, a connection per actor — bound
// to 127.0.0.1 unless `--host` widens it. A development toy: no auth,
// no TLS; the first line a connection sends is its name. Every line
// after is a `say` turn; between turns a poll (`look`, with the stamp
// the connection already has) delivers what the others did, so two
// terminals see each other's arrivals and moves as they happen.

export interface ServeOptions {
  archive: string;
  port: number;
  host: string;
  store: StoreKind;
  stateDir?: string;
  /** How often a quiet connection asks what the others did. */
  pollMs?: number;
  log?: (line: string) => void;
  now?: () => Date;
}

export interface Serving {
  port: number;
  host: string;
  close(): Promise<void>;
}

export async function serve(opts: ServeOptions): Promise<Serving> {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? (() => undefined);
  const archive = readArchive(opts.archive);
  const check = checkArchive(archive);
  if (!check.ok) throw new Error(formatCheck(check));
  if (!check.program.entry) throw new Error('No door here: sprout.json names no entry room.');
  const opened = await openStore(opts.store, opts.stateDir ?? stateDirOf(archive));
  const { runtime, microworldId } = await openSession(archive, opened.store, { now: now() });
  const sockets = new Set<Socket>();

  const attend = (socket: Socket) => {
    sockets.add(socket);
    let actor: { id: string; name: string } | null = null;
    let knownStamp: string | undefined;
    let chain = Promise.resolve();
    let poll: NodeJS.Timeout | null = null;
    const send = (lines: string[]) => {
      if (!socket.destroyed) socket.write(lines.map((l) => `${l}\n`).join(''));
    };
    /** The prompt, with no newline: what a client waits for. */
    const prompt = () => {
      if (!socket.destroyed) socket.write('> ');
    };
    const turn = async (input: Parameters<typeof runtime.turn>[0]['input']) => {
      if (!actor) return;
      const res = await runtime.turn({ microworldId, actor, input, now: now(), knownStamp });
      if (res.scene) knownStamp = res.scene.stamp;
      const lines = renderTurn(res);
      if (lines.length > 0) send(lines);
    };
    const bye = async () => {
      if (poll) clearInterval(poll);
      poll = null;
      if (actor) {
        const who = actor;
        actor = null;
        await runtime.turn({ microworldId, actor: who, input: { kind: 'leave' }, now: now() });
        log(`${who.name} left`);
      }
      socket.end();
    };
    const line = async (raw: string) => {
      const text = raw.trim();
      if (!actor) {
        if (text === '') {
          send(['Who are you? (a name, then Enter)']);
          return;
        }
        actor = { id: text, name: text };
        log(`${text} arrived`);
        await turn({ kind: 'enter' });
        prompt();
        poll = setInterval(() => {
          chain = chain.then(() => turn({ kind: 'look' })).catch(() => undefined);
        }, opts.pollMs ?? 1000);
        return;
      }
      if (text === '') return;
      if (QUIT.has(text.toLowerCase())) {
        await bye();
        return;
      }
      await turn({ kind: 'say', text });
      prompt();
    };
    send([`sprout serve: ${microworldId}. Who are you? (a name, then Enter)`]);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const one = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        chain = chain.then(() => line(one)).catch((err) => log(`${String(err)}`));
      }
    });
    socket.on('close', () => {
      sockets.delete(socket);
      chain = chain.then(bye).catch(() => undefined);
    });
    socket.on('error', () => undefined);
  };

  const server: Server = createServer(attend);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  log(`listening on ${opts.host}:${port} (${microworldId})`);
  return {
    port,
    host: opts.host,
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await opened.close();
    },
  };
}
