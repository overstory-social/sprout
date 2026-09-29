import { render } from 'ink';

import { App } from './app.js';
import { playPlain } from './plain.js';
import { Session, type SessionOptions } from './session.js';

// `sprout client connect <address> [--world w] [--as name] [--plain]`: one
// visitor, connected to a server, on the terminal's screen or, plain, as
// lines in and out. Resolves to the exit code once the visitor quits.

/** What connecting takes: the session's options, whether to run plain, and the terminal's streams. */
export interface ConnectOptions extends SessionOptions {
  readonly plain?: boolean;
  readonly stdin: NodeJS.ReadStream;
  readonly stdout: NodeJS.WriteStream;
  readonly stderr: { write(text: string): unknown };
}

/** Connect, and play until the visitor quits. */
export async function connect(options: ConnectOptions): Promise<number> {
  const session = new Session(options);
  try {
    await session.open();
  } catch (error) {
    options.stderr.write(
      `sprout client: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
  // A pipe, or a terminal asked for plain lines, gets lines; a terminal gets the screen.
  if (options.plain === true || !options.stdin.isTTY) {
    await playPlain(session, options.stdin, options.stdout);
    return 0;
  }
  const app = render(<App session={session} />, {
    stdin: options.stdin,
    stdout: options.stdout,
    exitOnCtrlC: false,
  });
  await app.waitUntilExit();
  return 0;
}
