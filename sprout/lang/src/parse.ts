// Reading a file into declarations (B05 onward; the first tier of the
// spec's The compiler › Two tiers).
//
// This is the parser for SOURCE — what an author writes in a `.sprout`
// file — and not the parser for what a visitor types, which is B27's and
// lives in `parser.ts`. It is built one backlog item at a time, and
// `READERS` is the table of what it currently reads: every place that
// asks "does a declaration start here?" reads that one table, because
// #59 was opened after four different answers to that question
// disagreed with one another.
//
// Two things it does deliberately. It RECOVERS: a declaration it cannot
// read costs that declaration and not the file, because an author owed
// three problems is owed all three. And every node it builds carries the
// span of the tokens it was built from, down to the individual option of
// an enum, so a diagnostic points at the word that is wrong.
//
// Three rules hold the recovery together, and each exists because its
// absence produced a bug:
//
//   - A missing separator is reported only once the NEXT item reads
//     successfully. A token that cannot be an item at all is that
//     token's problem, not a missing comma's.
//   - A gap the lexer made by stepping over a character is never blamed
//     on the author. The token after it says so itself (`afterRefusal`),
//     so no offset is carried and none can go stale.
//   - A word that starts a declaration is one only where a declaration
//     could start. `enum Ward { message, silver }` is a well-formed
//     enum, because nothing reserves an option's name.

import type {
  BinaryOperator,
  Declaration,
  Expr,
  LetStatement,
  EnumDeclaration,
  EnumOption,
  Ident,
  Literal,
  MessageDeclaration,
  PropertyDeclaration,
  RemembersDeclaration,
  TypeExpr,
  UnaryOperator,
} from './ast.js';
import type { Diagnostics } from './diagnostics.js';
import { Lexer, type Token, type TokenKind } from './lexer.js';
import { DEFAULT_LIMITS, type StaticCaps } from './limits.js';
import { spanning, type SourceFile, type Span } from './source.js';

/**
 * The words that start a declaration, as this compiler reads them
 * today, for anything outside the parser that needs the list.
 *
 * The parser itself never reads this: it dispatches off the `readers`
 * table and builds its "this compiler reads …" message from the same
 * table, so the message cannot go stale when a declaration is added. A
 * spec holds that this list and that message name the same words, in
 * both directions.
 */
export const DECLARATIONS = ['enum', 'message'] as const;

/**
 * The type names that are the language's own. They are read as types
 * wherever a type may be written. An enum may still declare an option
 * called `string` — *Reserved names* does not cover options — it simply
 * cannot be reached through the shorthand that takes a property's type
 * from its default.
 */
const BUILT_IN_TYPE_WORDS = new Set(['boolean', 'integer', 'string', 'object']);

/** Punctuation that ends a list of things, so a word before it is the last one. */
const CLOSERS = new Set([',', '}', ']']);

/** Which bracket opens which, for stepping over what the cap refused. */
const OPENER_OF: ReadonlyMap<string, string> = new Map([
  [']', '['],
  [')', '('],
  ['}', '{'],
]);

/**
 * How tightly each binary operator binds, loosest first. Nothing in the
 * spec states a precedence — see the notes' hole — so this is the
 * conventional one, which is what every expression the spec writes
 * already assumes: `p != self && chance(4)` reads as `(p != self) &&
 * chance(4)` and no other way.
 *
 * It is a table read by ONE loop rather than five near-identical
 * functions, for the reason #59 exists: four places that answered the
 * same question separately gave three different answers.
 */
const BINARY_PRECEDENCE: ReadonlyMap<string, number> = new Map([
  ['||', 1],
  ['&&', 2],
  ['==', 3],
  ['!=', 3],
  ['<', 4],
  ['<=', 4],
  ['>', 4],
  ['>=', 4],
  ['+', 5],
  ['-', 5],
]);

const LOOSEST = 1;
const TIGHTEST = 5;

/** The two prefix operators. `-x` is an expression; `!` has no truthiness behind it. */
const PREFIX = new Set<string>(['!', '-']);

/** What the text after an item turns out to mean. */
type Separator =
  /** The list ends here, or the file does. */
  | 'end'
  /** A separator was written and has been consumed. */
  | 'comma'
  /** No separator, but the lexer stepped over something here and has said so. */
  | 'gap'
  /** No separator, and nothing explains its absence. */
  | 'missing';

/** A list written out the way a person reads one: `a`, `a and b`, `a, b and c`. */
function readable(words: readonly string[]): string {
  if (words.length === 0) return 'nothing';
  if (words.length === 1) return `\`${words[0]}\``;
  const all = words.map((word) => `\`${word}\``);
  return `${all.slice(0, -1).join(', ')} and ${all.at(-1)}`;
}

class Parser {
  private readonly lexer: Lexer;
  /** Each declaration this compiler reads, and what reads it. */
  private readonly readers: ReadonlyMap<string, () => Declaration | null>;
  /** How deep the brackets currently are, against the host's nesting cap. */
  private depth = 0;
  /**
   * Whether the host's nesting cap has already been reported for the
   * declaration being read. Too many brackets is ONE fact about one
   * piece of writing, and reading on past what could not be read —
   * which is how an author owed three problems is owed all three —
   * would otherwise walk into the same wall once per bracket and say
   * it again each time. `:x [[[[…` said it 1,992 times.
   *
   * Reported once and then refused in silence, rather than abandoning
   * the rest: a `:remembers` whose first entry is too deep still owes
   * the author the missing colon in its third. Cleared between
   * declarations, so two deep ones are two reports.
   */
  private capReported = false;

  constructor(
    private readonly source: SourceFile,
    private readonly diagnostics: Diagnostics,
    private readonly caps: StaticCaps = DEFAULT_LIMITS.caps,
  ) {
    this.lexer = new Lexer(source, diagnostics);
    this.readers = new Map<string, () => Declaration | null>([
      ['enum', () => this.enumDeclaration()],
      ['message', () => this.messageDeclaration()],
    ]);
  }

  private peek(ahead = 0): Token {
    return this.lexer.peek(ahead);
  }

  private next(): Token {
    return this.lexer.next();
  }

  private get done(): boolean {
    return this.peek().kind === 'end';
  }

  /** Whether the next token is this punctuation, or this exact word. */
  private at(kind: TokenKind, text?: string): boolean {
    const token = this.peek();
    return token.kind === kind && (text === undefined || token.text === text);
  }

  /** Consume the next token if it matches, and say whether it did. */
  private take(kind: TokenKind, text?: string): Token | null {
    if (!this.at(kind, text)) return null;
    return this.next();
  }

  /** The zero-width span where something missing should have been written. */
  private here(): Span {
    const token = this.peek();
    return this.source.span(token.at.start, token.at.start);
  }

  /** A name as written, as a node, so a problem about it points at it. */
  private ident(token: Token): Ident {
    return { kind: 'ident', at: token.at, text: token.text };
  }

  /**
   * Whether the next token begins a declaration rather than being a word
   * that happens to spell one.
   *
   * Nothing reserves `enum` or `message` as an option name, so the word
   * alone decides nothing. What decides is what FOLLOWS: a declaration
   * is followed by its own name, where an option is followed by a
   * separator, by the thing that closes its list, or by the end of the
   * file.
   */
  private atDeclarationKeyword(): boolean {
    const token = this.peek();
    if (token.kind !== 'name' || !this.readers.has(token.text)) return false;
    const after = this.peek(1);
    if (after.kind === 'end') return false;
    return !(after.kind === 'punct' && CLOSERS.has(after.text));
  }

  /** One deeper, or a refusal that the host's nesting cap is reached. */
  private deeper(at: Span, remedy = 'Take some of the brackets out.'): boolean {
    if (this.depth + 1 > this.caps.nesting) {
      this.reportCap(at, remedy);
      return false;
    }
    this.depth += 1;
    return true;
  }

  /**
   * Step over what the cap would not let us read, the opening bracket
   * already taken. Without this the bracket is consumed, its level
   * never opens, and its CLOSER is left in the stream — where the next
   * recovery loop takes it for its own closing bracket and ends early,
   * dropping everything after it with nothing said. Counting matched
   * pairs on the way leaves the reader exactly past the construct.
   */
  private skipBracketed(close: string): void {
    const open = OPENER_OF.get(close)!;
    // Find the closer BEFORE taking anything. Two failures this avoids,
    // and the first version of this walked into both: a bracket that
    // was never closed takes the rest of the file with it, including
    // declarations that have nothing to do with this one; and a guard
    // that stops the skip early — on a declaration keyword, say —
    // leaves the real closers behind, which is the stray-closer bug
    // this helper exists to prevent. Nothing reserves `message` as a
    // word, so `[message foo]` is a list of two things and the skip
    // must walk straight past it.
    let depth = 1;
    let ahead = 0;
    for (;;) {
      const token = this.peek(ahead);
      if (token.kind === 'end') return; // never closed: take nothing
      if (token.kind === 'punct') {
        if (token.text === open) depth += 1;
        else if (token.text === close && --depth === 0) break;
      }
      ahead += 1;
    }
    for (let i = 0; i <= ahead; i++) this.next();
  }

  /** The nesting cap, said once per declaration and refused in silence after. */
  private reportCap(at: Span, remedy: string): void {
    if (this.capReported) return;
    this.capReported = true;
    this.diagnostics.refuse(
      at,
      `Nothing here may be nested more than ${this.caps.nesting} deep.`,
      remedy,
    );
  }

  /** What the text after an item means. A comma, where there is one, is consumed. */
  private separator(close: string): Separator {
    if (this.done) return 'end';
    if (this.at('punct', close)) return 'end';
    if (this.take('punct', ',') !== null) return 'comma';
    if (this.peek().afterRefusal) return 'gap';
    return 'missing';
  }

  /** Step over everything up to the next thing that could start a declaration. */
  private recover(): void {
    while (!this.done) {
      if (this.atDeclarationKeyword()) return;
      this.next();
    }
  }

  /**
   * Step over an enum's remaining options. Says whether it found the
   * closing brace, so the caller can report an enum the file simply ran
   * out before closing.
   */
  private recoverInBraces(): boolean {
    let depth = 1;
    while (!this.done) {
      if (this.at('punct', '{')) {
        depth += 1;
        this.next();
        continue;
      }
      if (this.at('punct', '}')) {
        depth -= 1;
        this.next();
        if (depth === 0) return true;
        continue;
      }
      // Only at the body's own depth. Below it an unmatched `{` means
      // the brace structure is already lost, and a keyword down there is
      // no more trustworthy than anything else — reading it as a
      // declaration promotes nested text to the top of the file.
      if (depth === 1 && this.atDeclarationKeyword()) return false;
      this.next();
    }
    return false;
  }

  /** Every declaration in the file, in the order they were written. */
  file(): Declaration[] {
    const declarations: Declaration[] = [];
    while (!this.done) {
      const token = this.peek();
      const read = token.kind === 'name' ? this.readers.get(token.text) : undefined;
      if (read !== undefined) {
        // Each declaration is owed its own account of being too deep.
        this.capReported = false;
        const declared = read();
        if (declared !== null) declarations.push(declared);
        continue;
      }
      this.diagnostics.refuse(
        token.at,
        `Sprout does not know what to do with "${token.text}" here.`,
        `A file holds declarations, and this compiler reads ${readable([...this.readers.keys()])}.`,
      );
      this.next();
      this.recover();
    }
    return declarations;
  }

  /** `enum Ward { oak, silver }` */
  private enumDeclaration(): EnumDeclaration | null {
    const keyword = this.next();

    const named = this.take('kind');
    if (named === null) {
      this.diagnostics.refuse(
        this.at('punct', '{') ? this.here() : this.peek().at,
        'An enum needs a name.',
        'A name for an enum starts with a capital: `enum Ward { oak, silver }`.',
      );
      this.recover();
      return null;
    }
    const name = this.ident(named);

    if (this.take('punct', '{') === null) {
      this.diagnostics.refuse(
        this.here(),
        `The options of \`${name.text}\` go in braces.`,
        `Write \`enum ${name.text} { oak, silver }\`, listing the values it can hold.`,
      );
      this.recover();
      return null;
    }

    const unclosed = (at: Span): void => {
      this.diagnostics.refuse(
        at,
        `\`${name.text}\` is never closed.`,
        'Add a } after its options.',
      );
    };

    const options: EnumOption[] = [];
    let refused = false;
    /** Where a comma should have been, held until the next option proves it was wanted. */
    let missingComma: Span | null = null;

    for (;;) {
      if (this.done) {
        unclosed(this.source.endSpan);
        refused = true;
        break;
      }
      if (this.at('punct', '}')) {
        this.next();
        break;
      }
      if (this.atDeclarationKeyword()) {
        unclosed(this.peek().at);
        refused = true;
        break;
      }

      const word = this.take('name');
      if (word === null) {
        const wrong = this.peek();
        this.diagnostics.refuse(
          wrong.at,
          `\`${name.text}\` cannot hold ${this.describe(wrong)}.`,
          'An option is a lower-case word: `oak`, `touch_dry`, `the_press`.',
        );
        // `recoverInBraces` gives up for two reasons: the file ran out,
        // or it found the next declaration and left it unconsumed. The
        // second has a token to point at, and pointing past it at the
        // end of the file names the wrong place.
        if (!this.recoverInBraces()) {
          unclosed(this.done ? this.source.endSpan : this.peek().at);
        }
        refused = true;
        break;
      }

      // The option read, so a separator really was wanted before it.
      if (missingComma !== null) {
        this.diagnostics.refuse(
          missingComma,
          `\`${name.text}\` needs a comma between its options.`,
          `Write \`enum ${name.text} { ${[...options.map((o) => o.name.text), word.text].join(', ')}, … }\`.`,
        );
        missingComma = null;
      }
      options.push({ kind: 'option', at: word.at, name: this.ident(word) });

      const after = this.separator('}');
      if (after === 'missing') missingComma = this.here();
      if (after === 'comma' && this.at('punct', '}')) {
        this.diagnostics.refuse(
          this.peek().at,
          `\`${name.text}\` has a comma after its last option.`,
          'Remove it: options are separated by commas, not ended by them.',
        );
      }
    }

    if (options.length === 0) {
      // Whatever went wrong has already been named; saying the enum has
      // no options as well reports one mistake twice.
      if (refused) return null;
      this.diagnostics.refuse(
        name.at,
        `\`${name.text}\` has no options, so nothing could ever hold one.`,
        `Write the values it can take: \`enum ${name.text} { oak, silver }\`.`,
      );
      return null;
    }

    const last = options.at(-1)!;
    return { kind: 'enum', at: spanning(keyword.at, last.at), name, options };
  }

  // --- types, literals and properties -------------------------------------

  /** `boolean`, `Drying`, `sprout.Ward`, `[Ward]`. */
  private typeExpr(): TypeExpr | null {
    const open = this.take('punct', '[');
    if (open !== null) {
      if (!this.deeper(open.at)) {
        this.skipBracketed(']');
        return null;
      }
      try {
        const element = this.typeExpr();
        if (element === null) return null;
        const close = this.take('punct', ']');
        if (close !== null) {
          return { kind: 'list-type', at: spanning(open.at, close.at), element };
        }
        if (this.at('punct', ',')) {
          // `[Ward, oak]` is a list VALUE whose first element was
          // capitalised, not a list type with too much in it. Saying
          // "never closed" would point at a bracket the author wrote
          // correctly.
          this.diagnostics.refuse(
            this.peek().at,
            'A list type names one element type.',
            'Write `[Ward]` for a list of wards. A list of values is written with its values: `[oak, silver]`.',
          );
          return null;
        }
        this.diagnostics.refuse(
          this.here(),
          'A list type is never closed.',
          'Write the element type in brackets, as in `[Ward]`.',
        );
        return null;
      } finally {
        this.depth -= 1;
      }
    }

    const first = this.peek();
    if (first.kind === 'kind') {
      this.next();
      return { kind: 'named-type', at: first.at, library: null, name: this.ident(first) };
    }
    // Before the library branch: `boolean.` is the language's own word
    // followed by a stray dot, never a library called `boolean`.
    if (first.kind === 'name' && BUILT_IN_TYPE_WORDS.has(first.text)) {
      this.next();
      return { kind: 'named-type', at: first.at, library: null, name: this.ident(first) };
    }
    if (first.kind === 'name' && this.peek(1).kind === 'punct' && this.peek(1).text === '.') {
      const library = this.next();
      this.next();
      const named = this.take('kind');
      if (named === null) {
        this.diagnostics.refuse(
          this.peek().at,
          `\`${library.text}.\` is not followed by a name.`,
          "A library's kind or enum starts with a capital, as in `sprout.Ward`.",
        );
        return null;
      }
      return {
        kind: 'named-type',
        at: spanning(library.at, named.at),
        library: this.ident(library),
        name: this.ident(named),
      };
    }
    this.diagnostics.refuse(
      first.at,
      `${this.describe(first)} is not a type.`,
      'Write `boolean`, `integer`, `string`, the name of an enum, or `[…]` for a list of those.',
    );
    return null;
  }

  /** Whether what comes next is a type rather than a value. */
  private atType(): boolean {
    const first = this.peek();
    if (first.kind === 'kind') return true;
    if (first.kind === 'name' && BUILT_IN_TYPE_WORDS.has(first.text)) return true;
    if (first.kind === 'name' && this.peek(1).kind === 'punct' && this.peek(1).text === '.') {
      return true;
    }
    // `[Ward]` is a list type and `[oak]` is a list value; the capital
    // tells them apart. Only the first element is looked at, which is
    // why `typeExpr` says something accurate about `[Ward, oak]`.
    if (first.kind === 'punct' && first.text === '[') {
      let ahead = 1;
      while (this.peek(ahead).kind === 'punct' && this.peek(ahead).text === '[') ahead += 1;
      const inner = this.peek(ahead);
      if (inner.kind === 'kind') return true;
      if (inner.kind === 'name' && BUILT_IN_TYPE_WORDS.has(inner.text)) return true;
      if (
        inner.kind === 'name' &&
        this.peek(ahead + 1).kind === 'punct' &&
        this.peek(ahead + 1).text === '.'
      ) {
        return true;
      }
    }
    return false;
  }

  /** `false`, `4`, `"a line"`, `wet`, `[oak, silver]`. */
  private literal(): Literal | null {
    const token = this.peek();
    if (token.kind === 'punct' && token.text === '-') {
      this.next();
      const digits = this.take('integer');
      if (digits === null) {
        this.diagnostics.refuse(
          this.peek().at,
          'A minus sign needs a number after it.',
          'Write a whole number, as in `-3`.',
        );
        return null;
      }
      if (this.atFraction()) return null;
      return { kind: 'integer', at: spanning(token.at, digits.at), value: -Number(digits.text) };
    }
    if (token.kind === 'integer') {
      this.next();
      if (this.atFraction()) return null;
      return { kind: 'integer', at: token.at, value: Number(token.text) };
    }
    if (token.kind === 'string') {
      this.next();
      return { kind: 'string', at: token.at, value: token.text };
    }
    if (token.kind === 'name' && (token.text === 'true' || token.text === 'false')) {
      this.next();
      return { kind: 'boolean', at: token.at, value: token.text === 'true' };
    }
    if (token.kind === 'name') {
      this.next();
      return { kind: 'option-literal', at: token.at, name: this.ident(token) };
    }
    if (token.kind === 'punct' && token.text === '[') {
      const open = this.next();
      if (!this.deeper(open.at)) {
        this.skipBracketed(']');
        return null;
      }
      try {
        return this.listLiteral(open);
      } finally {
        this.depth -= 1;
      }
    }
    this.diagnostics.refuse(
      token.at,
      `${this.describe(token)} is not a value.`,
      'Write `true` or `false`, a whole number, text in quotes, an option of an enum, or a list.',
    );
    return null;
  }

  /**
   * A decimal point after a number. Sprout has no fractions, and an
   * author who wrote one is owed that sentence rather than a complaint
   * about the separator their `.` ran into.
   */
  private atFraction(): boolean {
    if (!(this.at('punct', '.') && this.peek(1).kind === 'integer')) return false;
    const dot = this.next();
    const rest = this.next();
    this.diagnostics.refuse(
      spanning(dot.at, rest.at),
      'Sprout has no fractions.',
      'Write a whole number. A quantity that needs halves is counted in halves.',
    );
    return true;
  }

  /** `[oak, silver]`, the brackets already open. */
  private listLiteral(open: Token): Literal | null {
    const elements: Literal[] = [];
    let missingComma: Span | null = null;
    // Said once, at the element that breaks it, and then read on: the
    // cap is one fact about one list, and an author whose list is two
    // too long is still owed whatever else is wrong inside it. The
    // declaration is refused at the end rather than truncated, because
    // a silent drop is the one thing a full list must never be.
    let overCap = false;
    for (;;) {
      const close = this.take('punct', ']');
      if (close !== null) {
        if (overCap) return null;
        return { kind: 'list-literal', at: spanning(open.at, close.at), elements };
      }
      if (this.done) {
        this.diagnostics.refuse(
          this.source.endSpan,
          'This list is never closed.',
          'Add a ] after its elements.',
        );
        return null;
      }
      const before = this.peek();
      const element = this.literal();
      if (element === null) {
        // An author owed three problems is owed all three, so the list
        // reads ON — past the element it could not read, and not past
        // everything up to the next comma, which would swallow the
        // well-formed elements in between without saying so.
        //
        // Unless the file itself ran out inside that element, in which
        // case whatever it already said is the whole explanation.
        // Looping back to the top would have every list enclosing this
        // one say "never closed" about the same exhausted file, once
        // per level of nesting.
        if (this.done) return null;
        if (this.peek().at.start === before.at.start) this.next();
        this.separator(']');
        missingComma = null;
        continue;
      }
      if (missingComma !== null) {
        this.diagnostics.refuse(
          missingComma,
          'A list needs a comma between its elements.',
          'Write `[oak, silver]`.',
        );
        missingComma = null;
      }
      if (elements.length >= this.caps.listElements) {
        if (!overCap) {
          this.diagnostics.refuse(
            element.at,
            `A list holds at most ${this.caps.listElements} things.`,
            'Take some out, or hold them somewhere that is not a list.',
          );
          overCap = true;
        }
      } else {
        elements.push(element);
      }
      if (this.separator(']') === 'missing') missingComma = this.here();
    }
  }

  /**
   * What follows a property's name, in either place it can be written:
   * an optional type, then a default, then an optional integer range.
   */
  private propertyBody(name: Ident, from: Span): PropertyDeclaration | null {
    const wantedType = this.atType();
    const type = wantedType ? this.typeExpr() : null;
    if (wantedType && type === null) return null;

    let value: Literal | null = null;
    if (type === null) {
      value = this.literal();
      if (value === null) return null;
    } else if (this.take('name', 'default') !== null) {
      value = this.literal();
      if (value === null) return null;
    } else {
      this.diagnostics.refuse(
        this.here(),
        `\`:${name.text}\` has a type and no value to start at.`,
        'Every instance starts at a default: write `default` and the value.',
      );
      return null;
    }

    let min: PropertyDeclaration['min'] = null;
    let max: PropertyDeclaration['max'] = null;
    for (;;) {
      const which = this.at('name', 'min') ? 'min' : this.at('name', 'max') ? 'max' : null;
      if (which === null) break;
      const word = this.next();
      const bound = this.literal();
      if (bound === null) return null;
      if (bound.kind !== 'integer') {
        this.diagnostics.refuse(
          bound.at,
          `A ${which} is a whole number.`,
          `Write \`${which} 0\`, or leave it out.`,
        );
        return null;
      }
      if ((which === 'min' ? min : max) !== null) {
        this.diagnostics.refuse(
          word.at,
          `\`:${name.text}\` says ${which} twice.`,
          'Write it once.',
        );
        return null;
      }
      if (which === 'min') min = bound;
      else max = bound;
    }

    // Whichever part ends last, which is not always the max: `max 1 min 2`
    // is as legal as `min 2 max 1` and ends at the min.
    const parts = [value, min, max].filter((part) => part !== null);
    const end = parts.reduce((latest, part) => (part.at.end >= latest.at.end ? part : latest));
    return { kind: 'property', at: spanning(from, end.at), name, type, default: value, min, max };
  }

  /** `:wear 0 min 0 max 99` — a property as a kind or an object writes one. */
  property(): PropertyDeclaration | null {
    const symbol = this.take('symbol');
    if (symbol === null) {
      this.diagnostics.refuse(
        this.peek().at,
        `A property starts with its name, and ${this.describe(this.peek())} is not one.`,
        'Write `:wear 0`, with a colon before the name.',
      );
      return null;
    }
    return this.propertyBody(this.ident(symbol), symbol.at);
  }

  /** `:remembers [handled: false, visits: 0 min 0 max 99]` */
  remembers(): RemembersDeclaration | null {
    const symbol = this.take('symbol');
    if (symbol === null || symbol.text !== 'remembers') {
      this.diagnostics.refuse(
        (symbol ?? this.peek()).at,
        'This is not a `:remembers`.',
        'Write `:remembers [visits: 0]`.',
      );
      return null;
    }
    if (this.take('punct', '[') === null) {
      this.diagnostics.refuse(
        this.here(),
        'What an object remembers goes in brackets.',
        'Write `:remembers [handled: false, visits: 0 min 0 max 99]`.',
      );
      return null;
    }

    const properties: PropertyDeclaration[] = [];
    let missingComma: Span | null = null;
    for (;;) {
      const close = this.take('punct', ']');
      if (close !== null) {
        return { kind: 'remembers', at: spanning(symbol.at, close.at), properties };
      }
      if (this.done) {
        this.diagnostics.refuse(
          this.source.endSpan,
          'This `:remembers` is never closed.',
          'Add a ] after what it remembers.',
        );
        return null;
      }

      const before = this.peek();
      const declared = this.rememberedProperty();
      if (declared === null) {
        // As the list above, including that a file which ran out inside
        // the entry has already been explained by whatever read it.
        if (this.done) return null;
        if (this.peek().at.start === before.at.start) this.next();
        this.separator(']');
        missingComma = null;
        continue;
      }
      if (missingComma !== null) {
        this.diagnostics.refuse(
          missingComma,
          'A `:remembers` needs a comma between what it remembers.',
          'Write `:remembers [handled: false, visits: 0]`.',
        );
        missingComma = null;
      }
      properties.push(declared);
      if (this.separator(']') === 'missing') missingComma = this.here();
    }
  }

  /** `visits: 0 min 0 max 99` — one entry of a `:remembers`. */
  private rememberedProperty(): PropertyDeclaration | null {
    const named = this.take('name');
    if (named === null) {
      this.diagnostics.refuse(
        this.peek().at,
        `A remembered property starts with its name, and ${this.describe(this.peek())} is not one.`,
        'Write `visits: 0`, with the name first and no colon before it.',
      );
      return null;
    }
    if (this.take('punct', ':') === null) {
      this.diagnostics.refuse(
        this.here(),
        `\`${named.text}\` needs a colon between its name and its value.`,
        `Write \`${named.text}: 0\`.`,
      );
      return null;
    }
    return this.propertyBody(this.ident(named), named.at);
  }

  /** `message :stir`, `message :illuminating with boolean` */
  private messageDeclaration(): MessageDeclaration | null {
    const keyword = this.next();
    const named = this.take('symbol');
    if (named === null) {
      this.diagnostics.refuse(
        this.peek().at,
        'A message needs a name.',
        "A message's name has a colon before it: `message :stir`.",
      );
      this.recover();
      return null;
    }
    const name = this.ident(named);
    if (this.take('name', 'with') === null) {
      return { kind: 'message', at: spanning(keyword.at, named.at), name, carries: null };
    }
    const carries = this.typeExpr();
    if (carries === null) {
      this.recover();
      return null;
    }
    return { kind: 'message', at: spanning(keyword.at, carries.at), name, carries };
  }

  /** A token as a person would describe it, for a message about the wrong one. */
  // --- expressions --------------------------------------------------
  //
  // Precedence climbing over one table. Every operand of a given level
  // is read at the level above it, and the loop at each level consumes
  // its own operators left to right, so `a - b - c` is `(a - b) - c`.
  //
  // Nothing here recurses without a bound. Parentheses, call arguments
  // and stacked prefix operators all count against the host's nesting
  // cap; a chain of operators at one level is read by the loop rather
  // than by recursion.

  /** An expression, or null having said why it is not one. */
  expression(level: number = LOOSEST): Expr | null {
    if (level > TIGHTEST) return this.unary();
    let left = this.expression(level + 1);
    if (left === null) return null;
    for (;;) {
      const token = this.peek();
      if (token.kind !== 'punct' || BINARY_PRECEDENCE.get(token.text) !== level) return left;
      this.next();
      const right = this.expression(level + 1);
      if (right === null) return null;
      left = {
        kind: 'binary',
        at: spanning(left.at, right.at),
        operator: token.text as BinaryOperator,
        left,
        right,
      };
    }
  }

  /**
   * `!x`, `-x`, and the stacks of them. Read into a list and applied
   * afterwards rather than by recursing, so that a wall of `!` is
   * refused by the nesting cap instead of exhausting the stack.
   */
  private unary(): Expr | null {
    const operators: Token[] = [];
    let refused = false;
    while (this.peek().kind === 'punct' && PREFIX.has(this.peek().text)) {
      const token = this.next();
      // Against `this.depth`, which parentheses, lists and call
      // arguments all share. A counter of its own would give every
      // bracketed level a fresh allowance of signs on top of the
      // shared one, so eight parentheses each holding eight `!` would
      // nest sixty-four deep under a cap of eight.
      // Its own remedy: a wall of signs has no bracket in it, and
      // telling the author to take some brackets out names something
      // they did not write.
      if (!this.deeper(token.at, 'Take some of the signs out.')) {
        refused = true;
        break;
      }
      operators.push(token);
    }
    try {
      return refused ? null : this.applyPrefix(operators);
    } finally {
      this.depth -= operators.length;
    }
  }

  /** The operators of a prefix stack, applied to what they were written before. */
  private applyPrefix(operators: readonly Token[]): Expr | null {
    let expr = this.postfix();
    if (expr === null) return null;
    for (let i = operators.length - 1; i >= 0; i--) {
      const token = operators[i]!;
      expr = {
        kind: 'unary',
        at: spanning(token.at, expr.at),
        operator: token.text as UnaryOperator,
        operand: expr,
      };
    }
    return expr;
  }

  /** `x.count`, `x.get(:p)`, and the chains of them. */
  private postfix(): Expr | null {
    let expr = this.primary();
    if (expr === null) return null;
    while (this.at('punct', '.')) {
      this.next();
      const name = this.take('name');
      if (name === null) {
        this.diagnostics.refuse(
          this.peek().at,
          'A dot needs the name of something to read after it.',
          'Write what to read, as in `self.count` or `self.get(:wear)`.',
        );
        return null;
      }
      const open = this.take('punct', '(');
      if (open === null) {
        expr = {
          kind: 'member',
          at: spanning(expr.at, name.at),
          receiver: expr,
          member: this.ident(name),
        };
        continue;
      }
      const read = this.argumentList(open);
      if (read === null) return null;
      expr = {
        kind: 'call',
        at: spanning(expr.at, read.at),
        receiver: expr,
        method: this.ident(name),
        arguments: read.arguments,
      };
    }
    return expr;
  }

  /** A whole expression in brackets, a value, a name, a symbol or a kind. */
  private primary(): Expr | null {
    const token = this.peek();

    if (token.kind === 'punct' && token.text === '(') {
      const open = this.next();
      if (!this.deeper(open.at)) {
        this.skipBracketed(')');
        return null;
      }
      try {
        const inner = this.expression();
        if (inner === null) {
          // Give up on the whole bracket, not on its contents: leaving
          // the closer behind hands it to whatever is reading around
          // this, which takes it for its own and ends early.
          this.skipBracketed(')');
          return null;
        }
        const close = this.take('punct', ')');
        if (close === null) {
          this.diagnostics.refuse(
            this.done ? this.source.endSpan : this.peek().at,
            'This bracket is never closed.',
            'Add a ) after what it holds.',
          );
          this.skipBracketed(')');
          return null;
        }
        return inner;
      } finally {
        this.depth -= 1;
      }
    }

    if (token.kind === 'integer') {
      this.next();
      if (this.atFraction()) return null;
      return { kind: 'integer', at: token.at, value: Number(token.text) };
    }
    if (token.kind === 'string') {
      this.next();
      return { kind: 'string', at: token.at, value: token.text };
    }
    if (token.kind === 'symbol') {
      this.next();
      return { kind: 'symbol-expr', at: token.at, name: this.ident(token) };
    }
    if (token.kind === 'kind') {
      this.next();
      return { kind: 'kind-expr', at: token.at, library: null, name: this.ident(token) };
    }
    if (token.kind === 'name') {
      if (token.text === 'true' || token.text === 'false') {
        this.next();
        return { kind: 'boolean', at: token.at, value: token.text === 'true' };
      }
      // `sprout.Container` is a kind, where `actor.recall` is a read:
      // what follows the dot decides, the same way it does for a type.
      if (
        this.peek(1).kind === 'punct' &&
        this.peek(1).text === '.' &&
        this.peek(2).kind === 'kind'
      ) {
        const library = this.next();
        this.next();
        const name = this.next();
        return {
          kind: 'kind-expr',
          at: spanning(library.at, name.at),
          library: this.ident(library),
          name: this.ident(name),
        };
      }
      if (this.peek(1).kind === 'punct' && this.peek(1).text === '(') {
        const name = this.next();
        const open = this.next();
        const read = this.argumentList(open);
        if (read === null) return null;
        return {
          kind: 'free-call',
          at: spanning(name.at, read.at),
          name: this.ident(name),
          arguments: read.arguments,
        };
      }
      this.next();
      return { kind: 'binding', at: token.at, name: this.ident(token) };
    }

    this.diagnostics.refuse(
      token.at,
      `${this.describe(token)} is not something to read.`,
      'Write a value, a name something in scope answers to, or a reading such as `self.get(:wear)`.',
    );
    return null;
  }

  /**
   * What is between a call's brackets, the opening one already taken.
   * The same loop `listLiteral` uses, for the same reasons: it reads ON
   * past an argument it could not read rather than skipping to the next
   * comma, and a missing comma is reported only once the next argument
   * reads.
   */
  private argumentList(open: Token): { arguments: Expr[]; at: Span } | null {
    if (!this.deeper(open.at)) {
      this.skipBracketed(')');
      return null;
    }
    try {
      const args: Expr[] = [];
      let missingComma: Span | null = null;
      for (;;) {
        const close = this.take('punct', ')');
        if (close !== null) return { arguments: args, at: spanning(open.at, close.at) };
        if (this.done) {
          this.diagnostics.refuse(
            this.source.endSpan,
            'This bracket is never closed.',
            'Add a ) after what it holds.',
          );
          return null;
        }
        const before = this.peek();
        const argument = this.expression();
        if (argument === null) {
          if (this.done) return null;
          if (this.peek().at.start === before.at.start) this.next();
          this.separator(')');
          missingComma = null;
          continue;
        }
        if (missingComma !== null) {
          this.diagnostics.refuse(
            missingComma,
            'A reading needs a comma between what it is given.',
            'Write `self.set(:wear, 1)`.',
          );
          missingComma = null;
        }
        args.push(argument);
        if (this.separator(')') === 'missing') missingComma = this.here();
      }
    } finally {
      this.depth -= 1;
    }
  }

  /**
   * `let ribs = tools.count(Rib)`. The name is lower-case like every
   * other binding, and there is no type to write: a `let` takes its
   * type from what it names, exactly.
   */
  letStatement(): LetStatement | null {
    const keyword = this.take('name', 'let');
    if (keyword === null) {
      this.diagnostics.refuse(
        this.peek().at,
        `${this.describe(this.peek())} does not name a value.`,
        'Write `let <name> = <what it names>`.',
      );
      return null;
    }
    const name = this.take('name');
    if (name === null) {
      this.diagnostics.refuse(
        this.peek().at,
        this.peek().kind === 'kind'
          ? `A name for a value starts with a small letter, and \`${this.peek().text}\` starts with a capital.`
          : 'A `let` needs a name.',
        'Write `let <name> = <what it names>`, as in `let ribs = tools.count(Rib)`.',
      );
      return null;
    }
    if (this.at('punct', ':')) {
      this.diagnostics.refuse(
        this.peek().at,
        'A `let` takes its type from what it names, so there is none to write.',
        `Write \`let ${name.text} = <what it names>\`.`,
      );
      return null;
    }
    if (this.take('punct', '=') === null) {
      this.diagnostics.refuse(
        this.here(),
        `\`${name.text}\` is not given anything to name.`,
        `Write \`let ${name.text} = <what it names>\`.`,
      );
      return null;
    }
    const value = this.expression();
    if (value === null) return null;
    return { kind: 'let', at: spanning(keyword.at, value.at), name: this.ident(name), value };
  }

  private describe(token: Token): string {
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
      default:
        return `\`${token.text}\``;
    }
  }
}

/** Every declaration in one file. Problems go to `diagnostics`; nothing is thrown. */
export function parseDeclarations(
  source: SourceFile,
  diagnostics: Diagnostics,
  caps?: StaticCaps,
): Declaration[] {
  return new Parser(source, diagnostics, caps).file();
}

/**
 * One property declaration, read on its own. A property is written
 * inside a kind or an object, and neither exists yet (B12, B19), so this
 * is how B06 is exercised and how those items will read one.
 */
export function parseProperty(
  source: SourceFile,
  diagnostics: Diagnostics,
  caps?: StaticCaps,
): PropertyDeclaration | null {
  return new Parser(source, diagnostics, caps).property();
}

/**
 * One `let`, read on its own. A `let` is written inside a body, and no
 * body exists yet (B24 onward), so this is how B11 is exercised and how
 * those items will read one.
 */
export function parseLet(
  source: SourceFile,
  diagnostics: Diagnostics,
  caps?: StaticCaps,
): LetStatement | null {
  return new Parser(source, diagnostics, caps).letStatement();
}

/**
 * One expression, read on its own. Expressions are written inside
 * bodies, and no body exists yet (B24 onward), so this is how B09 is
 * exercised and how those items will read one.
 */
export function parseExpression(
  source: SourceFile,
  diagnostics: Diagnostics,
  caps?: StaticCaps,
): Expr | null {
  return new Parser(source, diagnostics, caps).expression();
}

/** One `:remembers`, read on its own, for the same reason. */
export function parseRemembers(
  source: SourceFile,
  diagnostics: Diagnostics,
  caps?: StaticCaps,
): RemembersDeclaration | null {
  return new Parser(source, diagnostics, caps).remembers();
}
