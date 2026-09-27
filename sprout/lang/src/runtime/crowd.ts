// How many people may stand in one place (the spec's The host contract ›
// Enforcement; Limits › Cost that scales with people). The crowd is the
// one cost the language cannot bound, so the host does, with its
// `peoplePerPlace`; a host that sets none leaves it unbounded. Only people
// count, never an NPC, and a move that would bring one more person into a
// full place is refused before any guard, as the engine's other refusals
// are, through the world's `crowded`, which `sprout.World` writes as a
// default and a world may replace.

import type { ResolvedPassage } from '../declare/passages.js';
import { isPerson } from './audience.js';
import type { Speech } from './body.js';
import type { InstanceId } from './ids.js';
import type { StateReader } from './state.js';

/** The world's line for a person turned away from a full place, rendered with `item` and `to` (the spec's bindings table). */
const CROWDED = 'crowded';

/**
 * Whether `item` is a person `to` has no room for: `to` already holds as
 * many other people as `limit` allows. Never, where the host set no limit.
 */
export function turnedAway(
  state: StateReader,
  item: InstanceId,
  to: InstanceId,
  limit: number | null,
): boolean {
  if (limit === null || !isPerson(state, item)) return false;
  const standing = state.children(to).filter((id) => id !== item && isPerson(state, id));
  return standing.length >= limit;
}

/** The world's `crowded`, as it applies on the world's composed kind: what the one turned away reads. */
export function crowded(state: StateReader): Speech {
  const passage: ResolvedPassage | undefined = state
    .instance(state.world)
    ?.kind.passages.get(CROWDED);
  if (passage === undefined) {
    throw new Error(`the world composes no \`${CROWDED}\` passage, which \`sprout.World\` writes.`);
  }
  return { passage };
}
