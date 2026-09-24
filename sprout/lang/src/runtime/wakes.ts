// The wakes an object holds (the spec's Time › Wakes, Absence; Limits ›
// Runtime budgets). A `wake` asks for one under the world's next serial,
// due no sooner than the host's floor, and one asked past the host's cap
// on pending wakes faults; nothing is charged while it waits. A wake is
// due once its instant has come and its object is in the tree, and due
// wakes are delivered oldest first: by when they fell due, then by the
// serial they were asked under.
//
// Two invariants. An object's list is kept oldest first, so its first
// entry is the one catch-up delivers. And nothing here reads a clock:
// every instant is the one the host handed the turn.

import { wakeSeconds } from '../check/wake.js';
import type { WakeStatement } from '../syntax/ast.js';
import type { InstanceId } from './ids.js';
import type { LifecycleContext } from './lifecycle.js';
import { isLive } from './live.js';
import {
  codeUnitOrder,
  readerOf,
  type Instance,
  type PendingWake,
  type WorldState,
} from './state.js';
import type { HostSeconds } from './time.js';

/**
 * A `wake` past the host's cap on pending wakes (the spec's Limits ›
 * Runtime budgets). Thrown, as a spawn past the host's bound is, and
 * faults the turn.
 */
export class WakeFault extends Error {
  constructor(
    readonly object: InstanceId,
    detail: string,
  ) {
    super(detail);
    this.name = 'WakeFault';
  }
}

/** One pending wake and the object that asked for it. */
export interface DueWake extends PendingWake {
  readonly object: InstanceId;
}

/** Whether `a` is delivered before `b`: the one due first, then the one asked first. */
export function oldestFirst(a: PendingWake, b: PendingWake): number {
  return a.dueAt - b.dueAt || a.serial - b.serial;
}

/**
 * `wake in <n> <unit>`, run by `self`: one wake asked at the turn's
 * instant and due after what was asked or the host's floor, whichever is
 * longer. Past the host's cap it faults, and nothing is written.
 */
export function askToWake(
  context: LifecycleContext,
  self: InstanceId,
  statement: WakeStatement,
): PendingWake {
  const { draft, budget, now } = context;
  const instance = draft.instance(self);
  if (instance === undefined) throw new Error(`\`${self}\` is not here to be woken.`);
  const cap = budget.limits.pendingWakesPerObject;
  if (instance.wakes.length >= cap) {
    throw new WakeFault(
      self,
      `\`${self}\` asked for a wake with ${instance.wakes.length} pending, and this host allows ${cap}.`,
    );
  }
  const wait = Math.max(wakeSeconds(statement), budget.limits.shortestWakeSeconds);
  const wake: PendingWake = { serial: draft.nextSerial(), askedAt: now, dueAt: now + wait };
  draft.write({ ...instance, wakes: [...instance.wakes, wake].sort(oldestFirst) });
  return wake;
}

/**
 * Every wake due at `now`, oldest first: each whose instant has come, on
 * an object in the tree. A wake on something that is not, such as what
 * an away visitor carries, waits until it is.
 */
export function dueWakes(state: WorldState, now: HostSeconds): DueWake[] {
  const reader = readerOf(state);
  const due: DueWake[] = [];
  for (const instance of state.instances.values()) {
    const ready = instance.wakes.filter((wake) => wake.dueAt <= now);
    if (ready.length === 0 || !isLive(reader, instance.id)) continue;
    for (const wake of ready) due.push({ object: instance.id, ...wake });
  }
  return due.sort((a, b) => oldestFirst(a, b) || codeUnitOrder(a.object, b.object));
}

/** What catch-up delivers of `due`: each object's oldest, in the order they fell due (the spec's Absence). */
export function onePerObject(due: readonly DueWake[]): DueWake[] {
  const seen = new Set<InstanceId>();
  return due.filter((wake) => {
    if (seen.has(wake.object)) return false;
    seen.add(wake.object);
    return true;
  });
}

/** `instance` with the wake asked under `serial` taken off its list. */
export function withoutWake(instance: Instance, serial: number): Instance {
  return { ...instance, wakes: instance.wakes.filter((wake) => wake.serial !== serial) };
}
