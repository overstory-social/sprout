import { SEED_MAX, SproutList, type InstanceId, type Value } from '@overstory/sprout/lang';

import { freshStage, playStep, type Stage, type Traced } from './play.js';
import { lineOf, secondsOf, type Script, type Step } from './script.js';
import { pathOf, type PlayableWorld } from './stand.js';

// A script read once by the parser, for a runtime that has no parser. Each
// typed line becomes the reading the TypeScript parser resolved for it, in
// the world as the script has made it by then: the verb by its qualified
// name, who acted, and what fills each role by id, shaped as the view's
// `SeenFiller` shapes it (the spec's The runtime › The log). A line the
// parser answered instead of reading, or that faulted while being read, is
// marked `skip` so the other runtime does not run it. The file travels
// beside the script as `<script>.readings.json`.

/** A chosen value as JSON: a boolean, a number, a string, or a list of them. */
export type ReadValue = boolean | number | string | readonly ReadValue[] | null;

/** What fills a role of a resolved reading: a `SeenFiller`, with a value role's chosen value in place of an id. */
export type ReadFiller =
  | {
      readonly role: string;
      readonly binds: 'object';
      readonly id: InstanceId;
      readonly name: string;
    }
  | {
      readonly role: string;
      readonly binds: 'set';
      readonly ids: readonly InstanceId[];
      readonly names: readonly string[];
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
    }
  | {
      readonly typed: string;
      readonly seed: number;
      readonly skip: true;
      /** The parser's own answer (a passage's name or its words), or `faulted`. */
      readonly why: string;
    };

/** One step of the script, with the clock and seed it begins under. */
export type ReadStep = {
  readonly index: number;
  readonly line: string;
  /** Host seconds on the fake clock when the step begins. */
  readonly now: number;
  /** The seed the step's first turn is drawn under; each turn after it takes the next. */
  readonly seed: number;
} & Facts;

/** What kind of step it is, and what that kind carries. */
export type Facts =
  | { readonly kind: 'comment' }
  | { readonly kind: 'seed' }
  | { readonly kind: 'arrive' | 'leave'; readonly nickname: string }
  | { readonly kind: 'tick' }
  | { readonly kind: 'advance'; readonly seconds: number }
  | { readonly kind: 'command'; readonly nickname: string; readonly turns: readonly ReadTurn[] };

/** The whole file. */
export interface Readings {
  readonly format: 1;
  readonly script: string;
  readonly steps: readonly ReadStep[];
}

function valueOf(value: Value): ReadValue {
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  return value instanceof SproutList ? value.elements.map(valueOf) : null;
}

function fillersOf(stage: Stage, reading: NonNullable<Traced['reading']>): ReadFiller[] {
  const named = (id: InstanceId): string => pathOf(stage.state.world, id);
  return reading.verb.roles.map((role): ReadFiller => {
    const bound = reading.bindings.get(role.name);
    if (bound === undefined) return { role: role.name, binds: 'unbound' };
    if ('object' in bound) {
      return { role: role.name, binds: 'object', id: bound.object, name: named(bound.object) };
    }
    if ('set' in bound) {
      return { role: role.name, binds: 'set', ids: bound.set, names: bound.set.map(named) };
    }
    if ('exit' in bound) {
      const { direction, label, to } = bound.exit;
      return { role: role.name, binds: 'exit', direction, label, to };
    }
    return { role: role.name, binds: 'value', value: valueOf(bound.value) };
  });
}

function turnOf(stage: Stage, traced: Traced, seed: number): ReadTurn {
  const typed = traced.typed ?? '';
  const { reading } = traced;
  if (reading !== null) {
    return {
      typed,
      seed,
      skip: false,
      verb: `${reading.verb.library}.${reading.verb.name}`,
      actor: reading.actor,
      fillers: fillersOf(stage, reading),
      refused: traced.refused,
    };
  }
  return { typed, seed, skip: true, why: traced.answered ?? 'faulted' };
}

function factsOf(step: Step, turns: readonly ReadTurn[]): Facts {
  if ('comment' in step) return { kind: 'comment' };
  if ('seed' in step) return { kind: 'seed' };
  if ('as' in step) return { kind: 'command', nickname: step.as, turns };
  if ('arrive' in step) return { kind: 'arrive', nickname: step.arrive };
  if ('leave' in step) return { kind: 'leave', nickname: step.leave };
  if ('tick' in step) return { kind: 'tick' };
  return { kind: 'advance', seconds: secondsOf(step.advance) ?? 0 };
}

/**
 * `script` played over a freshly loaded `world`, each typed line as the
 * readings the parser made of it; thrown, naming the step, where a step
 * cannot be played.
 */
export function resolveScript(world: PlayableWorld, script: Script, name: string): Readings {
  const stage = freshStage(world);
  const steps = script.steps.map((step, i): ReadStep => {
    const begins = { index: i, line: lineOf(step), now: stage.now, seed: stage.seed };
    const from = stage.turns.length;
    playStep(stage, step, `${name}, step ${i + 1}`);
    const turns = stage.turns
      .slice(from)
      .filter((traced) => traced.turn === 'command')
      .map((traced, k) => turnOf(stage, traced, (begins.seed + k) % (SEED_MAX + 1)));
    return { ...begins, ...factsOf(step, turns) };
  });
  return { format: 1, script: name, steps };
}

/** `readings` as the file holds it: one step to a line. */
export function writeReadings(readings: Readings): string {
  const steps = readings.steps.map((step) => `    ${JSON.stringify(step)}`).join(',\n');
  return `{\n  "format": 1,\n  "script": ${JSON.stringify(readings.script)},\n  "steps": [\n${steps}\n  ]\n}\n`;
}
