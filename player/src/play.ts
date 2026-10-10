import {
  arrivalTurn,
  DEFAULT_LIMITS,
  departureTurn,
  dueWakes,
  initialState,
  isPlace,
  maintenanceTurn,
  nicknameRefusal,
  occupiedPlaces,
  parseCommand,
  readerOf,
  renderActed,
  renderEffects,
  tickTurn,
  visitKey,
  wakeTurn,
  commandTurn,
  runLine,
  SEED_MAX,
  type CommandHost,
  type DueWake,
  type Effect,
  type Fault,
  type HostSeconds,
  type InstanceId,
  type Level,
  type Ran,
  type Reading,
  type Said,
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
import { turnSeed } from './seeds.js';
import {
  catalogueFor,
  pathOf,
  seatReturning,
  seatingMismatch,
  type PlayableWorld,
} from './stand.js';

// `sprout play`: a script of what visitors type and what the host does
// (`script.ts`), played through real turns over a freshly loaded world
// (the spec's The runtime › Turns; The host contract › Admission and
// identity, Time). The world runs under the host's default limits and no
// clock. Time starts at 0 and moves only when the script says. While
// anyone stands in the world, every due wake is delivered live at the
// instant it falls due; while nobody does, the world waits, and the next
// arrival's catch-up delivers what fell due (the spec's Time › Absence
// leaves the choice to the host). A step's seed is the script's, 0 until
// it sets one; a line's commands after the first take the next seed each,
// and a tick's or a wake's turn is seeded from it by `turnSeed`.
//
// Playing a script gives it back with every step's `expect` filled in
// with all it made, so a script played is its own golden, and a changed
// expectation is a changed behaviour. `playStep` is one step against a
// `Stage`; `sprout play` with no script drives the same `Stage` one
// typed line at a time, read into the same steps, so what a session
// records is a script by construction.

/**
 * One line of what a line made, at its level (the spec's The runtime ›
 * Levels): its text in the transcript, which is the line in full, the
 * words where a reader read them, and `shown`, the line as a player's
 * screen shows it; `reader` is whose screen, or null for whoever is at
 * the console. An effect is prose, and so are the host's words to someone
 * it keeps at the door; a fault is an error, a reader cut short a
 * warning, and every other note of the host's info.
 */
export interface Made {
  readonly level: Level;
  readonly text: string;
  readonly words: string | null;
  /** The effect's kind where a reader read it, `said` or `told`; null for a host line. */
  readonly kind: string | null;
  readonly shown: string;
  readonly reader: string | null;
}

/**
 * One step of a script and what playing it made: null for a comment and
 * `@seed`, which make nothing; and every turn it ran, in order.
 */
export interface PlayedStep {
  readonly step: Step;
  readonly made: readonly Made[] | null;
  readonly turns: readonly Traced[];
}

/**
 * One turn a step ran, as a report of what a playthrough reached reads it
 * (`report.ts`): its kind; who typed what, for a command; what it said;
 * the handlers and hooks it ran; the reading it performed, the engine
 * line the parser answered with instead, or whether the consent pass
 * refused; its faults, a maintenance turn's one for each part; and every place that held a visitor once it was over, at any depth.
 */
export interface Traced {
  readonly turn: 'arrival' | 'departure' | 'command' | 'tick' | 'wake' | 'maintenance';
  readonly as: string | null;
  readonly typed: string | null;
  readonly effects: readonly Effect[];
  readonly ran: readonly Ran[];
  readonly reading: Reading | null;
  readonly answered: string | null;
  readonly refused: boolean;
  readonly faults: readonly Fault[];
  readonly standing: readonly InstanceId[];
  /** What the log keeps of the turn, which a runtime working from the log's inputs reproduces (`readings.ts`). */
  readonly logged: Logged;
  /** The bounds the parser drew below while it read the line, in order: the turn's stream begins with them. */
  readonly parseDraws: readonly number[];
  /** What the parser said before the reading's own lines. */
  readonly asides: readonly Aside[];
}

/**
 * A line the parser says before the reading's own (the spec's Parsing › Pronouns, Choosing a reading):
 * the world's `pronoun_correction` for a thing a pronoun named, with the pronoun it declares, or the
 * engine's `meant`, telling the actor which thing a reading drawn from a tie took the words to name.
 */
export interface Aside {
  readonly line: 'meant' | 'pronoun_correction';
  readonly thing: InstanceId;
  readonly pronoun: string | null;
}

/**
 * The inputs and outcome a turn's entry in the log keeps beside what it said (the spec's The runtime ›
 * The log): the seed it drew from, the instant, whom it was for, how it ended, who it cut short, the
 * world's last serial once it ended, and, for catch-up, each wake it delivered, consumed or left pending.
 */
export interface Logged {
  readonly seed: number;
  readonly now: HostSeconds;
  readonly who: string | null;
  readonly outcome: 'done' | 'faulted' | 'refused' | 'closed';
  readonly cut: readonly string[];
  readonly serial: number;
  readonly wakes: {
    readonly delivered: readonly DueWake[];
    readonly faulted: readonly { readonly wake: DueWake; readonly fault: Fault }[];
    readonly abandoned: readonly DueWake[];
  } | null;
}

/** The host's side of one play: the world as it stands, the instant, the seed, each nickname's visit, and every turn run. */
export interface Stage {
  readonly host: CommandHost;
  state: WorldState;
  now: HostSeconds;
  seed: number;
  readonly visits: Map<string, VisitKey>;
  readonly turns: Traced[];
  /** The bounds the parser drew below reading the command turn now running. */
  readonly parsed: number[];
}

/**
 * Every place that holds a visitor present under `stage`'s state, at any
 * depth out to the world, so one riding a boat is in each river reach the
 * boat stands in; visitors in arrival order, each from their own place out.
 */
function standing(stage: Stage): InstanceId[] {
  const reader = readerOf(stage.state);
  const places: InstanceId[] = [];
  for (const visit of stage.visits.values()) {
    const record = stage.state.visitors.get(visit);
    let at =
      record === undefined ? null : (stage.state.instances.get(record.instance)?.container ?? null);
    while (at !== null) {
      if (isPlace(reader, at) && !places.includes(at)) places.push(at);
      at = stage.state.instances.get(at)?.container ?? null;
    }
  }
  return places;
}

/** What a turn leaves in the log beside what it said, as `stage` stands once it is over. */
function loggedOf(stage: Stage, parts: Partial<Logged> & Pick<Logged, 'seed'>): Logged {
  return {
    now: stage.now,
    who: null,
    outcome: 'done',
    cut: [],
    serial: stage.state.serial,
    wakes: null,
    ...parts,
  };
}

/** The visit that is `id`, for a log that names who was cut short by their visit. */
function visitsOf(stage: Stage, ids: readonly InstanceId[]): string[] {
  return ids.map((id) => {
    for (const record of stage.state.visitors.values())
      if (record.instance === id) return record.visit;
    return id;
  });
}

/** Note a turn `stage` ran, once its state is the turn's outcome. */
function trace(
  stage: Stage,
  turn: Traced['turn'],
  logged: Logged,
  parts: Partial<Omit<Traced, 'turn' | 'standing' | 'logged'>>,
): void {
  stage.turns.push({
    turn,
    as: null,
    typed: null,
    effects: [],
    ran: [],
    reading: null,
    answered: null,
    refused: false,
    faults: [],
    parseDraws: [],
    asides: [],
    ...parts,
    standing: standing(stage),
    logged,
  });
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

/** `effects`, one line to each paragraph each reader read, under the reader's nickname and the kind. */
function effectLines(stage: Stage, effects: readonly Effect[]): Made[] {
  return effects.flatMap((effect) => {
    const reader = stage.state.visitors.get(effect.visit)?.nickname ?? effect.visit;
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

/** A reader by their nickname, or anything else by its path. */
function whoIs(stage: Stage, id: InstanceId): string {
  for (const record of stage.state.visitors.values()) {
    if (record.instance === id) return record.nickname;
  }
  return pathOf(stage.state.world, id);
}

/**
 * A fault as the host would log it, against the object it names; a
 * player's screen shows only its name, as an error.
 */
function faultLine(stage: Stage, what: string, fault: Fault): Made {
  const against =
    fault.object === null ? '' : `, against ${pathOf(stage.state.world, fault.object)}`;
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
  trace(
    stage,
    'maintenance',
    loggedOf(stage, {
      seed: stage.seed,
      wakes: {
        delivered: caught.value.delivered,
        faulted: caught.value.faulted,
        abandoned: caught.value.abandoned,
      },
    }),
    {
      effects: caught.effects,
      ran: caught.value.ran,
      faults: caught.value.faulted.map(({ fault }) => fault),
    },
  );
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
  const traceArrival = (
    logged: Partial<Logged>,
    parts: Partial<Omit<Traced, 'turn' | 'standing' | 'logged'>>,
  ) =>
    trace(stage, 'arrival', loggedOf(stage, { seed: stage.seed, who: visit, ...logged }), {
      as: nickname,
      ...parts,
    });
  if (arrived.committed) {
    stage.state = arrived.state;
    traceArrival(
      { cut: visitsOf(stage, arrived.cutShort) },
      { effects: arrived.effects, ran: arrived.value.drained.ran },
    );
    if (wanted !== null && arrived.value.entered.place !== wanted) {
      throw seatingMismatch(stage.state.world, at!, arrived.value.entered.place);
    }
    return [...out, ...turnLines(stage, arrived)];
  }
  if ('closed' in arrived) {
    traceArrival({ outcome: 'closed' }, { refused: true });
    return [...out, refusedLineOf('closed', arrived.closed.words)];
  }
  if ('refused' in arrived) {
    traceArrival({ outcome: 'refused' }, { effects: arrived.effects, refused: true });
    return [...out, ...effectLines(stage, arrived.effects)];
  }
  traceArrival({ outcome: 'faulted' }, { faults: [arrived.fault] });
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
    trace(
      stage,
      'departure',
      loggedOf(stage, { seed: stage.seed, who: visit, cut: visitsOf(stage, left.cutShort) }),
      { as: nickname, effects: left.effects, ran: left.value.drained?.ran ?? [] },
    );
    return turnLines(stage, left);
  }
  stage.state = left.quietly.state;
  trace(
    stage,
    'departure',
    loggedOf(stage, {
      seed: stage.seed,
      who: visit,
      outcome: 'faulted',
      cut: visitsOf(stage, left.quietly.cutShort),
    }),
    { as: nickname, effects: left.quietly.effects, faults: [left.fault] },
  );
  return [faultLine(stage, 'the departure', left.fault)];
}

/**
 * `Marta> take brass key`: every command turn the line runs, the first
 * seeded as the stage seeds a turn and each after it with the next seed.
 */
function command(stage: Stage, nickname: string, text: string, where: string): Made[] {
  const visit = present(stage, nickname, where);
  const out: Made[] = [];
  let seed = stage.seed;
  runLine(
    { ...inputs(stage), visit, text },
    (typed) => {
      const turn = commandTurn(stage.state, stage.host, typed);
      const traceCommand = (
        logged: Partial<Logged>,
        parts: Partial<Omit<Traced, 'turn' | 'standing' | 'logged'>>,
      ) =>
        trace(
          stage,
          'command',
          loggedOf(stage, { seed: typed.seed, now: typed.now, who: visit, ...logged }),
          { as: nickname, typed: typed.text, parseDraws: [...stage.parsed], ...parts },
        );
      if (!turn.committed) {
        traceCommand({ outcome: 'faulted' }, { effects: turn.effects, faults: [turn.fault] });
        out.push(...effectLines(stage, turn.effects), faultLine(stage, 'the command', turn.fault));
        return turn;
      }
      stage.state = turn.state;
      const { value } = turn;
      traceCommand(
        { cut: visitsOf(stage, turn.cutShort) },
        {
          effects: turn.effects,
          ran: 'drained' in value ? (value.drained?.ran ?? []) : [],
          // A reading that ran, allowed or refused, is the visitor's last.
          reading:
            'acted' in value || 'refused' in value
              ? (stage.state.visitors.get(typed.visit)?.lastReading ?? null)
              : null,
          answered: 'answered' in value ? answeredBy(value.answered) : null,
          refused: 'refused' in value,
          asides: asidesOf(value),
        },
      );
      // A step of an intent that runs is the host's to log at info.
      if ('step' in value && value.step !== null) {
        out.push(hostLineOf(`step: ${value.step.verb.library}.${value.step.verb.name}`));
      }
      out.push(...turnLines(stage, turn));
      // A reading drawn from a tie is the host's to log as a warning.
      if ('drawn' in value && value.drawn !== null) {
        const text = `drawn: the line read ${value.drawn.among} ways that tied, and one was drawn`;
        out.push({ level: 'warning', text, words: null, kind: null, shown: text, reader: null });
      }
      return turn;
    },
    () => (seed = (seed + 1) % (SEED_MAX + 1)),
  );
  return out;
}

/**
 * `@tick`: one tick turn for each place a visitor stands in, in the host's
 * order, each seeded from the stage's seed and the place's path
 * (`turnSeed`), so two places never draw alike.
 */
function tick(stage: Stage): Made[] {
  const out: Made[] = [];
  for (const place of occupiedPlaces(stage.state)) {
    const seed = turnSeed(stage.seed, pathOf(stage.state.world, place), 0);
    const turn = tickTurn(stage.state, stage.host, { ...inputs(stage), seed, place });
    if ('unoccupied' in turn) continue;
    if (!turn.committed) {
      trace(stage, 'tick', loggedOf(stage, { seed, who: place, outcome: 'faulted' }), {
        faults: [turn.fault],
      });
      out.push(faultLine(stage, `the tick of ${pathOf(stage.state.world, place)}`, turn.fault));
      continue;
    }
    stage.state = turn.state;
    trace(
      stage,
      'tick',
      loggedOf(stage, { seed, who: place, cut: visitsOf(stage, turn.cutShort) }),
      { effects: turn.effects, ran: turn.value.drained.ran },
    );
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
  while (occupiedPlaces(stage.state).length > 0) {
    const [next] = dueWakes(stage.state, until);
    if (next === undefined) break;
    stage.now = Math.max(stage.now, next.dueAt);
    const woken = pathOf(stage.state.world, next.object);
    const nth = woke.get(next.object) ?? 0;
    woke.set(next.object, nth + 1);
    const seed = turnSeed(stage.seed, woken, nth);
    const turn = wakeTurn(stage.state, stage.host, {
      ...inputs(stage),
      seed,
      object: next.object,
      serial: next.serial,
    });
    if ('unwoken' in turn) continue;
    if (!turn.committed) {
      stage.state = turn.consumed.state;
      trace(stage, 'wake', loggedOf(stage, { seed, who: next.object, outcome: 'faulted' }), {
        faults: [turn.fault],
      });
      out.push(faultLine(stage, `the wake of ${woken}`, turn.fault));
      continue;
    }
    stage.state = turn.state;
    trace(
      stage,
      'wake',
      loggedOf(stage, { seed, who: next.object, cut: visitsOf(stage, turn.cutShort) }),
      { effects: turn.effects, ran: turn.value.drained.ran },
    );
    out.push(hostLineOf(`${woken} woke, ${turn.value.elapsed} seconds after it asked`));
    out.push(...turnLines(stage, turn));
  }
  stage.now = until;
  return out;
}

/** The lines the parser said before a committed command's own, in the order it said them. */
function asidesOf(value: object): Aside[] {
  if (!('corrected' in value) || !('drawn' in value)) return [];
  const said = (line: Said, name: Aside['line']): Aside | null => {
    const thing = line.bindings.get('thing');
    const pronoun = line.bindings.get('pronoun');
    if (thing === undefined || thing.binds !== 'object') return null;
    return {
      line: name,
      thing: thing.id,
      pronoun:
        pronoun?.binds === 'value' && typeof pronoun.value === 'string' ? pronoun.value : null,
    };
  };
  const drawn = value.drawn as { readonly meant: Said | null } | null;
  return [
    ...(value.corrected as readonly Said[]).map((line) => said(line, 'pronoun_correction')),
    ...(drawn?.meant == null ? [] : [said(drawn.meant, 'meant')]),
  ].filter((one): one is Aside => one !== null);
}

/** The engine line the parser answered a command with, by its passage's name, or its words where they are a string. */
function answeredBy(said: Said): string {
  const { said: speech } = said;
  if ('passage' in speech) return speech.passage.name;
  if ('text' in speech) return speech.text;
  return 'absent' in speech ? speech.absent : speech.recorded.transcript;
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

/** A fresh stage over `world`: as it loads, time at 0, seed 0, nobody yet arrived. */
export function freshStage(world: PlayableWorld): Stage {
  const catalogue = catalogueFor(world);
  const stage: Stage = {
    host: {
      catalogue,
      budgets: DEFAULT_LIMITS.budgets,
      render: renderEffects,
      // The parser's draws are noted, since a runtime that does not parse begins its stream with them.
      parse: (text, actor, context) => {
        stage.parsed.length = 0;
        const recording = {
          below: (n: number): number => {
            stage.parsed.push(n);
            return context.draws.below(n);
          },
        };
        return parseCommand(text, actor, { ...context, draws: recording });
      },
    },
    state: initialState(catalogue),
    now: 0,
    seed: 0,
    visits: new Map(),
    turns: [],
    parsed: [],
  };
  return stage;
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
