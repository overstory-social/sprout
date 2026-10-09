import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import {
  CARTRIDGE_EXTENSION,
  CartridgeUnreadable,
  DEFAULT_LIMITS,
  emitCartridge,
  generateSkill,
  loadCartridge,
  type Bundle,
} from '@overstory/sprout/lang';
import {
  catalogueFor,
  filledIn,
  playSteps,
  reportOf,
  readScript,
  runTests,
  standIn,
  testFiles,
  writeReport,
  writeScript,
  type PlayableWorld,
  type PlayedRun,
  type StandOptions,
} from '@overstory/sprout-player';
import { playInteractively, type Io } from '@overstory/sprout-repl';

import { checkWorld, formatCheck, formatCheckJson } from './check.js';
import { scaffold, SCAFFOLD_USAGE } from './scaffold/command.js';
import { formatGrammar, parseLine } from './parse.js';
import { clientConnect, mcpServe, serverStart } from './peers.js';
import { inspectView } from './view.js';

// The `sprout` command: six verbs on a microworld folder; `skill`, the
// builder's reference this compiler generates from its own tables; and
// `client`, `server` and `mcp`, handed to the terminal client, the server
// and the MCP host where they are installed. `mcp` says a refused world's
// page on stderr, since its stdout may be the protocol's.
// Flags are `--name value` or `--name=value`; `--flag` alone is true, and
// `--json`, `--debug` and `--write` are always alone. The first bare word
// is the command, the next the path. Every command but `play` with no
// script, `client`, `server` and `mcp` is synchronous; those hand back a
// promise of their exit code rather than the code itself.

export const USAGE = `sprout — a Sprout microworld on the command line

${SCAFFOLD_USAGE}  sprout check [dir] [--json]         compile strictly; problems by file:line:column (or JSON); exit 1 on any
  sprout pack dir [-o world.sproutworld]
                                      compile strictly, then write the world as a cartridge: one file a
                                      runtime loads in place of the source; without -o, <name>.sproutworld
  sprout parse [dir]                  every phrase the world accepts
  sprout parse dir "line" [--at place] [--as name]
                                      what a visitor standing there makes of the line, and whether it is refused
  sprout view [dir] [--at place] [--as name]
                                      what a visitor standing there is shown and could type
  sprout play dir script.json [--write] [--report file.json]    (dir may be a .sproutworld cartridge)
                                      play a script, JSON steps of what visitors type and what the host does,
                                      through real turns, and print it with every step expecting all it made;
                                      --write saves that over the script; --report writes what it reached, what
                                      was misread or faulted, and the prose it never showed, as JSON
  sprout play dir [--at place] [--as name] [--debug] [--record file.json]
                                      play interactively from stdin under one visitor's own prompt, showing
                                      only what that visitor reads, or, with --debug, every reader's lines and
                                      the host's; --record writes the session as a script
  sprout test [dir] [script ...] [--report file.json]    (dir may be a .sproutworld; name its scripts)
                                      run the world's tests, dir/tests/*.json or the scripts named: each a script
                                      whose steps expect what the world should say, a reader's line whole or its
                                      words alone, in order; what failed and what the world said; exit 1 on a failure;
                                      --report writes what they reached between them, as play --report does
  sprout skill                        the builder's reference, generated from this compiler's own tables,
                                      as a skill for a model: sprout skill > .claude/skills/sprout/SKILL.md
  sprout client connect host:port [--world w] [--as name] [--plain]
                                      play on a server as one visitor, in the terminal client; --plain for
                                      lines in and out; needs @overstory/sprout-tui installed
  sprout mcp dir [--http host:port] [--seed n] [--record file.json] [--turn-cap n] [--advance-per-turn 30s]
                                      serve the world to an agent as a visitor and only as a visitor, over MCP:
                                      tools to arrive, say a line and leave, answered with the prose that visitor
                                      reads; stdio for one visitor, --http for several in one world; --record
                                      writes the session as a script; needs @overstory/sprout-mcp installed
  sprout server start --config server.toml [--watch] [--log-format text|json]
                                      serve the worlds the config names until stopped; --watch redeploys a
                                      world when its folder changes; needs @overstory/sprout-server installed
`;

export interface Parsed {
  command: string | null;
  positional: string[];
  flags: Record<string, string | true>;
}

/** Flags that stand alone and never take the word after them as their value. */
const SWITCHES: ReadonlySet<string> = new Set(['json', 'debug', 'write', 'plain', 'watch']);

/** The short flags there are, and the long flag each stands for. */
const SHORT: Readonly<Record<string, string>> = { o: 'out' };

export function parseArgs(argv: readonly string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const short = /^-([a-z])$/.exec(a)?.[1];
    if (short !== undefined && SHORT[short] !== undefined) {
      const value = argv[i + 1];
      if (value !== undefined && !value.startsWith('-')) flags[SHORT[short]!] = argv[++i]!;
      else flags[SHORT[short]!] = true;
    } else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (SWITCHES.has(a.slice(2))) flags[a.slice(2)] = true;
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

/**
 * The world `path` names, to play: a cartridge it is when it ends in
 * `.sproutworld`, loaded; a folder otherwise, compiled as `check` compiles
 * it. Null, with the page or the reason said, where it cannot be.
 */
function playable(path: string, say: (text: string) => void): PlayableWorld | null {
  if (!path.endsWith(CARTRIDGE_EXTENSION)) return compiled(path, say);
  try {
    return loadCartridge(readFileSync(path), { caps: DEFAULT_LIMITS.caps });
  } catch (err) {
    if (!(err instanceof CartridgeUnreadable)) throw err;
    say(`${path}: ${err.message}\n`);
    return null;
  }
}

/** The file `--report` writes to, or null where it is not given. */
function reportFile(flags: Parsed['flags']): string | null {
  const report = flags['report'];
  if (report === true) throw new Error('--report wants a file after it: --report reached.json');
  return report ?? null;
}

/** Write what `runs` reached over `world` to `file`; only a folder's source says what there was to reach. */
function writeReached(world: PlayableWorld, runs: readonly PlayedRun[], file: string): void {
  if (!('manifest' in world)) {
    throw new Error(
      '--report counts what the world declares, which a cartridge does not keep: report over the world folder.',
    );
  }
  writeFileSync(file, writeReport(reportOf(world, runs)));
}

/** Where `--at` stands the visitor, and the nickname `--as` gives them. */
function standing(flags: Parsed['flags']): StandOptions {
  const at = flags['at'];
  const as = flags['as'];
  if (at === true) throw new Error('--at wants a place after it, as the world names it: --at hall');
  if (as === true) throw new Error('--as wants a nickname after it: --as Marta');
  return { ...(at === undefined ? {} : { at }), ...(as === undefined ? {} : { nickname: as }) };
}

const defaultIo = (): Io => ({
  stdout: process.stdout,
  stderr: process.stderr,
  stdin: process.stdin,
});

/** Run the command line; the exit code, or, for `play` with no script, a promise of it. */
export function main(argv: readonly string[], io: Io = defaultIo()): number | Promise<number> {
  const { command, positional, flags } = parseArgs(argv);
  const say = (text: string) => io.stdout.write(text);
  try {
    switch (command) {
      case null:
      case 'help':
      case '--help':
        say(USAGE);
        return command === null ? 1 : 0;
      case 'scaffold': {
        const done = scaffold(positional, flags);
        (done.ok ? io.stdout : io.stderr).write(done.page);
        return done.ok ? 0 : 1;
      }
      case 'check': {
        const result = checkWorld(positional[0] ?? '.');
        say(flags['json'] ? formatCheckJson(result) : formatCheck(result));
        return result.ok ? 0 : 1;
      }
      case 'pack': {
        const dir = positional[0];
        if (dir === undefined) {
          throw new Error(
            'pack wants a world folder, as in `sprout pack myworld -o myworld.sproutworld`.',
          );
        }
        const checked = compiled(dir, say);
        if (checked === null) return 1;
        const out = flags['out'];
        if (out === true) throw new Error('-o wants a file after it: -o myworld.sproutworld');
        const file = out ?? `${checked.manifest.name}${CARTRIDGE_EXTENSION}`;
        const bytes = emitCartridge(checked);
        writeFileSync(file, bytes);
        say(`packed ${checked.manifest.name} into ${file}: ${bytes.length} bytes\n`);
        return 0;
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
        const checked = playable(dir, say);
        if (checked === null) return 1;
        const report = reportFile(flags);
        if (script === undefined || script === '-') {
          if (report !== null) {
            throw new Error(
              '--report reads a script played: record the session with --record walk.json, then ' +
                '`sprout play dir walk.json --report reached.json`.',
            );
          }
          const debug = flags['debug'] !== undefined;
          const record = flags['record'];
          if (record === true)
            throw new Error('--record wants a file after it: --record walk.json');
          return playInteractively(
            checked,
            { ...standing(flags), debug, ...(record === undefined ? {} : { record }) },
            io,
          );
        }
        const name = basename(script);
        const read = readScript(readFileSync(script, 'utf8'), name);
        const steps = playSteps(checked, read, name);
        const played = writeScript(filledIn(read, steps));
        // Printed, the page is the transcript alone, so it can be kept as a golden.
        if (report !== null) writeReached(checked, [{ name, played: steps }], report);
        if (flags['write'] !== undefined) {
          writeFileSync(script, played);
          say(`wrote ${script}\n`);
          if (report !== null) say(`wrote ${report}\n`);
        } else say(played);
        return 0;
      }
      case 'test': {
        const [dir = '.', ...named] = positional;
        const checked = playable(dir, say);
        if (checked === null) return 1;
        if (dir.endsWith(CARTRIDGE_EXTENSION) && named.length === 0) {
          throw new Error(
            'a cartridge carries no tests: name the scripts to run, as in `sprout test world.sproutworld tests/first.json`.',
          );
        }
        const report = reportFile(flags);
        const tested = runTests(checked, testFiles(dir, named));
        say(tested.page);
        if (report !== null) {
          writeReached(checked, tested.runs, report);
          say(`wrote ${report}\n`);
        }
        return tested.ok ? 0 : 1;
      }
      case 'skill':
        say(generateSkill({ usage: USAGE }));
        return 0;
      case 'client':
        return clientConnect(positional, flags, io);
      case 'server':
        return serverStart(argv.slice(1), io);
      case 'mcp': {
        const checked = compiled(positional[0] ?? '.', (text) => io.stderr.write(text));
        if (checked === null) return 1;
        return mcpServe(checked, flags, io);
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
