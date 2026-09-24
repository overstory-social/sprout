import { z } from 'zod';

import {
  SEED_MAX,
  type Effect,
  type EffectKind,
  type Fault,
  type RuntimeBudgets,
  type TurnHost,
  type WriteInputs,
} from '@overstory/sprout/lang';

// What every entry of the log is built from (the spec's The runtime ›
// The log, Effects, Faults): a turn's inputs, its effects and its fault,
// as zod schemas, since an adapter validates what it reads back. A turn's
// inputs are what the host handed it and everything that decides what it
// does: the seed, the bound on stored instances, its instant, and the
// host's runtime budgets as they were, so a replay under other figures
// still reproduces what ran. The host's clock is not among them: the
// wall-clock backstop is the one thing a replay does not reproduce
// (Limits › Runtime budgets).

const whole = z.number().int().nonnegative();

/** The host's runtime budgets as one turn ran under them. */
export const LoggedBudgets = z.object({
  steps: whole,
  pollSteps: whole,
  output: whole,
  events: whole,
  cascadeDepth: whole,
  passageDepth: whole,
  setRoleObjects: whole,
  spawnsPerTurn: whole,
  shortestWakeSeconds: whole,
  pendingWakesPerObject: whole,
  peoplePerPlace: whole.nullable(),
  wallClockMs: whole.nullable(),
}) satisfies z.ZodType<RuntimeBudgets>;
export type LoggedBudgets = z.infer<typeof LoggedBudgets>;

/** What the host handed one write turn: its seed, its bound, its instant and its budgets. */
export const TurnInputs = z.object({
  seed: z.number().int().min(0).max(SEED_MAX),
  mayHold: whole.nullable(),
  /** When it ran, in whole host seconds. */
  now: whole,
  budgets: LoggedBudgets,
});
export type TurnInputs = z.infer<typeof TurnInputs>;

const EFFECT_KINDS = [
  'said',
  'told',
  'refused',
  'described',
  'notice',
] as const satisfies readonly EffectKind[];

/** One effect as the log keeps it: its kind, where it came from, whose turn, its reader and the words they read. */
export const LoggedEffect = z.object({
  kind: z.enum(EFFECT_KINDS),
  from: z.string().min(1),
  actor: z.string().min(1).nullable(),
  to: z.string().min(1),
  visit: z.string().min(1),
  paragraphs: z.array(z.string()),
});
export type LoggedEffect = z.infer<typeof LoggedEffect>;

/** A fault as the log keeps it: the rule broken, what happened, the object it is about, and whether it is the engine's. */
export const LoggedFault = z.object({
  name: z.string().min(1),
  detail: z.string(),
  object: z.string().min(1).nullable(),
  engine: z.boolean(),
});
export type LoggedFault = z.infer<typeof LoggedFault>;

/** What `host` handed a turn run with `inputs`, as the log keeps it. */
export function inputsOf(inputs: WriteInputs, host: TurnHost): TurnInputs {
  return {
    seed: inputs.seed,
    mayHold: inputs.mayHold,
    now: inputs.now,
    budgets: LoggedBudgets.parse(host.budgets),
  };
}

/** A logged turn's inputs as a turn takes them again. */
export function writeInputsOf(entry: TurnInputs): WriteInputs {
  return { seed: entry.seed, mayHold: entry.mayHold, now: entry.now };
}

/** `effects` as the log keeps them, in order. */
export function loggedEffects(effects: readonly Effect[]): LoggedEffect[] {
  return effects.map((effect) => ({
    kind: effect.kind,
    from: effect.from,
    actor: effect.actor,
    to: effect.to,
    visit: effect.visit,
    paragraphs: [...effect.paragraphs],
  }));
}

/** `fault` as the log keeps it. */
export function loggedFault(fault: Fault): LoggedFault {
  return { name: fault.name, detail: fault.detail, object: fault.object, engine: fault.engine };
}
