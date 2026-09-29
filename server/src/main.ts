import { readFileSync } from 'node:fs';

import { readConfig } from './config.js';
import { serverLog, type LogFormat } from './log.js';
import { startServer, type RunningServer } from './server.js';

// `sprout-server start --config server.toml [--watch] [--log-format text|json]`
// (docs/design/sprout-server.md, Commands): the config read and checked,
// every world it names served, the server's log on stdout, until the
// process is asked to stop, when every client is told so and the server
// closes.

/** Where the command writes, and what tells it to stop. */
export interface MainIo {
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
  /** Resolves when the server is to stop, as a signal does. */
  readonly stopped: Promise<unknown>;
}

export const USAGE = `sprout-server — Sprout's reference host

  sprout-server start --config server.toml [--watch] [--log-format text|json]
      serve every world the config names until stopped; the log on stdout;
      --watch redeploys a world, from its initial state, when its folder changes
`;

/** Run the command line; resolves to its exit code once the server has stopped, or at once where it cannot start. */
export async function main(argv: readonly string[], io: MainIo): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'help') {
    io.stdout.write(USAGE);
    return 0;
  }
  if (command !== 'start') {
    io.stderr.write(
      command === undefined ? USAGE : `sprout-server: no such command "${command}"\n\n${USAGE}`,
    );
    return 1;
  }
  // A flag's value is the word after it, and never another flag.
  const flag = (name: string): string | null => {
    const at = rest.indexOf(`--${name}`);
    const value = at >= 0 ? rest[at + 1] : undefined;
    return value === undefined || value.startsWith('--') ? null : value;
  };
  const path = flag('config');
  if (path === null) {
    io.stderr.write(
      'sprout-server: `start` wants the config after `--config`: --config server.toml\n',
    );
    return 1;
  }
  const format = flag('log-format') ?? 'text';
  if (format !== 'text' && format !== 'json') {
    io.stderr.write('sprout-server: `--log-format` is `text` or `json`.\n');
    return 1;
  }
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    io.stderr.write(`sprout-server: there is no config at ${path}.\n`);
    return 1;
  }
  const read = readConfig(text, path);
  if ('problems' in read) {
    io.stderr.write(`${read.problems.join('\n')}\n`);
    return 1;
  }
  const log = serverLog(
    read.config.logLevel,
    format as LogFormat,
    () => Math.floor(Date.now() / 1000),
    (line) => io.stdout.write(`${line}\n`),
  );
  let running: RunningServer;
  try {
    running = await startServer({ config: read.config, log, watch: rest.includes('--watch') });
  } catch (error) {
    io.stderr.write(`sprout-server: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  await io.stopped;
  await running.close();
  log.write('info', 'stopped');
  return 0;
}
