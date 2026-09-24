// What a place is, and so what `here` is typed as (the spec's The world
// model › Places; Properties › Where types come from). A place is any
// object whose composed kind declares `contains actors`, and `here` is
// `sprout.Place` only where that holds of every such kind: one that holds
// actors without composing it could be an actor's place, so there `here`
// is the object type, and the kind is named for the remedy.

import { qualifiedName, SPROUT } from './enums.js';
import type { KindLookup, KindRef } from './kinds.js';

/** `sprout.Place`: `contains actors` and the notices a place speaks for itself. */
export const PLACE = qualifiedName(SPROUT, 'Place');

/** The kind `here` is typed at, and the first kind holding actors without composing `sprout.Place`. */
export interface HereKind {
  /** `sprout.Place`; null where a kind below does not compose it, or the standard library is absent. */
  readonly place: KindRef | null;
  /** The first of the world's kinds that holds actors and does not compose `sprout.Place`; null where none does. */
  readonly unlike: KindRef | null;
}

/** What `here` is typed as over `kinds`, every composed kind in the world. */
export function hereKindOf(kinds: readonly KindRef[], lookup: KindLookup): HereKind {
  const unlike = kinds.find((kind) => kind.containsActors && !kind.composes.has(PLACE)) ?? null;
  const place = lookup.qualified(SPROUT, 'Place');
  return { place: unlike === null ? place : null, unlike };
}
