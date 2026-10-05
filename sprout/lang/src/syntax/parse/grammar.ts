// `grammar { name "brass key"  article a  nouns "brass" }`, as a kind or
// an object writes one (the spec's Names › Addressing and display,
// Articles; Verbs › Exits, Links). The block holds lines, each led by its
// word: `name` and one name in quotes, `article` and one of `a`, `an`,
// `the` or `none`, `pronouns` and one of `she`, `he`, `it` or `they`, `nouns` and one or more nouns in quotes, `adjectives`
// and one or more adjectives in quotes, a place's
// `exit` and `link` lines, which `exits.ts` reads, and its `lit` and a
// condition in brackets. What the lines mean
// together, and what they may not say, is `declare/grammar.ts`'s and
// `declare/exits.ts`'s.
//
// A line that could not be read costs that line, and the block keeps the
// rest; a block never closed ends where the body's next member starts.

import type { Expr } from '../ast.js';
import {
  isArticle,
  isPronoun,
  TYPED_PRONOUNS,
  type GrammarDeclaration,
  type GrammarAdjective,
  type GrammarLine,
  type GrammarLit,
  type GrammarNoun,
} from '../ast-grammar.js';
import type { Token } from '../lexer.js';
import { spanning, type Span } from '../../source/source.js';
import { readable } from '../../source/words.js';
import { expression } from './expressions.js';
import { exitLine, linkLine, stepOverToken, type LineEnds } from './exits.js';
import { type Parser } from './parser.js';
import { skipBracketed } from './recovery.js';

/** How a block is written, for a remedy. */
const EXAMPLE = 'grammar { name "brass key"  article a  nouns "brass" }';

/** The words a line of the block begins with. */
const LINE_WORDS = [
  'name',
  'article',
  'pronouns',
  'nouns',
  'adjectives',
  'exit',
  'link',
  'lit',
] as const;

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
      do stepOverToken(p);
      while (!atLineEnd(p, startsMember));
      continue;
    }
    const line = grammarLine(p, { atLineEnd: (at) => atLineEnd(at, startsMember) });
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
function grammarLine(p: Parser, ends: LineEnds): GrammarLine | null {
  if (p.at('name', 'exit')) return exitLine(p, ends);
  if (p.at('name', 'link')) return linkLine(p, ends);
  if (p.at('name', 'lit')) return litLine(p, ends);
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
    case 'pronouns': {
      const next = p.peek();
      if (next.kind === 'name' && isPronoun(next.text)) {
        p.next();
        return { kind: 'grammar-pronouns', at: spanning(word.at, next.at), pronoun: next.text };
      }
      // A pronoun a visitor types for it, `her`, is the one it declares, `she`.
      const meant = next.kind === 'name' && Object.hasOwn(TYPED_PRONOUNS, next.text);
      p.diagnostics.refuse(
        next.kind === 'end' ? p.source.span(word.at.end) : next.at,
        '`pronouns` is followed by `she`, `he`, `it` or `they`.',
        meant
          ? `Write \`pronouns ${TYPED_PRONOUNS[next.text]!}\`: a thing declares the pronoun it is, and a visitor may call it \`${next.text}\`.`
          : 'Write `pronouns she`, the pronoun the thing is called by.',
      );
      // A word that is plainly the pronoun meant is this line's; the block's next line is not.
      const lineWord = next.kind === 'name' && isLineWord(next.text);
      if ((next.kind === 'name' || next.kind === 'kind') && !lineWord) p.next();
      return null;
    }
    case 'adjectives': {
      const adjectives: GrammarAdjective[] = [];
      for (let quoted = p.take('string'); quoted !== null; quoted = nextNoun(p)) {
        adjectives.push({ kind: 'grammar-adjective', at: quoted.at, text: quoted.text });
      }
      if (adjectives.length === 0) {
        unquoted(p, word, 'adjectives', '`adjectives "old" "worn"`');
        return null;
      }
      return {
        kind: 'grammar-adjectives',
        at: spanning(word.at, adjectives.at(-1)!.at),
        adjectives,
      };
    }
    default: {
      const nouns: GrammarNoun[] = [];
      for (let quoted = p.take('string'); quoted !== null; quoted = nextNoun(p)) {
        nouns.push({ kind: 'grammar-noun', at: quoted.at, text: quoted.text });
      }
      if (nouns.length === 0) {
        unquoted(p, word, 'nouns', '`nouns "brass" "key ring"`');
        return null;
      }
      return { kind: 'grammar-nouns', at: spanning(word.at, nouns.at(-1)!.at), nouns };
    }
  }
}

/**
 * Refuse a `nouns` or `adjectives` line with nothing in quotes after it. A
 * bare word on the same line is one written without its quotes, and is
 * this line's; one on the next line starts the block's next line.
 */
function unquoted(p: Parser, word: Token, line: 'nouns' | 'adjectives', example: string): void {
  const next = p.peek();
  const sameLine = !p.source.text.slice(word.at.end, next.at.start).includes('\n');
  const bare = sameLine && next.kind === 'name' && !isLineWord(next.text) ? next : null;
  p.diagnostics.refuse(
    p.at('end') ? p.source.span(word.at.end) : next.at,
    `\`${line}\` is followed by one or more ${line} in quotes.`,
    bare === null ? `Write ${example}.` : `Write \`${line} "${bare.text}"\`, in quotes.`,
  );
  if (bare !== null) p.next();
}

/** The noun after one already read: the next in quotes, a comma between them or not, as the spec's worked microworld writes `nouns "cabinet", "type"`. */
function nextNoun(p: Parser): Token | null {
  const after = p.peek(1);
  if (p.at('punct', ',') && after.kind === 'string') p.next();
  return p.take('string');
}

/** How a `lit` line is written, for a remedy. */
const LIT_EXAMPLE = '`lit (self.sees(sprout.LightSource, :lit))`';

/**
 * `lit (…)`, its word next: the condition in brackets; null having said
 * why. A bracket never closed costs the line, and never the block's next.
 */
function litLine(p: Parser, ends: LineEnds): GrammarLit | null {
  const word = p.next();
  const open = p.take('punct', '(');
  if (open === null) {
    p.diagnostics.refuse(
      p.source.span(word.at.end),
      '`lit` is followed by its condition in brackets: whether the place can be seen.',
      `Write ${LIT_EXAMPLE}.`,
    );
    return null;
  }
  if (p.at('punct', ')')) {
    const close = p.next();
    p.diagnostics.refuse(
      spanning(open.at, close.at),
      'This `lit` says nothing inside its brackets.',
      `Write the condition the place is lit under, as in ${LIT_EXAMPLE}, or leave \`lit\` out and the place is always lit.`,
    );
    return null;
  }
  const unclosed = (): null => {
    p.diagnostics.refuse(
      p.done ? p.source.endSpan : p.peek().at,
      'The condition of this `lit` ends here, and its bracket is never closed.',
      'Add a ) after the condition.',
    );
    return null;
  };
  if (ends.atLineEnd(p)) return unclosed();
  if (!p.deeper(open.at)) {
    skipBracketed(p, ')');
    return null;
  }
  let condition: Expr | null;
  try {
    condition = expression(p);
  } finally {
    p.depth -= 1;
  }
  if (condition === null) {
    skipBracketed(p, ')');
    return null;
  }
  const close = p.take('punct', ')');
  if (close === null) {
    unclosed();
    if (!ends.atLineEnd(p)) skipBracketed(p, ')');
    return null;
  }
  return { kind: 'grammar-lit', at: spanning(word.at, close.at), condition };
}
