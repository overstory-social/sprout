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
  Declaration,
  EnumDeclaration,
  EnumOption,
  Ident,
  Literal,
  MessageDeclaration,
  PropertyDeclaration,
  RemembersDeclaration,
  TypeExpr,
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
  private deeper(at: Span): boolean {
    if (this.depth + 1 > this.caps.nesting) {
      this.diagnostics.refuse(
        at,
        `Nothing here may be nested more than ${this.caps.nesting} deep.`,
        'Take some of the brackets out.',
      );
      return false;
    }
    this.depth += 1;
    return true;
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
      if (!this.deeper(open.at)) return null;
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
      if (!this.deeper(open.at)) return null;
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
    for (;;) {
      const close = this.take('punct', ']');
      if (close !== null) {
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
        if (this.done) continue;
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
      elements.push(element);
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
        // As the list above: on past the one it could not read, not
        // past what follows it.
        if (this.done) continue;
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

/** One `:remembers`, read on its own, for the same reason. */
export function parseRemembers(
  source: SourceFile,
  diagnostics: Diagnostics,
  caps?: StaticCaps,
): RemembersDeclaration | null {
  return new Parser(source, diagnostics, caps).remembers();
}
