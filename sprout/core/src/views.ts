import { pollView, type PolledView, type TurnHost, type VisitKey } from '@overstory/sprout/lang';

import type { SproutStore } from './store.js';
import { committedState } from './turns.js';

// A visitor's view against a store, and a host's cache of it (the spec's
// The runtime › Turns, The view). A view is polled from the last committed
// state with no lock, and is valid until a committed write turn names its
// visitor stale; there is no world version, so the cache is invalidated by
// those names alone. A poll may run while a write turn commits, so a view
// a poll began before a visitor was named stale is not kept.

/** Poll `visit`'s view of `microworldId`, on the last committed state, with no lock. */
export async function runView(
  store: SproutStore,
  microworldId: string,
  host: TurnHost,
  visit: VisitKey,
): Promise<PolledView> {
  return pollView(await committedState(store, microworldId, host), host, visit);
}

/** Each visitor's last view, per world, kept until a committed write turn names it stale. */
export class ViewCache {
  /** Each view kept, by world then visit. */
  private readonly kept = new Map<string, Map<VisitKey, PolledView>>();
  /** How many times each visitor has been named stale, by world then visit. */
  private readonly named = new Map<string, Map<VisitKey, number>>();
  /** How many times each world has been cleared, which counts against every visitor in it. */
  private readonly cleared = new Map<string, number>();

  /** `visit`'s view of `microworldId`: the one kept, else a fresh poll, kept unless it was named stale meanwhile. */
  async view(
    store: SproutStore,
    microworldId: string,
    host: TurnHost,
    visit: VisitKey,
  ): Promise<PolledView> {
    const held = this.kept.get(microworldId)?.get(visit);
    if (held !== undefined) return held;
    const began = this.timesNamed(microworldId, visit);
    const polled = await runView(store, microworldId, host, visit);
    if (this.timesNamed(microworldId, visit) === began) {
      within(this.kept, microworldId).set(visit, polled);
    }
    return polled;
  }

  /**
   * Drop the views of `visits`, as a committed write turn names them
   * (`Committed.stale`); a host names a visitor who departed here too,
   * since a departure names only those still present.
   */
  stale(microworldId: string, visits: readonly VisitKey[]): void {
    const named = within(this.named, microworldId);
    const kept = this.kept.get(microworldId);
    for (const visit of visits) {
      named.set(visit, (named.get(visit) ?? 0) + 1);
      kept?.delete(visit);
    }
  }

  /** Drop every view of `microworldId`, as a publish of a new bundle must. */
  clear(microworldId: string): void {
    this.kept.delete(microworldId);
    this.cleared.set(microworldId, (this.cleared.get(microworldId) ?? 0) + 1);
  }

  private timesNamed(microworldId: string, visit: VisitKey): number {
    return (this.named.get(microworldId)?.get(visit) ?? 0) + (this.cleared.get(microworldId) ?? 0);
  }
}

/** The map `maps` holds for `microworldId`, made empty where it holds none. */
function within<V>(maps: Map<string, Map<VisitKey, V>>, microworldId: string): Map<VisitKey, V> {
  const found = maps.get(microworldId);
  if (found !== undefined) return found;
  const made = new Map<VisitKey, V>();
  maps.set(microworldId, made);
  return made;
}
