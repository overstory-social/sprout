// Reading a file into declarations: the first tier of the spec's The
// compiler › Two tiers.
//
// This is the parser for SOURCE — what an author writes in a `.sprout`
// file — and not the parser for what a visitor types, which is B27's.
// This module is its entry; the grammar is in `parse/`, one module per
// area, each a set of functions taking the `Parser` context.
//
// Two things it does deliberately. It RECOVERS: a declaration it cannot
// read costs that declaration and not the file, because an author owed
// three problems is owed all three. And every node it builds carries the
// span of the tokens it was built from, down to the individual option of
// an enum, so a diagnostic points at the word that is wrong.
//
// Three rules hold the recovery together:
//
//   - A missing separator is reported only once the NEXT item reads
//     successfully. A token that cannot be an item at all is that
//     token's problem, not a missing comma's.
//   - A gap the lexer made by stepping over a character is never blamed
//     on the author. The token after it says so itself (`afterRefusal`),
//     so no offset is carried and none can go stale.
//   - A word that starts a declaration is one only where a declaration
//     could start. `enum Ward { message, silver }` is an enum with
//     `silver` in it: a reserved word is READ as the word it is, and
//     then refused as an option, so neither the enum nor anything after
//     it is lost to a word standing where it may not.

import type {
  Declaration,
  Expr,
  LetStatement,
  PropertyDeclaration,
  RemembersDeclaration,
} from './ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { StaticCaps } from '../bundle/limits.js';
import type { SourceFile } from '../source/source.js';
import { DECLARATION_READERS, file } from './parse/declarations.js';
import { expression, letStatement } from './parse/expressions.js';
import { Parser } from './parse/parser.js';
import { property, remembers } from './parse/properties.js';

export { DEEPEST } from './parse/parser.js';

/**
 * The words that start a declaration, as this compiler reads them
 * today, for anything outside the parser that needs the list.
 *
 * The parser itself never reads this: it dispatches off the `readers`
 * table and builds its "this compiler reads …" message from the same
 * table, so the message cannot go stale when a declaration is added. A
 * spec holds that this list and that message name the same words, in
 * both directions.
 */
export const DECLARATIONS = ['enum', 'kind', 'message', 'object', 'world'] as const;

/** Every declaration in one file. Problems go to `diagnostics`; nothing is thrown. */
export function parseDeclarations(
  source: SourceFile,
  diagnostics: Diagnostics,
  caps?: StaticCaps,
): Declaration[] {
  return file(new Parser(source, diagnostics, DECLARATION_READERS, caps));
}

/**
 * One property declaration, read on its own, so the property reader can
 * be exercised directly; a world, a kind and an object read one through
 * the same path.
 */
export function parseProperty(
  source: SourceFile,
  diagnostics: Diagnostics,
  caps?: StaticCaps,
): PropertyDeclaration | null {
  return property(new Parser(source, diagnostics, DECLARATION_READERS, caps));
}

/**
 * One `let`, read on its own. A `let` is written inside a body, and no
 * body exists yet (B24 onward), so this is how one is exercised.
 */
export function parseLet(
  source: SourceFile,
  diagnostics: Diagnostics,
  caps?: StaticCaps,
): LetStatement | null {
  return letStatement(new Parser(source, diagnostics, DECLARATION_READERS, caps));
}

/**
 * One expression, read on its own. Expressions are written inside
 * bodies, and no body exists yet (B24 onward), so this is how one is
 * exercised.
 */
export function parseExpression(
  source: SourceFile,
  diagnostics: Diagnostics,
  caps?: StaticCaps,
): Expr | null {
  return expression(new Parser(source, diagnostics, DECLARATION_READERS, caps));
}

/** One `:remembers`, read on its own, for the same reason. */
export function parseRemembers(
  source: SourceFile,
  diagnostics: Diagnostics,
  caps?: StaticCaps,
): RemembersDeclaration | null {
  return remembers(new Parser(source, diagnostics, DECLARATION_READERS, caps));
}
