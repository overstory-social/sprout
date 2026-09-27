import { createInterface } from 'node:readline';

import type { Bundle } from '@overstory/sprout/lang';

import type { Io } from './cli.js';
import {
  arrive,
  defaultVisitor,
  freshStage,
  heard,
  leave,
  playInteractive,
  type Made,
} from './play.js';
import { INSPECTOR, type StandOptions } from './stand.js';

// `sprout play` with no script (or `-`): the same stage and grammar
// `play.ts` gives a script, driven one line at a time from `io`'s stdin
// instead, under the prompt of whoever is standing — the notes' Holes in
// the spec record that interactive play is not in the spec's The
// compiler › The command line (427). A line typed where stdin is a real
// terminal is already shown by its own echo, right after the prompt; one
// typed anywhere else is not, so it is written out under the prompt as a
// script's line would be. Either way the effects it made follow it
// indented, so the page printed is what a script of the same lines
// would print. `Ctrl-D` ends the session with a departure turn for
// whoever is still standing, as a last `@leave` would.

/** `line`, then what `made` gave, as a script's page holds them. */
function announce(io: Io, line: string, made: readonly Made[] | null): void {
  io.stdout.write(`${line}\n`);
  if (made !== null) for (const one of heard(made)) io.stdout.write(`  ${one.text}\n`);
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
  options: StandOptions,
  io: Io,
): Promise<number> {
  const stage = freshStage(bundle);
  const nickname = options.nickname ?? INSPECTOR;
  try {
    announce(io, `@arrive ${nickname}`, arrive(stage, nickname, options.at));
  } catch (err) {
    return refuse(io, err);
  }
  if (defaultVisitor(stage) === null) return 0;

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
      const outcome = playInteractive(stage, raw, `stdin:${at}`);
      if (!tty) io.stdout.write(`${outcome.line}\n`);
      if (outcome.made !== null) {
        for (const one of heard(outcome.made)) io.stdout.write(`  ${one.text}\n`);
      }
      prompt();
    }
  } catch (err) {
    return refuse(io, err);
  } finally {
    lines.close();
  }

  const departing = defaultVisitor(stage);
  if (departing !== null) {
    if (tty) io.stdout.write('\n');
    announce(io, `@leave ${departing}`, leave(stage, departing, 'end of session'));
  }
  return 0;
}
