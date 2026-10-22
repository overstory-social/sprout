// How a cartridge writes the names a world is made of (the spec's The
// compiler › What compiling produces): an identifier as its text, and an
// object path as its steps joined by dots, which is how a runtime reads
// them. The one exception is a name the name table binds: the table maps
// the node written to what it reached, so that node stays an entry, an
// identifier as `{kind, text}` and a dotted path as `{kind: 'path', text}`,
// and a path of one bound step is written as that step. No name keeps a
// place: nothing reads one back.
//
// `NAME_FIELDS` is the contract both ways: the writer flattens a name only
// in a field it lists, and the reader gives back an identifier or a path in
// exactly those fields, so a cartridge read by the language reads as the
// compiler built it.

import type { Ident, ObjectPath } from '../syntax/ast.js';
import type { Span } from '../source/source.js';
import type { Rewrite } from './cartridge-graph.js';

/** What a field holds: one name, an object path, a list of names (each possibly null), or a list of paths. */
type NameField = 'name' | 'path' | 'names' | 'paths';

/** Every field of a node that holds a name, by the node's kind. */
export const NAME_FIELDS: Readonly<Record<string, Readonly<Record<string, NameField>>>> = {
  act: { verb: 'name' },
  'act-role': { role: 'name', filler: 'path' },
  'act-value': { role: 'name' },
  binding: { name: 'name' },
  bound: { name: 'name' },
  broadcast: { message: 'name' },
  call: { method: 'name' },
  capacity: { by: 'name' },
  connect: { link: 'name', destination: 'path' },
  each: { variable: 'name' },
  enum: { name: 'name' },
  'extension-statement': { extension: 'name', name: 'name' },
  'extension-use': { name: 'name' },
  'free-call': { name: 'name' },
  from: { role: 'name' },
  'grammar-choice': { leads: 'path' },
  'grammar-exit': { direction: 'name', leads: 'path' },
  'grammar-link': { name: 'name' },
  'grammar-refusal': { said: 'name' },
  'grammar-saying': { said: 'name' },
  guard: { parameters: 'names' },
  handler: { message: 'name', parameters: 'names' },
  'handler-ref': { message: 'name' },
  hook: { property: 'name', parameters: 'names' },
  'hook-ref': { property: 'name' },
  import: { namespace: 'name', from: 'name' },
  'imported-name': { name: 'name', alias: 'name' },
  intent: { name: 'name' },
  'intent-filler': { role: 'name', slot: 'name' },
  'intent-step': { verb: 'name' },
  kind: { name: 'name' },
  'kind-expr': { library: 'name', name: 'name' },
  let: { name: 'name' },
  member: { member: 'name' },
  message: { name: 'name' },
  move: { thing: 'path', destination: 'path' },
  'move-through': { thing: 'path', direction: 'name' },
  'named-type': { library: 'name', name: 'name' },
  object: { name: 'name', placedIn: 'path', places: 'paths' },
  option: { name: 'name' },
  'option-literal': { name: 'name' },
  pass: { message: 'name' },
  passage: { name: 'name' },
  'phrase-slot': { role: 'name' },
  play: { except: 'names' },
  property: { name: 'name' },
  'prose-exit': { direction: 'name' },
  'prose-for': { variable: 'name' },
  refuse: { said: 'name' },
  role: { name: 'name' },
  'role-ref': { role: 'name', verb: 'name' },
  say: { said: 'name' },
  send: { target: 'path', message: 'name' },
  spawn: { container: 'path' },
  'symbol-expr': { name: 'name' },
  synonyms: { verb: 'name' },
  tell: { to: 'path', said: 'name' },
  text: { said: 'name' },
  verb: { name: 'name' },
  'visitors-arrive-at': { place: 'path' },
  world: { name: 'name' },
};

const kindOf = (value: unknown): unknown =>
  value !== null && typeof value === 'object' ? (value as { kind?: unknown }).kind : undefined;

const fieldOf = (owner: object, key: string): NameField | undefined => {
  const kind = kindOf(owner);
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(NAME_FIELDS, kind)) {
    return undefined;
  }
  const fields = NAME_FIELDS[kind]!;
  return Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : undefined;
};

/** Whether `value` is a name a writer has to place somewhere: an identifier or an object path. */
const isName = (value: unknown): boolean => kindOf(value) === 'ident' || kindOf(value) === 'path';

/** The names of a world as a cartridge writes them, given the nodes its name table binds. */
export interface NamesWritten {
  /** The rewrite that writes each name field; it refuses a name it meets anywhere else. */
  readonly rewrite: Rewrite;
  /** The node a name-table key is written as, the same one the fields that hold it write. */
  readonly key: (node: object) => object;
}

/** How the names of a world are written, `bound` being the nodes its name table maps. */
export function namesWritten(bound: ReadonlySet<object>): NamesWritten {
  const paths = new Map<ObjectPath, object>();
  const lists = new WeakMap<object, unknown[]>();

  const identCell = (ident: Ident): unknown => (bound.has(ident) ? ident : ident.text);
  const pathCell = (path: ObjectPath): unknown => {
    const only = path.parts.length === 1 ? path.parts[0]! : null;
    if (only !== null && bound.has(only)) return only;
    const text = path.parts.map((part) => part.text).join('.');
    if (!bound.has(path)) return text;
    let written = paths.get(path);
    if (written === undefined) {
      written = { kind: 'path', text };
      paths.set(path, written);
    }
    return written;
  };
  const nameCell = (value: unknown, where: string): unknown => {
    if (value === null) return null;
    const kind = kindOf(value);
    if (kind === 'ident') return identCell(value as Ident);
    if (typeof value === 'string') {
      throw new Error(`a cartridge writes ${where} as a name, and it holds a string`);
    }
    return value;
  };

  const rewrite: Rewrite = (owner, key, value) => {
    const kind = kindOf(owner);
    if (kind === 'ident' && key === 'at') return undefined;
    const field = fieldOf(owner, key);
    const where = `${String(kind)}.${key}`;
    switch (field) {
      case 'name':
        return nameCell(value, where);
      case 'path':
        if (kindOf(value) === 'path') return pathCell(value as ObjectPath);
        if (typeof value === 'string') {
          throw new Error(`a cartridge writes ${where} as a path, and it holds a string`);
        }
        return value;
      case 'names': {
        const list = value as readonly unknown[];
        let written = lists.get(list);
        if (written === undefined) {
          written = list.map((one) => nameCell(one, where));
          lists.set(list, written);
        }
        return written;
      }
      case 'paths': {
        const list = value as readonly ObjectPath[];
        let written = lists.get(list);
        if (written === undefined) {
          written = list.map(pathCell);
          lists.set(list, written);
        }
        return written;
      }
      case undefined:
        if (isName(value)) throw new Error(`a cartridge holds no name at ${where}`);
        return value;
    }
  };

  const key = (node: object): object => {
    if (kindOf(node) !== 'path') return node;
    const written = pathCell(node as ObjectPath);
    return typeof written === 'object' && written !== null ? written : node;
  };
  return { rewrite, key };
}

/**
 * Gives back, on one object read from a cartridge, the identifiers and
 * paths its name fields were written without: each name as an identifier
 * and each path as its steps, at `nowhere`, as they kept no place.
 */
export function restoreNames(object: Record<string, unknown>, nowhere: Span): void {
  const kind = object['kind'];
  const ident = (text: string): Ident => ({ kind: 'ident', text, at: nowhere });
  if (kind === 'ident') {
    if (!('at' in object)) object['at'] = nowhere;
    return;
  }
  if (kind === 'path') {
    if (typeof object['text'] === 'string') {
      object['parts'] = object['text'].split('.').map(ident);
      delete object['text'];
    }
    if (!('at' in object)) object['at'] = nowhere;
    return;
  }
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(NAME_FIELDS, kind)) return;
  const name = (value: unknown): unknown => (typeof value === 'string' ? ident(value) : value);
  for (const [key, field] of Object.entries(NAME_FIELDS[kind]!)) {
    if (!(key in object)) continue;
    const value = object[key];
    const path = (one: unknown): unknown =>
      typeof one === 'string'
        ? { kind: 'path', parts: one.split('.').map(ident), at: nowhere }
        : kindOf(one) === 'ident'
          ? { kind: 'path', parts: [one], at: nowhere }
          : one;
    if (field === 'name') object[key] = name(value);
    else if (field === 'names') object[key] = (value as readonly unknown[]).map(name);
    else if (field === 'paths') object[key] = (value as readonly unknown[]).map(path);
    else object[key] = path(value);
  }
}
