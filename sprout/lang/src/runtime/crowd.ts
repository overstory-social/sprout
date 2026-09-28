// How many people may stand in one place (the spec's The host contract ›
// Enforcement; Limits › Cost that scales with people). The crowd is the
// one cost the language cannot bound, so the host does, with its
// `peoplePerPlace`; a host that sets none leaves it unbounded. Only people
// count, never an NPC, and a move that would bring one more person into a
// full place is refused before any guard, as the engine's other refusals
// are, through the engine's `crowded` (`engine-lines.ts`).

import { isPerson } from './audience.js';
import type { InstanceId } from './ids.js';
import type { StateReader } from './state.js';

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
