import {
  type Fault,
  type HostSeconds,
  type PolledReadings,
  type PolledScene,
  type PolledView,
  type TurnHost,
  type VisitKey,
} from '@overstory/sprout/lang';

import { pollFaultEntry } from './log/poll-fault.js';
import type { SproutStore } from './store.js';
import { engineOf, type EngineHost } from './engine.js';
import { committedStored } from './turns.js';

// A visitor's view against a store, and a host's cache of it (the spec's
// The runtime › Turns, The view). A view is polled from the last committed
// state with no lock, whole or in parts: the scene, and then one verb's
// readings at a time, each a poll of its own. Each is valid until a
// committed write turn names its visitor stale; there is no world version,
// so the cache is invalidated by those names alone. A poll may run while a
// write turn commits, so one a poll began before a visitor was named stale
// is not kept. A poll that faults is logged as an authoring fault, the one
// thing of a poll the log holds: the poll itself takes no lock, and its
// entry is appended after it, in a transaction that writes nothing of the
// world.

/**
 * Poll `visit`'s view of `microworldId` at `now`, on the last committed
 * state, with no lock; a fault is then logged against the object it lays
 * the fault on.
 */
export async function runView(
  store: SproutStore,
  microworldId: string,
  host: TurnHost & EngineHost,
  visit: VisitKey,
  now: HostSeconds,
): Promise<PolledView> {
  const polled = engineOf(host).view(await committedStored(store, microworldId), visit);
  await logged(store, microworldId, polled.fault, now);
  return polled;
}

/** Poll `visit`'s scene of `microworldId` at `now`, as `runView` polls the view. */
export async function runScene(
  store: SproutStore,
  microworldId: string,
  host: TurnHost & EngineHost,
  visit: VisitKey,
  now: HostSeconds,
): Promise<PolledScene> {
  const polled = engineOf(host).scene(await committedStored(store, microworldId), visit);
  await logged(store, microworldId, polled.fault, now);
  return polled;
}

/** Poll the readings of `verb`, by its qualified name, that `visit` could make in `microworldId`, as `runView` polls the view. */
export async function runReadings(
  store: SproutStore,
  microworldId: string,
  host: TurnHost & EngineHost,
  visit: VisitKey,
  verb: string,
  now: HostSeconds,
): Promise<PolledReadings> {
  const stored = await committedStored(store, microworldId);
  const polled = engineOf(host).readings(stored, visit, verb);
  await logged(store, microworldId, polled.fault, now);
  return polled;
}

/** Log `fault`, where a poll raised one, at `now`. */
async function logged(
  store: SproutStore,
  microworldId: string,
  fault: Fault | null,
  now: HostSeconds,
): Promise<void> {
  if (fault === null) return;
  const entry = pollFaultEntry(fault, now);
  await store.transaction(microworldId, (tx) => tx.appendLog(entry));
}

/** What the cache holds of one visitor: their view, their scene, and each verb's readings asked for. */
interface Held {
  view?: PolledView;
  scene?: PolledScene;
  readonly readings: Map<string, PolledReadings>;
}

/** Each visitor's last view, scene and readings, per world, kept until a committed write turn names them stale. */
export class ViewCache {
  /** What is kept of each visitor, by world then visit. */
  private readonly kept = new Map<string, Map<VisitKey, Held>>();
  /** How many times each visitor has been named stale, by world then visit. */
  private readonly named = new Map<string, Map<VisitKey, number>>();
  /** How many times each world has been cleared, which counts against every visitor in it. */
  private readonly cleared = new Map<string, number>();

  /** `visit`'s view of `microworldId`: the one kept, else a fresh poll at `now`, kept unless it was named stale meanwhile. */
  async view(
    store: SproutStore,
    microworldId: string,
    host: TurnHost & EngineHost,
    visit: VisitKey,
    now: HostSeconds,
  ): Promise<PolledView> {
    return this.keeping(
      microworldId,
      visit,
      (held) => held.view,
      (held, polled) => (held.view = polled),
      () => runView(store, microworldId, host, visit, now),
    );
  }

  /** `visit`'s scene of `microworldId`, kept as `view` keeps the view. */
  async scene(
    store: SproutStore,
    microworldId: string,
    host: TurnHost & EngineHost,
    visit: VisitKey,
    now: HostSeconds,
  ): Promise<PolledScene> {
    return this.keeping(
      microworldId,
      visit,
      (held) => held.scene,
      (held, polled) => (held.scene = polled),
      () => runScene(store, microworldId, host, visit, now),
    );
  }

  /**
   * The readings of `verb` that `visit` could make in `microworldId`, kept
   * as `view` keeps the view; none, with no poll, for a verb their scene
   * does not list, since nothing where they stand fits it.
   */
  async readings(
    store: SproutStore,
    microworldId: string,
    host: TurnHost & EngineHost,
    visit: VisitKey,
    verb: string,
    now: HostSeconds,
  ): Promise<PolledReadings> {
    const began = this.timesNamed(microworldId, visit);
    const { scene } = await this.scene(store, microworldId, host, visit, now);
    if (!scene.verbs.some((one) => one.verb === verb)) {
      return { visit, verb, readings: [], fault: null };
    }
    return this.keeping(
      microworldId,
      visit,
      (held) => held.readings.get(verb),
      (held, polled) => held.readings.set(verb, polled),
      () => runReadings(store, microworldId, host, visit, verb, now),
      began,
    );
  }

  /**
   * Drop what is kept of `visits`, as a committed write turn names them
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

  /** Drop everything kept of `microworldId`, as a publish of a new bundle must. */
  clear(microworldId: string): void {
    this.kept.delete(microworldId);
    this.cleared.set(microworldId, (this.cleared.get(microworldId) ?? 0) + 1);
  }

  /**
   * What `read` finds held of `visit`, else `poll`'s answer, kept by `keep`
   * unless `visit` was named stale since `began`, which is now unless the
   * caller read something the answer depends on first.
   */
  private async keeping<T>(
    microworldId: string,
    visit: VisitKey,
    read: (held: Held) => T | undefined,
    keep: (held: Held, polled: T) => void,
    poll: () => Promise<T>,
    began = this.timesNamed(microworldId, visit),
  ): Promise<T> {
    const found = this.kept.get(microworldId)?.get(visit);
    const held = found === undefined ? undefined : read(found);
    if (held !== undefined) return held;
    const polled = await poll();
    if (this.timesNamed(microworldId, visit) === began) {
      const visits = within(this.kept, microworldId);
      const into = visits.get(visit) ?? { readings: new Map() };
      visits.set(visit, into);
      keep(into, polled);
    }
    return polled;
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
