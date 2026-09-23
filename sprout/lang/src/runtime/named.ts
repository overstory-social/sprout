// An object a body names by an identifier or a path, read while the
// world runs (the spec's The world model › Destroying; The compiler ›
// What absent means). What a name reaches is a declared object, by its
// declared id; the resolving of names inside bodies is B32's, and reads
// through here.
//
// A declared object destroyed is gone for good, so a name that reaches
// one is a fault when it is read, as a dangling reference is, from the
// moment the destroy takes effect. A binding to it is not a name, and
// stays readable for the rest of that turn.

import { isMinted, type InstanceId } from './ids.js';
import type { Instance, StateReader } from './state.js';

/**
 * A name read at run time that reaches a declared object destroyed.
 * Thrown, as `MoveFault` is, because the turn cannot go on; B34 turns it
 * into the world's `fault` passage. The detail names the object by its
 * id, for the log and the host, never for a visitor.
 */
export class DestroyedReference extends Error {
  constructor(
    /** The declared object the name reaches. */
    readonly object: InstanceId,
  ) {
    super(`\`${object}\` was destroyed, and a declared object destroyed is gone for good.`);
    this.name = 'DestroyedReference';
  }
}

/**
 * The declared object `id` names, faulting where it was destroyed; null
 * where nothing is decoded under it now, which the absent rules read.
 */
export function namedObject(state: StateReader, id: InstanceId): Instance | null {
  if (isMinted(id))
    throw new Error(`\`${id}\` is minted, and a name reaches only what is declared.`);
  if (state.tombstoned(id)) throw new DestroyedReference(id);
  return state.instance(id) ?? null;
}
