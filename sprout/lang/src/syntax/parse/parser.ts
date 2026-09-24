// The source parser's context, which every grammar module beside it
// takes as its first argument: the cursor over the lexer's tokens, the
// depth bound and its once-per-declaration report, and the two questions
// of whether a declaration starts here (the first tier of the spec's The
// compiler › Two tiers).
//
// `readers` is the table of what it reads: every place that asks "does a
// declaration start here?" reads that one table, so the answer cannot
// differ from place to place.

import type { Declaration, Ident } from '../ast.js';
import type { Diagnostics } from '../../source/diagnostics.js';
import { Lexer, type LexerWindow, type Token, type TokenKind } from '../lexer.js';
import { DEFAULT_LIMITS, type StaticCaps } from '../../bundle/limits.js';
import type { SourceFile, Span } from '../../source/source.js';

/**
 * Punctuation that ends a list of things, so a word before it is the
 * last one — and so a word before it is an element rather than the
 * start of something, which is as much as recovery needs to know.
 */
const CLOSERS = new Set([',', '}', ']']);

/**
 * What each declaration's opening looks like, past the word itself.
 *
 * Recovery has to tell `enum Ward { … }`, which starts a declaration,
 * from `enum` standing where a word stands — a remembered property
 * called `enum`, an option written as `enum` — because the lexer reads
 * every one of them as a plain name. Where such a word may not be given
 * as a name is the reader's to refuse, at the word; what is here only
 * decides whether a DECLARATION starts. Only the word that starts one
 * knows what its own opening looks like, so each says, and a spec holds
 * that every word in the readers table has an entry here.
 *
 * Two tokens is as far as this looks, and it is deliberately the least
 * that separates the two readings: a guard that asks for more starts
 * refusing declarations an author really did write.
 */
const DECLARATION_SHAPES: ReadonlyMap<string, (name: Token, after: Token) => boolean> = new Map([
  // `enum Ward { oak, silver }` — a name that starts with a capital,
  // then the brace its options go in. Or the brace on its own: an
  // author who forgot the name still started an enum, and three
  // nameless ones in a row are three problems, not one.
  [
    'enum',
    (name: Token, after: Token) => punct(name, '{') || (name.kind === 'kind' && punct(after, '{')),
  ],
  // `message :stir` — the colon before the name is the whole of it, and
  // there is no brace to fall back on.
  ['message', (name: Token) => name.kind === 'symbol'],
  // `verb take { … }` — a name, then the brace its roles and phrases go
  // in: lower-case, or capitalised so that the refusal can say so. Or
  // the brace on its own, as for an enum.
  [
    'verb',
    (name: Token, after: Token) =>
      punct(name, '{') || ((name.kind === 'name' || name.kind === 'kind') && punct(after, '{')),
  ],
  // `world printers_shop is sprout.World { … }` — and the same with the
  // composition left out, or written with the colon, which parse so that
  // the refusal can name them.
  //
  // The brace on its own, as for an enum — but NOT a bare `:`, though a
  // nameless `world: victorian.Voice { … }` is written that way. A word
  // with a colon after it labels something, as `act` labels a role, and
  // the reader there refuses the word itself; a world with no name is
  // input an author seldom writes.
  [
    'world',
    (name: Token, after: Token) =>
      punct(name, '{') || (name.kind === 'name' && (punct(after, '{') || composing(after))),
  ],
  // `kind Crate is sprout.Container { … }`, or `kind Crate { … }`
  // composing nothing — a capitalised name, then its `is` (or the colon
  // written in its place) or its brace. Or the brace on its own, as for
  // an enum.
  [
    'kind',
    (name: Token, after: Token) =>
      punct(name, '{') || (name.kind === 'kind' && (punct(after, '{') || composing(after))),
  ],
  // `object bench is Bench { … }` — a lower-case name, then its `is`, or
  // the colon, the brace or the `in` of one that wrote its kinds with a
  // colon, left them out or named its container, which parse so that the
  // refusal can name what is wrong.
  [
    'object',
    (name: Token, after: Token) =>
      name.kind === 'name' &&
      (composing(after) || punct(after, '{') || (after.kind === 'name' && after.text === 'in')),
  ],
]);

/** Whether a declaration's kinds start here: `is`, or the colon written in its place. */
function composing(token: Token): boolean {
  return punct(token, ':') || (token.kind === 'name' && token.text === 'is');
}

/** Whether a token is one particular mark, which the shapes above ask a lot. */
export function punct(token: Token, text: string): boolean {
  return token.kind === 'punct' && token.text === text;
}

/**
 * Whether the next token can only belong to whatever encloses a list: the
 * next member's own name (a `symbol`), a word with a brace after it that
 * opens the next member's block (`remembers {`), or the body's own close
 * (`}`). None is ever a list element, so the hunt for a `]` stops here
 * rather than reading past it.
 */
export function atMemberOrClose(p: Parser): boolean {
  const block = p.peek().kind === 'name' && punct(p.peek(1), '{');
  return p.at('symbol') || block || p.at('punct', '}');
}

/**
 * How deep brackets and prefix signs may go before this parser refuses
 * to read further. The spec's Limits gives nesting no cap: this bound
 * is the parser's own, it is not a figure a host sets, and no bundle
 * records it.
 *
 * It is set by the STACK rather than by what is readable, since text
 * this parser accepts it must also survive. Reading one bracket costs
 * about nine JS frames, and the costliest shape — parentheses inside
 * call arguments — exhausts Node's default stack near depth seven
 * hundred, so this leaves a margin of more than five times over. It is
 * far above anything written on purpose; nothing in the spec's own
 * worlds nests past a handful.
 */
export const DEEPEST = 128;

/** What reads one declaration, as the `readers` table holds it. */
export type DeclarationReader = (p: Parser) => Declaration | null;

export class Parser {
  private readonly lexer: Lexer;
  /** How deep the brackets currently are, against `DEEPEST`. */
  depth = 0;
  /**
   * Whether the depth bound has already been reported for the
   * declaration being read. Too many brackets is ONE fact about one
   * piece of writing, and reading on past what could not be read —
   * which is how an author owed three problems is owed all three —
   * would otherwise meet the same wall once per bracket and say it
   * again each time.
   *
   * Reported once and then refused in silence, rather than abandoning
   * the rest: a `remembers` block whose first entry is too deep still
   * owes the author the missing value in its third. Cleared between
   * declarations, so two deep ones are two reports.
   */
  tooDeepReported = false;
  /**
   * Where a `[` stands, by source offset, that `closedBracketRun` has
   * found no `]` for. One failed probe answers for every `[` it walked
   * past, so a stretch of stray brackets is walked once and not once
   * per bracket.
   */
  readonly unclosedBrackets = new Set<number>();
  /** The extensions the file names at its top, whose statements `media.show(…)` writes. */
  readonly extensions = new Set<string>();

  constructor(
    readonly source: SourceFile,
    readonly diagnostics: Diagnostics,
    /** Each declaration this compiler reads, and what reads it. */
    readonly readers: ReadonlyMap<string, DeclarationReader>,
    readonly caps: StaticCaps = DEFAULT_LIMITS.caps,
    /** The part of the file to read, where it is one slot of prose and not the whole. */
    window?: LexerWindow,
  ) {
    this.lexer = new Lexer(source, diagnostics, window);
  }

  peek(ahead = 0): Token {
    return this.lexer.peek(ahead);
  }

  next(): Token {
    return this.lexer.next();
  }

  get done(): boolean {
    return this.peek().kind === 'end';
  }

  /**
   * Whether a comment or a passage never closed took the rest of the
   * file, having said so. A body it ran through is then not said to be
   * never closed as well: its `}` is inside what swallowed it.
   */
  get swallowedRest(): boolean {
    return this.lexer.swallowedRest;
  }

  /** Whether the next token is this punctuation, or this exact word. */
  at(kind: TokenKind, text?: string): boolean {
    const token = this.peek();
    return token.kind === kind && (text === undefined || token.text === text);
  }

  /** Consume the next token if it matches, and say whether it did. */
  take(kind: TokenKind, text?: string): Token | null {
    if (!this.at(kind, text)) return null;
    return this.next();
  }

  /** The zero-width span where something missing should have been written. */
  here(): Span {
    const token = this.peek();
    return this.source.span(token.at.start, token.at.start);
  }

  /** A name as written, as a node, so a problem about it points at it. */
  ident(token: Token): Ident {
    return { kind: 'ident', at: token.at, text: token.text };
  }

  /**
   * Whether a declaration begins here — asked by a loop that is reading
   * what the author WROTE, and so asked strictly.
   *
   * The lexer hands every declaration's word over as a plain name
   * wherever it stands, so the word alone decides nothing and its own
   * opening must: `DECLARATION_SHAPES` is what says whether that
   * opening is here, and a word without it is a word.
   *
   * Strictly, because of which way this one is allowed to be wrong. A
   * loop reading elements or members stops when this says yes, so a
   * false yes throws away something the author meant: `:ward [oak,
   * enum]` would lose its whole default. Recovery has the opposite
   * exposure and therefore its own question, below.
   */
  atDeclarationStart(ahead = 0): boolean {
    const token = this.peek(ahead);
    if (token.kind !== 'name' || !this.readers.has(token.text)) return false;
    const shape = DECLARATION_SHAPES.get(token.text);
    return shape !== undefined && shape(this.peek(ahead + 1), this.peek(ahead + 2));
  }

  /**
   * Whether recovery should stop here — the same question asked by a
   * loop that is skipping past what it could not read, and so asked
   * loosely.
   *
   * A word this compiler reads is where an author's next declaration
   * most likely begins, however badly they wrote it: `message` with the
   * name forgotten has no opening for `atDeclarationStart` to find, and
   * the strict question would walk past it as filler. A false yes costs
   * nothing here, because the file's own reader takes the word next and
   * says what is wrong with it; that asymmetry is why these are two
   * questions and not one.
   */
  atRecoveryStop(ahead = 0): boolean {
    const token = this.peek(ahead);
    if (token.kind !== 'name' || !this.readers.has(token.text)) return false;
    const after = this.peek(ahead + 1);
    if (after.kind === 'end') return false;
    return !(after.kind === 'punct' && CLOSERS.has(after.text));
  }

  /** One deeper, or a refusal that the parser's own bound is reached. */
  deeper(at: Span, remedy = 'Take some of the brackets out.'): boolean {
    if (this.depth + 1 > DEEPEST) {
      this.reportTooDeep(at, remedy);
      return false;
    }
    this.depth += 1;
    return true;
  }

  /**
   * Too deep to read, said once per declaration and refused in silence
   * after. It names no number: the bound is the parser's own and an
   * author who is told a figure will read it as something they may
   * write up to.
   */
  reportTooDeep(at: Span, remedy: string): void {
    if (this.tooDeepReported) return;
    this.tooDeepReported = true;
    this.diagnostics.refuse(at, 'This is nested too deep to read.', remedy);
  }

  /** A token as a person would describe it, for a message about the wrong one. */
  describe(token: Token): string {
    switch (token.kind) {
      case 'kind':
        return `\`${token.text}\`, which starts with a capital`;
      case 'string':
        return 'text in quotes';
      case 'integer':
        return `the number ${token.text}`;
      case 'symbol':
        return `\`:${token.text}\`, which is a property or a message`;
      case 'end':
        return 'the end of the file';
      case 'passage-body':
        return "a passage's words in braces";
      default:
        return `\`${token.text}\``;
    }
  }
}
