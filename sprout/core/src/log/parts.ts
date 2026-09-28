import { z } from 'zod';

import {
  SEED_MAX,
  type Effect,
  type EffectKind,
  type Fault,
  type InstanceId,
  type Plain,
  type RuntimeBudgets,
  type TurnHost,
  type WriteInputs,
} from '@overstory/sprout/lang';

// What every entry of the log is built from (the spec's The runtime ›
// The log, Effects, Levels, Faults; Extensions): a turn's inputs, its
// effects, an extension's with its payload, who it cut short, and its
// fault, as zod schemas, since an adapter validates what it reads back.
// Each carries its level: an effect is prose, a fault an error, and a
// reader cut short a warning. A turn's inputs are what the host handed
// it and everything that decides what it does: the seed, the bound on
// stored instances, its instant, and the host's runtime budgets as they
// were, so a replay under other figures still reproduces what ran. The
// host's clock is not among them: the wall-clock backstop is the one
// thing a replay does not reproduce (Limits › Runtime budgets).

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
  extensionEffects: whole.nullable(),
  nicknameCharacters: whole,
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

const PROSE_KINDS = [
  'said',
  'told',
  'refused',
  'described',
  'notice',
] as const satisfies readonly EffectKind[];

/** A payload an extension recorded: JSON's shapes. */
const LoggedPayload: z.ZodType<Plain> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(LoggedPayload),
    z.record(z.string(), LoggedPayload),
  ]),
);

/** What every effect carries: where it came from, whose turn, its reader and the words they read. */
const EffectParts = {
  level: z.literal('prose'),
  from: z.string().min(1),
  actor: z.string().min(1).nullable(),
  to: z.string().min(1),
  visit: z.string().min(1),
  paragraphs: z.array(z.string()),
};

/**
 * One effect as the log keeps it: a line the turn said, by its kind, or
 * what an extension's statement recorded, with the extension, the
 * statement and its payload beside its transcript line.
 */
export const LoggedEffect = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(PROSE_KINDS), ...EffectParts }),
  z.object({
    kind: z.literal('extension'),
    ...EffectParts,
    extension: z.string().min(1),
    statement: z.string().min(1),
    payload: LoggedPayload,
  }),
]);
export type LoggedEffect = z.infer<typeof LoggedEffect>;

/**
 * A fault as the log keeps it: the rule broken, what happened, the object
 * it is about, whether it is the engine's, and the extension it names.
 */
export const LoggedFault = z.object({
  level: z.literal('error'),
  name: z.string().min(1),
  detail: z.string(),
  object: z.string().min(1).nullable(),
  engine: z.boolean(),
  extension: z.string().min(1).nullable(),
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
  return effects.map((effect) => {
    const parts = {
      level: 'prose' as const,
      from: effect.from,
      actor: effect.actor,
      to: effect.to,
      visit: effect.visit,
      paragraphs: [...effect.paragraphs],
    };
    if (effect.kind !== 'extension') return { kind: effect.kind, ...parts };
    const { extension, statement, payload } = effect;
    return { kind: effect.kind, ...parts, extension, statement, payload };
  });
}

/** `fault` as the log keeps it. */
export function loggedFault(fault: Fault): LoggedFault {
  const { name, detail, object, engine, extension } = fault;
  return { level: 'error', name, detail, object, engine, extension };
}

/** Someone a turn's line would have taken past their output, who read nothing more that turn. */
export const LoggedCut = z.object({ level: z.literal('warning'), to: z.string().min(1) });
export type LoggedCut = z.infer<typeof LoggedCut>;

/** `cutShort`, as the log keeps it, in the order it happened. */
export function loggedCuts(cutShort: readonly InstanceId[]): LoggedCut[] {
  return cutShort.map((to) => ({ level: 'warning', to }));
}
