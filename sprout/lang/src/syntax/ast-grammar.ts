// What the compiler builds from a grammar block: how a visitor addresses
// a thing and how the engine names it (the spec's Names › Addressing and
// display, Articles). Every node keeps the rule `ast.ts` states: a `kind`
// and an `at`. The block's lines are kept in the order written, so a line
// written twice is refused where the second stands.

import type { Node } from '../source/nodes.js';

/** The articles a grammar block may declare: `none` is a proper name's. */
export const ARTICLES = ['a', 'an', 'the', 'none'] as const;
export type Article = (typeof ARTICLES)[number];

/** `name "brass key"`: what the engine calls the thing, and a noun it answers to. */
export interface GrammarName extends Node {
  readonly kind: 'grammar-name';
  /** What the quotes mean, after escapes. */
  readonly text: string;
}

/** `article the`: the article the engine writes before the name. */
export interface GrammarArticle extends Node {
  readonly kind: 'grammar-article';
  readonly article: Article;
}

/** One noun in quotes after `nouns`, its own node so a refusal of it points at it. */
export interface GrammarNoun extends Node {
  readonly kind: 'grammar-noun';
  readonly text: string;
}

/** `nouns "brass" "key ring"`: more words the thing answers to, added to its defaults. */
export interface GrammarNouns extends Node {
  readonly kind: 'grammar-nouns';
  readonly nouns: readonly GrammarNoun[];
}

export type GrammarLine = GrammarName | GrammarArticle | GrammarNouns;

/**
 * `grammar { name "brass key"  article a  nouns "brass" }` — a kind's or
 * an object's surface: what it is called and answers to. Naming is part
 * of the grammar block, never a property, so nothing renames itself
 * while the world runs.
 */
export interface GrammarDeclaration extends Node {
  readonly kind: 'grammar';
  readonly lines: readonly GrammarLine[];
}

/** Whether a word is one of the articles a grammar block may declare. */
export function isArticle(word: string): word is Article {
  return (ARTICLES as readonly string[]).includes(word);
}
