// What the compiler builds from a file's `import` lines (the spec's The
// world model › Imports): the names it imports from another file or a
// library, or a namespace for all of them. Every node keeps the rule
// `ast.ts` states: a `kind` and an `at`.

import type { Node } from '../source/nodes.js';
import type { Ident } from './ast.js';

/** One name an `import` brings in: a kind, enum, verb or object, or a message with its colon, and its `as`. */
export interface ImportedName extends Node {
  readonly kind: 'imported-name';
  readonly name: Ident;
  /** Whether it was written with its colon, as a message is: `:stir`. */
  readonly message: boolean;
  /** The name it goes by in this file, where `as` gave it one. */
  readonly alias: Ident | null;
}

/**
 * `import {Key, Ward as Guard}` from a file, or `import * as sprout` from
 * a library: exactly one of `names` and `namespace` is set.
 */
export interface ImportDeclaration extends Node {
  readonly kind: 'import';
  readonly names: readonly ImportedName[] | null;
  readonly namespace: Ident | null;
  /** The specifier as written, without its quotes, and where it stands. */
  readonly from: Ident;
}
