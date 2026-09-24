// The options a reading's value roles offer (the spec's Verbs › Value
// roles, A role-player narrows its own options; The runtime › The view).
// A value role binds only what some participant's `from` hears, so the
// options are exactly those: for a `symbol` role, the options each
// participant's list property holds now, and for an `integer` role, each
// range a participant's integer property or literal range gives. They are
// the same values `heardBy` accepts, so a chip a client offers is one the
// parser would bind.

import { playsOf, type RoleNarrowing } from '../declare/roles.js';
import type { Budget } from './budget.js';
import { SproutList } from './lists.js';
import { participantsOf, type Reading } from './reading.js';
import type { StateReader } from './state.js';
import type { Value } from './values.js';

/** A whole-number range, both ends included. */
export interface OptionRange {
  readonly min: number;
  readonly max: number;
}

/** What one value role of a reading can be filled with now. */
export type RoleOptions =
  | {
      readonly role: string;
      readonly takes: 'symbol';
      /** Each option some participant hears, first heard first. */
      readonly options: readonly string[];
    }
  | {
      readonly role: string;
      readonly takes: 'integer';
      /** Each range some participant hears, first heard first. */
      readonly ranges: readonly OptionRange[];
    };

/** What reading options reads: the state the participants live in, and the meter. */
export interface OptionsContext {
  readonly state: StateReader;
  readonly budget: Budget;
}

/**
 * The options of each value role of `reading`, in the order the verb
 * declares its roles: every value any participant's `from` hears, one
 * step for each `from` asked. A role nobody narrows has none.
 */
export function valueOptions(reading: Reading, context: OptionsContext): RoleOptions[] {
  const { verb } = reading;
  const participants = participantsOf(reading);
  return verb.roles.flatMap((role): RoleOptions[] => {
    const takes = role.filler?.fills;
    if (takes !== 'symbol' && takes !== 'integer') return [];
    const options: string[] = [];
    const ranges: OptionRange[] = [];
    for (const participant of participants) {
      const self = context.state.instance(participant.id);
      if (self === undefined) continue;
      for (const play of playsOf(self.kind.plays, verb.library, verb.name, participant.role)) {
        const narrowing = play.narrows.get(role.name);
        if (narrowing === undefined) continue;
        context.budget.spend();
        if (takes === 'integer') {
          const range = rangeOf(narrowing);
          if (range !== null && !ranges.some((one) => sameRange(one, range))) ranges.push(range);
          continue;
        }
        for (const option of heldOptions(narrowing, self.properties)) {
          if (!options.includes(option)) options.push(option);
        }
      }
    }
    return [
      takes === 'symbol' ? { role: role.name, takes, options } : { role: role.name, takes, ranges },
    ];
  });
}

/** The range an integer role's `from` hears: its integer property's, or the one written out; null for a list. */
function rangeOf(narrowing: RoleNarrowing): OptionRange | null {
  if (narrowing.narrows === 'range') return { min: narrowing.min, max: narrowing.max };
  const { type } = narrowing.property;
  return type.type === 'integer' ? { min: type.min, max: type.max } : null;
}

/** The options a symbol role's `from` hears: what its list property holds now, in order. */
function heldOptions(
  narrowing: RoleNarrowing,
  properties: ReadonlyMap<string, Value>,
): readonly string[] {
  if (narrowing.narrows !== 'property') return [];
  const held = properties.get(narrowing.property.name);
  if (!(held instanceof SproutList)) return [];
  return held.elements.filter((element): element is string => typeof element === 'string');
}

function sameRange(a: OptionRange, b: OptionRange): boolean {
  return a.min === b.min && a.max === b.max;
}
