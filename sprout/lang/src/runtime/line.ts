// A line a visitor typed, as the command turns it runs (the spec's
// Parsing › Sequences, again and all; Intents). `take key then open
// cabinet` and `take key. open cabinet` are two commands, each its own
// turn. A command's turn may plan the turns after it, which run next, in
// order, before the line's next command: each step of an intent, each
// thing of `all` or of a run, an item of a run whose words its own turn
// reads, and each command `and` joined, which is read from its own words
// on its own turn and may plan turns of its own.
// Every turn after the first has its own seed. A turn that does not let
// the line go on (`lineGoesOn`) ends it, and what ran before stays done.
// The host drives the turns, its store's way, through `commandsOfLine`.

import { lineGoesOn, type Command, type CommandTurn } from './command.js';

/** The commands `text` holds, split at each `.` and each word `then`; the whole line where it holds none. */
export function partsOf(text: string): string[] {
  const parts = text
    .split('.')
    .flatMap((sentence) => sentence.split(/\bthen\b/i))
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return parts.length === 0 ? [text] : parts;
}

/**
 * The command turns `command`'s line runs, each yielded for the host to
 * run and handed back as the turn it made: the first with `command`'s
 * seed, each after it with one from `seed`.
 */
export function* commandsOfLine(
  command: Command,
  seed: () => number,
): Generator<Command, void, CommandTurn> {
  // Each command is made afresh, so none carries a step the caller planned.
  const { visit, mayHold, now } = command;
  let first = true;
  const seedOf = (): number => {
    if (!first) return seed();
    first = false;
    return command.seed;
  };
  for (const text of partsOf(command.text)) {
    if (!(yield* turnsOf({ visit, mayHold, now }, text, seedOf))) return;
  }
}

/**
 * The turns one command runs: its own, then each it planned, in order,
 * a command it joined run with the turns it plans in turn; whether the
 * line goes on after them.
 */
function* turnsOf(
  base: Pick<Command, 'visit' | 'mayHold' | 'now'>,
  text: string,
  seed: () => number,
): Generator<Command, boolean, CommandTurn> {
  let turn = yield { ...base, text, seed: seed() };
  const next = turn.committed && 'next' in turn.value ? turn.value.next : [];
  for (const step of next) {
    if (!lineGoesOn(turn)) return false;
    if ('text' in step) {
      if (!(yield* turnsOf(base, step.text, seed))) return false;
    } else {
      const { planned, reread } = step;
      turn = yield { ...base, text, seed: seed(), planned, ...(reread ? { reread } : {}) };
    }
  }
  return lineGoesOn(turn);
}

/** Every turn `command`'s line runs, each run by `run`, in order. */
export function runLine(
  command: Command,
  run: (command: Command) => CommandTurn,
  seed: () => number,
): CommandTurn[] {
  const turns: CommandTurn[] = [];
  const line = commandsOfLine(command, seed);
  for (let step = line.next(); !step.done;) {
    const turn = run(step.value);
    turns.push(turn);
    step = line.next(turn);
  }
  return turns;
}
