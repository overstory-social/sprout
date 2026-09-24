// A thing's grammar block, in both tiers (the spec's Names › Addressing
// and display, Articles; Kinds › How members combine, the rows "nouns in
// the grammar block: all apply" and "`name`, `article`: refuse"; Limits ›
// Static caps).
//
// The first tier checks one body's lines against themselves: one `name`
// and one `article` however many blocks hold them, a name that is not
// empty and does not begin with an article, and the host's caps on nouns;
// its exits and links are `exits.ts`'s.
// The second tier composes: a composer's own `name` or `article` replaces
// what it composes, one source's applies, and two sources are refused;
// nouns from every source apply, in closure order, the composer's own
// last. What applies where nothing is written is the runtime's to say,
// since it depends on what the thing is.

import type { KindDeclaration, KindExpr, KindMember, ObjectDeclaration } from '../syntax/ast.js';
import type { Article, GrammarLine } from '../syntax/ast-grammar.js';
import type { Diagnostics } from '../source/diagnostics.js';
import type { Span } from '../source/source.js';
import { typedWords } from './addressing.js';
import { checkExitLines, type ExitCaps } from './exits.js';

/** The host's figures for the static caps a grammar block is held to. Never this layer's numbers. */
export interface GrammarCaps extends ExitCaps {
  readonly nounsPerObject: number;
  readonly nounCharacters: number;
}

/** One exclusive line as it applies: its value, the kind that wrote it, and where. */
export interface GrammarSource<T> {
  readonly value: T;
  /** The kind that wrote it, by qualified name. */
  readonly origin: string;
  readonly at: Span;
}

/** What a composed kind is called and answers to, as far as its closure writes it. */
export interface ComposedGrammar {
  readonly name: GrammarSource<string> | null;
  readonly article: GrammarSource<Article> | null;
  /** Every noun written in the closure, as written, in closure order and each once, however cased. */
  readonly nouns: readonly string[];
}

/** A kind whose closure writes no grammar at all. */
export const NO_GRAMMAR: ComposedGrammar = { name: null, article: null, nouns: [] };

/** The articles a name may not begin with (the spec's Addressing and display). */
const LEADING_ARTICLES: readonly string[] = ['a', 'an', 'the'];

/** Every line of every grammar block in a body, in the order written. */
function linesOf(members: readonly KindMember[]): GrammarLine[] {
  return members.flatMap((member) => (member.kind === 'grammar' ? member.lines : []));
}

/** One body's grammar lines, checked against themselves and the host's caps. */
export function checkGrammar(
  declared: KindDeclaration | ObjectDeclaration,
  caps: GrammarCaps,
  diagnostics: Diagnostics,
): void {
  const owner = declared.name.text;
  let named = false;
  let articled = false;
  let nouns = 0;
  const words = (text: string, at: Span): void => {
    for (const word of text.split(/\s+/)) {
      const length = [...word].length;
      if (length <= caps.nounCharacters) continue;
      diagnostics.refuse(
        at,
        `\`${word}\` is ${length} characters long, and ${caps.nounCharacters} is as long as a word a thing answers to may be.`,
        'Use a shorter word: it is one a visitor types.',
      );
    }
  };
  for (const line of linesOf(declared.members)) {
    switch (line.kind) {
      case 'grammar-name': {
        if (named) {
          diagnostics.refuse(
            line.at,
            `\`${owner}\` writes its \`name\` twice.`,
            'A thing has one name. Keep one `name` line.',
          );
          break;
        }
        named = true;
        const [first, ...rest] = line.text.trim().split(/\s+/);
        if (first === undefined || first === '') {
          diagnostics.refuse(
            line.at,
            `\`${owner}\`'s name is empty.`,
            'Write the name a visitor reads, as in `name "brass key"`, or take the line out and the name is its identifier.',
          );
          break;
        }
        const article = first.toLowerCase();
        if (LEADING_ARTICLES.includes(article)) {
          diagnostics.refuse(
            line.at,
            `A name never begins with an article, and \`${line.text.trim()}\` begins with \`${first}\`.`,
            rest.length === 0
              ? `Write the name without it, and say the article on its own line: \`article ${article}\`.`
              : `Write \`name "${rest.join(' ')}"\`, and say the article on its own line: \`article ${article}\`.`,
          );
          break;
        }
        words(line.text.trim(), line.at);
        break;
      }
      case 'grammar-article':
        if (articled) {
          diagnostics.refuse(
            line.at,
            `\`${owner}\` writes its \`article\` twice.`,
            'A thing is written with one article. Keep one `article` line.',
          );
        }
        articled = true;
        break;
      case 'grammar-nouns':
        for (const noun of line.nouns) {
          if (noun.text.trim() === '') {
            diagnostics.refuse(
              noun.at,
              'This noun is empty.',
              'Write the words a visitor types for it, or take it out.',
            );
            continue;
          }
          nouns += 1;
          if (nouns === caps.nounsPerObject + 1) {
            diagnostics.refuse(
              noun.at,
              `\`${owner}\` writes more than ${caps.nounsPerObject} nouns, and ${caps.nounsPerObject} is as many as a thing may have.`,
              'Keep the ones a visitor is most likely to type: its name and the last word of it are nouns already.',
            );
          }
          words(noun.text.trim(), noun.at);
        }
        break;
      case 'grammar-exit':
      case 'grammar-link':
        break;
    }
  }
  checkExitLines(owner, declared.members, caps, diagnostics);
}

/** What a composer's own body writes, which the first tier has checked. */
export function ownGrammar(members: readonly KindMember[], origin: string): ComposedGrammar {
  let name: GrammarSource<string> | null = null;
  let article: GrammarSource<Article> | null = null;
  const nouns: string[] = [];
  for (const line of linesOf(members)) {
    if (line.kind === 'grammar-name') {
      name ??= { value: line.text.trim(), origin, at: line.at };
    } else if (line.kind === 'grammar-article') {
      article ??= { value: line.article, origin, at: line.at };
    } else if (line.kind === 'grammar-nouns') {
      for (const noun of line.nouns) if (noun.text.trim() !== '') nouns.push(noun.text.trim());
    }
  }
  return { name, article, nouns: once(nouns) };
}

/** A composed kind's grammar, with the kind as written that brought it. */
export interface ComposedFrom {
  readonly grammar: ComposedGrammar;
  readonly written: KindExpr;
}

/**
 * The grammar a composer answers with: its own `name` and `article`, else
 * the one source's, two sources refused at the kind, as written, that
 * brought the second; and every source's nouns, its own last. `shown`
 * names an origin as a message does.
 */
export function composeGrammar(
  composer: string,
  composed: readonly ComposedFrom[],
  own: ComposedGrammar,
  shown: (origin: string) => string,
  diagnostics: Diagnostics,
): ComposedGrammar {
  const pick = <T>(
    line: 'name' | 'article',
    mine: GrammarSource<T> | null,
    of: (grammar: ComposedGrammar) => GrammarSource<T> | null,
  ): GrammarSource<T> | null => {
    if (mine !== null) return mine;
    const sources: { source: GrammarSource<T>; through: KindExpr }[] = [];
    for (const { grammar, written } of composed) {
      const source = of(grammar);
      if (source !== null && !sources.some((one) => one.source.origin === source.origin)) {
        sources.push({ source, through: written });
      }
    }
    const [first, second] = sources;
    if (first === undefined) return null;
    if (second !== undefined) {
      diagnostics.refuse(
        second.through.at,
        `\`${composer}\` gets its \`${line}\` from both \`${shown(first.source.origin)}\` and \`${shown(second.source.origin)}\`, and a thing has one.`,
        line === 'name'
          ? `Write \`grammar { name "…" }\` in \`${composer}\` to say what it is called.`
          : `Write \`grammar { article … }\` in \`${composer}\` to say which it is written with.`,
      );
    }
    return first.source;
  };
  return {
    name: pick('name', own.name, (grammar) => grammar.name),
    article: pick('article', own.article, (grammar) => grammar.article),
    nouns: once([...composed.flatMap(({ grammar }) => grammar.nouns), ...own.nouns]),
  };
}

/** Nouns each once, the first spelling kept, compared as a visitor types them. */
function once(nouns: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const noun of nouns) {
    const key = typedWords(noun).join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(noun);
  }
  return kept;
}
