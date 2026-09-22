// Reading a file into declarations: the first tier of the spec's The
// compiler › Two tiers.
//
// This is the parser for SOURCE — what an author writes in a `.sprout`
// file — and not the parser for what a visitor types, which is B27's and
// lives in `parser.ts`. `readers` is the table of what it reads: every
// place that asks "does a declaration start here?" reads that one table,
// so the answer cannot differ from place to place.
//
// Two things it does deliberately. It RECOVERS: a declaration it cannot
// read costs that declaration and not the file, because an author owed
// three problems is owed all three. And every node it builds carries the
// span of the tokens it was built from, down to the individual option of
// an enum, so a diagnostic points at the word that is wrong.
//
// Three rules hold the recovery together:
//
//   - A missing separator is reported only once the NEXT item reads
//     successfully. A token that cannot be an item at all is that
//     token's problem, not a missing comma's.
//   - A gap the lexer made by stepping over a character is never blamed
//     on the author. The token after it says so itself (`afterRefusal`),
//     so no offset is carried and none can go stale.
//   - A word that starts a declaration is one only where a declaration
//     could start. `enum Ward { message, silver }` is an enum with
//     `silver` in it: a reserved word is READ as the word it is, and
//     then refused as an option, so neither the enum nor anything after
//     it is lost to a word standing where it may not.

import type {
  BinaryOperator,
  ContainsDeclaration,
  Declaration,
  Expr,
  KindExpr,
  LetStatement,
  EnumDeclaration,
  EnumOption,
  Ident,
  Literal,
  MessageDeclaration,
  NamedType,
  OptionLiteral,
  PropertyDeclaration,
  RemembersDeclaration,
  TypeExpr,
  UnaryOperator,
  WorldDeclaration,
  WorldMember,
} from './ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import { Lexer, type Token, type TokenKind } from './lexer.js';
import { isReserved } from './reserved.js';
import { DEFAULT_LIMITS, type StaticCaps } from '../bundle/limits.js';
import { spanning, type SourceFile, type Span } from '../source/source.js';

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
export const DECLARATIONS = ['enum', 'message', 'world'] as const;

/**
 * The type names that are the language's own. They are read as types
 * wherever a type may be written. They are reserved words too, so
 * nothing else — an option, a binding — may be called by one.
 */
const BUILT_IN_TYPE_WORDS = new Set(['boolean', 'integer', 'string', 'object']);

/** `Ward`, `sprout.Ward` — a named type as it was written. */
function spellNamedType(type: NamedType): string {
  return type.library === null ? type.name.text : `${type.library.text}.${type.name.text}`;
}

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
  // `world printers_shop: sprout.World { … }` — and the same with the
  // composition left out, which parses so that the refusal can name it.
  //
  // The brace on its own, as for an enum — but NOT a bare `:`, though a
  // nameless `world: victorian.Voice { … }` is written that way.
  // `world` is an ordinary name too, and `[world: 1]` remembers a
  // property called `world`; that is input an author meant, where a
  // world with no name is input they did not.
  [
    'world',
    (name: Token, after: Token) =>
      punct(name, '{') || (name.kind === 'name' && (punct(after, '{') || punct(after, ':'))),
  ],
]);

/** Whether a token is one particular mark, which the shapes above ask a lot. */
function punct(token: Token, text: string): boolean {
  return token.kind === 'punct' && token.text === text;
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

/** Which bracket opens which, for stepping over what was refused. */
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
 * It is a table read by ONE loop rather than a function per level, so
 * every level answers the same question the same way.
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
  /** How deep the brackets currently are, against `DEEPEST`. */
  private depth = 0;
  /**
   * Whether the depth bound has already been reported for the
   * declaration being read. Too many brackets is ONE fact about one
   * piece of writing, and reading on past what could not be read —
   * which is how an author owed three problems is owed all three —
   * would otherwise meet the same wall once per bracket and say it
   * again each time.
   *
   * Reported once and then refused in silence, rather than abandoning
   * the rest: a `:remembers` whose first entry is too deep still owes
   * the author the missing colon in its third. Cleared between
   * declarations, so two deep ones are two reports.
   */
  private tooDeepReported = false;
  /**
   * Where a `[` stands, by source offset, that `closedBracketRun` has
   * found no `]` for. One failed probe answers for every `[` it walked
   * past, so a stretch of stray brackets is walked once and not once
   * per bracket.
   */
  private readonly unclosedBrackets = new Set<number>();

  constructor(
    private readonly source: SourceFile,
    private readonly diagnostics: Diagnostics,
    private readonly caps: StaticCaps = DEFAULT_LIMITS.caps,
  ) {
    this.lexer = new Lexer(source, diagnostics);
    this.readers = new Map<string, () => Declaration | null>([
      ['enum', () => this.enumDeclaration()],
      ['message', () => this.messageDeclaration()],
      ['world', () => this.worldDeclaration()],
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
   * Whether a declaration begins here — asked by a loop that is reading
   * what the author WROTE, and so asked strictly.
   *
   * The lexer hands `enum`, `message` and `world` over as plain names
   * wherever they stand, so the word alone decides nothing and its own
   * opening must: `DECLARATION_SHAPES` is what says whether that
   * opening is here, and a word without it is a word.
   *
   * Strictly, because of which way this one is allowed to be wrong. A
   * loop reading elements or members stops when this says yes, so a
   * false yes throws away something the author meant: `:remembers
   * [enum: 1]` would lose its whole block. Recovery has the opposite
   * exposure and therefore its own question, below.
   */
  private atDeclarationStart(): boolean {
    const token = this.peek();
    if (token.kind !== 'name' || !this.readers.has(token.text)) return false;
    const shape = DECLARATION_SHAPES.get(token.text);
    return shape !== undefined && shape(this.peek(1), this.peek(2));
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
  private atRecoveryStop(): boolean {
    const token = this.peek();
    if (token.kind !== 'name' || !this.readers.has(token.text)) return false;
    const after = this.peek(1);
    if (after.kind === 'end') return false;
    return !(after.kind === 'punct' && CLOSERS.has(after.text));
  }

  /** One deeper, or a refusal that the parser's own bound is reached. */
  private deeper(at: Span, remedy = 'Take some of the brackets out.'): boolean {
    if (this.depth + 1 > DEEPEST) {
      this.reportTooDeep(at, remedy);
      return false;
    }
    this.depth += 1;
    return true;
  }

  /**
   * Step over a construct being abandoned, its opening bracket
   * already taken. Counting matched pairs leaves the reader exactly
   * past the construct, so its CLOSER is never left in the stream for
   * the enclosing loop to take as its own and end early on.
   */
  private skipBracketed(close: string): void {
    const open = OPENER_OF.get(close)!;
    // Find the closer BEFORE taking anything, so a bracket that was
    // never closed takes nothing rather than the rest of the file. And
    // nothing stops the skip early, not even a declaration keyword:
    // the lexer reads `message` as a plain name, so `[message foo]` is
    // a list of two things and the skip walks straight past it.
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

  /**
   * Too deep to read, said once per declaration and refused in silence
   * after. It names no number: the bound is the parser's own and an
   * author who is told a figure will read it as something they may
   * write up to.
   */
  private reportTooDeep(at: Span, remedy: string): void {
    if (this.tooDeepReported) return;
    this.tooDeepReported = true;
    this.diagnostics.refuse(at, 'This is nested too deep to read.', remedy);
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
      if (this.atRecoveryStop()) return;
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
      if (depth === 1 && this.atRecoveryStop()) return false;
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
        this.tooDeepReported = false;
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
      if (this.atDeclarationStart()) {
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

      // A word read, so a separator really was wanted before it —
      // whether or not that word may stand as an option. A word the
      // author has to replace anyway is left out of what the remedy
      // offers to write.
      if (missingComma !== null) {
        const written = options.map((option) => option.name.text);
        if (!isReserved(word.text)) written.push(word.text);
        this.diagnostics.refuse(
          missingComma,
          `\`${name.text}\` needs a comma between its options.`,
          `Write \`enum ${name.text} { ${[...written, '…'].join(', ')} }\`.`,
        );
        missingComma = null;
      }

      if (isReserved(word.text)) {
        // A word of the language is still READ here, so the enum keeps
        // its other options and the declarations after it survive; it
        // is refused at the word and left out of the option set.
        this.diagnostics.refuse(
          word.at,
          `\`${word.text}\` is a word of the language, so it cannot be an option of \`${name.text}\`.`,
          'Choose another word for it.',
        );
        refused = true;
      } else {
        options.push({ kind: 'option', at: word.at, name: this.ident(word) });
      }

      // A comma after the LAST option is allowed, so the loop simply
      // reads on and finds the brace.
      if (this.separator('}') === 'missing') missingComma = this.here();
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
        // Every way out of here but the good one gives up on the whole
        // list type, so it steps over the rest of it: leaving the
        // closer behind hands it to whatever is reading around this,
        // which takes it for its own and ends early.
        const element = this.typeExpr();
        if (element === null) {
          this.skipBracketed(']');
          return null;
        }
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
          this.skipBracketed(']');
          return null;
        }
        this.diagnostics.refuse(
          this.here(),
          'A list type is never closed.',
          'Write the element type in brackets, as in `[Ward]`.',
        );
        this.skipBracketed(']');
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
      if (this.done || this.atDeclarationStart()) {
        // A word that starts a declaration is not an element, however
        // it reads as one — the lexer hands `enum` over as a plain
        // name, so `literal()` takes it and the hunt for a `]` walks on
        // through the rest of the file. What FOLLOWS the word decides:
        // `[oak, enum]` is still read as a list of two words here, and
        // `enum` is answered for where the option set is checked.
        this.diagnostics.refuse(
          this.done ? this.source.endSpan : this.peek().at,
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
        //
        // Nor past a word that starts a DECLARATION: `file()` is still
        // reading behind a property inside a world, and hunting for a
        // `]` would swallow every declaration after it. `[oak, enum]`
        // is still read as a list of two words, because
        // `atDeclarationStart` asks what FOLLOWS the word.
        if (this.done || this.atDeclarationStart()) return null;
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
   * Step over the rest of a property whose type could not be read: its
   * default and its bounds, which are the abandoned property's own text
   * and not a sibling. Left in the stream they are read as something
   * else, and the author is told about a mistake they did not make.
   */
  private skipPropertyTail(): void {
    if (this.take('name', 'default') !== null) this.skipValue();
    while (this.at('name', 'min') || this.at('name', 'max')) {
      this.next();
      this.skipValue();
    }
  }

  /**
   * Step over one written value without reading it. Only what can begin
   * a value is taken, so a property that ends where its default should
   * have been takes nothing and the separator after it stays where the
   * loop around this is waiting for it.
   */
  private skipValue(): void {
    if (this.at('punct', '[')) {
      this.next();
      this.skipBracketed(']');
      return;
    }
    // A written number, `-3` and `1.5` alike: Sprout has no fractions,
    // but an author who wrote one wrote it as part of this property.
    if (this.at('punct', '-') && this.peek(1).kind === 'integer') this.next();
    if (this.peek().kind === 'integer') {
      this.next();
      if (this.at('punct', '.') && this.peek(1).kind === 'integer') {
        this.next();
        this.next();
      }
      return;
    }
    if (this.peek().kind === 'string') {
      this.next();
      return;
    }
    // An option, unless a colon after it makes it the name of the next
    // entry of a `:remembers`.
    if (
      this.peek().kind === 'name' &&
      !(this.peek(1).kind === 'punct' && this.peek(1).text === ':')
    ) {
      this.next();
    }
  }

  /**
   * The option in `:ward Ward.iron`, the dot already read: the enum and
   * the option the property starts at, written as one. That spelling IS
   * the default, so no `default` may follow it.
   */
  private qualifiedDefault(name: Ident, type: NamedType): OptionLiteral | null {
    const word = this.take('name');
    if (word === null) {
      const wrong = this.peek();
      this.diagnostics.refuse(
        wrong.at,
        `\`${spellNamedType(type)}.\` cannot name ${this.describe(wrong)}.`,
        'An option is a lower-case word, as in `:ward Ward.iron`.',
      );
      return null;
    }
    const option: OptionLiteral = { kind: 'option-literal', at: word.at, name: this.ident(word) };
    const again = this.take('name', 'default');
    if (again !== null) {
      this.diagnostics.refuse(
        again.at,
        `\`:${name.text}\` says its default twice.`,
        `\`${spellNamedType(type)}.${option.name.text}\` already says what it starts at. Remove the \`default\` after it.`,
      );
      return null;
    }
    return option;
  }

  /**
   * What follows a property's name, in either place it can be written:
   * an optional type, then a default, then an optional integer range.
   * An enum and the option a property starts at may be written as one
   * instead — `:ward Ward.iron`, or `:ward sprout.Ward.iron` with the
   * enum's library (the spec's Properties › Declaring a property).
   */
  private propertyBody(name: Ident, from: Span): PropertyDeclaration | null {
    const wantedType = this.atType();
    const type = wantedType ? this.typeExpr() : null;
    if (wantedType && type === null) {
      this.skipPropertyTail();
      return null;
    }

    let value: Literal | null = null;
    if (type !== null && this.at('punct', '.')) {
      const dot = this.next();
      // Only an enum has options, so a dot after anything else is a
      // default written the wrong way round.
      if (type.kind !== 'named-type' || BUILT_IN_TYPE_WORDS.has(type.name.text)) {
        this.diagnostics.refuse(
          dot.at,
          `\`:${name.text}\` writes a dot after a type that has no options.`,
          'Only an enum names its option after a dot, as in `:ward Ward.iron`. Write `default` and the value instead.',
        );
        return null;
      }
      value = this.qualifiedDefault(name, type);
      if (value === null) return null;
    } else if (type === null) {
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
      // Read whatever was written and complain about its shape. A
      // reader that has not consumed anything cannot tell a stray
      // closing bracket from the one its own caller is waiting for, so
      // peeking first and stepping over a bad bound is not an option.
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

  // --- the world ------------------------------------------------------
  //
  // `world printers_shop: victorian.Voice { … }`. The message for a
  // word it does not read is built from the same table that reads its
  // members, so the two cannot drift.

  /** What may be written inside a world, and what reads each one. */
  private worldMembers(): ReadonlyMap<string, () => WorldMember | null> {
    return new Map<string, () => WorldMember | null>([
      ['visitors', () => this.visitors()],
      ['contains', () => this.contains()],
    ]);
  }

  private worldDeclaration(): WorldDeclaration | null {
    const keyword = this.next();
    const name = this.take('name');
    if (name === null) {
      this.diagnostics.refuse(
        this.peek().at,
        'A world needs a name.',
        'Write `world <name>: sprout.World { … }`, as in `world printers_shop: sprout.World { … }`.',
      );
      this.recover();
      return null;
    }

    const composes: KindExpr[] = [];
    if (this.take('punct', ':') !== null) {
      for (;;) {
        const composed = this.kindName();
        if (composed === null) {
          this.recover();
          return null;
        }
        composes.push(composed);
        if (this.take('punct', ',') !== null) continue;
        // Every other comma-separated list in this file says so when
        // the comma is missing; letting the brace complain instead
        // would name the wrong problem.
        if (!this.atKindName()) break;
        this.diagnostics.refuse(
          this.here(),
          'A world needs a comma between the kinds it composes.',
          'Write `world <name>: one.Kind, Another { … }`.',
        );
      }
    }

    const open = this.take('punct', '{');
    if (open === null) {
      this.diagnostics.refuse(
        this.here(),
        `\`${name.text}\` has nothing in it.`,
        'A world is written `world <name>: sprout.World { … }`, holding what it is made of.',
      );
      this.recover();
      return null;
    }

    const members: WorldMember[] = [];
    const readers = this.worldMembers();
    for (;;) {
      const close = this.take('punct', '}');
      if (close !== null) {
        return {
          kind: 'world',
          at: spanning(keyword.at, close.at),
          name: this.ident(name),
          composes,
          members,
        };
      }
      if (this.done) {
        this.diagnostics.refuse(
          this.source.endSpan,
          `\`${name.text}\` is never closed.`,
          'Add a } after what the world is made of.',
        );
        return null;
      }

      // A word that starts a DECLARATION is not a member, however it
      // reads as one. `world w { enum Ward { oak } }` is a world that
      // was never closed, and the enum is the file's; saying "a world
      // is not made of `enum`" as well leaves its braces orphaned and
      // the enum reparsed as a sibling of the world that held it.
      if (this.atDeclarationStart()) {
        this.diagnostics.refuse(
          this.peek().at,
          `\`${name.text}\` is never closed.`,
          'Add a } after what the world is made of.',
        );
        return null;
      }

      // Whether a word IS a member and whether reading it SUCCEEDED are
      // two questions, and answering them in one expression is how a
      // member that failed gets reported as a word nobody knows.
      const token = this.peek();
      const read = this.worldMemberReader(token, readers);
      if (read === null) {
        this.diagnostics.refuse(
          token.at,
          `A world is not made of ${this.describe(token)}.`,
          `It holds its properties, and ${readable([...readers.keys()])}.`,
        );
      }
      const member = read === null ? null : read();
      if (member !== null) {
        members.push(member);
        continue;
      }
      // A member that could not be read costs that member, and the body
      // reads on: an author owed three problems is owed all three. The
      // world is still returned with what did read, since the refusal
      // already keeps the file from being used.
      //
      // A word no reader took is stepped over, unless the next
      // declaration may begin there: then it is the file's.
      if (this.peek().at.start === token.at.start && !this.atRecoveryStop()) this.next();
      if (!this.recoverToMember(readers)) {
        this.diagnostics.refuse(
          this.done ? this.source.endSpan : this.peek().at,
          `\`${name.text}\` is never closed.`,
          'Add a } after what the world is made of.',
        );
        return null;
      }
    }
  }

  /**
   * Step over the rest of a world member that could not be read, to the
   * next member or the body's own `}`; false where the file ran out or a
   * declaration starts first. Braces nest, and so does a `[` closed
   * before any brace, so nothing inside a list is taken for a member,
   * while a `[` never closed is one token and cannot take the members
   * after it in silence.
   */
  private recoverToMember(readers: ReadonlyMap<string, () => WorldMember | null>): boolean {
    let braces = 0;
    while (!this.done) {
      const token = this.peek();
      if (punct(token, '{')) {
        braces += 1;
      } else if (punct(token, '}')) {
        if (braces === 0) return true;
        braces -= 1;
      } else if (braces === 0) {
        // As in `recoverInBraces`: below the body's own depth a keyword
        // is no more trustworthy than anything else.
        if (this.atRecoveryStop()) return false;
        if (this.worldMemberReader(token, readers) !== null) return true;
        const run = punct(token, '[') ? this.closedBracketRun() : 0;
        for (let i = 1; i < run; i++) this.next();
      }
      this.next();
    }
    return false;
  }

  /**
   * How many tokens the `[` here spans through its own `]`, or 0 where
   * no `]` closes it before a brace or the end of the file.
   */
  private closedBracketRun(): number {
    if (this.unclosedBrackets.has(this.peek().at.start)) return 0;
    // The brackets still open at each point, innermost last: the `[`
    // here is closed exactly when its own entry is popped.
    const open: number[] = [];
    for (let ahead = 0; ; ahead++) {
      const token = this.peek(ahead);
      if (token.kind === 'end' || punct(token, '{') || punct(token, '}')) {
        for (const start of open) this.unclosedBrackets.add(start);
        return 0;
      }
      if (punct(token, '[')) open.push(token.at.start);
      else if (punct(token, ']') && open.pop() !== undefined && open.length === 0) {
        return ahead + 1;
      }
    }
  }

  /** What reads the member a word begins, or null where it begins none. */
  private worldMemberReader(
    token: Token,
    readers: ReadonlyMap<string, () => WorldMember | null>,
  ): (() => WorldMember | null) | null {
    // A property is written with its colon, and `:remembers` is the one
    // symbol that is not one.
    if (token.kind === 'symbol') {
      return token.text === 'remembers' ? () => this.remembers() : () => this.property();
    }
    return token.kind === 'name' ? (readers.get(token.text) ?? null) : null;
  }

  /**
   * `contains`, or `contains actors` — the one line that makes a place.
   *
   * A word after it that is not `actors` is left where it is rather
   * than being swallowed: it goes back to the member table, which says
   * what a world is made of and names the word the author wrote. So
   * `contains actor`, singular, points at `actor`, which is where the
   * mistake is.
   */
  private contains(): ContainsDeclaration | null {
    const keyword = this.next();
    const actors = this.take('name', 'actors');
    return {
      kind: 'contains',
      at: actors === null ? keyword.at : spanning(keyword.at, actors.at),
      actors: actors !== null,
    };
  }

  /** `visitors are Creature`, `visitors arrive at composing_room`. */
  private visitors(): WorldMember | null {
    const keyword = this.next();
    if (this.take('name', 'are') !== null) {
      const visitor = this.kindName();
      if (visitor === null) return null;
      return { kind: 'visitors-are', at: spanning(keyword.at, visitor.at), visitor };
    }
    if (this.take('name', 'arrive') !== null) {
      if (this.take('name', 'at') === null) {
        this.diagnostics.refuse(
          this.peek().at,
          'A world says where visitors arrive AT.',
          'Write `visitors arrive at <name>`, naming the place they begin in.',
        );
        return null;
      }
      const place = this.take('name');
      if (place === null) {
        this.diagnostics.refuse(
          this.peek().at,
          'A world says where visitors arrive.',
          'Write `visitors arrive at <name>`, naming the place they begin in.',
        );
        return null;
      }
      return {
        kind: 'visitors-arrive-at',
        at: spanning(keyword.at, place.at),
        place: this.ident(place),
      };
    }
    this.diagnostics.refuse(
      this.peek().at,
      'A world says two things about visitors: what they are, and where they arrive.',
      'Write `visitors are <Kind>` or `visitors arrive at <name>`.',
    );
    return null;
  }

  /** Whether a kind's name starts here, which is how a missing comma is told from an end. */
  private atKindName(): boolean {
    const first = this.peek();
    if (first.kind === 'kind') return true;
    return (
      first.kind === 'name' &&
      this.peek(1).kind === 'punct' &&
      this.peek(1).text === '.' &&
      this.peek(2).kind === 'kind'
    );
  }

  /** `Key` or `sprout.Container` — a kind as written, wherever one is written. */
  private kindName(): KindExpr | null {
    const first = this.peek();
    if (first.kind === 'kind') {
      this.next();
      return { kind: 'kind-expr', at: first.at, library: null, name: this.ident(first) };
    }
    if (first.kind === 'name' && this.peek(1).kind === 'punct' && this.peek(1).text === '.') {
      const library = this.next();
      this.next();
      const named = this.take('kind');
      if (named !== null) {
        return {
          kind: 'kind-expr',
          at: spanning(library.at, named.at),
          library: this.ident(library),
          name: this.ident(named),
        };
      }
      this.diagnostics.refuse(
        this.peek().at,
        `\`${library.text}.\` is not followed by the name of a kind.`,
        'A kind starts with a capital letter, as in `sprout.Container`.',
      );
      return null;
    }
    this.diagnostics.refuse(
      first.at,
      `${this.describe(first)} is not the name of a kind.`,
      'A kind starts with a capital letter, as in `Creature` or `sprout.Container`.',
    );
    return null;
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
      if (this.done || this.atDeclarationStart()) {
        // As the list above: a word that starts a declaration ends the
        // hunt, because otherwise it runs to the end of the file.
        this.diagnostics.refuse(
          this.done ? this.source.endSpan : this.peek().at,
          'This `:remembers` is never closed.',
          'Add a ] after what it remembers.',
        );
        return null;
      }

      const before = this.peek();
      const declared = this.rememberedProperty();
      if (declared === null) {
        // As the list above, including that a file which ran out inside
        // the entry has already been explained by whatever read it, and
        // that a word starting a declaration ends the hunt.
        if (this.done || this.atDeclarationStart()) return null;
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

  // --- expressions --------------------------------------------------
  //
  // Precedence climbing over one table. Every operand of a given level
  // is read at the level above it, and the loop at each level consumes
  // its own operators left to right, so `a - b - c` is `(a - b) - c`.
  //
  // Nothing here recurses without a bound. Parentheses, call arguments
  // and stacked prefix operators all count against `DEEPEST`; a chain
  // of operators at one level is read by the loop rather than by
  // recursion.

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
   * refused by the depth bound instead of exhausting the stack.
   */
  private unary(): Expr | null {
    const operators: Token[] = [];
    let refused = false;
    while (this.peek().kind === 'punct' && PREFIX.has(this.peek().text)) {
      const token = this.next();
      // Against `this.depth`, which parentheses, lists and call
      // arguments all share. A counter of its own would give every
      // bracketed level a fresh allowance of signs on top of the
      // shared one, so a bracket at the bound could still hold a wall
      // of signs and reach twice as deep.
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
    if (isReserved(name.text)) {
      this.diagnostics.refuse(
        name.at,
        `\`${name.text}\` is a word of the language, so it cannot name a value.`,
        'Choose another name for it, as in `let ribs = <what it names>`.',
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
 * One property declaration, read on its own, so the property reader can
 * be exercised directly; a kind or an object (B19 onward) reads one
 * through the same path.
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
 * body exists yet (B24 onward), so this is how one is exercised.
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
 * bodies, and no body exists yet (B24 onward), so this is how one is
 * exercised.
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
