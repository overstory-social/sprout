// What the compiler builds from a grammar block: how a visitor addresses
// a thing and how the engine names it, and a place's ways out (the spec's
// Names › Addressing and display, Articles; Verbs › Exits, An exit may be
// conditional, Links). Every node keeps the rule `ast.ts` states: a
// `kind` and an `at`. The block's lines are kept in the order written, so
// a line written twice is refused where the second stands, and exits of
// one direction are tried in the order written.

import type { Node } from '../source/nodes.js';
import type { Expr, Ident, ObjectPath } from './ast.js';

/** The articles a grammar block may declare: `none` is a proper name's. */
export const ARTICLES = ['a', 'an', 'the', 'none'] as const;
export type Article = (typeof ARTICLES)[number];

/** The pronouns a grammar block may declare (the spec's Parsing › Pronouns). */
export const PRONOUNS = ['she', 'he', 'it', 'they'] as const;
export type Pronoun = (typeof PRONOUNS)[number];

/** The pronouns a visitor types, each with the pronoun a thing declares that it agrees with. */
export const TYPED_PRONOUNS: Readonly<Record<string, Pronoun>> = {
  it: 'it',
  them: 'they',
  him: 'he',
  her: 'she',
};

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

/** `pronouns she`: the pronoun the thing is called by, which a visitor's other pronoun for it is corrected to. */
export interface GrammarPronouns extends Node {
  readonly kind: 'grammar-pronouns';
  readonly pronoun: Pronoun;
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

/** One adjective in quotes after `adjectives`, its own node so a refusal of it points at it. */
export interface GrammarAdjective extends Node {
  readonly kind: 'grammar-adjective';
  readonly text: string;
}

/**
 * `adjectives "old" "brass"`: words that name the thing only more weakly
 * than a noun (the spec's Names › Addressing and display; Parsing ›
 * Matching a line), added to its defaults.
 */
export interface GrammarAdjectives extends Node {
  readonly kind: 'grammar-adjectives';
  readonly adjectives: readonly GrammarAdjective[];
}

/** An exit's or a link's label in quotes: what a visitor reads on a chip, and may type back. */
export interface GrammarLabel extends Node {
  readonly kind: 'grammar-label';
  /** What the quotes mean, after escapes: plain text, with no slots. */
  readonly text: string;
}

/**
 * `exit north "deeper into the dark" -> maze_hall when (!self.get(:lit))`:
 * a way out of a place, its direction, its label, where it leads, and
 * the guard that decides whether it applies. Which directions there are
 * is `declare/directions.ts`'s; the word is kept as written.
 */
export interface GrammarExit extends Node {
  readonly kind: 'grammar-exit';
  readonly direction: Ident;
  readonly label: GrammarLabel;
  /** An identifier, or a dotted path to a place. */
  readonly destination: ObjectPath;
  /** The condition in brackets after `when`; null where the exit always applies. */
  readonly when: Expr | null;
}

/**
 * `link onward "deeper into the dark"`: a way out whose destination is
 * assigned while the world runs, by `connect` naming it, and which does
 * not apply until it is. The name is the author's word, kept as written.
 */
export interface GrammarLink extends Node {
  readonly kind: 'grammar-link';
  readonly name: Ident;
  readonly label: GrammarLabel;
}

export type GrammarLine =
  | GrammarName
  | GrammarArticle
  | GrammarPronouns
  | GrammarNouns
  | GrammarAdjectives
  | GrammarExit
  | GrammarLink;

/**
 * `grammar { name "brass key"  article a  nouns "brass" }` — a kind's or
 * an object's surface: what it is called and answers to, and, for a
 * place, its exits and links. Naming is part of the grammar block, never
 * a property, so nothing renames itself while the world runs.
 */
export interface GrammarDeclaration extends Node {
  readonly kind: 'grammar';
  readonly lines: readonly GrammarLine[];
}

/** Whether a word is one of the articles a grammar block may declare. */
export function isArticle(word: string): word is Article {
  return (ARTICLES as readonly string[]).includes(word);
}

export function isPronoun(word: string): word is Pronoun {
  return (PRONOUNS as readonly string[]).includes(word);
}
