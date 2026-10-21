// What the compiler checks of a `pass` (the spec's Time › Passing time;
// The compiler › What it refuses). How much time passes is an integer,
// typed as any integer is, and counted in seconds when it runs; where it
// is written down it must not be below nothing, nor more seconds than the
// largest integer, and a count worked out at run time that breaks either
// faults then. How much of it the host grants is the host's longest pass
// to say, not the checker's; where a `pass` may stand is `blocks.ts`'s.

import type { PassTimeStatement } from '../syntax/ast.js';
import { INTEGER_MAX } from '../declare/types.js';
import { typeOf, type CheckContext } from './check.js';
import { describeGiven, writtenNumber } from './check/values.js';
import { countedSeconds, mostOf } from './wake.js';

const WORKED_OUT =
  'Work it out as a whole number, as in `pass (self.get(:wait)) minutes`, where `:wait` is an integer.';

/** `pass 90 seconds`, `pass (self.get(:wait)) minutes` — true where the count is an integer and a written one fits. */
export function checkPass(statement: PassTimeStatement, context: CheckContext): boolean {
  const { count, unit } = statement;
  const type = typeOf(count, context);
  if (type === null) return false;
  if (type.binds !== 'value' || type.type.type !== 'integer') {
    context.diagnostics.refuse(
      count.at,
      `How much time passes is a whole number, and ${describeGiven(count, type)}.`,
      WORKED_OUT,
    );
    return false;
  }
  const seconds = countedSeconds(count, unit);
  if (seconds === null) return true;
  if (seconds < 0) {
    context.diagnostics.refuse(
      count.at,
      `\`pass (${writtenNumber(count)}) ${unit}\` passes less than no time at all.`,
      `Pass 0 ${unit} or more.`,
    );
    return false;
  }
  if (seconds <= INTEGER_MAX) return true;
  context.diagnostics.refuse(
    count.at,
    `\`pass ${writtenNumber(count)} ${unit}\` asks for more time than a pass can.`,
    `Pass at most ${mostOf(unit)} ${unit}; the host lets no more than its longest pass go by.`,
  );
  return false;
}
