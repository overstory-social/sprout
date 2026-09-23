import { codeUnitOrder, type StoredChanges, type StoredState } from './records.js';

// A world's stored state held whole, as the memory store and the
// document store keep it: one committed turn's change set applied to it,
// every list kept in the code-unit order of its key, so each adapter
// hands back the same value the port promises.

/** `state` after one turn's `changes`: removals, then upserts by id, tombstones added once, visitors upserted by visit, the serial set. */
export function applyChanges(state: StoredState, changes: StoredChanges): StoredState {
  const instances = new Map(state.instances.map((i) => [i.id, i]));
  for (const id of changes.remove) instances.delete(id);
  for (const instance of changes.upsert) instances.set(instance.id, instance);
  const visitors = new Map(state.visitors.map((v) => [v.visit, v]));
  for (const visitor of changes.visitors) visitors.set(visitor.visit, visitor);
  return {
    serial: changes.serial,
    instances: [...instances.values()].sort((a, b) => codeUnitOrder(a.id, b.id)),
    visitors: [...visitors.values()].sort((a, b) => codeUnitOrder(a.visit, b.visit)),
    tombstones: [...new Set([...state.tombstones, ...changes.tombstones])].sort(codeUnitOrder),
  };
}
