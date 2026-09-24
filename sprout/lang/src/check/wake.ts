// What the compiler checks of a `wake` (the spec's Time › Wakes; The
// compiler › What it refuses). The wait is counted in seconds, and must
// be one `elapsed` can carry, since the wake reports at least that much
// when it arrives. How soon a wake may come and how many may be pending
// are the host's, so neither is checked here; where one may stand is
// `blocks.ts`'s.

import type { WakeStatement, WakeUnit } from '../syntax/ast.js';
import { INTEGER_MAX } from '../declare/types.js';
import type { CheckContext } from './check.js';

const SECONDS: Readonly<Record<WakeUnit, number>> = { seconds: 1, minutes: 60, hours: 3600 };

/** The seconds `wake in <n> <unit>` asks to wait. */
export function wakeSeconds(statement: WakeStatement): number {
  return statement.count.value * SECONDS[statement.unit];
}

/** `wake in 3 hours` — true where the wait is one `elapsed` can carry. */
export function checkWake(statement: WakeStatement, context: CheckContext): boolean {
  if (wakeSeconds(statement) <= INTEGER_MAX) return true;
  const most = Math.floor(INTEGER_MAX / SECONDS[statement.unit]);
  context.diagnostics.refuse(
    statement.count.at,
    `\`wake in ${statement.count.value} ${statement.unit}\` waits longer than a wake can.`,
    `Wait at most ${most} ${statement.unit}, and ask again with \`wake in\` when it arrives if it must be longer.`,
  );
  return false;
}
