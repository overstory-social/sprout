// An object a body names by an identifier or a path, read while the
// world runs (the spec's Names › Identifiers and scope; The world model ›
// Destroying; The compiler › What absent means). The checker resolved
// each name in the world's or a declared object's body to what it names,
// and each in a kind's body to the declarations it may reach
// (`check/names.ts`); this finds the instance, a kind's name from where
// the instance running the body sits now, nearest first.
//
// A declared object destroyed is gone for good, so a name that reaches
// one is a fault when it is read, as a dangling reference is, from the
// moment the destroy takes effect. A binding to it is not a name, and
// stays readable for the rest of that turn. A name is a target only in
// range: read through, one that is out of range or reaches nothing faults.

import type { Candidate, DeclaredAt, Named } from '../declare/names.js';
import type { Frame } from './evaluate.js';
import { declaredId, declaredPathOf, isMinted, type InstanceId } from './ids.js';
import { isLive, liveTree } from './live.js';
import { reaches } from './range.js';
import type { Instance, StateReader } from './state.js';

/**
 * A name read at run time that reaches a declared object destroyed.
 * Thrown, as `MoveFault` is, because the turn cannot go on: it faults
 * (`faults.ts`). The detail names the object by its
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
 * body's `self`: out of range, or nothing at all. Thrown, as
 * `DestroyedReference` is, and faults the turn.
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
 * was destroyed; the world; a copy `self`'s own body declares; or what
 * the nearest body declaring the name holds, counted outward from `self`.
 */
export function objectNamed(named: Named, state: StateReader, self: InstanceId): InstanceId | null {
  const world = state.world;
  switch (named.names) {
    case 'world':
      return world;
    case 'declared':
      return namedObject(state, declaredId(world, named.path))?.id ?? null;
    case 'own': {
      const at = declaredPathOf(world, self);
      if (at !== null) {
        return namedObject(state, declaredId(world, [...at, ...named.parts]))?.id ?? null;
      }
      return followed(state, self, named.steps);
    }
    case 'placed':
      return nearest(state, self, named.candidates);
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

/**
 * The first candidate whose first step the body of `self`, or of each
 * container outward to the world, declares, followed down its steps;
 * null where no body `self` sits in declares one, or where the one found
 * stops short of the name's last step.
 */
function nearest(
  state: StateReader,
  self: InstanceId,
  candidates: readonly Candidate[],
): InstanceId | null {
  const length = Math.max(...candidates.map((one) => one.steps.length));
  let holder: InstanceId | null = self;
  while (holder !== null) {
    const instance = state.instance(holder);
    const within: InstanceId = holder;
    const found = candidates.find((one) => declares(state.world, within, instance, one.steps[0]!));
    if (found !== undefined) {
      return found.steps.length < length ? null : followed(state, within, found.steps);
    }
    holder = instance?.container ?? null;
  }
  return null;
}

/**
 * Whether the body of `holder` declares `at`: for a declared holder, what
 * the tree places directly under it; for one made while the world runs,
 * what its kinds give it, or, for a copy, what the body it copies writes.
 */
function declares(
  world: InstanceId,
  holder: InstanceId,
  instance: Instance | undefined,
  at: DeclaredAt,
): boolean {
  if (at.in === 'tree') return declaredId(world, at.path.slice(0, -1)) === holder;
  if (!isMinted(holder) || instance === undefined) return false;
  if (at.path.length === 1) return instance.kind.order.includes(at.giver);
  const { made } = instance;
  return (
    made.from === 'given' && made.kind === at.giver && samePath(made.path, at.path.slice(0, -1))
  );
}

/** Each of `steps` in turn: the first inside `holder`, and each after inside the one before. */
function followed(
  state: StateReader,
  holder: InstanceId,
  steps: readonly DeclaredAt[],
): InstanceId | null {
  let here: InstanceId | null = holder;
  for (const step of steps) {
    if (here === null) return null;
    here =
      step.in === 'tree'
        ? (namedObject(state, declaredId(state.world, step.path))?.id ?? null)
        : givenInside(state, here, step.giver, step.path);
  }
  return here;
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
    if (made?.from === 'given' && made.kind === giver && samePath(made.path, path)) return id;
    queue.push(...state.children(id));
  }
  return null;
}

function samePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((step, i) => step === b[i]);
}
