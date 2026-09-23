// An object a body names by an identifier or a path, read while the
// world runs (the spec's Names › Identifiers and scope; The world model ›
// Destroying; The compiler › What absent means). The checker resolved
// each name to a declared object, the world, or the copy a kind gives the
// instance whose body runs (`check/names.ts`); this finds its instance.
//
// A declared object destroyed is gone for good, so a name that reaches
// one is a fault when it is read, as a dangling reference is, from the
// moment the destroy takes effect. A binding to it is not a name, and
// stays readable for the rest of that turn. A name is a target only in
// range: read through, one that is out of range or absent faults.

import type { Named } from '../declare/names.js';
import type { Frame } from './evaluate.js';
import { declaredId, declaredPathOf, isMinted, type InstanceId } from './ids.js';
import { isLive, liveTree } from './live.js';
import { reaches } from './range.js';
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

/**
 * A name read through at run time that reaches nothing in range of the
 * body's `self`: out of range, or absent. Thrown, as `DestroyedReference`
 * is; B34 turns it into the world's `fault` passage.
 */
export class NameOutOfRange extends Error {
  constructor(
    /** The name as written. */
    readonly written: string,
    /** What it reaches, where it reaches anything. */
    readonly object: InstanceId | null,
    self: InstanceId,
  ) {
    super(
      object === null
        ? `\`${written}\` reaches nothing here now, so \`${self}\` could not read through it.`
        : `\`${object}\` is out of range of \`${self}\`, so it could not be read through \`${written}\`.`,
    );
    this.name = 'NameOutOfRange';
  }
}

/**
 * The instance `named` reaches from `self`'s body, or null where nothing
 * is decoded there now: a declared object by its id, faulting where it
 * was destroyed; the world; or a kind's copy, which a declared holder
 * holds at its declared path and a spawned one somewhere inside it.
 */
export function objectNamed(named: Named, state: StateReader, self: InstanceId): InstanceId | null {
  const world = state.world;
  switch (named.names) {
    case 'world':
      return world;
    case 'declared':
      return namedObject(state, declaredId(world, named.path))?.id ?? null;
    case 'given': {
      const holder = holderOf(state, self, named.depth);
      if (holder === null) return null;
      const at = declaredPathOf(world, holder);
      if (at !== null) {
        return namedObject(state, declaredId(world, [...at, ...named.path]))?.id ?? null;
      }
      return givenInside(state, holder, named.giver, named.path);
    }
  }
}

/** What `named` reaches, read through by `frame.self`'s body: in range, or a fault. */
export function reachedByName(named: Named, written: string, frame: Frame): InstanceId {
  const target = objectNamed(named, frame.state, frame.self);
  const range = { tree: liveTree(frame.state), passes: frame.passes, budget: frame.budget };
  if (
    target === null ||
    !isLive(frame.state, target) ||
    !reaches(range, frame.self, target, 'any')
  ) {
    throw new NameOutOfRange(written, target, frame.self);
  }
  return target;
}

/** The instance `depth` steps out from `self` that holds the body's copies: by path where declared. */
function holderOf(state: StateReader, self: InstanceId, depth: number): InstanceId | null {
  const path = declaredPathOf(state.world, self);
  if (path !== null) {
    return depth > path.length ? null : declaredId(state.world, path.slice(0, path.length - depth));
  }
  let at: InstanceId | null = self;
  for (let step = 0; step < depth && at !== null; step++)
    at = state.instance(at)?.container ?? null;
  return at;
}

/** The first instance inside `holder`, breadth-first, made as `giver`'s copy at `path`. */
function givenInside(
  state: StateReader,
  holder: InstanceId,
  giver: string,
  path: readonly string[],
): InstanceId | null {
  const queue: InstanceId[] = [...state.children(holder)];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head]!;
    const made = state.instance(id)?.made;
    if (
      made?.from === 'given' &&
      made.kind === giver &&
      made.path.length === path.length &&
      made.path.every((step, i) => step === path[i])
    ) {
      return id;
    }
    queue.push(...state.children(id));
  }
  return null;
}
