import { sproutSkill } from '@overstory/sprout';

import { packArchive, readArchive, writeFile } from './archive.js';
import { EXTENSIONS, checkArchive, formatCheck, formatCheckJson } from './check.js';
import { initArchive } from './init.js';
import { play } from './play.js';
import { serve } from './serve.js';
import type { StoreKind } from './store.js';

// The `sprout` command (the split proposal §6): six verbs on a
// microworld archive. Flags are `--name value` or `--name=value`;
// `--flag` alone is true. The first bare word is the command, the next
// the path.

export const USAGE = `sprout — a Sprout microworld on the command line

  sprout init [dir]                          a folder with sprout.json, one room, a README line
  sprout check [dir|zip] [--json]            compile strictly; problems by file:line:column (or JSON); exit 1 on any
  sprout play [dir|zip] [--as name] [--fresh] [--store pglite|memory]
                                             walk it at a prompt; state in .sprout/ beside the folder
  sprout serve [dir|zip] [--port n] [--host h] [--store pglite|memory]
                                             the same on a TCP line protocol, 127.0.0.1:4040 by default (no auth, no TLS)
  sprout pack [dir] -o world.zip             the folder as one archive, checked first
  sprout skill                               the SKILL.md for the language as this sprout speaks it
`;

export interface Io {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  /** Whether stdin is a terminal (history and completion need one). */
  terminal: boolean;
  /** A running server is handed back here instead of blocking (the spec's hook); by default it runs until the process ends. */
  onServe?: (serving: { port: number; host: string; close(): Promise<void> }) => void;
}

export interface Parsed {
  command: string | null;
  positional: string[];
  flags: Record<string, string | true>;
}

export function parseArgs(argv: readonly string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1]!.startsWith('-')) flags[a.slice(2)] = argv[++i]!;
      else flags[a.slice(2)] = true;
    } else if (a === '-o' && i + 1 < argv.length) {
      flags['o'] = argv[++i]!;
    } else positional.push(a);
  }
  const [command = null, ...rest] = positional;
  return { command, positional: rest, flags };
}

function storeKind(flag: string | true | undefined): StoreKind {
  if (flag === undefined || flag === 'pglite') return 'pglite';
  if (flag === 'memory') return 'memory';
  throw new Error(`--store ${String(flag)}: pglite or memory`);
}

const defaultIo = (): Io => ({
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  terminal: process.stdin.isTTY === true,
});

/** Run the command line; the exit code. */
export async function main(argv: readonly string[], io: Io = defaultIo()): Promise<number> {
  const { command, positional, flags } = parseArgs(argv);
  const say = (text: string) => io.stdout.write(text);
  try {
    switch (command) {
      case null:
      case 'help':
      case '--help':
        say(USAGE);
        return command === null ? 1 : 0;
      case 'init': {
        const dir = positional[0] ?? '.';
        for (const name of initArchive(dir))
          say(`wrote ${dir === '.' ? name : `${dir}/${name}`}\n`);
        return 0;
      }
      case 'check': {
        const result = checkArchive(readArchive(positional[0] ?? '.'));
        say(flags['json'] ? formatCheckJson(result) : formatCheck(result));
        return result.ok ? 0 : 1;
      }
      case 'play':
        return play({
          archive: positional[0] ?? '.',
          as: typeof flags['as'] === 'string' ? flags['as'] : 'you',
          fresh: flags['fresh'] === true,
          store: storeKind(flags['store']),
          stateDir: typeof flags['state'] === 'string' ? flags['state'] : undefined,
          input: io.stdin,
          output: io.stdout,
          terminal: io.terminal,
        });
      case 'serve': {
        const serving = await serve({
          archive: positional[0] ?? '.',
          port: typeof flags['port'] === 'string' ? Number(flags['port']) : 4040,
          host: typeof flags['host'] === 'string' ? flags['host'] : '127.0.0.1',
          store: storeKind(flags['store']),
          stateDir: typeof flags['state'] === 'string' ? flags['state'] : undefined,
          log: (line) => io.stderr.write(`${line}\n`),
        });
        if (io.onServe) {
          io.onServe(serving);
          return 0;
        }
        await new Promise<void>((resolve) => {
          const stop = () => void serving.close().then(resolve);
          process.once('SIGINT', stop);
          process.once('SIGTERM', stop);
        });
        return 0;
      }
      case 'pack': {
        const archive = readArchive(positional[0] ?? '.');
        const result = checkArchive(archive);
        if (!result.ok) {
          say(formatCheck(result));
          return 1;
        }
        const out = typeof flags['o'] === 'string' ? flags['o'] : 'world.zip';
        writeFile(out, packArchive(archive));
        say(
          `wrote ${out} (${archive.files.length} files${archive.manifest ? ', sprout.json' : ''})\n`,
        );
        return 0;
      }
      case 'skill':
        say(sproutSkill(EXTENSIONS));
        return 0;
      default:
        io.stderr.write(`sprout: no such command "${command}"\n\n${USAGE}`);
        return 1;
    }
  } catch (err) {
    io.stderr.write(`sprout: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
