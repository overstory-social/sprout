// `grammar { name "brass key"  article a  nouns "brass" }`, as a kind or
// an object writes one (the spec's Names › Addressing and display,
// Articles). The block holds lines, each led by its word: `name` and one
// name in quotes, `article` and one of `a`, `an`, `the` or `none`, and
// `nouns` and one or more nouns in quotes. What the lines mean together,
// and what they may not say, is `declare/grammar.ts`'s.
//
// A line that could not be read costs that line, and the block keeps the
// rest; a block never closed ends where the body's next member starts.

import {
  isArticle,
  type GrammarDeclaration,
  type GrammarLine,
  type GrammarNoun,
} from '../ast-grammar.js';
import type { Token } from '../lexer.js';
import { spanning, type Span } from '../../source/source.js';
import { readable } from '../../source/words.js';
import { type Parser } from './parser.js';
import { stepPast } from './recovery.js';

/** How a block is written, for a remedy. */
const EXAMPLE = 'grammar { name "brass key"  article a  nouns "brass" }';

/** The words a line of the block begins with. */
const LINE_WORDS = ['name', 'article', 'nouns'] as const;

function isLineWord(word: string): boolean {
  return (LINE_WORDS as readonly string[]).includes(word);
}

/**
 * A grammar block, its word next. `startsMember` says where the enclosing
 * body's next member starts, which ends a block never closed. Null having
 * said why.
 */
export function grammar(
  p: Parser,
  startsMember: (token: Token) => boolean,
): GrammarDeclaration | null {
  const keyword = p.next();
  if (p.take('punct', '{') === null) {
    p.diagnostics.refuse(
      p.here(),
      'A grammar block holds its lines in braces.',
      `Write \`${EXAMPLE}\`.`,
    );
    return null;
  }
  const lines: GrammarLine[] = [];
  const block = (end: Span): GrammarDeclaration => ({
    kind: 'grammar',
    at: spanning(keyword.at, end),
    lines,
  });
  for (let last = keyword.at; ;) {
    const close = p.take('punct', '}');
    if (close !== null) return block(close.at);
    const token = p.peek();
    const lineWord = token.kind === 'name' && isLineWord(token.text);
    if (
      p.done ||
      p.atDeclarationStart() ||
      token.kind === 'symbol' ||
      (token.kind === 'name' && !lineWord && startsMember(token))
    ) {
      p.diagnostics.refuse(
        p.done ? p.source.endSpan : token.at,
        'This grammar block is never closed.',
        'Add a } after its last line.',
      );
      return block(last);
    }
    if (!lineWord) {
      p.diagnostics.refuse(
        token.at,
        `A grammar block is not made of ${p.describe(token)}.`,
        `It holds ${readable([...LINE_WORDS])}, as in \`${EXAMPLE}\`.`,
      );
      // The rest of the line it starts is its own, up to the block's next line.
      do stepPast(p);
      while (!atLineEnd(p, startsMember));
      continue;
    }
    const line = grammarLine(p);
    if (line !== null) {
      lines.push(line);
      last = line.at;
    }
  }
}

/** Whether the cursor is where a line of the block, its close, or what ends it, starts. */
function atLineEnd(p: Parser, startsMember: (token: Token) => boolean): boolean {
  const token = p.peek();
  if (p.done || token.kind === 'symbol' || p.atDeclarationStart()) return true;
  if (token.kind === 'punct' && token.text === '}') return true;
  return token.kind === 'name' && (isLineWord(token.text) || startsMember(token));
}

/** One line of the block, its word next; null having said why. */
function grammarLine(p: Parser): GrammarLine | null {
  const word = p.next();
  switch (word.text) {
    case 'name': {
      const quoted = p.take('string');
      if (quoted === null) {
        const next = p.peek();
        // A bare word is the name written without its quotes, and is this line's.
        const bare = next.kind === 'name' && !isLineWord(next.text) ? next : null;
        p.diagnostics.refuse(
          next.kind === 'end' ? p.source.span(word.at.end) : next.at,
          '`name` is followed by the name in quotes.',
          bare === null
            ? 'Write `name "brass key"`, with no article: the article is its own line.'
            : `Write \`name "${bare.text.replaceAll('_', ' ')}"\`, in quotes.`,
        );
        if (bare !== null) p.next();
        return null;
      }
      return { kind: 'grammar-name', at: spanning(word.at, quoted.at), text: quoted.text };
    }
    case 'article': {
      const next = p.peek();
      if (next.kind === 'name' && isArticle(next.text)) {
        p.next();
        return { kind: 'grammar-article', at: spanning(word.at, next.at), article: next.text };
      }
      p.diagnostics.refuse(
        next.kind === 'end' ? p.source.span(word.at.end) : next.at,
        '`article` is followed by `a`, `an`, `the` or `none`.',
        'Write `article the` for a thing there is one of, or `article none` for a proper name.',
      );
      // A word that is plainly the article meant, misspelt or capitalised,
      // is this line's; the block's next line is not.
      const lineWord = next.kind === 'name' && isLineWord(next.text);
      if ((next.kind === 'name' || next.kind === 'kind') && !lineWord) p.next();
      return null;
    }
    default: {
      const nouns: GrammarNoun[] = [];
      for (let quoted = p.take('string'); quoted !== null; quoted = p.take('string')) {
        nouns.push({ kind: 'grammar-noun', at: quoted.at, text: quoted.text });
      }
      if (nouns.length === 0) {
        p.diagnostics.refuse(
          p.at('end') ? p.source.span(word.at.end) : p.peek().at,
          '`nouns` is followed by one or more nouns in quotes.',
          'Write `nouns "brass" "key ring"`.',
        );
        return null;
      }
      return { kind: 'grammar-nouns', at: spanning(word.at, nouns.at(-1)!.at), nouns };
    }
  }
}
