import { z } from 'zod';

import type { CaughtUp, Committed, TurnHost, WriteInputs } from '@overstory/sprout/lang';

import { inputsOf, LoggedFault, loggedFault, TurnInputs, writeInputsOf } from './parts.js';

// A maintenance turn in the log (the spec's The runtime › The log,
// Faults; Time › Absence): the turn's inputs, and each wake catch-up
// delivered, consumed after a fault, or left pending once the budget was
// spent, each by its object and serial. Catch-up says nothing, so it has
// no effects.

const LoggedWake = z.object({ object: z.string().min(1), serial: z.number().int().positive() });

export const MaintenanceEntry = TurnInputs.extend({
  kind: z.literal('maintenance'),
  delivered: z.array(LoggedWake),
  faulted: z.array(LoggedWake.extend({ fault: LoggedFault })),
  abandoned: z.array(LoggedWake),
});
export type MaintenanceEntry = z.infer<typeof MaintenanceEntry>;

/** What the log keeps of catch-up run with `inputs` by `host` as `turn`. */
export function maintenanceEntry(
  inputs: WriteInputs,
  host: TurnHost,
  turn: Committed<CaughtUp>,
): MaintenanceEntry {
  const { delivered, faulted, abandoned } = turn.value;
  return {
    kind: 'maintenance',
    ...inputsOf(inputs, host),
    delivered: delivered.map(({ object, serial }) => ({ object, serial })),
    faulted: faulted.map(({ wake, fault }) => ({
      object: wake.object,
      serial: wake.serial,
      fault: loggedFault(fault),
    })),
    abandoned: abandoned.map(({ object, serial }) => ({ object, serial })),
  };
}

/** The inputs catch-up was run with, as `entry` records them. */
export function maintenanceOf(entry: MaintenanceEntry): WriteInputs {
  return writeInputsOf(entry);
}
