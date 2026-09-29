import type { Io } from '@overstory/sprout-repl';

// The commands the CLI hands to another package, loaded only when the
// command runs and only where it is installed, as an optional peer: the
// terminal client (`sprout client connect`) and the server (`sprout server
// start`). Where one is not installed, the command says which to install.

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
    const code = (error as { code?: string }).code;
    if (code !== 'ERR_MODULE_NOT_FOUND') throw error;
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
