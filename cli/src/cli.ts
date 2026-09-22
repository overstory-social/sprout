import { checkWorld, formatCheck, formatCheckJson } from './check.js';
import { initWorld } from './init.js';

// The `sprout` command: two verbs on a microworld folder. Flags are
// `--name value` or `--name=value`; `--flag` alone is true. The first
// bare word is the command, the next the path. `play` and `serve` return
// when the runtime does (B34, B37).

export const USAGE = `sprout — a Sprout microworld on the command line

  sprout init [dir] [--author name]   a folder with sprout.json, a world and a README line
  sprout check [dir] [--json]         compile strictly; problems by file:line:column (or JSON); exit 1 on any
`;

export interface Io {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
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
    } else positional.push(a);
  }
  const [command = null, ...rest] = positional;
  return { command, positional: rest, flags };
}

const defaultIo = (): Io => ({ stdout: process.stdout, stderr: process.stderr });

/** Run the command line; the exit code. */
export function main(argv: readonly string[], io: Io = defaultIo()): number {
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
        const author = typeof flags['author'] === 'string' ? flags['author'] : undefined;
        for (const name of initWorld(dir, author)) {
          say(`wrote ${dir === '.' ? name : `${dir}/${name}`}\n`);
        }
        return 0;
      }
      case 'check': {
        const result = checkWorld(positional[0] ?? '.');
        say(flags['json'] ? formatCheckJson(result) : formatCheck(result));
        return result.ok ? 0 : 1;
      }
      default:
        io.stderr.write(`sprout: no such command "${command}"\n\n${USAGE}`);
        return 1;
    }
  } catch (err) {
    io.stderr.write(`sprout: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
