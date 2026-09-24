import type { CommandHost } from '@overstory/sprout/lang';

import { emptyState, type StoredState } from '../records.js';
import { applyChanges } from '../state.js';
import {
  arrivalStep,
  commandStep,
  departureStep,
  loaded,
  maintenanceStep,
  tickStep,
  wakeStep,
  type Step,
} from '../steps.js';
import { arrivalOf } from './arrival.js';
import { commandOf } from './command.js';
import { departureOf } from './departure.js';
import { LogEntry, type Logged, type TurnEntry } from './entry.js';
import { maintenanceOf } from './maintenance.js';
import type { PublishEntry } from './publish.js';
import { tickOf } from './tick.js';
import { wakeOf } from './wake.js';
import type { WithholdingEntry } from './withholding.js';

// Replaying a world's log (the spec's The runtime › The log; The host
// contract › What the host may not do): every turn entry run again, in
// order, over what the turns before it wrote, against the bundle of the
// publish or withholding before it, from its own seed, instant and bound
// and under the budgets it logged, with no clock, so the wall-clock
// backstop cannot fire where it did not. A turn reproduces when running
// it again gives exactly the entry logged, its effects and fault among
// it; any other outcome is a divergence, which is what a moderator is
// looking for. A poll's fault is not run again, since a poll writes
// nothing.

/** What a replay runs one bundle's turns under; each turn's budgets are its own. */
export type ReplayHost = Pick<CommandHost, 'catalogue' | 'render' | 'parse'>;

/** The host for the bundle a publish or a withholding says the world runs from there on. */
export type ReplayHosts = (opening: PublishEntry | WithholdingEntry) => ReplayHost;

/** A logged turn that did not reproduce: what it logged, and what running it again gave, null where it ran nothing or threw. */
export interface Divergence {
  readonly seq: number;
  readonly logged: TurnEntry;
  readonly replayed: TurnEntry | null;
}

/** What a replay gives back: the state the turns wrote, how many it ran, and every one that did not reproduce. */
export interface Replayed {
  readonly state: StoredState;
  readonly turns: number;
  readonly diverged: readonly Divergence[];
}

/**
 * Replay `log`, oldest first, from `from`, each segment against the host
 * `hosts` gives for the publish or withholding that opens it. A turn
 * logged before any publish is refused, since nothing says which bundle
 * it ran against.
 */
export function replayLog(
  log: readonly Logged[],
  hosts: ReplayHosts,
  from: StoredState = emptyState(),
): Replayed {
  let host: ReplayHost | null = null;
  let state = from;
  let turns = 0;
  const diverged: Divergence[] = [];
  for (const { seq, entry } of log) {
    if (entry.kind === 'publish' || entry.kind === 'withholding') {
      host = hosts(entry);
      continue;
    }
    if (entry.kind === 'poll-fault') continue;
    if (host === null) {
      throw new Error(
        `The log's entry ${seq}, of kind \`${entry.kind}\`, comes before any publish, so nothing says which bundle it ran against.`,
      );
    }
    turns += 1;
    const step = rerun(state, { ...host, budgets: entry.budgets }, entry);
    if (step?.changes) state = applyChanges(state, step.changes);
    const replayed = step?.entry ?? null;
    if (replayed === null || !sameEntry(replayed, entry)) {
      diverged.push({ seq, logged: entry, replayed });
    }
  }
  return { state, turns, diverged };
}

/** `entry`'s turn run again by `as` over `stored`, or null where it throws before it opens. */
function rerun(stored: StoredState, as: CommandHost, entry: TurnEntry): Step<unknown> | null {
  const world = as.catalogue.world;
  try {
    const state = loaded(stored, as);
    switch (entry.kind) {
      case 'command':
        return commandStep(state, as, commandOf(entry));
      case 'tick':
        return tickStep(state, as, tickOf(world, entry));
      case 'wake':
        return wakeStep(state, as, wakeOf(world, entry));
      case 'maintenance':
        return maintenanceStep(state, as, maintenanceOf(entry));
      case 'arrival':
        return arrivalStep(state, as, arrivalOf(entry));
      case 'departure':
        return departureStep(state, as, departureOf(entry));
    }
  } catch {
    return null;
  }
}

/** Whether two entries say the same, whatever order a store handed their fields back in. */
function sameEntry(a: LogEntry, b: LogEntry): boolean {
  return (
    JSON.stringify(canonical(LogEntry.parse(a))) === JSON.stringify(canonical(LogEntry.parse(b)))
  );
}

/** `v` with every object's keys in code-unit order. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}
