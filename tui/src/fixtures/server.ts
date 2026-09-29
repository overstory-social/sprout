import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_BLESSED, DEFAULT_LIMITS } from '@overstory/sprout/lang';
import { serverLog, startServer, type RunningServer } from '@overstory/sprout-server';

import { Session } from '../session.js';

// What the client's specs share: a server in-process serving a corpus
// world on a free port, and a session connected to it with a tokens file
// of its own. Spec support: the package build leaves it out.

/** The corpus world `good/<name>`'s folder. */
export const corpusWorld = (name: string): string =>
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'corpus', 'good', name);

/** A server serving the corpus world `name`, on a free port. */
export function serving(name = 'sequences'): Promise<RunningServer> {
  return startServer({
    config: {
      host: '127.0.0.1',
      port: 0,
      logLevel: 'error',
      tickSeconds: 3600,
      wakesWhileEmpty: false,
      worlds: [corpusWorld(name)],
      limits: DEFAULT_LIMITS,
      blessed: DEFAULT_BLESSED,
    },
    log: serverLog(
      'error',
      'text',
      () => 0,
      () => {},
    ),
  });
}

/** A tokens file of its own, so every person a spec makes is someone new. */
export const tokensFile = (): string =>
  join(mkdtempSync(join(tmpdir(), 'sprout-tokens-')), 'tokens.json');

/** A session with `server`, as `nickname` where one is given, opened. */
export async function connected(
  server: RunningServer,
  nickname?: string,
  tokens = tokensFile(),
): Promise<Session> {
  const session = new Session({
    address: `127.0.0.1:${server.port}`,
    tokens,
    ...(nickname === undefined ? {} : { nickname }),
  });
  await session.open();
  return session;
}

/** Wait until `test` holds of `session`, or fail naming what it shows. */
export async function until(session: Session, test: () => boolean): Promise<void> {
  for (let waited = 0; !test(); waited++) {
    if (waited > 100)
      throw new Error(
        `never came: ${JSON.stringify(session.state.lines.map((line) => line.text))}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Whether `session` has shown a line of `text`. */
export const shows = (session: Session, text: string): boolean =>
  session.state.lines.some((line) => line.text === text);
