import {
  saveWorld,
  SEED_MAX,
  type InstanceId,
  type Fault,
  type Plain,
  type RuntimeBudgets,
  type StoredChanges,
  type StoredWorld,
  type WrittenAt,
} from '@overstory/sprout/lang';

import { fillerOf, type Handed, type ParseRecord, type ReadFiller } from './parsed.js';
import { freshStage, playStep, type Aside, type Stage, type Traced } from './play.js';
import { lineOf, secondsOf, type Script, type Step } from './script.js';
import type { PlayableWorld } from './stand.js';

// A script read once by the parser, for a runtime that has no parser. Each
// typed line becomes the reading the TypeScript parser resolved for it, in
// the world as the script has made it by then: the verb by its qualified
// name, who acted, and what fills each role, by id only (the spec's The
// runtime › The log). A filler has the fields of the view's `SeenFiller`
// except the words a visitor reads (`name`, `names`), which a runtime
// working from ids does not need; a value role carries the value the
// visitor chose, which `SeenFiller` leaves to `options`. A line the parser
// answered instead of reading, or that faulted while being read, is marked
// `skip` so the other runtime does not run it. Beside each command turn is
// what the parser read (`ParseFacts`), which a runtime that parses compares
// its own parse with (`sproutc parse`). Times are in seconds, named
// for what they are: `atSeconds` when a step begins, `forSeconds` for how
// long an advance lasts. The file travels beside the script as
// `<script>.readings.json`.

/** One line a reader read: whose screen, the kind of line it was and its words. */
export interface Said {
  readonly reader: string;
  readonly kind: string;
  readonly words: string;
}

/** A fault as the language gives it: the rule broken, what happened, the object it is about, whether it is the engine's own, and its extension. */
export interface TurnFault {
  readonly name: string;
  readonly detail: string;
  readonly object: string | null;
  readonly engine: boolean;
  readonly extension: string | null;
}

/**
 * What the log keeps of one turn that ran, as a runtime working from the log's inputs reproduces it: the
 * seed it drew from, the instant, whom it was for (and an arrival's nickname, a wake's serial), how it
 * ended, the fault it ended in, the world's last serial, each effect it told in the language's shape, who
 * it cut short, and, for catch-up, the wakes it delivered, consumed after a fault, and left pending. Beside
 * the entry, what a host is given: what the store writes, null where the turn wrote nothing, and whose views
 * it made stale, null where it faulted.
 */
export interface TurnEntry {
  readonly kind: Traced['turn'];
  readonly seed: number;
  readonly seconds: number;
  readonly who: string | null;
  readonly outcome: 'done' | 'faulted' | 'refused';
  readonly fault: TurnFault | null;
  readonly serial: number;
  readonly nickname?: string;
  readonly wake?: number;
  readonly effects: readonly {
    readonly kind: string;
    readonly from: string;
    readonly actor: string | null;
    readonly to: string;
    readonly visit: string;
    readonly paragraphs: readonly string[];
    readonly written: readonly WrittenAt[];
    /** An extension's effect: what recorded it, and its payload where the runtime holds the extension. */
    readonly extension?: string;
    readonly statement?: string;
    readonly payload?: Plain;
  }[];
  /** Who a line would have taken past their output, by instance. */
  readonly cutShort: readonly string[];
  readonly stale: readonly string[] | null;
  readonly changes: StoredChanges | null;
  readonly delivered?: readonly { readonly object: string; readonly serial: number }[];
  readonly faulted?: readonly {
    readonly object: string;
    readonly serial: number;
    readonly fault: TurnFault;
  }[];
  readonly abandoned?: readonly { readonly object: string; readonly serial: number }[];
}

/** What a step left behind it, which a runtime playing the readings is compared with. */
export interface After {
  /** The lines readers read, in order. */
  readonly says: readonly Said[];
  /** Every turn that ran and has an entry in the log, in order. */
  readonly turns: readonly TurnEntry[];
  /** The stored world once the step is over; absent where the readings were resolved without it, as a profile's are. */
  readonly world?: StoredWorld;
}

/**
 * What a runtime that parses compares its own parse of a turn with: what `host.parse` returned, absent
 * where the turn was not parsed (one that displaced its visitor); the reading and the run's item a later
 * turn of a line was handed; and the stored world a turn after the first in a step began from, which the
 * first takes from the step before (`After.world`).
 */
export interface ParseFacts {
  readonly parsed?: ParseRecord;
  readonly handed?: Handed;
  readonly before?: StoredWorld;
}

/** One command turn of a typed line: what the parser made of the text. */
export type ReadTurn = ParseFacts &
  (
    | {
        readonly typed: string;
        readonly seed: number;
        readonly skip: false;
        readonly verb: string;
        readonly actor: InstanceId;
        readonly fillers: readonly ReadFiller[];
        /** Whether the consent pass refused the reading; the reading is still one to run. */
        readonly refused: boolean;
        /** The bounds the parser drew below reading the line, which a runtime that does not parse draws first. */
        readonly draws: readonly number[];
        /** What the parser said before the reading's own lines. */
        readonly asides: readonly Aside[];
        readonly says: readonly Said[];
        readonly expect: TurnEntry;
      }
    | {
        readonly typed: string;
        readonly seed: number;
        readonly skip: true;
        /** The parser's own answer (a passage's name or its words), or `faulted`. */
        readonly why: string;
        /** What the parser's answer told the reader, and the entry it left, which a runtime that does not parse echoes. */
        readonly says: readonly Said[];
        readonly expect: TurnEntry;
      }
  );

/** One step of the script, with the clock and seed it begins under. */
export type ReadStep = {
  readonly index: number;
  readonly line: string;
  /** Host seconds on the fake clock when the step begins. */
  readonly atSeconds: number;
  /**
   * The step's seed: a command's first turn is drawn under it and each turn
   * after takes the next; a tick's and a wake's turns are seeded from it by `turnSeed`.
   */
  readonly seed: number;
  /** What the step left behind it, once played; absent from a comment and `@seed`. */
  readonly after?: After;
} & Facts;

/** What kind of step it is, and what that kind carries. */
export type Facts =
  | { readonly kind: 'comment' }
  | { readonly kind: 'seed' }
  | { readonly kind: 'arrive' | 'leave'; readonly nickname: string }
  | { readonly kind: 'tick' }
  | { readonly kind: 'advance'; readonly forSeconds: number }
  | { readonly kind: 'command'; readonly nickname: string; readonly turns: readonly ReadTurn[] };

/** The whole file. */
export interface Readings {
  readonly format: 1;
  readonly script: string;
  /** The budgets the script was played under, where they were not the host's defaults; a runtime playing the readings is set to them. */
  readonly budgets?: Partial<RuntimeBudgets>;
  readonly steps: readonly ReadStep[];
}

/** What fills each role: the roles the reading binds in the order it binds them, then the rest, unbound. */
function fillersOf(reading: NonNullable<Traced['reading']>): ReadFiller[] {
  const names = reading.verb.roles.map((role) => role.name);
  const bound = [...reading.bindings.keys()];
  const order = [...bound, ...names.filter((name) => !bound.includes(name))];
  return order.map((name) => fillerOf(name, reading.bindings.get(name)));
}

/** What `traced` told the readers, one line to each paragraph, by nickname. */
function saysOf(stage: Stage, traced: Traced): Said[] {
  return traced.effects.flatMap((effect) => {
    const reader = stage.state.visitors.get(effect.visit)?.nickname ?? effect.visit;
    return effect.paragraphs.map((words) => ({ reader, kind: effect.kind, words }));
  });
}

/** `fault` as the entry keeps it. */
function faultOf(fault: Fault): TurnFault {
  const { name, detail, object, engine, extension } = fault;
  return { name, detail, object, engine, extension };
}

/** The entry the log keeps of `traced`. */
function entryOf(traced: Traced): TurnEntry {
  const { logged } = traced;
  const named = (wake: { readonly object: string; readonly serial: number }) => ({
    object: wake.object,
    serial: wake.serial,
  });
  // Catch-up keeps the faults of its parts, each against its wake, and none of its own.
  const fault = traced.turn === 'maintenance' ? undefined : traced.faults[0];
  return {
    kind: traced.turn,
    seed: logged.seed,
    seconds: logged.now,
    who: logged.who,
    outcome: logged.outcome === 'closed' ? 'refused' : logged.outcome,
    fault: fault === undefined ? null : faultOf(fault),
    serial: logged.serial,
    ...(logged.nickname === null ? {} : { nickname: logged.nickname }),
    ...(logged.wake === null ? {} : { wake: logged.wake }),
    effects: traced.effects.map((effect) => ({
      kind: effect.kind,
      from: effect.from,
      actor: effect.actor,
      to: effect.to,
      visit: effect.visit,
      paragraphs: [...effect.paragraphs],
      written: effect.written.map((where) => ({ ...where })),
      ...(effect.kind === 'extension'
        ? { extension: effect.extension, statement: effect.statement, payload: effect.payload }
        : {}),
    })),
    cutShort: [...logged.cut],
    stale: logged.stale === null ? null : [...logged.stale],
    changes: logged.changes,
    ...(logged.wakes === null
      ? {}
      : {
          delivered: logged.wakes.delivered.map(named),
          faulted: logged.wakes.faulted.map(({ wake, fault }) => ({
            ...named(wake),
            fault: faultOf(fault),
          })),
          abandoned: logged.wakes.abandoned.map(named),
        }),
  };
}

/** What a parser compares with: absent where the turn has none, so a file keeps only what a turn had. */
function parseFactsOf(traced: Traced, worlds: boolean): ParseFacts {
  return {
    ...(traced.parsed === null ? {} : { parsed: traced.parsed }),
    ...(traced.handed === null ? {} : { handed: traced.handed }),
    ...(traced.before === null || !worlds ? {} : { before: saveWorld(traced.before) }),
  };
}

function turnOf(stage: Stage, traced: Traced, seed: number, worlds: boolean): ReadTurn {
  const typed = traced.typed ?? '';
  // A turn that faulted performed no reading, but the parser made one, and the other runtime runs it.
  const reading = traced.reading ?? traced.read;
  const echo = {
    says: saysOf(stage, traced),
    expect: entryOf(traced),
    ...parseFactsOf(traced, worlds),
  };
  if (reading !== null) {
    return {
      typed,
      seed,
      skip: false,
      verb: `${reading.verb.library}.${reading.verb.name}`,
      actor: reading.actor,
      fillers: fillersOf(reading),
      refused: traced.refused,
      draws: [...traced.parseDraws],
      asides: [...traced.asides],
      ...echo,
    };
  }
  return { typed, seed, skip: true, why: traced.answered ?? 'faulted', ...echo };
}

function factsOf(step: Step, turns: readonly ReadTurn[]): Facts {
  if ('comment' in step) return { kind: 'comment' };
  if ('seed' in step) return { kind: 'seed' };
  if ('as' in step) return { kind: 'command', nickname: step.as, turns };
  if ('arrive' in step) return { kind: 'arrive', nickname: step.arrive };
  if ('leave' in step) return { kind: 'leave', nickname: step.leave };
  if ('tick' in step) return { kind: 'tick' };
  return { kind: 'advance', forSeconds: secondsOf(step.advance) ?? 0 };
}

/**
 * `script` played over a freshly loaded `world`, each typed line as the
 * readings the parser made of it; thrown, naming the step, where a step
 * cannot be played.
 */
export function resolveScript(
  world: PlayableWorld,
  script: Script,
  name: string,
  budgets: Partial<RuntimeBudgets> = {},
  { worlds = true }: { readonly worlds?: boolean } = {},
): Readings {
  const stage = freshStage(world, budgets);
  const steps = script.steps.map((step, i): ReadStep => {
    const begins = { index: i, line: lineOf(step), atSeconds: stage.now, seed: stage.seed };
    const from = stage.turns.length;
    playStep(stage, step, `${name}, step ${i + 1}`);
    const ran = stage.turns.slice(from);
    const turns = ran
      .filter((traced) => traced.turn === 'command')
      .map((traced, k) => turnOf(stage, traced, (begins.seed + k) % (SEED_MAX + 1), worlds));
    if ('comment' in step || 'seed' in step) return { ...begins, ...factsOf(step, turns) };
    const after: After = {
      says: ran.flatMap((traced) => saysOf(stage, traced)),
      // A world that admits no one runs no turn, and so has no entry.
      turns: ran.filter((traced) => traced.logged.outcome !== 'closed').map(entryOf),
      ...(worlds ? { world: saveWorld(stage.state) } : {}),
    };
    return { ...begins, ...factsOf(step, turns), after };
  });
  return Object.keys(budgets).length === 0
    ? { format: 1, script: name, steps }
    : { format: 1, script: name, budgets, steps };
}

/** `readings` as the file holds it: one step to a line. */
export function writeReadings(readings: Readings): string {
  const steps = readings.steps.map((step) => `    ${JSON.stringify(step)}`).join(',\n');
  const budgets =
    readings.budgets === undefined ? '' : `  "budgets": ${JSON.stringify(readings.budgets)},\n`;
  return `{\n  "format": 1,\n  "script": ${JSON.stringify(readings.script)},\n${budgets}  "steps": [\n${steps}\n  ]\n}\n`;
}
