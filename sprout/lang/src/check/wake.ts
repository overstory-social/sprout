// What the compiler checks of a `wake` (the spec's Time › Wakes; The
// compiler › What it refuses). How long it waits is an integer, typed as
// any integer is, and counted in seconds when it runs. Where the count
// is written down the checker can tell more: the wait must not be below
// nothing, and must be one `elapsed` can carry, since the wake reports at
// least that much when it arrives; a count worked out at run time that
// breaks either faults then. How soon a wake may come and how many may be
// pending are the host's, so neither is checked here; where one may stand
// is `blocks.ts`'s.

import type { Expr, TimeUnit, WakeStatement } from '../syntax/ast.js';
import { INTEGER_MAX } from '../declare/types.js';
import { typeOf, type CheckContext } from './check.js';
import { describeGiven, writtenNumber } from './check/values.js';

const SECONDS: Readonly<Record<TimeUnit, number>> = { seconds: 1, minutes: 60, hours: 3600 };

const WORKED_OUT =
  'Work it out as a whole number, as in `wake in (self.get(:delay)) minutes`, where `:delay` is an integer.';

/** The seconds `wake in <n> <unit>` asks to wait, where its count is written down; null where it is worked out. */
export function wakeSeconds(statement: WakeStatement): number | null {
  return countedSeconds(statement.count, statement.unit);
}

/** The seconds a count of `unit` comes to, where the count is written down; null where it is worked out. */
export function countedSeconds(count: Expr, unit: TimeUnit): number | null {
  const written = writtenNumber(count);
  return written === null ? null : written * SECONDS[unit];
}

/** The most of `unit` a count may be, so its seconds stay an integer. */
export function mostOf(unit: TimeUnit): number {
  return Math.floor(INTEGER_MAX / SECONDS[unit]);
}

/** `wake in 3 hours`, `wake in (self.get(:delay)) minutes` — true where the count is an integer and a written one fits. */
export function checkWake(statement: WakeStatement, context: CheckContext): boolean {
  const { count, unit } = statement;
  const type = typeOf(count, context);
  if (type === null) return false;
  if (type.binds !== 'value' || type.type.type !== 'integer') {
    context.diagnostics.refuse(
      count.at,
      `How long a wake waits is a whole number, and ${describeGiven(count, type)}.`,
      WORKED_OUT,
    );
    return false;
  }
  const seconds = wakeSeconds(statement);
  if (seconds === null) return true;
  if (seconds < 0) {
    context.diagnostics.refuse(
      count.at,
      `\`wake in (${writtenNumber(count)}) ${unit}\` waits less than no time at all.`,
      `Wait 0 ${unit} or more; a wait shorter than the host's shortest wake is raised to it.`,
    );
    return false;
  }
  if (seconds <= INTEGER_MAX) return true;
  const most = mostOf(unit);
  context.diagnostics.refuse(
    count.at,
    `\`wake in ${writtenNumber(count)} ${unit}\` waits longer than a wake can.`,
    `Wait at most ${most} ${unit}, and ask again with \`wake in\` when it arrives if it must be longer.`,
  );
  return false;
}
