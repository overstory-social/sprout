import { DEFAULT_LIMITS } from '@overstory/sprout/lang';

import type { LoggedEffect, LoggedFault } from '../log/parts.js';

// What the log specs build entries from: a turn's inputs as the log keeps
// them, an effect and a fault. Spec support: the package build leaves it out.

/** A turn's inputs, as the log keeps them: seed 3, no bound, at 9, under the default budgets. */
export const INPUTS = {
  level: 'info',
  seed: 3,
  mayHold: null,
  now: 9,
  budgets: DEFAULT_LIMITS.budgets,
} as const;

/** One line said to Marta in the tally's hall. */
export const SAID: LoggedEffect = {
  kind: 'said',
  level: 'prose',
  from: 'tally.hall.counter',
  actor: 'tally#1',
  to: 'tally#1',
  visit: 'v-marta',
  paragraphs: ['Click.'],
};

/** A fault, as the log keeps one. */
export const FAULTED: LoggedFault = {
  level: 'error',
  name: 'IntegerOverflow',
  detail: '2147483648 is outside the integer range, -2147483648 to 2147483647.',
  object: null,
  engine: false,
  extension: null,
};

/** `entry` through JSON and back, as a store hands it back. */
export const roundTrip = <T>(entry: T): unknown => JSON.parse(JSON.stringify(entry));
