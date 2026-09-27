// An object a body names by an identifier or a path, read while the
// world runs (the spec's Names › Identifiers and scope; The world model ›
// Destroying; The compiler › What absent means). The checker resolved
// each name in the world's or a declared object's body to what it names,
// and each in a kind's body to what its steps are answered to by
// (`check/names.ts`); this finds the instance, a kind's name from where
// the instance running the body sits now, nearest first and judged by
// what each container holds now rather than by what its body declares.
//
// A declared object destroyed is gone for good, so a name that reaches
// one is a fault when it is read, as a dangling reference is, from the
// moment the destroy takes effect. A binding to it is not a name, and
// stays readable for the rest of that turn. A name is a target only in
// range: read through, one that is out of range or reaches nothing faults.

import type { GivenAt, Named, PlacedStep } from '../declare/names.js';
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
 * What answers to a name's step: anything called it, a spawned instance
 * made as a declaration of it is included; or only what has it as an
 * identifier, which is what an exit's destination names, since a spawned
 * place has none (the spec's Spawning).
 */
export type Answering = 'anything' | 'identifiers';

/**
 * The instance `named` reaches from `self`'s body, or null where nothing
 * is decoded there now: a declared object by its id, faulting where it
 * was destroyed; the world; a copy `self`'s own body declares; or what
 * is nearest `self` by what each container holds now.
 */
export function objectNamed(
  named: Named,
  state: StateReader,
  self: InstanceId,
  answering: Answering = 'anything',
): InstanceId | null {
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
      return nearest(state, self, named.steps, answering);
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
 * What `steps` reach from `self`, judged by contents: the first step among
 * what `self` holds, else what each container outward to the world holds,
 * and each step after it among what the one before holds now (the spec's
 * Identifiers and scope). Null where a step finds nothing.
 */
function nearest(
  state: StateReader,
  self: InstanceId,
  steps: readonly PlacedStep[],
  answering: Answering,
): InstanceId | null {
  const [first, ...rest] = steps;
  if (first === undefined) return null;
  for (let holder: InstanceId | null = self; holder !== null;) {
    const found = heldAs(state, holder, first, answering);
    if (found !== null) return heldDown(state, found, rest, answering);
    holder = state.instance(holder)?.container ?? null;
  }
  return null;
}

/** Each of `steps` in turn among what the one before holds, from `holder` down; null where one finds nothing. */
function heldDown(
  state: StateReader,
  holder: InstanceId,
  steps: readonly PlacedStep[],
  answering: Answering,
): InstanceId | null {
  let here: InstanceId | null = holder;
  for (const step of steps) {
    if (here === null) return null;
    here = heldAs(state, here, step, answering);
  }
  return here;
}

/** The first thing `holder` holds now, in its contents order, that answers to `step`; null where none does. */
function heldAs(
  state: StateReader,
  holder: InstanceId,
  step: PlacedStep,
  answering: Answering,
): InstanceId | null {
  for (const id of state.children(holder)) {
    const instance = state.instance(id);
    if (instance !== undefined && answersTo(state.world, instance, step, answering)) return id;
  }
  return null;
}

/**
 * Whether `instance` answers to `step`: a declared object or a copy by its
 * identifier, the last step of its path; a spawned instance, which has
 * none, where it is made of what some declaration of the name is made of
 * and `answering` admits it. A visitor answers to no identifier, since
 * nobody wrote its declaration.
 */
function answersTo(
  world: InstanceId,
  instance: Instance,
  step: PlacedStep,
  answering: Answering,
): boolean {
  const { made } = instance;
  switch (made.from) {
    case 'world':
    case 'visitor':
      return false;
    case 'declared':
      return declaredPathOf(world, instance.id)?.at(-1) === step.name;
    case 'given':
      return made.path.at(-1) === step.name;
    case 'spawned':
      return (
        answering === 'anything' &&
        step.madeOf.some(
          (kinds) => kinds.length > 0 && kinds.every((kind) => instance.kind.composes.has(kind)),
        )
      );
  }
}

/** Each of `steps` in turn: the first inside `holder`, and each after inside the one before. */
function followed(
  state: StateReader,
  holder: InstanceId,
  steps: readonly GivenAt[],
): InstanceId | null {
  let here: InstanceId | null = holder;
  for (const step of steps) {
    if (here === null) return null;
    here = givenInside(state, here, step.giver, step.path);
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
