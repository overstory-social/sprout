import { z } from 'zod';

import type { SproutStore } from '../store.js';
import { ArrivalEntry } from './arrival.js';
import { CommandEntry } from './command.js';
import { DepartureEntry } from './departure.js';
import { MaintenanceEntry } from './maintenance.js';
import { PollFaultEntry } from './poll-fault.js';
import { PublishEntry } from './publish.js';
import { TickEntry } from './tick.js';
import { WakeEntry } from './wake.js';
import { WithholdingEntry } from './withholding.js';

// The event log (the spec's The runtime › The log): one world's entries,
// in the order they were appended, each numbered by the store from 1. It
// holds every write turn with its inputs and seed — commands, ticks,
// wakes and maintenance, and every visitor's entry, exit and nickname —
// with what each said; every publish and withholding, with the bundle's
// hash; and a poll's fault, which is the one thing of a poll it holds.
// Each entry is appended inside the transaction of the turn it records,
// so a turn and its entry land together, and the order is the order the
// world's lock let them run.

export const LogEntry = z.discriminatedUnion('kind', [
  CommandEntry,
  TickEntry,
  WakeEntry,
  MaintenanceEntry,
  ArrivalEntry,
  DepartureEntry,
  PublishEntry,
  WithholdingEntry,
  PollFaultEntry,
]);
export type LogEntry = z.infer<typeof LogEntry>;

/** An entry as a store hands it back: its place in the world's log, from 1, and the entry. */
export const Logged = z.object({ seq: z.number().int().positive(), entry: LogEntry });
export type Logged = z.infer<typeof Logged>;

/** A logged entry that records a write turn, which a replay runs again. */
export type TurnEntry = Exclude<LogEntry, PublishEntry | WithholdingEntry | PollFaultEntry>;

/** The entries of `microworldId`'s log after `after` (0 for the first), oldest first, at most `limit`. */
export function readLog(
  store: SproutStore,
  microworldId: string,
  opts: { readonly after?: number; readonly limit: number },
): Promise<Logged[]> {
  return store.read(microworldId, (tx) => tx.log(opts));
}

/** Every entry of `microworldId`'s log, oldest first, read `page` entries at a time, which is the host's to size. */
export async function wholeLog(
  store: SproutStore,
  microworldId: string,
  page: number,
): Promise<Logged[]> {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new Error(`A page of the log is ${page} entries, and must be at least 1.`);
  }
  const all: Logged[] = [];
  for (;;) {
    const next = await readLog(store, microworldId, { after: all.at(-1)?.seq ?? 0, limit: page });
    all.push(...next);
    if (next.length < page) return all;
  }
}
