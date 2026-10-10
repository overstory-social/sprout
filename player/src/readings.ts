import {
  saveWorld,
  SEED_MAX,
  SproutList,
  type InstanceId,
  type RuntimeBudgets,
  type StoredWorld,
  type WrittenAt,
  type Value,
} from '@overstory/sprout/lang';

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
// `skip` so the other runtime does not run it. Times are in seconds, named
// for what they are: `atSeconds` when a step begins, `forSeconds` for how
// long an advance lasts. The file travels beside the script as
// `<script>.readings.json`.

/** A chosen value as JSON: a boolean, a number, a string, or a list of them. */
export type ReadValue = boolean | number | string | readonly ReadValue[] | null;

/** What fills a role of a resolved reading: a `SeenFiller` by id alone, with a value role's chosen value. */
export type ReadFiller =
  | {
      readonly role: string;
      readonly binds: 'object';
      readonly id: InstanceId;
    }
  | {
      readonly role: string;
      readonly binds: 'set';
      readonly ids: readonly InstanceId[];
    }
  | {
      readonly role: string;
      readonly binds: 'exit';
      readonly direction: string | null;
      readonly label: string;
      readonly to: InstanceId;
    }
  | { readonly role: string; readonly binds: 'value'; readonly value: ReadValue }
  | { readonly role: string; readonly binds: 'unbound' };

/** One line a reader read: whose screen, the kind of line it was and its words. */
export interface Said {
  readonly reader: string;
  readonly kind: string;
  readonly words: string;
}

/**
 * What the log keeps of one turn that ran, as a runtime working from the log's inputs reproduces it: the
 * seed it drew from, the instant, whom it was for, how it ended, the fault it ended in, the world's last
 * serial, each effect it told and where its words were written, who it cut short, and, for catch-up,
 * the wakes it delivered, consumed after a fault, and left pending.
 */
export interface TurnEntry {
  readonly kind: Traced['turn'];
  readonly seed: number;
  readonly seconds: number;
  readonly who: string | null;
  readonly outcome: 'done' | 'faulted' | 'refused';
  readonly fault: string | null;
  /** What happened, in the words of the fault's name; null where there was none. */
  readonly detail: string | null;
  readonly serial: number;
  readonly effects: readonly {
    readonly kind: string;
    readonly from: string;
    readonly to: string;
    readonly visit: string;
    readonly paragraphs: readonly string[];
    readonly written: readonly WrittenAt[];
  }[];
  readonly cutShort: readonly string[];
  readonly delivered?: readonly { readonly object: string; readonly serial: number }[];
  readonly faulted?: readonly {
    readonly object: string;
    readonly serial: number;
    readonly fault: string;
    readonly detail: string;
  }[];
  readonly abandoned?: readonly { readonly object: string; readonly serial: number }[];
}

/** What a step left behind it, which a runtime playing the readings is compared with. */
export interface After {
  /** The lines readers read, in order. */
  readonly says: readonly Said[];
  /** Every turn that ran and has an entry in the log, in order. */
  readonly turns: readonly TurnEntry[];
  /** The stored world once the step is over. */
  readonly world: StoredWorld;
}

/** One command turn of a typed line: what the parser made of the text. */
export type ReadTurn =
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
    };

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

function valueOf(value: Value): ReadValue {
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  return value instanceof SproutList ? value.elements.map(valueOf) : null;
}

/** What fills each role: the roles the reading binds in the order it binds them, then the rest, unbound. */
function fillersOf(reading: NonNullable<Traced['reading']>): ReadFiller[] {
  const names = reading.verb.roles.map((role) => role.name);
  const bound = [...reading.bindings.keys()];
  const order = [...bound, ...names.filter((name) => !bound.includes(name))];
  return order.map((name): ReadFiller => {
    const role = { name };
    const bound = reading.bindings.get(role.name);
    if (bound === undefined) return { role: role.name, binds: 'unbound' };
    if ('object' in bound) {
      return { role: role.name, binds: 'object', id: bound.object };
    }
    if ('set' in bound) {
      return { role: role.name, binds: 'set', ids: bound.set };
    }
    if ('exit' in bound) {
      const { direction, label, to } = bound.exit;
      return { role: role.name, binds: 'exit', direction, label, to };
    }
    return { role: role.name, binds: 'value', value: valueOf(bound.value) };
  });
}

/** What `traced` told the readers, one line to each paragraph, by nickname. */
function saysOf(stage: Stage, traced: Traced): Said[] {
  return traced.effects.flatMap((effect) => {
    const reader = stage.state.visitors.get(effect.visit)?.nickname ?? effect.visit;
    return effect.paragraphs.map((words) => ({ reader, kind: effect.kind, words }));
  });
}

/** The entry the log keeps of `traced`. */
function entryOf(traced: Traced): TurnEntry {
  const { logged } = traced;
  const named = (wake: { readonly object: string; readonly serial: number }) => ({
    object: wake.object,
    serial: wake.serial,
  });
  return {
    kind: traced.turn,
    seed: logged.seed,
    seconds: logged.now,
    who: logged.who,
    outcome: logged.outcome === 'closed' ? 'refused' : logged.outcome,
    // Catch-up keeps the faults of its parts, each against its wake, and none of its own.
    fault: traced.turn === 'maintenance' ? null : (traced.faults[0]?.name ?? null),
    detail: traced.turn === 'maintenance' ? null : (traced.faults[0]?.detail ?? null),
    serial: logged.serial,
    effects: traced.effects.map((effect) => ({
      kind: effect.kind,
      from: effect.from,
      to: effect.to,
      visit: effect.visit,
      paragraphs: [...effect.paragraphs],
      written: effect.written.map((where) => ({ ...where })),
    })),
    cutShort: [...logged.cut],
    ...(logged.wakes === null
      ? {}
      : {
          delivered: logged.wakes.delivered.map(named),
          faulted: logged.wakes.faulted.map(({ wake, fault }) => ({
            ...named(wake),
            fault: fault.name,
            detail: fault.detail,
          })),
          abandoned: logged.wakes.abandoned.map(named),
        }),
  };
}

function turnOf(stage: Stage, traced: Traced, seed: number): ReadTurn {
  const typed = traced.typed ?? '';
  // A turn that faulted performed no reading, but the parser made one, and the other runtime runs it.
  const reading = traced.reading ?? traced.read;
  const echo = { says: saysOf(stage, traced), expect: entryOf(traced) };
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
): Readings {
  const stage = freshStage(world, budgets);
  const steps = script.steps.map((step, i): ReadStep => {
    const begins = { index: i, line: lineOf(step), atSeconds: stage.now, seed: stage.seed };
    const from = stage.turns.length;
    playStep(stage, step, `${name}, step ${i + 1}`);
    const ran = stage.turns.slice(from);
    const turns = ran
      .filter((traced) => traced.turn === 'command')
      .map((traced, k) => turnOf(stage, traced, (begins.seed + k) % (SEED_MAX + 1)));
    if ('comment' in step || 'seed' in step) return { ...begins, ...factsOf(step, turns) };
    const after: After = {
      says: ran.flatMap((traced) => saysOf(stage, traced)),
      // A world that admits no one runs no turn, and so has no entry.
      turns: ran.filter((traced) => traced.logged.outcome !== 'closed').map(entryOf),
      world: saveWorld(stage.state),
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
