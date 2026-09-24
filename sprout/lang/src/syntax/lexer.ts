// Where spans come from (the spec's The compiler › Diagnostics, Lexical
// rules).
//
// Nothing downstream can point at a token the reader never kept, so
// every token carries the span of its own text, and a node built from
// tokens spans the ones it was built from.
//
// It is PULL-BASED rather than a list-returning pass: a lexer that hands
// back one token at a time can report a bad character, step over it and
// carry on, where one that throws gives an author the first problem in
// their file and hides the rest.
//
// A passage's body is raw prose between braces (the spec's Prose ›
// Passages) and is not read by the rules of the code around it: an
// apostrophe or a `?` would be refused, and every recovery walk would
// count the braces of its slots. So the body is one `passage-body` token
// holding its text whole, and `parse/prose.ts` reads what it says. What
// opens one is decided here, from the tokens already read rather than from the
// parser, because a parser looking ahead for a closing bracket reads
// past a passage before any reader has asked for it.

import type { Diagnostics } from '../source/diagnostics.js';
import type { Span, SourceFile } from '../source/source.js';
import type { Spanned } from '../source/nodes.js';

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
  /**
   * `{ You take {target}. }` after a passage's header — its `text` is
   * everything between the outer braces, exactly as written.
   */
  | 'passage-body'
  /** The zero-width token at the end of the file, returned for ever after. */
  | 'end';

export interface Token extends Spanned {
  readonly kind: TokenKind;
  /**
   * What the token says: a string's text after escapes, a symbol's name
   * without its colon, everything else exactly as it was written.
   */
  readonly text: string;
  /**
   * Whether a character was refused and stepped over immediately before
   * this token. A refused character leaves no token, so without this the
   * parser sees two things side by side that were not, and reports the
   * gap as a missing separator — one mistake, said twice, the second
   * time wrongly. It rides on the token rather than being reconstructed
   * from offsets, so that no caller has to pass an exact end offset to
   * get the right answer.
   */
  readonly afterRefusal: boolean;
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

/** What may follow a backslash, in quoted text and in a passage alike (the spec's Lexical rules). */
const ESCAPES: ReadonlySet<string> = new Set(['"', '\\', 'n', '{']);

/**
 * The tokens a passage's header may hold between `passage` and its `{`.
 * The header is a name and `default`; one more is allowed so that a stray
 * word there is refused at the word rather than the prose after it being
 * read as code.
 */
export const HEADER_WORDS = 3;

/** The kinds of token that may stand in a passage's header. */
export const HEADER_KINDS: ReadonlySet<TokenKind> = new Set([
  'name',
  'kind',
  'symbol',
  'string',
  'integer',
]);

/** A passage's header while it is being read: the words after `passage` so far. */
interface Header {
  readonly words: number;
  /** Where the last token of the header ended, to tell a word on the next line. */
  readonly end: number;
  /** The passage's name where one was written, for the refusal of a body never closed. */
  readonly name: string | null;
}

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
/** A stretch of a file to read on its own, as a slot inside prose is read. */
export interface LexerWindow {
  readonly start: number;
  readonly end: number;
}

export class Lexer {
  private at = 0;
  private readonly ahead: Token[] = [];
  /**
   * How far into `ahead` the reader has got. A cursor rather than a
   * `shift()` per token, because `peek` will buffer as far as it is
   * asked to — a parser stepping over a construct it could not read
   * looks for its closing bracket first — and shifting one token at a
   * time out of a long buffer is quadratic in its length.
   */
  private aheadAt = 0;
  /** Whether a character was refused since the last token was made. */
  private pendingRefusal = false;
  /** The passage header being read, from the word `passage` to the `{` that opens its body. */
  private header: Header | null = null;
  /** Whether a comment or a passage body never closed took the rest of the file. */
  private swallowed = false;

  /** The text read: the file's, cut at the end of the window where there is one, so every offset is the file's. */
  private readonly text: string;
  /** Whether `$first` and its kind are names, as they are inside a passage's slots. */
  private readonly prose: boolean;

  /**
   * @param window the part of the file to read, where it is not the whole:
   *   a slot of a passage or of quoted text, whose `$` names are read as names
   */
  constructor(
    readonly source: SourceFile,
    private readonly diagnostics: Diagnostics,
    window?: LexerWindow,
  ) {
    this.text = window === undefined ? source.text : source.text.slice(0, window.end);
    this.at = window?.start ?? 0;
    this.prose = window !== undefined;
  }

  /** The next token, consuming it. At the end of the file, the `end` token, for ever. */
  next(): Token {
    if (this.aheadAt >= this.ahead.length) return this.read();
    const token = this.ahead[this.aheadAt++]!;
    if (this.aheadAt === this.ahead.length) {
      this.ahead.length = 0;
      this.aheadAt = 0;
    }
    return token;
  }

  /** The token `ahead` places along, without consuming anything. */
  peek(ahead = 0): Token {
    while (this.ahead.length - this.aheadAt <= ahead) this.ahead.push(this.read());
    return this.ahead[this.aheadAt + ahead]!;
  }

  /**
   * Whether a comment or a passage body never closed took the rest of
   * the file. What was open around it was closed inside it, so its own
   * refusal is the one mistake to report.
   */
  get swallowedRest(): boolean {
    return this.swallowed;
  }

  /** Whether everything but the `end` token has been read. */
  get done(): boolean {
    return this.peek().kind === 'end';
  }

  private span(start: number, end: number): Span {
    return this.source.span(start, end);
  }

  private token(kind: TokenKind, start: number, end: number, text?: string): Token {
    const afterRefusal = this.pendingRefusal;
    this.pendingRefusal = false;
    return {
      kind,
      at: this.span(start, end),
      text: text ?? this.source.text.slice(start, end),
      afterRefusal,
    };
  }

  /**
   * Past spaces, newlines and comments, to the next thing that is a
   * token. A comment is `//` to the end of its line or `/* … *\/` across
   * lines (the spec's Lexical rules); block comments do not nest, so the
   * first `*\/` closes one however many `/*` it holds.
   */
  private skipBlanks(): void {
    const text = this.text;
    for (;;) {
      while (this.at < text.length && /\s/.test(text[this.at]!)) this.at++;
      if (text[this.at] === '/' && text[this.at + 1] === '/') {
        while (this.at < text.length && text[this.at] !== '\n') this.at++;
        continue;
      }
      if (text[this.at] === '/' && text[this.at + 1] === '*') {
        const start = this.at;
        const close = text.indexOf('*/', start + 2);
        if (close >= 0) {
          this.at = close + 2;
          continue;
        }
        // Never closed: the rest of the file is comment, and saying so
        // at the opening keeps one missing `*\/` from being reported as
        // a file that simply ended.
        this.at = text.length;
        this.pendingRefusal = true;
        this.swallowed = true;
        this.diagnostics.refuse(
          this.span(start, start + 2),
          'This comment is never closed.',
          'Add */ where it ends. A comment that starts with /* runs until the next */.',
        );
        return;
      }
      return;
    }
  }

  private read(): Token {
    const token = this.readToken();
    this.follow(token);
    return token;
  }

  /**
   * Keep track of a passage header. A `{` opens a passage's body when it
   * follows the word `passage` with at most `HEADER_WORDS` words between,
   * all on the line `passage` was written on: a header left without its
   * braces then never takes the next line's member for its own.
   */
  private follow(token: Token): void {
    if (token.kind === 'name' && token.text === 'passage') {
      this.header = { words: 0, end: token.at.end, name: null };
      return;
    }
    const header = this.header;
    if (header === null) return;
    const sameLine = !this.text.slice(header.end, token.at.start).includes('\n');
    if (!HEADER_KINDS.has(token.kind) || !sameLine || header.words >= HEADER_WORDS) {
      this.header = null;
      return;
    }
    const named = token.kind !== 'name' || token.text !== 'default';
    this.header = {
      words: header.words + 1,
      end: token.at.end,
      name: header.name ?? (named ? token.text : null),
    };
  }

  private readToken(): Token {
    const text = this.text;
    for (;;) {
      this.skipBlanks();
      const start = this.at;
      if (start >= text.length) return this.token('end', text.length, text.length, '');

      const ch = text[start]!;

      if (ch === '"') return this.readString(start);

      // `$first`, `$last`, `$index` and `$count` inside a passage's
      // slots (the spec's Prose › Conditionals and loops).
      if (ch === '$' && this.prose && isLower(text[start + 1] ?? '')) {
        let end = start + 1;
        while (end < text.length && isNameRest(text[end]!)) end++;
        this.at = end;
        return this.token('name', start, end);
      }

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

      // `_` on its own is the name for a parameter left unnamed (the
      // spec's Events › Receiving); a name still starts with a letter.
      if (ch === '_' && !isNameRest(text[start + 1] ?? '')) {
        this.at = start + 1;
        return this.token('name', start, this.at);
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

      if (ch === '{' && this.header !== null) return this.readPassageBody(start);

      const punct = PUNCTUATION.find((p) => text.startsWith(p, start));
      if (punct !== undefined) {
        this.at = start + punct.length;
        return this.token('punct', start, this.at);
      }

      this.at = start + 1;
      this.pendingRefusal = true;
      this.diagnostics.refuse(
        this.span(start, this.at),
        `Sprout does not use the character "${ch}".`,
        'Remove it, or put it inside quotes if it is part of something to read.',
      );
    }
  }

  /**
   * `"…"`, with `\"`, `\\`, `\n` and `\{` inside it. Text does not span
   * lines: a newline before the closing quote ends the token there and is
   * refused, which keeps one missing quote from swallowing the file. An
   * unescaped `{` is an ordinary character here; only a passage reads it.
   */
  private readString(start: number): Token {
    const source = this.text;
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
        if (escape === 'n') value += '\n';
        else if (ESCAPES.has(escape)) value += escape;
        else {
          this.diagnostics.refuse(
            this.span(i, i + 2),
            'A backslash inside text means one of \\" , \\\\ , \\n or \\{.',
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

  /**
   * A passage's body, from its `{` through the `}` that matches it. Braces
   * inside nest, since each opens a slot; one escaped, `\{`, is a
   * character. Inside a slot, quoted text is text, and a brace in it counts
   * for nothing. `//` and `/*` are prose here, not comments. A body never
   * closed is refused once, at its opening, and takes the rest of the file.
   */
  private readPassageBody(open: number): Token {
    const text = this.text;
    const name = this.header?.name ?? null;
    let depth = 0;
    let quoted = false;
    let i = open + 1;
    while (i < text.length) {
      const ch = text[i]!;
      if (ch === '\\') {
        const escape = text[i + 1] ?? '';
        if (ESCAPES.has(escape)) {
          i += 2;
          continue;
        }
        // Stepped over with the character after it, as in quoted text, so
        // a `\}` meant as a brace does not close anything; a line break
        // after it is left to be read.
        const width = escape === '' || escape === '\n' ? 1 : 2;
        this.diagnostics.refuse(
          this.span(i, i + width),
          'A backslash inside a passage means one of \\" , \\\\ , \\n or \\{.',
          'Write \\\\ if you meant a backslash of its own.',
        );
        i += width;
        continue;
      }
      if (quoted) {
        // Quoted text in a slot ends at its quote, or at the end of its
        // line as quoted text in code does.
        if (ch === '"' || ch === '\n') quoted = false;
      } else if (ch === '"') {
        quoted = depth > 0;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        if (depth === 0) {
          this.at = i + 1;
          return this.token('passage-body', open, this.at, text.slice(open + 1, i));
        }
        depth -= 1;
      }
      i += 1;
    }
    this.at = text.length;
    this.diagnostics.refuse(
      this.span(open, open + 1),
      name === null
        ? 'This passage opens here and is never closed.'
        : `The passage \`${name}\` opens here and is never closed.`,
      'Add a } where its words end. Every { inside a passage opens a slot that needs its own }; write \\{ for a brace that is only a character.',
    );
    const token = this.token('passage-body', open, text.length, text.slice(open + 1));
    this.pendingRefusal = true;
    this.swallowed = true;
    return token;
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
