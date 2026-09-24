// What an object is called when a slot renders it (the spec's Prose ›
// Slots; Names › Addressing and display, Articles, Nicknames).
//
// An object renders as its article and its name, and as "you" to the
// reader it is. A visitor's name is their nickname, which has no article.
// Anything else is named by default: its identifier humanised in lower
// case, `oak_door` as "oak door", or, for what was made while the world
// runs, its kind's name the same way, `PrintedSheet` as "printed sheet";
// and its article is `a`, written "an" before a vowel. B27 brings the
// grammar block, whose `name` and `article` come before the defaults.

import { kindFileName } from '../declare/kind-files.js';
import type { InstanceId } from '../runtime/ids.js';
import type { StateReader } from '../runtime/state.js';

/** Who a visitor is called, by the instance that is them; null for any other instance. */
export type Nicknames = (id: InstanceId) => string | null;

/** What names an object in prose: the state it lives in, and visitors' nicknames. */
export interface Naming {
  readonly state: StateReader;
  readonly nickname: Nicknames;
}

/** `object` as `reader` reads it: "you", a nickname, or an article and a name. */
export function objectWords(object: InstanceId, reader: InstanceId, naming: Naming): string {
  if (object === reader) return 'you';
  const nickname = naming.nickname(object);
  if (nickname !== null) return nickname;
  const instance = naming.state.instance(object);
  if (instance === undefined) {
    throw new Error(`\`${object}\` is rendered in prose, and is not an instance.`);
  }
  const name = defaultName(instance.kind.name);
  return `${indefinite(name)} ${name}`;
}

/** An identifier or a kind's name, humanised in lower case. */
export function defaultName(written: string): string {
  const snake = /^[A-Z]/.test(written) ? kindFileName(written).replace(/\.sprout$/, '') : written;
  return snake.replaceAll('_', ' ');
}

/** The article `a`, as it is written before `name`. */
function indefinite(name: string): 'a' | 'an' {
  return /^[aeiou]/i.test(name) ? 'an' : 'a';
}
