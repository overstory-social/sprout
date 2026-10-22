import { z } from 'zod';

import type { WriteInputs } from '@overstory/sprout/lang';

import { LoggedFault, LoggedWarning, TurnInputs, writeInputsOf } from './parts.js';

// A maintenance turn in the log (the spec's The runtime › The log,
// Faults; Time › Absence): the turn's inputs, and each wake catch-up
// delivered, consumed after a fault, or left pending once the budget was
// spent, each by its object and serial, and what they did that nobody was
// told of. Catch-up says nothing, so it has no effects.

const LoggedWake = z.object({ object: z.string().min(1), serial: z.number().int().positive() });

export const MaintenanceEntry = TurnInputs.extend({
  kind: z.literal('maintenance'),
  level: z.literal('info'),
  delivered: z.array(LoggedWake),
  faulted: z.array(LoggedWake.extend({ fault: LoggedFault })),
  abandoned: z.array(LoggedWake),
  /** What the wakes it delivered did that nobody was told of, each a warning. */
  warnings: z.array(LoggedWarning),
});
export type MaintenanceEntry = z.infer<typeof MaintenanceEntry>;

/** The inputs catch-up was run with, as `entry` records them. */
export function maintenanceOf(entry: MaintenanceEntry): WriteInputs {
  return writeInputsOf(entry);
}
