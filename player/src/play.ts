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
  renderActed,
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
import { pathOf, seatReturning, seatingMismatch } from './stand.js';

// `sprout play`: a script of what visitors type and what the host does
// (`script.ts`), played through real turns over a freshly loaded world
// (the spec's The runtime › Turns; The host contract › Admission and
// identity, Time). The world runs under the host's default limits and no
// clock. Time starts at 0 and moves only when the script says. While
// anyone stands in the world, every due wake is delivered live at the
// instant it falls due; while nobody does, the world waits, and the next
// arrival's catch-up delivers what fell due (the spec's Time › Absence
// leaves the choice to the host). Each turn's seed is the script's, 0
// until it sets one.
//
// Playing a script gives it back with every step's `expect` filled in
// with all it made, so a script played is its own golden, and a changed
// expectation is a changed behaviour. `playStep` is one step against a
// `Stage`; `sprout play` with no script drives the same `Stage` one
// typed line at a time, read into the same steps, so what a session
// records is a script by construction.

/**
 * One line of what a line made: its text in the transcript, the words
 * where a reader read them, and whether a turn faulted. `shown` is the
 * line as a player's screen shows it, or null for the host's own notes;
 * `reader` is whose screen, or null for whoever is at the console.
 */
export interface Made {
  readonly text: string;
  readonly words: string | null;
  readonly fault: boolean;
  /** The effect's kind where a reader read it, `said` or `told`; null for a host line. */
  readonly kind: string | null;
  readonly shown: string | null;
  readonly reader: string | null;
}

/** One step of a script and what playing it made: null for a comment and `@seed`, which make nothing. */
export interface PlayedStep {
  readonly step: Step;
  readonly made: readonly Made[] | null;
}

/** The host's side of one play: the world as it stands, the instant, the seed, and each nickname's visit. */
export interface Stage {
  readonly host: CommandHost;
  state: WorldState;
  now: HostSeconds;
  seed: number;
  readonly visits: Map<string, VisitKey>;
}

/** One interactive line played: the line as the grammar writes it, the step it is, and what it made. */
export interface Interactive {
  readonly line: string;
  readonly step: Step | null;
  readonly made: readonly Made[] | null;
}

/** What a line made, as the transcript writes it: `(nothing)` where nothing was. */
export function heard(made: readonly Made[]): readonly Made[] {
  return made.length === 0 ? [hostLineOf('(nothing)')] : made;
}

/** A line the host writes, which no reader read. */
function hostLineOf(text: string): Made {
  return { text, words: null, fault: false, kind: null, shown: null, reader: null };
}

/** The host refusing someone at the door: its words are shown at the console, whoever was refused. */
function refusedLineOf(what: string, words: string): Made {
  return {
    text: `${what}: ${words}`,
    words: null,
    fault: false,
    kind: null,
    shown: words,
    reader: null,
  };
}

/** `effects`, one line to each paragraph each reader read, under the reader's nickname and the kind. */
function effectLines(stage: Stage, effects: readonly Effect[]): Made[] {
  return effects.flatMap((effect) => {
    const reader = stage.state.visitors.get(effect.visit)?.nickname ?? effect.visit;
    return effect.paragraphs.map((words) => ({
      text: `${reader} (${effect.kind}): ${words}`,
      words,
      fault: false,
      kind: effect.kind,
      shown: words,
      reader,
    }));
  });
}

/**
 * A fault as the host would log it, against the object it names; a
 * player's screen shows only its name, as an error.
 */
function faultLine(stage: Stage, what: string, fault: Fault): Made {
  const against =
    fault.object === null ? '' : `, against ${pathOf(stage.state.world, fault.object)}`;
  return {
    text: `${what} faulted${against}, ${fault.name}: ${fault.detail}`,
    words: null,
    fault: true,
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
  if (refused !== null) return [refusedLineOf('nickname refused', refused.words)];
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
  if ('closed' in arrived) return [...out, refusedLineOf('closed', arrived.closed.words)];
  if ('refused' in arrived) return [...out, ...effectLines(stage, arrived.effects)];
  return [
    ...out,
    refusedLineOf('not admitted', arrived.words),
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
 * What `step` makes against `stage`, or null for a comment and `@seed`,
 * which make nothing; thrown, naming `where`, where it cannot be played.
 */
export function playStep(stage: Stage, step: Step, where: string): Made[] | null {
  if ('comment' in step) return null;
  if ('seed' in step) {
    stage.seed = step.seed;
    return null;
  }
  if ('as' in step) return command(stage, step.as, step.type, where);
  if ('arrive' in step) return arrive(stage, step.arrive);
  if ('leave' in step) return leave(stage, step.leave, where);
  if ('tick' in step) return tick(stage);
  const seconds = secondsOf(step.advance);
  if (seconds === null)
    throw new Error(`${where}: write how long passes, as in \`@advance 40 minutes\`.`);
  return advance(stage, seconds);
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
 * One line typed at the interactive prompt against `stage`, in the typed
 * line grammar: `Marta> take brass key` addresses Marta by name; a bare
 * `take brass key` addresses whoever `defaultVisitor` names, since the
 * prompt already said whose turn it is. The line with a bare line's
 * addressee filled in, the step it is (null for a blank line), and what
 * it made. Thrown, naming where, where nobody stands to address a bare
 * line or the line is none of the grammar's.
 */
export function playInteractive(stage: Stage, raw: string, where: string): Interactive {
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
  if (step === null) return { line: '', step: null, made: null };
  return { line: lineOf(step), step, made: playStep(stage, step, where) };
}

/**
 * What `nickname` typing `text` looks like to `viewer` at the same
 * console: the world's `acted`, rendered for them, or the typed line
 * itself where that renders nothing.
 */
export function actedBy(
  stage: Stage,
  viewer: string,
  nickname: string,
  text: string,
): readonly string[] {
  const visit = stage.visits.get(viewer);
  const actor = stage.state.visitors.get(stage.visits.get(nickname)!)?.instance;
  const rendered =
    visit === undefined || actor === undefined
      ? null
      : renderActed(stage.state, stage.host, visit, actor, text);
  return rendered !== null && rendered.length > 0 ? rendered : [`${nickname}: ${text}`];
}

/** What a step made, as a script expects it: each reader's line whole, and each host line at its level. */
export function expectationsOf(made: readonly Made[]): Expectation[] {
  return made.map((one) =>
    one.reader !== null && one.kind !== null && one.words !== null
      ? { reader: one.reader, kind: one.kind, words: one.words }
      : { level: one.fault ? 'error' : 'info', text: one.text },
  );
}

/** Play `script` over a freshly loaded `bundle`, step by step; thrown, naming the step, where one cannot be played. */
export function playSteps(bundle: Bundle, script: Script, name: string): PlayedStep[] {
  const stage = freshStage(bundle);
  return script.steps.map((step, i) => ({
    step,
    made: playStep(stage, step, `${name}, step ${i + 1}`),
  }));
}

/** `script` played over a freshly loaded `bundle`, every step that plays expecting all it made. */
export function playScript(bundle: Bundle, script: Script, name: string): Script {
  const steps = playSteps(bundle, script, name).map(({ step, made }) =>
    made === null || !plays(step) ? step : { ...step, expect: expectationsOf(made) },
  );
  return script.about === undefined ? { steps } : { about: script.about, steps };
}
