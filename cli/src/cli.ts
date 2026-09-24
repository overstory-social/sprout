import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { generateSkill, type Bundle } from '@overstory/sprout/lang';

import { checkWorld, formatCheck, formatCheckJson } from './check.js';
import { initWorld } from './init.js';
import { formatGrammar, parseLine } from './parse.js';
import { playScript } from './play.js';
import { catalogueFor, standIn, type StandOptions } from './stand.js';
import { runTests, testFiles } from './test.js';
import { inspectView } from './view.js';

// The `sprout` command: six verbs on a microworld folder, and `skill`,
// the builder's reference this compiler generates from its own tables.
// Flags are `--name value` or `--name=value`; `--flag` alone is true. The
// first bare word is the command, the next the path. Playing
// interactively, and `serve`, are not built.

export const USAGE = `sprout — a Sprout microworld on the command line

  sprout init [dir] [--author name]   a folder with sprout.json, a world and a README line
  sprout check [dir] [--json]         compile strictly; problems by file:line:column (or JSON); exit 1 on any
  sprout parse [dir]                  every phrase the world accepts, in the order they are tried
  sprout parse dir "line" [--at place] [--as name]
                                      what a visitor standing there makes of the line, and whether it is refused
  sprout view [dir] [--at place] [--as name]
                                      what a visitor standing there is shown and could type
  sprout play dir script              play a script of typed lines and host events through real turns;
                                      the transcript, each line followed by what every reader read
  sprout test [dir] [script ...]      run the world's tests, dir/tests/*.txt or the scripts named: each a play script
                                      with what the world should say indented under a line, the whole line or its
                                      words alone, in order; what failed and what the world said; exit 1 on a failure
  sprout skill                        the builder's reference, generated from this compiler's own tables,
                                      as a skill for a model: sprout skill > .claude/skills/sprout/SKILL.md
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

/** The world in `dir`, compiled as `check` compiles it; null, with `check`'s page said, where it is refused. */
function compiled(dir: string, say: (text: string) => void): Bundle | null {
  const result = checkWorld(dir);
  if (result.bundle !== null) return result.bundle;
  say(formatCheck(result));
  return null;
}

/** Where `--at` stands the visitor, and the nickname `--as` gives them. */
function standing(flags: Parsed['flags']): StandOptions {
  const at = flags['at'];
  const as = flags['as'];
  if (at === true) throw new Error('--at wants a place after it, as the world names it: --at hall');
  if (as === true) throw new Error('--as wants a nickname after it: --as Marta');
  return { ...(at === undefined ? {} : { at }), ...(as === undefined ? {} : { nickname: as }) };
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
      case 'parse': {
        const [dir = '.', line] = positional;
        const checked = compiled(dir, say);
        if (checked === null) return 1;
        if (line === undefined) {
          say(formatGrammar(catalogueFor(checked)));
          return 0;
        }
        const parsed = parseLine(line, standIn(checked, standing(flags)));
        say(parsed.page);
        return parsed.ok ? 0 : 1;
      }
      case 'view': {
        const checked = compiled(positional[0] ?? '.', say);
        if (checked === null) return 1;
        const inspected = inspectView(standIn(checked, standing(flags)));
        say(inspected.page);
        return inspected.ok ? 0 : 1;
      }
      case 'play': {
        const [dir = '.', script] = positional;
        if (script === undefined) {
          throw new Error(
            'play wants a script after the folder, as in `sprout play shop opening.txt`: lines like `@arrive Marta` and `Marta> look`.',
          );
        }
        const checked = compiled(dir, say);
        if (checked === null) return 1;
        const text = readFileSync(script === '-' ? 0 : script, 'utf8');
        say(playScript(checked, text, script === '-' ? 'the script' : basename(script)).page);
        return 0;
      }
      case 'test': {
        const [dir = '.', ...named] = positional;
        const checked = compiled(dir, say);
        if (checked === null) return 1;
        const tested = runTests(checked, testFiles(dir, named));
        say(tested.page);
        return tested.ok ? 0 : 1;
      }
      case 'skill':
        say(generateSkill({ usage: USAGE }));
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
