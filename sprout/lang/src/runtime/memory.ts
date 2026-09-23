// What a world remembers about one actor, for the memory panel (the
// spec's The host contract, and Properties › Per-actor memory). A visitor
// may open a panel showing everything every object in the world
// remembers about them, which is possible because memory is declared and
// keyed by actor and nothing else about them is stored. Dormant objects
// count: their memory is kept untouched, so it is shown as stored.
// Erasing it is not built; the spec gives only the panel.

import type { InstanceId } from './ids.js';
import { codeUnitOrder as compare, type WorldState } from './state.js';
import type { StoredValue } from './stored.js';
import type { Value } from './values.js';

/** One thing one object remembers about the actor. */
export interface Remembered {
  readonly object: InstanceId;
  readonly property: string;
  /** Decoded for an object the bundle declares now; as stored for a dormant one. */
  readonly value: Value | StoredValue;
}

/**
 * Everything every object in `state` remembers about `actor`, decoded or
 * dormant, by object id and then by property name. Only what was
 * written is remembered: a remembered property never written about this
 * actor reads as its default, and is not listed.
 */
export function rememberedAbout(state: WorldState, actor: InstanceId): Remembered[] {
  const found: Remembered[] = [];
  for (const instance of state.instances.values()) {
    const written = instance.memory.get(actor);
    if (written === undefined) continue;
    for (const [property, value] of written) found.push({ object: instance.id, property, value });
  }
  for (const [id, record] of state.dormant) {
    const written = record.memory[actor];
    if (written === undefined) continue;
    for (const [property, stored] of Object.entries(written)) {
      found.push({ object: id, property, value: stored.value });
    }
  }
  return found.sort((a, b) => compare(a.object, b.object) || compare(a.property, b.property));
}
