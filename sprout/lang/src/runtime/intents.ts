// An intent read from a line, and the steps it plans (the spec's Parsing ›
// Intents). Every step is planned before the line runs, against the world
// as the visitor typed into it: a step whose roles what was bound cannot
// fill, or whose `when` is false, is left out, and the rest are the line's
// readings, each run as a turn of its own. A `when` is read as a guard is,
// with the one typing as `actor`, their place as `here` and each slot by
// its name; a name it reads that is out of range, or destroyed, makes it
// false.

import type { ResolvedIntent, ResolvedIntentStep } from '../declare/intents.js';
import type { Budget } from './budget.js';
import type { Catalogue } from './catalogue.js';
import { boundObject, evaluateCondition, type Evaluated } from './evaluate.js';
import type { InstanceId } from './ids.js';
import { DestroyedReference, NameOutOfRange } from './named.js';
import { fits } from './parser/nouns.js';
import type { PassRule } from './range.js';
import type { Bound, Reading } from './reading.js';
import type { StateReader } from './state.js';

/** A line understood as an intent: which, who typed it, and what fills each slot, by the slot's name. */
export interface IntentReading {
  readonly intent: ResolvedIntent;
  readonly actor: InstanceId;
  readonly bindings: ReadonlyMap<string, Bound>;
}

/** What planning reads: the world as the visitor typed into it, and the turn's meter. */
export interface PlanContext {
  readonly state: StateReader;
  readonly catalogue: Catalogue;
  readonly passes: PassRule<InstanceId>;
  readonly budget: Budget;
}

/** The readings `intended` stands for, in order: each step that can be filled and whose `when` holds. */
export function planIntent(intended: IntentReading, context: PlanContext): Reading[] {
  const planned: Reading[] = [];
  for (const step of intended.intent.steps) {
    const reading = readingOf(step, intended, context.state);
    if (reading !== null && holds(step, intended, context)) planned.push(reading);
  }
  return planned;
}

/** The reading one step makes of what the slots hold; null where a role it gives cannot be filled so. */
function readingOf(
  step: ResolvedIntentStep,
  intended: IntentReading,
  state: StateReader,
): Reading | null {
  const bindings = new Map<string, Bound>();
  for (const [role, slot] of step.fillers) {
    const bound = intended.bindings.get(intended.intent.slots[slot]!);
    const thing =
      bound !== undefined && 'object' in bound ? state.instance(bound.object) : undefined;
    const declared = step.verb.roles.find((one) => one.name === role)!;
    if (thing === undefined || !fits(declared, thing)) return null;
    bindings.set(role, bound!);
  }
  return { verb: step.verb, actor: intended.actor, bindings };
}

/** Whether `step`'s `when` holds now; one it cannot read, a name out of range or destroyed, does not. */
function holds(step: ResolvedIntentStep, intended: IntentReading, context: PlanContext): boolean {
  if (step.when === null) return true;
  const { state, catalogue, passes, budget } = context;
  const bindings = new Map<string, Evaluated>([['actor', boundObject(intended.actor)]]);
  const here = state.instance(intended.actor)?.container ?? null;
  if (here !== null) bindings.set('here', boundObject(here));
  for (const [slot, bound] of intended.bindings) {
    if ('object' in bound) bindings.set(slot, boundObject(bound.object));
  }
  try {
    return evaluateCondition(step.when, {
      state,
      kinds: catalogue.lookup,
      library: intended.intent.library,
      self: intended.actor,
      bindings,
      budget,
      caps: catalogue.caps,
      names: catalogue.names,
      passes,
    });
  } catch (thrown) {
    if (thrown instanceof NameOutOfRange || thrown instanceof DestroyedReference) return false;
    throw thrown;
  }
}
