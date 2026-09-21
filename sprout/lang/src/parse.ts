// Reading a file into declarations (B05 onward; the first tier of the
// spec's The compiler › Two tiers).
//
// This is the parser for SOURCE — what an author writes in a `.sprout`
// file — and not the parser for what a visitor types, which is B27's and
// lives in `parser.ts`. It is built one backlog item at a time: B05
// brings the top-level loop and `enum`, and each later item adds the
// declaration it is about. `DECLARATIONS` is the list of what it
// currently reads, and it is also what an unknown word at the top of a
// file is measured against, so the message stays true as the list grows
// rather than promising syntax the compiler does not have.
//
// Two things it does deliberately. It RECOVERS: a declaration it cannot
// read costs that declaration and not the file, because an author owed
// three problems is owed all three. And every node it builds carries the
// span of the tokens it was built from, down to the individual option of
// an enum, so a diagnostic points at the word that is wrong.

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
import { spanning, type SourceFile, type Span } from './source.js';

/**
 * The words that start a declaration, as this compiler reads them
 * today. Each backlog item that adds a declaration adds its word here,
 * and the message for an unknown one is built from this list, so it
 * never offers syntax that does not work yet.
 */
export const DECLARATIONS = ['enum', 'message'] as const;

/**
 * The three type names that are the language's own. They are read as
 * types wherever a type may be written, so an enum cannot take one of
 * them as a name and an option called `string` is still an option
 * everywhere an option belongs.
 */
const BUILT_IN_TYPE_WORDS = new Set(['boolean', 'integer', 'string', 'object']);

/** A list written out the way a person reads one: `a`, `a and b`, `a, b and c`. */
function readable(words: readonly string[]): string {
  if (words.length === 0) return 'nothing';
  if (words.length === 1) return `\`${words[0]}\``;
  const all = words.map((word) => `\`${word}\``);
  return `${all.slice(0, -1).join(', ')} and ${all.at(-1)}`;
}

class Parser {
  private readonly lexer: Lexer;

  constructor(
    private readonly source: SourceFile,
    private readonly diagnostics: Diagnostics,
  ) {
    this.lexer = new Lexer(source, diagnostics);
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
   * Whether the next token begins a declaration rather than being an
   * option that happens to spell one.
   *
   * Nothing reserves `enum` or `message` as an option name — *Reserved
   * names* covers message, verb and member names and not these — so the
   * word alone decides nothing, and `enum Ward { message, silver }` is a
   * well-formed enum. What decides is what FOLLOWS: an option is
   * followed by a comma or by the closing brace, and a declaration is
   * followed by its own name.
   */
  private atDeclarationKeyword(): boolean {
    const token = this.peek();
    if (token.kind !== 'name' || !(DECLARATIONS as readonly string[]).includes(token.text)) {
      return false;
    }
    const after = this.peek(1);
    return !(after.kind === 'punct' && (after.text === ',' || after.text === '}'));
  }

  /**
   * Whether the lexer already refused something in the gap since
   * `after`. When it did, the author has the real message and a
   * "needs a comma" here would be the same mistake said twice.
   */
  private gapRefused(after: number): boolean {
    return this.lexer.refusedBetween(after, this.peek().at.start);
  }

  /** Step over everything up to the next thing that could start a declaration. */
  private recover(): void {
    while (!this.done) {
      const token = this.peek();
      if (token.kind === 'name' && (DECLARATIONS as readonly string[]).includes(token.text)) return;
      this.next();
    }
  }

  /** Step over an enum's remaining options, to its closing brace or the next declaration. */
  private recoverInBraces(): void {
    let depth = 1;
    while (!this.done) {
      if (this.at('punct', '{')) depth += 1;
      if (this.at('punct', '}')) {
        depth -= 1;
        this.next();
        if (depth === 0) return;
        continue;
      }
      if (this.atDeclarationKeyword()) return;
      this.next();
    }
  }

  /** Every declaration in the file, in the order they were written. */
  file(): Declaration[] {
    const declarations: Declaration[] = [];
    while (!this.done) {
      const token = this.peek();
      if (token.kind === 'name' && token.text === 'enum') {
        const declared = this.enumDeclaration();
        if (declared !== null) declarations.push(declared);
        continue;
      }
      if (token.kind === 'name' && token.text === 'message') {
        const declared = this.messageDeclaration();
        if (declared !== null) declarations.push(declared);
        continue;
      }
      this.diagnostics.refuse(
        token.at,
        `Sprout does not know what to do with "${token.text}" here.`,
        `A file holds declarations, and this compiler reads ${readable(DECLARATIONS)}.`,
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

    const options: EnumOption[] = [];
    let refused = false;
    for (;;) {
      if (this.done) {
        this.diagnostics.refuse(
          this.source.endSpan,
          `\`${name.text}\` is never closed.`,
          'Add a } after its options.',
        );
        break;
      }
      if (this.at('punct', '}')) {
        this.next();
        break;
      }
      if (this.atDeclarationKeyword()) {
        // `enum` or `message` here is the next declaration, not an
        // option. Reading it as one swallows that declaration whole.
        this.diagnostics.refuse(
          this.peek().at,
          `\`${name.text}\` is never closed.`,
          'Add a } after its options.',
        );
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
        this.recoverInBraces();
        refused = true;
        break;
      }
      options.push({ kind: 'option', at: word.at, name: this.ident(word) });

      if (this.done) continue; // the top of the loop says what an unclosed enum is
      if (this.atDeclarationKeyword()) continue; // and what a forgotten brace is
      if (this.at('punct', '}')) continue;
      if (this.take('punct', ',') !== null) {
        if (this.at('punct', '}')) {
          this.diagnostics.refuse(
            this.peek().at,
            `\`${name.text}\` has a comma after its last option.`,
            'Remove it: options are separated by commas, not ended by them.',
          );
        }
        continue;
      }
      // Only now: a comma is genuinely not there, so a character the
      // lexer stepped over is the better explanation of the gap.
      if (this.gapRefused(word.at.end)) continue;
      this.diagnostics.refuse(
        this.here(),
        `\`${name.text}\` needs a comma between its options.`,
        `Write \`enum ${name.text} { ${options.map((o) => o.name.text).join(', ')}, … }\`.`,
      );
    }

    if (options.length === 0) {
      // A bad option has already been refused by name; saying the enum
      // has none as well reports one mistake twice.
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
      const element = this.typeExpr();
      if (element === null) return null;
      const close = this.take('punct', ']');
      if (close === null) {
        this.diagnostics.refuse(
          this.here(),
          'A list type is never closed.',
          'Write the element type in brackets, as in `[Ward]`.',
        );
        return null;
      }
      return { kind: 'list-type', at: spanning(open.at, close.at), element };
    }

    const first = this.peek();
    if (first.kind === 'kind') {
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
    if (first.kind === 'name' && BUILT_IN_TYPE_WORDS.has(first.text)) {
      this.next();
      return { kind: 'named-type', at: first.at, library: null, name: this.ident(first) };
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
    // `[Ward]` is a list type and `[oak]` is a list value; the capital tells them apart.
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
      return { kind: 'integer', at: spanning(token.at, digits.at), value: -Number(digits.text) };
    }
    if (token.kind === 'integer') {
      this.next();
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
      const elements: Literal[] = [];
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
        const element = this.literal();
        if (element === null) return null;
        elements.push(element);
        if (this.done) continue; // the top of the loop says what an unclosed list is
        if (this.at('punct', ']')) continue;
        if (this.take('punct', ',') !== null) continue;
        if (this.gapRefused(element.at.end)) continue;
        this.diagnostics.refuse(
          this.here(),
          'A list needs a comma between its elements.',
          'Write `[oak, silver]`.',
        );
        return null;
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

    const last = max ?? min ?? value;
    return { kind: 'property', at: spanning(from, last.at), name, type, default: value, min, max };
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
      const declared = this.propertyBody(this.ident(named), named.at);
      if (declared === null) return null;
      properties.push(declared);
      if (this.done) continue; // the top of the loop says what an unclosed one is
      if (this.at('punct', ']')) continue;
      if (this.take('punct', ',') !== null) continue;
      if (this.gapRefused(declared.at.end)) continue;
      this.diagnostics.refuse(
        this.here(),
        'A `:remembers` needs a comma between what it remembers.',
        'Write `:remembers [handled: false, visits: 0]`.',
      );
      return null;
    }
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
export function parseDeclarations(source: SourceFile, diagnostics: Diagnostics): Declaration[] {
  return new Parser(source, diagnostics).file();
}

/**
 * One property declaration, read on its own. A property is written
 * inside a kind or an object, and neither exists yet (B12, B19), so this
 * is how B06 is exercised and how those items will read one.
 */
export function parseProperty(
  source: SourceFile,
  diagnostics: Diagnostics,
): PropertyDeclaration | null {
  return new Parser(source, diagnostics).property();
}

/** One `:remembers`, read on its own, for the same reason. */
export function parseRemembers(
  source: SourceFile,
  diagnostics: Diagnostics,
): RemembersDeclaration | null {
  return new Parser(source, diagnostics).remembers();
}
