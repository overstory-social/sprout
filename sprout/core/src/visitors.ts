import {
  codeUnitOrder,
  type StoredInstance,
  type StoredState,
  type StoredVisitor,
  type VisitorInWorld,
} from './records.js';

// What one world keeps about one visitor, and what forgetting them
// takes (the spec's The host contract › Moderation and takedown: memory
// is erased "with their instance", which is possible because it is
// declared and keyed). Memory is stored per remembering instance, keyed
// by the actor's instance id, so both read across every instance of the
// world. What the visitor's instance held goes with it, all the way
// down, as a destroyed object's contents do; a declared object among
// them leaves no tombstone, so the next load makes it again where it was
// declared.

/** What forgetting one visit changes in one world's state. */
export interface Forgetting {
  readonly visitor: StoredVisitor;
  /** The visitor's instance and every instance stored inside it, in code-unit order. */
  readonly remove: readonly string[];
  /** Every other instance that remembered the visitor, with that memory gone, in code-unit order. */
  readonly rewrite: readonly StoredInstance[];
}

/** What forgetting `visit` changes in `state`, or null where the world holds no such visit. */
export function forgetting(state: StoredState, visit: string): Forgetting | null {
  const visitor = state.visitors.find((v) => v.visit === visit);
  if (visitor === undefined) return null;
  const held = new Map<string, string[]>();
  for (const instance of state.instances) {
    if (instance.container === null) continue;
    held.set(instance.container, [...(held.get(instance.container) ?? []), instance.id]);
  }
  const gone = new Set<string>();
  const walk = [visitor.instance];
  while (walk.length > 0) {
    const id = walk.pop()!;
    if (gone.has(id)) continue;
    gone.add(id);
    walk.push(...(held.get(id) ?? []));
  }
  const present = new Set(state.instances.map((i) => i.id));
  const rewrite = state.instances
    .filter((i) => !gone.has(i.id) && Object.hasOwn(i.memory, visitor.instance))
    .map((i) => {
      const memory = { ...i.memory };
      delete memory[visitor.instance];
      return { ...i, memory };
    });
  return {
    visitor,
    remove: [...gone].filter((id) => present.has(id)).sort(codeUnitOrder),
    rewrite: rewrite.sort((a, b) => codeUnitOrder(a.id, b.id)),
  };
}

/** `state` with what `forgetting` found taken out of it. */
export function applyForgetting(state: StoredState, change: Forgetting): StoredState {
  const rewritten = new Map(change.rewrite.map((i) => [i.id, i]));
  const removed = new Set(change.remove);
  return {
    serial: state.serial,
    instances: state.instances
      .filter((i) => !removed.has(i.id))
      .map((i) => rewritten.get(i.id) ?? i),
    visitors: state.visitors.filter((v) => v.visit !== change.visitor.visit),
    tombstones: state.tombstones,
  };
}

/** What `state` keeps about `visit` in `microworldId`, or null where it holds no such visit. */
export function visitorIn(
  microworldId: string,
  state: StoredState,
  visit: string,
): VisitorInWorld | null {
  const visitor = state.visitors.find((v) => v.visit === visit);
  if (visitor === undefined) return null;
  const memory: VisitorInWorld['memory'] = {};
  for (const instance of [...state.instances].sort((a, b) => codeUnitOrder(a.id, b.id))) {
    const remembered = instance.memory[visitor.instance];
    if (remembered !== undefined) memory[instance.id] = { ...remembered };
  }
  return {
    microworldId,
    visitor: { ...visitor },
    instance: state.instances.find((i) => i.id === visitor.instance) ?? null,
    memory,
  };
}
