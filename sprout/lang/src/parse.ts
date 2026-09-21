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

import type { Declaration, EnumDeclaration, EnumOption, Ident } from './ast.js';
import type { Diagnostics } from './diagnostics.js';
import { Lexer, type Token, type TokenKind } from './lexer.js';
import { spanning, type SourceFile, type Span } from './source.js';

/**
 * The words that start a declaration, as this compiler reads them
 * today. Each backlog item that adds a declaration adds its word here,
 * and the message for an unknown one is built from this list, so it
 * never offers syntax that does not work yet.
 */
export const DECLARATIONS = ['enum'] as const;

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
      const token = this.peek();
      if (token.kind === 'name' && (DECLARATIONS as readonly string[]).includes(token.text)) return;
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
