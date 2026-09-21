// Where spans come from (B01; the spec's The compiler › Diagnostics).
//
// Nothing downstream can point at a token the reader never kept, so the
// lexer is the floor the whole position story stands on: every token
// carries the span of its own text, and a node built from tokens spans
// the ones it was built from.
//
// It is PULL-BASED rather than a list-returning pass, for two reasons.
// A passage body is raw prose between braces (the spec's Prose ›
// Passages) and cannot be read with the same rules as the code around
// it, so the parser has to be able to change how the next thing is read;
// and a lexer that hands back one token at a time can report a bad
// character, step over it and carry on, where one that throws gives an
// author the first problem in their file and hides the rest.
//
// Reading a passage body is B29's — this is the token surface the rest
// of the language is written in, and the seam that lets B29 add the
// other one.

import type { Diagnostics } from './diagnostics.js';
import type { Span, SourceFile } from './source.js';
import type { Spanned } from './nodes.js';

export type TokenKind =
  /** `world`, `composing_room`, `default` — an identifier, which may be a keyword. */
  | 'name'
  /** `Season`, `Creature` — a kind or an enum. */
  | 'kind'
  /** `:season`, `:entered`, `:wet` — a property, a message or an option. */
  | 'symbol'
  /** `"work [target]"` — its `text` is the text it means, after escapes. */
  | 'string'
  /** `40` — unsigned; a minus sign is an operator the parser applies. */
  | 'integer'
  /** `{`, `->`, `==` — everything in PUNCTUATION. */
  | 'punct'
  /** The zero-width token at the end of the file, returned for ever after. */
  | 'end';

export interface Token extends Spanned {
  readonly kind: TokenKind;
  /**
   * What the token says: a string's text after escapes, a symbol's name
   * without its colon, everything else exactly as it was written.
   */
  readonly text: string;
}

/** Longest first, so `->` is never read as `-` and `==` is never read as `=`. */
const PUNCTUATION = [
  '->',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '(',
  ')',
  '{',
  '}',
  '[',
  ']',
  ',',
  '.',
  ':',
  '=',
  '<',
  '>',
  '+',
  '-',
  '!',
] as const;

const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';
const isLower = (ch: string): boolean => ch >= 'a' && ch <= 'z';
const isUpper = (ch: string): boolean => ch >= 'A' && ch <= 'Z';
const isNameRest = (ch: string): boolean => isLower(ch) || isDigit(ch) || ch === '_';
const isKindRest = (ch: string): boolean => isNameRest(ch) || isUpper(ch);

/**
 * One file's tokens, one at a time. Problems go to the `Diagnostics` it
 * was given and reading carries on, so a file with three bad characters
 * reports three times rather than once.
 */
export class Lexer {
  private at = 0;
  private readonly ahead: Token[] = [];

  constructor(
    readonly source: SourceFile,
    private readonly diagnostics: Diagnostics,
  ) {}

  /** The next token, consuming it. At the end of the file, the `end` token, for ever. */
  next(): Token {
    return this.ahead.length > 0 ? this.ahead.shift()! : this.read();
  }

  /** The token `ahead` places along, without consuming anything. */
  peek(ahead = 0): Token {
    while (this.ahead.length <= ahead) this.ahead.push(this.read());
    return this.ahead[ahead]!;
  }

  /** Whether everything but the `end` token has been read. */
  get done(): boolean {
    return this.peek().kind === 'end';
  }

  private span(start: number, end: number): Span {
    return this.source.span(start, end);
  }

  private token(kind: TokenKind, start: number, end: number, text?: string): Token {
    return { kind, at: this.span(start, end), text: text ?? this.source.text.slice(start, end) };
  }

  /** Past spaces, newlines and `//` comments, to the next thing that is a token. */
  private skipBlanks(): void {
    const text = this.source.text;
    for (;;) {
      while (this.at < text.length && /\s/.test(text[this.at]!)) this.at++;
      if (text[this.at] === '/' && text[this.at + 1] === '/') {
        while (this.at < text.length && text[this.at] !== '\n') this.at++;
        continue;
      }
      return;
    }
  }

  private read(): Token {
    const text = this.source.text;
    for (;;) {
      this.skipBlanks();
      const start = this.at;
      if (start >= text.length) return this.token('end', text.length, text.length, '');

      const ch = text[start]!;

      if (ch === '"') return this.readString(start);

      if (ch === ':' && isLower(text[start + 1] ?? '')) {
        let end = start + 1;
        while (end < text.length && isNameRest(text[end]!)) end++;
        this.at = end;
        return this.token('symbol', start, end, text.slice(start + 1, end));
      }

      if (isDigit(ch)) {
        let end = start;
        while (end < text.length && isDigit(text[end]!)) end++;
        this.at = end;
        return this.token('integer', start, end);
      }

      if (isLower(ch)) {
        let end = start;
        while (end < text.length && isNameRest(text[end]!)) end++;
        this.at = end;
        return this.token('name', start, end);
      }

      if (isUpper(ch)) {
        let end = start;
        while (end < text.length && isKindRest(text[end]!)) end++;
        this.at = end;
        return this.token('kind', start, end);
      }

      const punct = PUNCTUATION.find((p) => text.startsWith(p, start));
      if (punct !== undefined) {
        this.at = start + punct.length;
        return this.token('punct', start, this.at);
      }

      this.at = start + 1;
      this.diagnostics.refuse(
        this.span(start, this.at),
        `Sprout does not use the character "${ch}".`,
        'Remove it, or put it inside quotes if it is part of something to read.',
      );
    }
  }

  /**
   * `"…"`, with `\"`, `\\` and `\n` inside it. Text does not span lines:
   * a newline before the closing quote ends the token there and is
   * refused, which keeps one missing quote from swallowing the file.
   */
  private readString(start: number): Token {
    const source = this.source.text;
    let i = start + 1;
    let value = '';
    while (i < source.length) {
      const ch = source[i]!;
      if (ch === '"') {
        this.at = i + 1;
        return this.token('string', start, this.at, value);
      }
      if (ch === '\n') break;
      if (ch === '\\') {
        const escape = source[i + 1] ?? '';
        if (escape === '"' || escape === '\\') value += escape;
        else if (escape === 'n') value += '\n';
        else {
          this.diagnostics.refuse(
            this.span(i, i + 2),
            'A backslash inside text means one of \\" , \\\\ or \\n.',
            'Write \\\\ if you meant a backslash of its own.',
          );
          value += escape;
        }
        i += 2;
        continue;
      }
      value += ch;
      i++;
    }
    this.at = i;
    this.diagnostics.refuse(
      this.span(start, i),
      'This text is never closed.',
      'Add a closing " at the end of it. Text does not run past the end of a line.',
    );
    return this.token('string', start, i, value);
  }
}

/** Every token of a file, `end` last. For a whole-file pass that wants the list. */
export function tokenise(source: SourceFile, diagnostics: Diagnostics): Token[] {
  const lexer = new Lexer(source, diagnostics);
  const tokens: Token[] = [];
  for (;;) {
    const token = lexer.next();
    tokens.push(token);
    if (token.kind === 'end') return tokens;
  }
}
