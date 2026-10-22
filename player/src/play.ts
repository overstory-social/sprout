import {
  Draws,
  SEED_MAX,
  storedId,
  visitKey,
  type DueWake,
  type Effect,
  type Fault,
  type HostSeconds,
  type InstanceId,
  type RuntimeBudgets,
  type VisitKey,
} from '@overstory/sprout/lang';
import {
  applyChanges,
  emptyState,
  type GivenCommand,
  type LoggedFault,
  type Step as EngineStep,
  type StoredState,
  type TurnEntry,
} from '@overstory/sprout/core';

import {
  lineOf,
  secondsOf,
  stepOfLine,
  TYPED_LINE,
  type Expectation,
  plays,
  type Script,
  type Step,
} from './script.js';
import { keptReadingOf } from './play/reading.js';
import {
  recordsOf,
  trace,
  type Made,
  type PlayedStep,
  type Stage,
  type Traced,
} from './play/traced.js';
import { engineFor, hostFor, type PlayableWorld } from './engine.js';
import { turnSeed } from './seeds.js';
import { pathOf, seatReturning, seatingMismatch } from './stand.js';

// `sprout play`: a script of what visitors type and what the host does
// (`script.ts`), played through real turns over a freshly loaded world
// (the spec's The runtime › Turns; The host contract › Admission and
// identity, Time). The player is a local host: it keeps the world's stored
// state as a store would, and runs every turn, poll and question through
// one engine (core's `Engine`), the C runtime built for WebAssembly. The world runs under the
// host's default limits and no clock. Time starts at 0 and moves only when
// the script says, or when a command asks for time to pass, which this
// host grants whole up to its longest pass. While anyone stands in the world, every due wake is
// delivered live at the instant it falls due; while nobody does, the world
// waits, and the next arrival's catch-up delivers what fell due (the
// spec's Time › Absence leaves the choice to the host). A step's seed is
// the one a seed step just set, and otherwise the next of the mulberry32
// stream begun from the last seed set, 0 at the start (the spec's The
// command line); a line's commands after the first take the next seed
// each, and a tick's or a wake's turn is seeded from it by `turnSeed`.
//
// Playing a script gives it back with every step's `expect` filled in
// with all it made, so a script played is its own golden, and a changed
// expectation is a changed behaviour. `playStep` is one step against a
// `Stage`; `sprout play` with no script drives the same `Stage` one
// typed line at a time, read into the same steps, so what a session
// records is a script by construction.

export type { Made, PlayedStep, Stage, Traced } from './play/traced.js';
export type { TurnFiller, TurnReading } from './play/reading.js';

/** One interactive line read: the line as the grammar writes it, and the step it is. */
export interface Typed {
  readonly line: string;
  readonly step: Step | null;
}

/** What a line made, as the transcript writes it: `(nothing)` where nothing was. */
export function heard(made: readonly Made[]): readonly Made[] {
  return made.length === 0 ? [hostLineOf('(nothing)')] : made;
}

/** A line the host writes, which no reader read. */
function hostLineOf(text: string): Made {
  return { level: 'info', text, words: null, kind: null, shown: text, reader: null };
}

/** The host refusing someone at the door: its words are shown at the console, whoever was refused. */
function refusedLineOf(what: string, words: string): Made {
  return {
    level: 'prose',
    text: `${what}: ${words}`,
    words: null,
    kind: null,
    shown: words,
    reader: null,
  };
}

/** The visitor record `visit` has in `stage`'s stored state, if any. */
function visitorOf(stage: Stage, visit: string) {
  return stage.stored.visitors.find((one) => one.visit === visit);
}

/** `effects`, one line to each paragraph each reader read, under the reader's nickname and the kind. */
function effectLines(stage: Stage, effects: readonly Effect[]): Made[] {
  return effects.flatMap((effect) => {
    const reader = visitorOf(stage, effect.visit)?.nickname ?? effect.visit;
    return effect.paragraphs.map((words) => ({
      level: 'prose' as const,
      text: `${reader} (${effect.kind}): ${words}`,
      words,
      kind: effect.kind,
      shown: words,
      reader,
    }));
  });
}

/**
 * What a committed turn said, and a warning for each reader it cut short
 * past their output, as the host would log it.
 */
function turnLines(
  stage: Stage,
  turn: { readonly effects: readonly Effect[]; readonly cutShort: readonly InstanceId[] },
): Made[] {
  const { output } = stage.host.budgets;
  return [
    ...effectLines(stage, turn.effects),
    ...turn.cutShort.map((id): Made => {
      const text = `${whoIs(stage, id)} was cut short: one turn may say ${output} characters to any one person`;
      return { level: 'warning', text, words: null, kind: null, shown: text, reader: null };
    }),
  ];
}

/** The world's id, which a path is written under. */
function worldOf(stage: Stage): InstanceId {
  return stage.host.catalogue.world;
}

/** A reader by their nickname, or anything else by its path. */
function whoIs(stage: Stage, id: InstanceId): string {
  return (
    stage.stored.visitors.find((one) => one.instance === id)?.nickname ?? pathOf(worldOf(stage), id)
  );
}

/**
 * A fault as the host would log it, against the object it names; a
 * player's screen shows only its name, as an error.
 */
function faultLine(stage: Stage, what: string, fault: Fault): Made {
  const against = fault.object === null ? '' : `, against ${pathOf(worldOf(stage), fault.object)}`;
  return {
    level: 'error',
    text: `${what} faulted${against}, ${fault.name}: ${fault.detail}`,
    words: null,
    kind: null,
    shown: `[error] ${fault.name}`,
    reader: null,
  };
}

/** The inputs a write turn is handed now. */
function inputs(stage: Stage): { seed: number; mayHold: null; now: HostSeconds } {
  return { seed: stage.seed, mayHold: null, now: stage.now };
}

/**
 * Land `step` on `stage` as a store would: its changes written where it
 * wrote any, and the stored state it landed handed back to the engine,
 * which may keep the world live from it.
 */
function land<T>(stage: Stage, step: EngineStep<T>): T {
  if (step.changes !== null) stage.stored = applyChanges(stage.stored, step.changes);
  stage.engine.landed?.(stage.stored);
  return step.turn;
}

/** A fault as the log keeps it, as the language gives it. */
function loggedFaultOf(stage: Stage, fault: LoggedFault): Fault {
  const { name, detail, object, engine, extension } = fault;
  return {
    name,
    detail,
    object: object === null ? null : storedId(worldOf(stage), object),
    engine,
    extension,
  };
}

/** What catch-up did of each wake: delivered, consumed by a fault, or left pending. */
interface CaughtUp {
  readonly delivered: readonly DueWake[];
  readonly faulted: readonly { readonly wake: DueWake; readonly fault: Fault }[];
  readonly abandoned: readonly DueWake[];
}

/** What catch-up did of each wake, as its entry records them, each read whole from the state it began from. */
function caughtUp(stage: Stage, entry: TurnEntry | null, from: StoredState): CaughtUp {
  if (entry === null || entry.kind !== 'maintenance') {
    throw new Error('The engine ran catch-up and logged no maintenance entry for it.');
  }
  const records = recordsOf(from);
  const due = (wake: { readonly object: string; readonly serial: number }): DueWake => {
    const pending = records.get(wake.object)?.wakes?.find((one) => one.serial === wake.serial);
    if (pending === undefined) {
      throw new Error(`Catch-up delivered a wake \`${wake.object}\` was not waiting on.`);
    }
    return { object: storedId(worldOf(stage), wake.object), ...pending };
  };
  return {
    delivered: entry.delivered.map(due),
    faulted: entry.faulted.map((one) => ({
      wake: due(one),
      fault: loggedFaultOf(stage, one.fault),
    })),
    abandoned: entry.abandoned.map(due),
  };
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
  const refused = stage.engine.nicknameRefusal(stage.stored, visit, nickname);
  if (refused !== null) return [refusedLineOf('nickname refused', refused.words)];
  // Reinserted, not merely set, so a returning nickname moves to the end
  // of `visits`' iteration order: `defaultVisitor` reads that order as
  // who arrived most recently, and a `Map` does not reorder a key its
  // `set` already held.
  stage.visits.delete(nickname);
  stage.visits.set(nickname, visit);
  const from = stage.stored;
  const step = stage.engine.maintenance(stage.stored, inputs(stage));
  const caught = land(stage, step);
  const wakes = caughtUp(stage, step.entry, from);
  trace(stage, 'maintenance', {
    effects: caught.effects,
    account: step.account,
    faults: wakes.faulted.map(({ fault }) => fault),
  });
  const world = worldOf(stage);
  const out = [
    ...wakes.delivered.map((wake) =>
      hostLineOf(
        `caught up: ${pathOf(world, wake.object)} woke, ${stage.now - wake.askedAt} seconds after it asked`,
      ),
    ),
    ...wakes.faulted.map(({ fault }) => faultLine(stage, 'a wake in catch-up', fault)),
    ...wakes.abandoned.map((wake) =>
      hostLineOf(`left for live time: ${pathOf(world, wake.object)}'s wake`),
    ),
  ];
  const { before, wanted } = seatReturning(stage.stored, catalogue, at, visit, nickname);
  stage.stored = before;
  const arrival = stage.engine.arrival(stage.stored, { ...inputs(stage), visit, nickname });
  const arrived = land(stage, arrival);
  const traceArrival = (parts: Partial<Omit<Traced, 'turn' | 'standing'>>) =>
    trace(stage, 'arrival', { as: nickname, account: arrival.account, ...parts });
  if (arrived.committed) {
    traceArrival({ effects: arrived.effects });
    const place = stage.engine.standing(stage.stored, visit)?.place.id ?? null;
    if (wanted !== null && place !== wanted) {
      throw seatingMismatch(world, at!, place ?? world);
    }
    return [...out, ...turnLines(stage, arrived)];
  }
  if ('closed' in arrived) {
    traceArrival({});
    return [...out, refusedLineOf('closed', arrived.closed.words)];
  }
  if ('refused' in arrived) {
    traceArrival({ effects: arrived.effects });
    return [...out, ...effectLines(stage, arrived.effects)];
  }
  traceArrival({ faults: [arrived.fault] });
  return [
    ...out,
    refusedLineOf('not admitted', arrived.words),
    faultLine(stage, 'the arrival', arrived.fault),
  ];
}

/** `@leave Marta`: a departure turn. */
export function leave(stage: Stage, nickname: string, where: string): Made[] {
  const visit = present(stage, nickname, where);
  const step = stage.engine.departure(stage.stored, { ...inputs(stage), visit });
  const left = land(stage, step);
  if (left.committed) {
    trace(stage, 'departure', { as: nickname, effects: left.effects, account: step.account });
    return turnLines(stage, left);
  }
  trace(stage, 'departure', {
    as: nickname,
    effects: left.quietly.effects,
    faults: [left.fault],
    account: step.account,
  });
  return [...turnLines(stage, left.quietly), faultLine(stage, 'the departure', left.fault)];
}

/**
 * `Marta> take brass key`: every command turn the line runs, the first
 * seeded as the stage seeds a turn and each after it with the next seed.
 * A turn that asks for time to pass is followed by that much of it, as
 * `@advance` passes it, before the line's next turn (the spec's Time ›
 * Passing time); this host grants all the engine gives.
 */
function command(stage: Stage, nickname: string, text: string, where: string): Made[] {
  const visit = present(stage, nickname, where);
  const out: Made[] = [];
  let seed = stage.seed;
  const line = stage.engine.line(
    { ...inputs(stage), visit, text },
    () => (seed = (seed + 1) % (SEED_MAX + 1)),
    () => stage.now,
  );
  let previous: GivenCommand | null = null;
  for (let typed = line.next(null); typed !== null; typed = line.next(previous)) {
    const step = stage.engine.command(stage.stored, typed);
    const turn = land(stage, step);
    previous = turn;
    const traceCommand = (parts: Partial<Omit<Traced, 'turn' | 'standing'>>) =>
      trace(stage, 'command', {
        as: nickname,
        typed: typed.text,
        account: step.account,
        ...parts,
      });
    if (!turn.committed) {
      traceCommand({ effects: turn.effects, faults: [turn.fault] });
      out.push(...effectLines(stage, turn.effects), faultLine(stage, 'the command', turn.fault));
      continue;
    }
    const { value } = turn;
    const read = 'step' in value ? value : null;
    // A reading that ran, allowed or refused, is the visitor's last.
    const last = read === null ? null : (visitorOf(stage, visit)?.lastReading ?? null);
    const actor = visitorOf(stage, visit)?.instance as InstanceId | undefined;
    traceCommand({
      effects: turn.effects,
      reading: last === null || actor === undefined ? null : keptReadingOf(last, actor),
    });
    // A step of an intent that runs is the host's to log at info.
    if (read !== null && read.step !== null) {
      out.push(hostLineOf(`step: ${read.step.verb.library}.${read.step.verb.name}`));
    }
    out.push(...turnLines(stage, turn));
    // A reading drawn from a tie is the host's to log as a warning.
    if (read !== null && read.drawn !== null) {
      const text = `drawn: the line read ${read.drawn.among} ways that tied, and one was drawn`;
      out.push({ level: 'warning', text, words: null, kind: null, shown: text, reader: null });
    }
    // Time a command asks to pass passes before anything else runs, its line's next turn included.
    if (read !== null && read.passes > 0) {
      out.push(hostLineOf(`passes: ${read.passes} seconds`), ...advance(stage, read.passes));
    }
  }
  return out;
}

/**
 * `@tick`: one tick turn for each place a visitor stands in, in the host's
 * order, each seeded from the stage's seed and the place's path
 * (`turnSeed`), so two places never draw alike.
 */
function tick(stage: Stage): Made[] {
  const out: Made[] = [];
  const world = worldOf(stage);
  for (const place of stage.engine.occupiedPlaces(stage.stored)) {
    const seed = turnSeed(stage.seed, pathOf(world, place), 0);
    const step = stage.engine.tick(stage.stored, { ...inputs(stage), seed, place });
    const turn = land(stage, step);
    if ('unoccupied' in turn) continue;
    if (!turn.committed) {
      trace(stage, 'tick', { faults: [turn.fault], account: step.account });
      out.push(faultLine(stage, `the tick of ${pathOf(world, place)}`, turn.fault));
      continue;
    }
    trace(stage, 'tick', { effects: turn.effects, account: step.account });
    out.push(...turnLines(stage, turn));
  }
  return out;
}

/**
 * `@advance 40 minutes`: time moves on, each wake delivered live at the
 * instant it falls due while anyone stands in the world, seeded from the
 * stage's seed, the woken object's path and how many times it has already
 * woken in this advance (`turnSeed`); while nobody does, wakes wait for the
 * next arrival's catch-up.
 */
function advance(stage: Stage, seconds: number): Made[] {
  const until = stage.now + seconds;
  const out: Made[] = [];
  const woke = new Map<InstanceId, number>();
  const world = worldOf(stage);
  while (stage.engine.occupiedPlaces(stage.stored).length > 0) {
    const [next] = stage.engine.dueWakes(stage.stored, until);
    if (next === undefined) break;
    stage.now = Math.max(stage.now, next.dueAt);
    const woken = pathOf(world, next.object);
    const nth = woke.get(next.object) ?? 0;
    woke.set(next.object, nth + 1);
    const seed = turnSeed(stage.seed, woken, nth);
    const step = stage.engine.wake(stage.stored, {
      ...inputs(stage),
      seed,
      object: next.object,
      serial: next.serial,
    });
    const turn = land(stage, step);
    if ('unwoken' in turn) continue;
    if (!turn.committed) {
      trace(stage, 'wake', { faults: [turn.fault], account: step.account });
      out.push(faultLine(stage, `the wake of ${woken}`, turn.fault));
      continue;
    }
    trace(stage, 'wake', { effects: turn.effects, account: step.account });
    out.push(hostLineOf(`${woken} woke, ${stage.now - next.askedAt} seconds after it asked`));
    out.push(...turnLines(stage, turn));
  }
  stage.now = until;
  return out;
}

/** Whether `nickname` is standing in the world under `stage`'s stored state. */
export function isPresent(stage: Stage, nickname: string): boolean {
  const visit = stage.visits.get(nickname);
  const record = visit === undefined ? undefined : visitorOf(stage, visit);
  if (record === undefined) return false;
  const instance = stage.stored.instances.find((one) => one.id === record.instance);
  return Boolean(instance?.container);
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
 * What `step` makes against `stage`, or null for a comment and `@seed`,
 * which make nothing; thrown, naming `where`, where it cannot be played.
 */
export function playStep(stage: Stage, step: Step, where: string): Made[] | null {
  if ('comment' in step) return null;
  if ('seed' in step) {
    if (step.seed > SEED_MAX) {
      throw new Error(`${where}: a seed is a whole number from 0 to ${SEED_MAX}.`);
    }
    stage.set = step.seed;
    stage.seeds = new Draws(step.seed);
    return null;
  }
  stage.seed = stage.set ?? stage.seeds.below(SEED_MAX + 1);
  stage.set = null;
  if ('as' in step) return command(stage, step.as, step.type, where);
  if ('arrive' in step) return arrive(stage, step.arrive);
  if ('leave' in step) return leave(stage, step.leave, where);
  if ('tick' in step) return tick(stage);
  const seconds = secondsOf(step.advance);
  if (seconds === null)
    throw new Error(`${where}: write how long passes, as in \`@advance 40 minutes\`.`);
  return advance(stage, seconds);
}

/**
 * A fresh stage over `world`: nothing stored
 * yet, time at 0, seed 0, nobody yet arrived, under the host's default
 * budgets, less any `budgets` given instead.
 */
export function freshStage(world: PlayableWorld, budgets: Partial<RuntimeBudgets> = {}): Stage {
  const host = hostFor(world, budgets);
  return {
    host,
    engine: engineFor(world, host),
    stored: emptyState(),
    now: 0,
    seed: 0,
    set: 0,
    seeds: new Draws(0),
    visits: new Map(),
    turns: [],
  };
}

/**
 * One line typed at the interactive prompt against `stage`, in the typed
 * line grammar: `Marta> take brass key` addresses Marta by name; a bare
 * `take brass key` addresses whoever `defaultVisitor` names, since the
 * prompt already said whose turn it is. The line with a bare line's
 * addressee filled in, and the step it is (null, and an empty line, for
 * a blank line); nothing is played. Thrown, naming where, where nobody
 * stands to address a bare line or the line is none of the grammar's.
 */
export function typedStep(stage: Stage, raw: string, where: string): Typed {
  const trimmed = raw.trim();
  const bare = trimmed !== '' && !/^[@#]/.test(trimmed) && !TYPED_LINE.test(trimmed);
  let step: Step | null;
  if (bare) {
    const nickname = defaultVisitor(stage);
    if (nickname === null) {
      throw new Error(`${where}: nobody is standing to hear it: write \`@arrive Marta\` first.`);
    }
    step = { as: nickname, type: trimmed };
  } else step = stepOfLine(trimmed, where);
  return step === null ? { line: '', step: null } : { line: lineOf(step), step };
}

/**
 * What `nickname` typing `text` looks like to `viewer` at the same
 * console: the world's `acted`, which the engine renders for them, or the
 * typed line itself where that renders nothing.
 */
export function actedBy(
  stage: Stage,
  viewer: string,
  nickname: string,
  text: string,
): readonly string[] {
  const visit = stage.visits.get(viewer);
  const actor = stage.visits.get(nickname);
  const rendered =
    visit === undefined || actor === undefined
      ? null
      : stage.engine.acted(stage.stored, visit, actor, text);
  return rendered !== null && rendered.length > 0 ? rendered : [`${nickname}: ${text}`];
}

/** What a step made, as a script expects it: each reader's line whole, and every other line at its level. */
export function expectationsOf(made: readonly Made[]): Expectation[] {
  return made.map((one) =>
    one.reader !== null && one.kind !== null && one.words !== null
      ? { reader: one.reader, kind: one.kind, words: one.words }
      : { level: one.level, text: one.text },
  );
}

/** Play `script` over a freshly loaded `world`, step by step; thrown, naming the step, where one cannot be played. */
export function playSteps(world: PlayableWorld, script: Script, name: string): PlayedStep[] {
  const stage = freshStage(world);
  return script.steps.map((step, i) => {
    const from = stage.turns.length;
    const made = playStep(stage, step, `${name}, step ${i + 1}`);
    return { step, made, turns: stage.turns.slice(from) };
  });
}

/** `script` played over a freshly loaded `world`, every step that plays expecting all it made. */
export function playScript(world: PlayableWorld, script: Script, name: string): Script {
  return filledIn(script, playSteps(world, script, name));
}

/** `script` with every step that played expecting all it made, as `played` gives it. */
export function filledIn(script: Script, played: readonly PlayedStep[]): Script {
  const steps = played.map(({ step, made }) =>
    made === null || !plays(step) ? step : { ...step, expect: expectationsOf(made) },
  );
  return script.about === undefined ? { steps } : { about: script.about, steps };
}
