// The reserved words as the grammars colour them (the spec's The compiler ›
// Lexical rules). The list is the compiler's own, read from
// `RESERVED_WORDS`, so the grammar cannot name a word the language does
// not reserve or miss one it does; this module only sorts it into the
// literals, the type names and the rest.

import { RESERVED_WORDS } from '@overstory/sprout';

/** The reserved words that are literals. */
export const LITERALS: readonly string[] = ['true', 'false'];

/** The reserved words that name a type, `symbol` the value-role word among them. */
export const TYPE_NAMES: readonly string[] = ['boolean', 'integer', 'string', 'object', 'symbol'];

/** Every other reserved word: the words of the language's own syntax, in the compiler's order. */
export function syntaxWords(): string[] {
  return [...RESERVED_WORDS].filter((w) => !LITERALS.includes(w) && !TYPE_NAMES.includes(w));
}

/** A pattern matching any of `words` as a whole word, longest first so none shadows another. */
export function wordsPattern(words: readonly string[]): string {
  const sorted = [...words].sort((a, b) => b.length - a.length || a.localeCompare(b));
  return `\\b(?:${sorted.join('|')})\\b`;
}
