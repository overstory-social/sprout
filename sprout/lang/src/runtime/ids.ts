// What an instance and a visitor are called in stored state (the spec's
// The runtime › State, Spawning).
//
// An instance id is one of two forms, both led by the world's name. A
// declared object's id is its declared path, `printers_shop.kiln.shelf`,
// and the world's own is `printers_shop`; moving an object in source
// therefore makes it a new object. Anything made while the world runs is
// given a minted id, `printers_shop#12`, from the world's one serial
// counter, and a minted id is never reused. Names match
// `[a-z][a-z0-9_]*`, so neither `.` nor `#` occurs inside one and the two
// forms cannot collide.

import type { TreePath } from '../declare/tree.js';

declare const instance: unique symbol;
/** A declared path with the world first, `printers_shop.kiln.shelf` (the world's own is `printers_shop`), or a minted `printers_shop#12`. */
export type InstanceId = string & { readonly [instance]: true };

declare const visit: unique symbol;
/** The host's opaque key for one person in this world, stable across visits; never an account id. */
export type VisitKey = string & { readonly [visit]: true };

/** What a world or an object may be named: the lexer's name. */
const NAME = /^[a-z][a-z0-9_]*$/;

function named(what: string, name: string): string {
  if (!NAME.test(name))
    throw new Error(`${what} \`${name}\` is not a name: it matches [a-z][a-z0-9_]*.`);
  return name;
}

/** A declared object's id: its path under the world, the world's own for `[]`. */
export function declaredId(world: string, path: TreePath): InstanceId {
  const steps = [named('the world', world), ...path.map((step) => named('the step', step))];
  return steps.join('.') as InstanceId;
}

/** The id of something made while the world runs, from a positive serial the world has not issued before. */
export function mintedId(world: string, serial: number): InstanceId {
  if (!Number.isSafeInteger(serial) || serial < 1) {
    throw new Error(`a minted id takes a positive whole serial, not ${serial}.`);
  }
  return `${named('the world', world)}#${serial}` as InstanceId;
}

/** The declared path an id names under `world`, or null for a minted id or another world's. */
export function declaredPathOf(world: string, id: InstanceId): TreePath | null {
  if (isMinted(id)) return null;
  if (id === world) return [];
  if (!id.startsWith(`${world}.`)) return null;
  return id.slice(world.length + 1).split('.');
}

/** Whether an id was minted rather than declared. */
export function isMinted(id: InstanceId): boolean {
  return id.includes('#');
}

/** A visit key, as the host hands one over. */
export function visitKey(key: string): VisitKey {
  if (key.length === 0) throw new Error('a visit key is never empty.');
  return key as VisitKey;
}

/** Which form a stored string is as an id under `world`, or null when it is neither. */
export function idForm(world: string, id: string): 'world' | 'declared' | 'minted' | null {
  if (id === world) return 'world';
  if (id.startsWith(`${world}#`))
    return /^[1-9][0-9]*$/.test(id.slice(world.length + 1)) ? 'minted' : null;
  if (!id.startsWith(`${world}.`)) return null;
  return id
    .slice(world.length + 1)
    .split('.')
    .every((step) => NAME.test(step))
    ? 'declared'
    : null;
}

/** A stored string as an id under `world`, as a log hands one back; a string of no form of the world's is refused. */
export function storedId(world: string, id: string): InstanceId {
  if (idForm(world, id) === null) throw new Error(`\`${id}\` is not an id in \`${world}\`.`);
  return id as InstanceId;
}
