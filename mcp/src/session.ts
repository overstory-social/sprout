import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import { keeps, type Bundle } from '@overstory/sprout/lang';
import {
  expectationsOf,
  freshStage,
  playStep,
  plays,
  readScript,
  writeScript,
  type Made,
  type Stage,
  type Step,
} from '@overstory/sprout-player';

// One world, freshly loaded on the player's stage, played by agents as
// visitors and only as visitors (`sprout mcp`). What a visitor is given is
// what a person playing reads (the spec's The runtime › Levels): the prose
// written to them, one paragraph to a line, and a fault by its name; lines
// another visitor's turn wrote to them wait in their inbox until their
// next call. Nothing given names a file, a path, a declaration or a
// fault's detail. The host's side is set when the session opens and is
// never a visitor's to see: the seed, the file the session is recorded
// to as a script, each visitor's turn cap, and how far each command moves
// time, as a round of the reference host's clock does: a tick of every
// occupied place, then time advanced and every wake due delivered.

/** What the host sets when a session opens. */
export interface SessionOptions {
  /** The seed every turn starts from until the script sets another; 0 where not given. */
  readonly seed?: number;
  /** Where the session is written as a script after every step, each step expecting all it made. */
  readonly record?: string;
  /** How many commands each visitor may type; unbounded where not given. */
  readonly turnCap?: number;
  /** Seconds each command moves time by, after a tick of every occupied place; none where not given. */
  readonly advancePerTurn?: number;
}

/**
 * A world being played: its stage, what the host set, where the host is
 * told what goes wrong on its side, each visitor's unread lines and
 * commands typed, and the script so far.
 */
export interface Session {
  readonly stage: Stage;
  readonly options: SessionOptions;
  readonly warn: (words: string) => void;
  readonly inboxes: Map<string, string[]>;
  readonly typed: Map<string, number>;
  readonly recorded: Step[];
}

/** What a call gives the visitor who made it: what they read, and whether the call was refused. */
export interface Answer {
  readonly text: string;
  readonly refused: boolean;
}

/**
 * A session over `bundle`'s world as it loads, at time 0 and the seed the
 * host set; `warn` hears what goes wrong on the host's side, which no
 * visitor is told. Thrown where the file to record to cannot be written,
 * before anyone plays.
 */
export function openSession(
  bundle: Bundle,
  options: SessionOptions = {},
  warn: (words: string) => void = () => {},
): Session {
  if (options.record !== undefined) writeFileSync(options.record, writeScript({ steps: [] }));
  const session = freshSession(bundle, options, warn);
  if (options.seed !== undefined) run(session, { seed: options.seed }, null);
  return session;
}

/**
 * The session recorded to `options.record`, played again onto a fresh
 * stage, so a host whose process restarted carries on where it was: a
 * session is its seed and its steps, and the same steps make the same
 * world. Nothing replayed reaches an inbox, and `warn` hears of a step
 * that no longer makes what was recorded. Opened as `openSession` opens
 * one where nothing is recorded there yet.
 */
export function resumeSession(
  bundle: Bundle,
  options: SessionOptions = {},
  warn: (words: string) => void = () => {},
): Session {
  const { record } = options;
  if (record === undefined || !existsSync(record)) return openSession(bundle, options, warn);
  const script = readScript(readFileSync(record, 'utf8'), record);
  const session = freshSession(bundle, options, warn);
  script.steps.forEach((step, i) => {
    const made = playStep(session.stage, step, `${record}, step ${i + 1}`);
    if ('as' in step) session.typed.set(step.as, (session.typed.get(step.as) ?? 0) + 1);
    if (made !== null && plays(step) && step.expect !== undefined) {
      if (!isDeepStrictEqual(expectationsOf(made), step.expect)) {
        warn(`${record}, step ${i + 1}: played again, it does not make what was recorded`);
      }
    }
    session.recorded.push(step);
  });
  return session;
}

/** A session over a fresh stage of `bundle`'s world, with nothing played or recorded. */
function freshSession(
  bundle: Bundle,
  options: SessionOptions,
  warn: (words: string) => void,
): Session {
  return {
    stage: freshStage(bundle),
    options,
    warn,
    inboxes: new Map(),
    typed: new Map(),
    recorded: [],
  };
}

/** Whether `name` stands in the world. */
export function isPresent(session: Session, name: string): boolean {
  const { state } = session.stage;
  const visit = session.stage.visits.get(name);
  const record = visit === undefined ? undefined : state.visitors.get(visit);
  return record !== undefined && Boolean(state.instances.get(record.instance)?.container);
}

/**
 * Play `step`, keep it in the script with all it made, and give each
 * reader what they read of it; a line no reader read, the host's words
 * at the door or a fault's name, goes to `caller`.
 */
function run(session: Session, step: Step, caller: string | null): void {
  const at = `session, step ${session.recorded.length + 1}`;
  const made = playStep(session.stage, step, at);
  session.recorded.push(
    made === null || !plays(step) ? step : { ...step, expect: expectationsOf(made) },
  );
  const { record } = session.options;
  if (record !== undefined) {
    try {
      writeFileSync(record, writeScript({ steps: session.recorded }));
    } catch (error) {
      // The turn has happened; the host is told the recording fell behind, and the visitor is not.
      session.warn(
        `could not record to ${record}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  for (const line of made ?? []) deliver(session, line, caller);
}

/** `line` into its reader's inbox, where a person playing would see it. */
function deliver(session: Session, line: Made, caller: string | null): void {
  if (!keeps('error', line.level)) return;
  const to = line.reader ?? caller;
  // Nobody reads for a visitor who is not here: a returning one starts with an empty inbox.
  if (to === null || (to !== caller && !isPresent(session, to))) return;
  const inbox = session.inboxes.get(to) ?? [];
  inbox.push(line.shown);
  session.inboxes.set(to, inbox);
}

/** Everything waiting for `name`, taken from their inbox, one line apiece. */
function read(session: Session, name: string): string {
  const lines = session.inboxes.get(name) ?? [];
  session.inboxes.set(name, []);
  return lines.join('\n');
}

/** A call the host refuses, in words for the visitor, playing nothing. */
function refused(text: string): Answer {
  return { text, refused: true };
}

/** `name` comes into the world, as a host admits anyone: what they read, or, refused, the host's words turning them away. */
export function arrive(session: Session, name: string): Answer {
  const nickname = name.trim();
  if (nickname === '') return refused('Give a name to arrive as.');
  if (isPresent(session, nickname)) return refused(`${nickname} is already here.`);
  run(session, { arrive: nickname }, nickname);
  // Turned away at the door, they read the host's words and are not bound to the name.
  return { text: read(session, nickname), refused: !isPresent(session, nickname) };
}

/**
 * `name` types `line`, one command turn or several as the line reads;
 * then, where the host set it, every occupied place is ticked and time
 * moves on. What they read, from this and from anything since their last
 * call; refused where they are not here, the line is empty or not one
 * line, or they have typed as many commands as the session allows.
 */
export function say(session: Session, name: string, line: string): Answer {
  if (!isPresent(session, name)) return refused(`${name} is not here: arrive first.`);
  const typed = line.trim();
  if (typed === '') return refused('Say what you do, as in "look" or "take the lamp".');
  if (/[\r\n]/.test(typed)) return refused('Say one line at a time.');
  const count = session.typed.get(name) ?? 0;
  const cap = session.options.turnCap;
  if (cap !== undefined && count >= cap) {
    return refused(`You have taken all ${cap} turns this session allows.`);
  }
  session.typed.set(name, count + 1);
  run(session, { as: name, type: typed }, name);
  const seconds = session.options.advancePerTurn;
  if (seconds !== undefined && seconds > 0) {
    run(session, { tick: true }, name);
    run(session, { advance: `${seconds} seconds` }, name);
  }
  return { text: read(session, name), refused: false };
}

/** `name` leaves; what they read of it, and nothing more is kept for them. */
export function leave(session: Session, name: string): Answer {
  if (!isPresent(session, name)) return refused(`${name} is not here.`);
  run(session, { leave: name }, name);
  const text = read(session, name);
  session.inboxes.delete(name);
  return { text, refused: false };
}
