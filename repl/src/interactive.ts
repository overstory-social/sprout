import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

import type { Bundle } from '@overstory/sprout/lang';

import {
  actedBy,
  arrive,
  defaultVisitor,
  expectationsOf,
  freshStage,
  heard,
  INSPECTOR,
  leave,
  playInteractive,
  plays,
  writeScript,
  type Made,
  type StandOptions,
  type Step,
} from '@overstory/sprout-player';

// `sprout play` with no script (or `-`): the same stage and grammar the
// player gives a script, driven one line at a time from `io`'s stdin
// instead, under the prompt of whoever is standing (the spec's The
// compiler › The command line). The prompt's visitor is whoever most
// recently arrived and still stands, and the screen shows only the prose
// they read, one paragraph to a line, and a fault's name as an error; a
// line typed for someone else shows as the world's `acted`. With
// `debug`, the page is instead what a script of the same lines would
// print, every reader's line and the host's notes indented under it. A
// line typed where stdin is a real terminal is already shown by its own
// echo, right after the prompt; one typed anywhere else is written out
// as a script's line would be. `Ctrl-D` ends the session with a departure
// turn for whoever is still standing, as a last `@leave` would. With
// `record`, the session is also written as a script, each step expecting
// all it made, so playing it back makes the same.

/** The streams a session reads and writes. */
export interface Io {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  /** Where `play` with no script reads typed lines; the process's own stdin unless given another. */
  stdin?: NodeJS.ReadableStream;
}

/** Where and as whom a session stands, whether it prints everything, and where to record it as a script. */
export interface SessionOptions extends StandOptions {
  readonly debug?: boolean;
  readonly record?: string;
}

/** What `made` shows on `viewer`'s screen: the lines they read, and the console's own. */
function shownTo(viewer: string | null, made: readonly Made[]): string[] {
  return made.flatMap((one) =>
    one.shown !== null && (one.reader === null || one.reader === viewer) ? [one.shown] : [],
  );
}

/** `sprout: <message>`, to `io`'s stderr, as `main`'s own catch writes a refusal. */
function refuse(io: Io, err: unknown): 1 {
  io.stderr.write(`sprout: ${err instanceof Error ? err.message : String(err)}\n`);
  return 1;
}

/**
 * Play `bundle` interactively: admit one visitor, `Inspector` unless
 * `options.nickname` names them, seated at `options.at` as a returning
 * visitor where it is given, then take one line at a time from `io`'s
 * stdin until it ends or the last visitor's departure does. The exit
 * code, as `main` returns it for any other command.
 */
export async function playInteractively(
  bundle: Bundle,
  options: SessionOptions,
  io: Io,
): Promise<number> {
  if (options.record !== undefined && options.at !== undefined) {
    return refuse(
      io,
      new Error(
        '--record cannot keep --at: a script brings everyone in where visitors arrive. Leave out --at, ' +
          'and walk there.',
      ),
    );
  }
  const stage = freshStage(bundle);
  const debug = options.debug === true;
  const recorded: Step[] = [];
  const keep = (step: Step | null, made: readonly Made[] | null) => {
    if (step === null) return;
    recorded.push(made === null || !plays(step) ? step : { ...step, expect: expectationsOf(made) });
  };
  const saved = <T>(code: T): T => {
    if (options.record !== undefined)
      writeFileSync(options.record, writeScript({ steps: recorded }));
    return code;
  };
  const write = (lines: readonly string[]) => {
    for (const line of lines) io.stdout.write(`${line}\n`);
  };
  /** What `made` prints: indented under its line in debug, and otherwise what the screen shows. */
  const print = (made: readonly Made[] | null, viewer: string | null) => {
    if (made === null) return;
    write(debug ? heard(made).map((one) => `  ${one.text}`) : shownTo(viewer, made));
  };

  const nickname = options.nickname ?? INSPECTOR;
  try {
    const made = arrive(stage, nickname, options.at);
    keep({ arrive: nickname }, made);
    if (debug) write([`@arrive ${nickname}`]);
    print(made, nickname);
  } catch (err) {
    return refuse(io, err);
  }
  if (defaultVisitor(stage) === null) return saved(0);

  const input = io.stdin ?? process.stdin;
  const tty = (input as NodeJS.ReadStream).isTTY === true;
  const lines = createInterface({ input, terminal: false });
  // A real terminal's own echo shows what is typed right after this, so
  // it must be written before each read, not after — a script line
  // needs no addressee, so nobody standing to default to is not the end
  // of the session, only of a prompt worth showing.
  const prompt = () => {
    const current = defaultVisitor(stage);
    if (tty && current !== null) io.stdout.write(`${current}> `);
  };
  let at = 1;
  try {
    prompt();
    for await (const raw of lines) {
      at += 1;
      const before = defaultVisitor(stage);
      const outcome = playInteractive(stage, raw, `stdin:${at}`);
      keep(outcome.step, outcome.made);
      if (!tty) write([outcome.line]);
      // Whoever the prompt is now watches: an arrival hands the screen to
      // the one who came in, and the last departure leaves it with them.
      const viewer = defaultVisitor(stage) ?? before;
      const { step } = outcome;
      if (!debug && viewer !== null && step !== null && 'as' in step && step.as !== viewer) {
        write(actedBy(stage, viewer, step.as, step.type));
      }
      print(outcome.made, viewer);
      prompt();
    }
  } catch (err) {
    return saved(refuse(io, err));
  } finally {
    lines.close();
  }

  const departing = defaultVisitor(stage);
  if (departing !== null) {
    if (tty) io.stdout.write('\n');
    if (debug) write([`@leave ${departing}`]);
    const made = leave(stage, departing, 'end of session');
    keep({ leave: departing }, made);
    print(made, departing);
  }
  return saved(0);
}
