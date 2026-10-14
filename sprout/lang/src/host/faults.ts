// What a fault is, as an engine gives one (the spec's The runtime ›
// Faults, The view): the rule a turn or a poll broke, for the log and the
// host. The engine tells the visitor in the world's own words, so a fault
// is never silent; a fault of the engine's own is marked for the host to
// report loudly.

import type { InstanceId } from './ids.js';

/** A turn that faulted: what was broken, for the log and the host; never shown to a visitor. */
export interface Fault {
  /** The rule broken, by the error's name: `BudgetExhausted`, `MoveFault`, `ListFull`, …. */
  readonly name: string;
  /** What happened, naming objects by id. */
  readonly detail: string;
  /** The instance the fault is about, where the rule names one. */
  readonly object: InstanceId | null;
  /** True where nothing the world did explains it: the engine's own defect, which the host reports loudly. */
  readonly engine: boolean;
  /** The extension whose code threw or gave what it may not, which the host reports as that extension's; null for every other fault. */
  readonly extension: string | null;
}
