// What an object is called when a slot renders it (the spec's Prose ›
// Slots; Names › Addressing and display, Articles, Nicknames).
//
// An object renders as its article and its name, as its grammar block and
// the defaults give them (`runtime/parser/address.ts`), and as "you" to
// the reader it is. A visitor is their nickname, with no article. The
// article is written as it applies: `a`, `an` or `the` before the name,
// and nothing for `none`.

import type { InstanceId } from '../runtime/ids.js';
import { addressOf } from '../runtime/parser/address.js';
import type { StateReader } from '../runtime/state.js';

/** What names an object in prose: the state it lives in, and each visitor's nickname. */
export interface Naming {
  readonly state: StateReader;
  /** Each visitor's nickname, by the instance that is them. */
  readonly nicknames: ReadonlyMap<InstanceId, string>;
}

/** `object` as `reader` reads it: "you", or its article and its name. */
export function objectWords(object: InstanceId, reader: InstanceId, naming: Naming): string {
  if (object === reader) return 'you';
  const instance = naming.state.instance(object);
  if (instance === undefined) {
    throw new Error(`\`${object}\` is rendered in prose, and is not an instance.`);
  }
  const { name, article } = addressOf(instance, {
    world: naming.state.world,
    nicknames: naming.nicknames,
  });
  return article === 'none' ? name : `${article} ${name}`;
}
