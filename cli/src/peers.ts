import type { Readable, Writable } from 'node:stream';

import type { Bundle } from '@overstory/sprout/lang';
import type { Io } from '@overstory/sprout-repl';

// The commands the CLI hands to another package, loaded only when the
// command runs and only where it is installed, as an optional peer: the
// terminal client (`sprout client connect`), the server (`sprout server
// start`) and a world as tools for an agent (`sprout mcp`). Where one is
// not installed, the command says which to install.

/** Load `name`, or say which package to install and give null. */
async function peer<T>(
  load: () => Promise<T>,
  name: string,
  command: string,
  io: Io,
): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    // Only the peer itself missing is its not being installed; a package it needs missing is its defect.
    const { code, message } = error as { code?: string; message?: string };
    if (code !== 'ERR_MODULE_NOT_FOUND' || !message?.includes(`'${name}'`)) throw error;
    io.stderr.write(
      `sprout: \`${command}\` needs ${name}, which is not installed: npm install ${name}\n`,
    );
    return null;
  }
}

/** `sprout client connect <address> [--world w] [--as name] [--plain]`. */
export async function clientConnect(
  positional: readonly string[],
  flags: Readonly<Record<string, string | true>>,
  io: Io,
): Promise<number> {
  const [sub, address] = positional;
  if (sub !== 'connect' || address === undefined) {
    io.stderr.write(
      'sprout: `client` connects to a server: sprout client connect localhost:4700 [--world w] [--as name] [--plain]\n',
    );
    return 1;
  }
  const tui = await peer(
    () => import('@overstory/sprout-tui'),
    '@overstory/sprout-tui',
    'sprout client',
    io,
  );
  if (tui === null) return 1;
  const world = flags['world'];
  const nickname = flags['as'];
  return tui.connect({
    address,
    ...(typeof world === 'string' ? { world } : {}),
    ...(typeof nickname === 'string' ? { nickname } : {}),
    plain: flags['plain'] !== undefined,
    stdin: (io.stdin ?? process.stdin) as NodeJS.ReadStream,
    stdout: io.stdout as NodeJS.WriteStream,
    stderr: io.stderr,
  });
}

/** `sprout server start --config server.toml [--watch] [--log-format text|json]`, handed to the server's own command. */
export async function serverStart(argv: readonly string[], io: Io): Promise<number> {
  const server = await peer(
    () => import('@overstory/sprout-server'),
    '@overstory/sprout-server',
    'sprout server',
    io,
  );
  if (server === null) return 1;
  const stopped = new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  return server.main(argv, { stdout: io.stdout, stderr: io.stderr, stopped });
}

/** `sprout mcp <dir> [--http host:port] [--seed n] [--record file] [--turn-cap n] [--advance-per-turn 30s]`, over the world `bundle`. */
export async function mcpServe(
  bundle: Bundle,
  flags: Readonly<Record<string, string | true>>,
  io: Io,
): Promise<number> {
  const mcp = await peer(
    () => import('@overstory/sprout-mcp'),
    '@overstory/sprout-mcp',
    'sprout mcp',
    io,
  );
  if (mcp === null) return 1;
  const stopped = new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
  try {
    return await mcp.serve(bundle, mcp.sessionOptions(flags), mcp.listenAt(flags), {
      stdin: (io.stdin ?? process.stdin) as Readable,
      stdout: io.stdout as Writable,
      stderr: io.stderr as Writable,
      stopped,
    });
  } catch (error) {
    // Refused as `main` refuses anything, since the promise this returns is past its catch:
    // a flag it cannot use, a file it cannot record to, a port already taken.
    io.stderr.write(`sprout: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
