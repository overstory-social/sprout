import type { Catalogue, RuntimeBudgets } from '@overstory/sprout/lang';

import type { Engine } from '../engine.js';
import { emptyState, type StoredState } from '../records.js';
import { applyChanges } from '../state.js';
import type { Step } from '../steps.js';
import { arrivalOf } from './arrival.js';
import { commandOf } from './command.js';
import { departureOf } from './departure.js';
import { atDepth, canonical } from './depth.js';
import { LogEntry, type Logged, type TurnEntry } from './entry.js';
import { maintenanceOf } from './maintenance.js';
import type { PublishEntry } from './publish.js';
import { tickOf } from './tick.js';
import { wakeOf } from './wake.js';
import type { WithholdingEntry } from './withholding.js';

// Replaying a world's log (the spec's The runtime › The log; The host
// contract › What the host may not do): every turn entry handed again, in
// order, to an engine's turn of its kind, over what the turns before it
// wrote since the publish or withholding before it, which redeployed the
// world, against that one's bundle, from its own seed, instant and bound,
// under the budgets it logged, and, for a command, with the words, the
// planned step and the item re-read it logged. A turn reproduces when
// running it again gives exactly the entry logged, its effects and fault
// among it, a play-depth entry's effects compared by their digest (The
// log › Depth); any other outcome is a divergence, which is what a
// moderator is looking for. A line a visitor said and a poll's fault are
// not run again, since neither changed the world: a replay reproduces it
// exactly with or without them. Any engine replays any engine's log.

/** One bundle's turns as a replay runs them: the catalogue its entries are read against, and its engine under a turn's budgets. */
export interface ReplayBundle {
  readonly catalogue: Catalogue;
  engine(budgets: RuntimeBudgets): Engine;
}

/** The bundle a publish or a withholding says the world runs from there on. */
export type ReplayBundles = (opening: PublishEntry | WithholdingEntry) => ReplayBundle;

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
 * Replay `log`, oldest first, from `from`, each segment on the engines
 * the bundle `bundles` gives for the publish or withholding that opens it,
 * one for each set of budgets its turns logged. A turn logged before any
 * publish is refused, since nothing says which bundle it ran against.
 */
export function replayLog(
  log: readonly Logged[],
  bundles: ReplayBundles,
  from: StoredState = emptyState(),
): Replayed {
  let bundle: ReplayBundle | null = null;
  let engines = new Map<string, Engine>();
  let state = from;
  let turns = 0;
  const diverged: Divergence[] = [];
  for (const { seq, entry } of log) {
    if (entry.kind === 'publish' || entry.kind === 'withholding') {
      // Each redeploys the world: what follows starts from the bundle's initial state.
      bundle = bundles(entry);
      engines = new Map();
      state = emptyState();
      continue;
    }
    if (entry.kind === 'said' || entry.kind === 'poll-fault') continue;
    if (bundle === null) {
      throw new Error(
        `The log's entry ${seq}, of kind \`${entry.kind}\`, comes before any publish, so nothing says which bundle it ran against.`,
      );
    }
    turns += 1;
    const budgets = JSON.stringify(canonical(entry.budgets));
    const engine = engines.get(budgets) ?? bundle.engine(entry.budgets);
    engines.set(budgets, engine);
    const step = rerun(engine, bundle.catalogue, state, entry);
    if (step !== null) {
      if (step.changes !== null) state = applyChanges(state, step.changes);
      engine.landed?.(state);
    }
    const replayed = step?.entry ?? null;
    if (replayed === null || !sameEntry(atDepthOf(entry, replayed), entry)) {
      diverged.push({ seq, logged: entry, replayed });
    }
  }
  return { state, turns, diverged };
}

/** `entry`'s turn handed again to `engine` over `stored`, or null where it throws before it opens. */
function rerun(
  engine: Engine,
  catalogue: Catalogue,
  stored: StoredState,
  entry: TurnEntry,
): Step<unknown> | null {
  try {
    switch (entry.kind) {
      case 'command':
        return engine.command(stored, commandOf(entry, catalogue));
      case 'tick':
        return engine.tick(stored, tickOf(catalogue.world, entry));
      case 'wake':
        return engine.wake(stored, wakeOf(catalogue.world, entry));
      case 'maintenance':
        return engine.maintenance(stored, maintenanceOf(entry));
      case 'arrival':
        return engine.arrival(stored, arrivalOf(entry));
      case 'departure':
        return engine.departure(stored, departureOf(entry));
    }
  } catch {
    return null;
  }
}

/** `replayed` at the depth `logged` was kept at: a play-depth entry is compared by its effects' digest. */
function atDepthOf(logged: TurnEntry, replayed: TurnEntry): LogEntry {
  return 'digest' in logged && logged.digest !== undefined ? atDepth(replayed, 'play') : replayed;
}

/** Whether two entries say the same, whatever order a store handed their fields back in. */
function sameEntry(a: LogEntry, b: LogEntry): boolean {
  return (
    JSON.stringify(canonical(LogEntry.parse(a))) === JSON.stringify(canonical(LogEntry.parse(b)))
  );
}
