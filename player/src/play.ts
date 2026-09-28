import {
  arrivalTurn,
  catalogueOf,
  DEFAULT_LIMITS,
  departureTurn,
  dueWakes,
  initialState,
  maintenanceTurn,
  nicknameRefusal,
  occupiedPlaces,
  parseCommand,
  renderEffects,
  tickTurn,
  visitKey,
  wakeTurn,
  commandTurn,
  type Bundle,
  type CommandHost,
  type Effect,
  type Fault,
  type HostSeconds,
  type VisitKey,
  type WorldState,
} from '@overstory/sprout/lang';

import { pathOf, seatReturning, seatingMismatch } from './stand.js';

// `sprout play`: a script of what visitors type and what the host does,
// played through real turns over a freshly loaded world, and the
// transcript it makes (the spec's The runtime › Turns; The host contract
// › Admission and identity, Time). The world runs under the host's
// default limits and no clock. Time starts at 0 and moves only when the
// script says. While anyone stands in the world, every due wake is
// delivered live at the instant it falls due; while nobody does, the
// world waits, and the next arrival's catch-up delivers what fell due
// (the spec's Time › Absence leaves the choice to the host). Each turn's
// seed is the script's, 0 until it sets one.
//
// A script is a transcript. `Marta> take brass key` is Marta typing;
// `@arrive Marta`, `@leave Marta`, `@tick`, `@advance 40 minutes` and
// `@seed 7`, which sets the seed every turn after it is given, are the
// host's; `#` starts a comment, kept as written, and a
// blank line is kept. Every line indented is what the line above it made,
// which playing writes afresh: one line per paragraph each reader read,
// under their nickname and the effect's kind. So a transcript played is
// its own golden, and a changed line is a changed behaviour. `sprout
// test` reads the same script through `playLines`, keeping what the author
// indented under each line as what they expect of it.
//
// `playLine` is one line of that grammar against a `Stage`; `sprout play`
// with no script drives the same `Stage` and `playLine` interactively,
// one line at a time from stdin, so a typed session is a script by
// construction. `playInteractive` is its line, widened to admit a bare
// line (no `Name>` before it) for whoever most recently arrived and
// still stands, which the script grammar itself never admits.

/** What playing gave: the transcript. */
export interface Played {
  readonly page: string;
}

/** One line of what a line made: its text in the transcript, the words where a reader read them, and whether a turn faulted. */
export interface Made {
  readonly text: string;
  readonly words: string | null;
  readonly fault: boolean;
}

/** An indented line as the script holds it, trimmed, and the line number it stands on. */
export interface Written {
  readonly at: number;
  readonly text: string;
}

/**
 * One line of a script and what playing it made: null for a comment, a
 * blank line and `@seed`, which make nothing. `under` is what the script
 * had indented beneath it.
 */
export interface PlayedLine {
  readonly at: number;
  readonly line: string;
  readonly made: readonly Made[] | null;
  readonly under: readonly Written[];
}

/** A script played line by line, and whatever it had indented above its first line. */
export interface PlayedLines {
  readonly lines: readonly PlayedLine[];
  readonly before: readonly Written[];
}

/** The host's side of one play: the world as it stands, the instant, the seed, and each nickname's visit. */
export interface Stage {
  readonly host: CommandHost;
  state: WorldState;
  now: HostSeconds;
  seed: number;
  readonly visits: Map<string, VisitKey>;
}

/** `Marta> take brass key`: who types it and what they typed. */
const TYPED_LINE = /^([^\s>@#][^>]*)> ?(.*)$/;

const UNITS: Readonly<Record<string, number>> = {
  second: 1,
  seconds: 1,
  minute: 60,
  minutes: 60,
  hour: 3600,
  hours: 3600,
};

/** What a line made, as the transcript writes it: `(nothing)` where nothing was. */
export function heard(made: readonly Made[]): readonly Made[] {
  return made.length === 0 ? [hostLineOf('(nothing)')] : made;
}

/** A line the host writes, which no reader read. */
function hostLineOf(text: string): Made {
  return { text, words: null, fault: false };
}

/** `effects`, one line to each paragraph each reader read, under the reader's nickname and the kind. */
function effectLines(stage: Stage, effects: readonly Effect[]): Made[] {
  return effects.flatMap((effect) => {
    const reader = stage.state.visitors.get(effect.visit)?.nickname ?? effect.visit;
    return effect.paragraphs.map((words) => ({
      text: `${reader} (${effect.kind}): ${words}`,
      words,
      fault: false,
    }));
  });
}

/** A fault as the host would log it, against the object it names. */
function faultLine(stage: Stage, what: string, fault: Fault): Made {
  const against =
    fault.object === null ? '' : `, against ${pathOf(stage.state.world, fault.object)}`;
  return {
    text: `${what} faulted${against}, ${fault.name}: ${fault.detail}`,
    words: null,
    fault: true,
  };
}

/** The inputs a write turn is handed now. */
function inputs(stage: Stage): { seed: number; mayHold: null; now: HostSeconds } {
  return { seed: stage.seed, mayHold: null, now: stage.now };
}

/**
 * `@arrive Marta`: catch-up, then the arrival, as a host admits anyone.
 * `at` seats them as a returning visitor to that place first, as the
 * interactive session's own first line does (`--at`, as `sprout parse`
 * takes it); the script grammar never passes it, since `@arrive` names
 * no place. Thrown where `at` names no place, or does not seat them
 * there, since both are a bad `--at` rather than a turn's outcome.
 */
export function arrive(stage: Stage, nickname: string, at?: string): Made[] {
  const visit = stage.visits.get(nickname) ?? visitKey(`visit:${nickname}`);
  const { catalogue } = stage.host;
  const refused = nicknameRefusal(stage.state, catalogue, stage.host.budgets, visit, nickname);
  if (refused !== null) return [hostLineOf(`nickname refused: ${refused.words}`)];
  // Reinserted, not merely set, so a returning nickname moves to the end
  // of `visits`' iteration order: `defaultVisitor` reads that order as
  // who arrived most recently, and a `Map` does not reorder a key its
  // `set` already held.
  stage.visits.delete(nickname);
  stage.visits.set(nickname, visit);
  const caught = maintenanceTurn(stage.state, stage.host, inputs(stage));
  stage.state = caught.state;
  const out = [
    ...caught.value.delivered.map((wake) =>
      hostLineOf(
        `caught up: ${pathOf(stage.state.world, wake.object)} woke, ${stage.now - wake.askedAt} seconds after it asked`,
      ),
    ),
    ...caught.value.faulted.map(({ fault }) => faultLine(stage, 'a wake in catch-up', fault)),
    ...caught.value.abandoned.map((wake) =>
      hostLineOf(`left for live time: ${pathOf(stage.state.world, wake.object)}'s wake`),
    ),
  ];
  const { before, wanted } = seatReturning(stage.state, catalogue, at, visit, nickname);
  stage.state = before;
  const arrived = arrivalTurn(stage.state, stage.host, { ...inputs(stage), visit, nickname });
  if (arrived.committed) {
    stage.state = arrived.state;
    if (wanted !== null && arrived.value.entered.place !== wanted) {
      throw seatingMismatch(stage.state.world, at!, arrived.value.entered.place);
    }
    return [...out, ...effectLines(stage, arrived.effects)];
  }
  if ('closed' in arrived) return [...out, hostLineOf(`closed: ${arrived.closed.words}`)];
  if ('refused' in arrived) return [...out, ...effectLines(stage, arrived.effects)];
  return [
    ...out,
    hostLineOf(`not admitted: ${arrived.words}`),
    faultLine(stage, 'the arrival', arrived.fault),
  ];
}

/** `@leave Marta`: a departure turn. */
export function leave(stage: Stage, nickname: string, where: string): Made[] {
  const visit = present(stage, nickname, where);
  const left = departureTurn(stage.state, stage.host, { ...inputs(stage), visit });
  if (left.committed) {
    stage.state = left.state;
    return effectLines(stage, left.effects);
  }
  stage.state = left.quietly.state;
  return [faultLine(stage, 'the departure', left.fault)];
}

/** `Marta> take brass key`: one command turn. */
function command(stage: Stage, nickname: string, text: string, where: string): Made[] {
  const visit = present(stage, nickname, where);
  const turn = commandTurn(stage.state, stage.host, { ...inputs(stage), visit, text });
  if (!turn.committed) {
    return [...effectLines(stage, turn.effects), faultLine(stage, 'the command', turn.fault)];
  }
  stage.state = turn.state;
  const out = effectLines(stage, turn.effects);
  if ('choices' in turn.value && turn.value.choices.length > 0) {
    out.push(hostLineOf(`choices: ${turn.value.choices.map((choice) => choice.line).join(' | ')}`));
  }
  return out;
}

/** `@tick`: one tick turn for each place a visitor stands in, in the host's order. */
function tick(stage: Stage): Made[] {
  const out: Made[] = [];
  for (const place of occupiedPlaces(stage.state)) {
    const turn = tickTurn(stage.state, stage.host, { ...inputs(stage), place });
    if ('unoccupied' in turn) continue;
    if (!turn.committed) {
      out.push(faultLine(stage, `the tick of ${pathOf(stage.state.world, place)}`, turn.fault));
      continue;
    }
    stage.state = turn.state;
    out.push(...effectLines(stage, turn.effects));
  }
  return out;
}

/**
 * `@advance 40 minutes`: time moves on, each wake delivered live at the
 * instant it falls due while anyone stands in the world; while nobody
 * does, wakes wait for the next arrival's catch-up.
 */
function advance(stage: Stage, seconds: number): Made[] {
  const until = stage.now + seconds;
  const out: Made[] = [];
  while (occupiedPlaces(stage.state).length > 0) {
    const [next] = dueWakes(stage.state, until);
    if (next === undefined) break;
    stage.now = Math.max(stage.now, next.dueAt);
    const woken = pathOf(stage.state.world, next.object);
    const turn = wakeTurn(stage.state, stage.host, {
      ...inputs(stage),
      object: next.object,
      serial: next.serial,
    });
    if ('unwoken' in turn) continue;
    if (!turn.committed) {
      stage.state = turn.consumed.state;
      out.push(faultLine(stage, `the wake of ${woken}`, turn.fault));
      continue;
    }
    stage.state = turn.state;
    out.push(hostLineOf(`${woken} woke, ${turn.value.elapsed} seconds after it asked`));
    out.push(...effectLines(stage, turn.effects));
  }
  stage.now = until;
  return out;
}

/** Whether `nickname` is standing in the world under `stage`'s state. */
function isPresent(stage: Stage, nickname: string): boolean {
  const visit = stage.visits.get(nickname);
  const record = visit === undefined ? undefined : stage.state.visitors.get(visit);
  return record !== undefined && Boolean(stage.state.instances.get(record.instance)?.container);
}

/** The visit `nickname` is standing in the world under; thrown where they are not. */
function present(stage: Stage, nickname: string, where: string): VisitKey {
  if (!isPresent(stage, nickname)) {
    throw new Error(
      `${where}: ${nickname} is not in the world: write \`@arrive ${nickname}\` first.`,
    );
  }
  return stage.visits.get(nickname)!;
}

/**
 * Who a bare interactive line addresses: whoever most recently arrived
 * and still stands, arrival order among those who ever have; null where
 * nobody does. The script grammar never needs this, since every typed
 * line names who it is.
 */
export function defaultVisitor(stage: Stage): string | null {
  const arrived = [...stage.visits.keys()];
  for (let i = arrived.length - 1; i >= 0; i--) {
    if (isPresent(stage, arrived[i]!)) return arrived[i]!;
  }
  return null;
}

/**
 * What a host line does, `@` and all, or null for `@seed`, which does
 * nothing of itself; thrown, saying what to write, where it is not one.
 */
function hostLine(stage: Stage, line: string, where: string): Made[] | null {
  const [word, ...rest] = line.slice(1).trim().split(/\s+/);
  const arg = rest.join(' ');
  switch (word) {
    case 'arrive':
    case 'leave':
      if (arg === '')
        throw new Error(`${where}: \`@${word}\` wants a nickname, as in \`@${word} Marta\`.`);
      return word === 'arrive' ? arrive(stage, arg) : leave(stage, arg, where);
    case 'tick':
      if (arg !== '') throw new Error(`${where}: \`@tick\` stands alone.`);
      return tick(stage);
    case 'advance': {
      const [count, unit] = rest;
      const each = unit === undefined ? undefined : UNITS[unit];
      if (rest.length !== 2 || !/^\d+$/.test(count!) || each === undefined) {
        throw new Error(`${where}: write how long passes, as in \`@advance 40 minutes\`.`);
      }
      return advance(stage, Number(count) * each);
    }
    case 'seed':
      if (!/^\d+$/.test(arg)) throw new Error(`${where}: write a whole number, as in \`@seed 7\`.`);
      stage.seed = Number(arg);
      return null;
    default:
      throw new Error(
        `${where}: \`@${word ?? ''}\` is not something the host does here. ` +
          'Write `@arrive`, `@leave`, `@tick`, `@advance` or `@seed`.',
      );
  }
}

/** A fresh stage over `bundle`'s world: as it loads, time at 0, seed 0, nobody yet arrived. */
export function freshStage(bundle: Bundle): Stage {
  const catalogue = catalogueOf(bundle, DEFAULT_LIMITS.caps);
  return {
    host: {
      catalogue,
      budgets: DEFAULT_LIMITS.budgets,
      render: renderEffects,
      parse: parseCommand,
    },
    state: initialState(catalogue),
    now: 0,
    seed: 0,
    visits: new Map(),
  };
}

/**
 * The script grammar's own reading of one line against `stage`: null for
 * a comment, a blank line or `@seed`. Thrown, saying what to write,
 * where the line is neither what someone types, what the host does, nor
 * a comment.
 */
function playLine(stage: Stage, trimmed: string, where: string): readonly Made[] | null {
  if (trimmed === '' || trimmed.startsWith('#')) return null;
  if (trimmed.startsWith('@')) return hostLine(stage, trimmed, where);
  const typed = TYPED_LINE.exec(trimmed);
  if (typed === null) {
    throw new Error(
      `${where}: a line is what someone types, as in \`Marta> take brass key\`, what the host does, ` +
        'as in `@arrive Marta`, or a `#` comment; what a line made is indented under it.',
    );
  }
  return command(stage, typed[1]!.trim(), typed[2]!, where);
}

/**
 * One line typed at the interactive prompt against `stage`: `Marta>
 * take brass key` addresses Marta by name, as the script grammar reads
 * it; a bare `take brass key` addresses whoever `defaultVisitor` names,
 * since the prompt already said whose turn it is. The canonical line it
 * is, with a bare line's addressee filled in, and what it made — the
 * same shape a script line and its made lines are, so the pair, printed,
 * is a script line played again. Thrown, naming where, where nobody
 * stands to address a bare line.
 */
export function playInteractive(
  stage: Stage,
  raw: string,
  where: string,
): { line: string; made: readonly Made[] | null } {
  const trimmed = raw.trimEnd();
  if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('@')) {
    return { line: trimmed, made: playLine(stage, trimmed, where) };
  }
  if (TYPED_LINE.test(trimmed)) {
    return { line: trimmed, made: playLine(stage, trimmed, where) };
  }
  const nickname = defaultVisitor(stage);
  if (nickname === null) {
    throw new Error(`${where}: nobody is standing to hear it: write \`@arrive Marta\` first.`);
  }
  return { line: `${nickname}> ${trimmed}`, made: command(stage, nickname, trimmed, where) };
}

/** Play `script` over a freshly loaded `bundle`, line by line, keeping what each line had indented under it. */
export function playLines(bundle: Bundle, script: string, name = 'the script'): PlayedLines {
  const stage = freshStage(bundle);
  const played: { at: number; line: string; made: readonly Made[] | null; under: Written[] }[] = [];
  const before: Written[] = [];
  const lines = script.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const [i, line] of lines.entries()) {
    const at = i + 1;
    const where = `${name}:${at}`;
    if (/^\s/.test(line) && line.trim() !== '') {
      (played.at(-1)?.under ?? before).push({ at, text: line.trim() });
      continue;
    }
    const trimmed = line.trimEnd();
    played.push({ at, line: trimmed, made: playLine(stage, trimmed, where), under: [] });
  }
  return { lines: played, before };
}

/** Play `script` over a freshly loaded `bundle`: the transcript, each line followed by what it made. */
export function playScript(bundle: Bundle, script: string, name = 'the script'): Played {
  const page = playLines(bundle, script, name).lines.flatMap(({ line, made }) => [
    line,
    ...(made === null ? [] : heard(made).map((one) => `  ${one.text}`)),
  ]);
  return { page: page.map((line) => `${line}\n`).join('') };
}
