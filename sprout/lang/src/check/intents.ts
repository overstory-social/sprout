// An intent's steps checked against the whole bundle (the spec's Parsing ›
// Intents): each step's `when` is read before the line runs, against the
// world as the visitor typed into it, with the one typing as `actor`,
// their place as `here`, and each slot typed by what fills the role this
// step gives it, or as an object where this step gives it none. It is a
// guard: a boolean that reads, and may not write, draw or narrate.

import type { Diagnostics } from '../source/diagnostics.js';
import type { KindLookup, KindRef } from '../declare/kinds.js';
import type { ResolvedIntent, ResolvedIntentStep } from '../declare/intents.js';
import type { HereKind } from '../declare/places.js';
import {
  actorBinding,
  hereBinding,
  objectOf,
  OPEN_OBJECT,
  Scope,
  showBindingType,
  type BindingType,
} from './bindings.js';
import { typeOf, type CheckContext } from './check.js';

/** What an intent's steps are checked against. */
export interface IntentSetting {
  readonly kinds: KindLookup;
  /** `sprout.Actor`, which `actor` is typed as; null where the standard library's kind is absent. */
  readonly actor: KindRef | null;
  readonly here: HereKind;
  readonly diagnostics: Diagnostics;
}

/** Check the `when` of each of `intent`'s steps. */
export function checkIntentSteps(intent: ResolvedIntent, setting: IntentSetting): void {
  for (const step of intent.steps) {
    if (step.when !== null) checkStepWhen(intent, step, setting);
  }
}

/** The type a slot has in `step`: what fills the role the step gives it, or an object. */
function slotType(slot: number, step: ResolvedIntentStep): BindingType {
  for (const [role, filled] of step.fillers) {
    if (filled !== slot) continue;
    const filler = step.verb.roles.find((one) => one.name === role)?.filler;
    return filler?.fills === 'kind' ? objectOf(filler.kind) : OPEN_OBJECT;
  }
  return OPEN_OBJECT;
}

function checkStepWhen(
  intent: ResolvedIntent,
  step: ResolvedIntentStep,
  setting: IntentSetting,
): void {
  const when = step.when!;
  const { diagnostics } = setting;
  const scope = Scope.root();
  scope.introduce(actorBinding(setting.actor, when.at), diagnostics);
  scope.introduce(hereBinding(setting.here, when.at), diagnostics);
  intent.slots.forEach((name, slot) => {
    scope.introduce(
      { name, type: slotType(slot, step), origin: 'parameter', at: when.at, writable: false },
      diagnostics,
    );
  });
  const context: CheckContext = {
    scope,
    kinds: setting.kinds,
    from: intent.library,
    self: null,
    diagnostics,
    undrawn: { by: 'step' },
  };
  const type = typeOf(when, context);
  if (type === null) return;
  if (type.binds !== 'value' || type.type.type !== 'boolean') {
    diagnostics.refuse(
      when.at,
      `A step's \`when\` says whether it runs, so it is true or false, and this is ${showBindingType(type)}.`,
      'Write a condition, as in `when (y.get(:locked))`.',
    );
  }
}
