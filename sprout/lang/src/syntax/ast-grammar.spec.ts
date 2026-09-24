import { describe, expect, it } from 'vitest';

import type { KindDeclaration } from './ast.js';
import { ARTICLES, isArticle, type GrammarDeclaration } from './ast-grammar.js';
import { Diagnostics } from '../source/diagnostics.js';
import { nodesOf, unspanned } from '../source/nodes.js';
import { parseDeclarations } from './parse.js';
import { SourceFile, textOf } from '../source/source.js';

describe('a grammar block’s nodes keep the rule every node keeps', () => {
  const diagnostics = new Diagnostics();
  const [kind] = parseDeclarations(
    new SourceFile(
      'k.sprout',
      'kind Key { grammar { name "brass key"  article the  nouns "brass" "key ring" } }\n',
    ),
    diagnostics,
  ) as [KindDeclaration];
  const block = kind.members[0] as GrammarDeclaration;

  it('reads clean, and every node carries a span', () => {
    expect(diagnostics.all).toEqual([]);
    expect(unspanned([kind])).toEqual([]);
  });

  it('names each part by its kind, spanned at what was written', () => {
    const kinds = new Set([...nodesOf([kind])].map((node) => node.kind));
    for (const one of [
      'grammar',
      'grammar-name',
      'grammar-article',
      'grammar-nouns',
      'grammar-noun',
    ]) {
      expect(kinds.has(one), one).toBe(true);
    }
    expect(block.lines.map((line) => textOf(line.at))).toEqual([
      'name "brass key"',
      'article the',
      'nouns "brass" "key ring"',
    ]);
  });
});

describe('the articles a grammar block may declare', () => {
  it('are the spec’s four, `none` a proper name’s', () => {
    expect(ARTICLES).toEqual(['a', 'an', 'the', 'none']);
    expect(ARTICLES.every(isArticle)).toBe(true);
    for (const word of ['The', 'my', 'this', '']) expect(isArticle(word), word).toBe(false);
  });
});
