// What the compiler builds from what a file writes of an extension: the
// line at its top that names one, and a statement of one (the spec's
// Extensions › What an extension may add, Activation and absence). Every
// node keeps the rule `ast.ts` states: a `kind` and an `at`.

import type { Node } from '../source/nodes.js';
import type { Expr, Ident, IntegerLiteral } from './ast.js';

/**
 * `extension media 2` — an extension this file uses, pinned by major
 * version, written at the top of the file before anything it declares.
 * The manifest pins the same one at the same major.
 */
export interface ExtensionUse extends Node {
  readonly kind: 'extension-use';
  readonly name: Ident;
  readonly major: IntegerLiteral;
}

/**
 * `media.show(self.get(:image))` — a statement of an extension the file
 * names at its top, with its arguments. What it takes, and where it may
 * stand, is the extension's and the checker's to say.
 */
export interface ExtensionStatement extends Node {
  readonly kind: 'extension-statement';
  readonly extension: Ident;
  readonly name: Ident;
  readonly arguments: readonly Expr[];
}
