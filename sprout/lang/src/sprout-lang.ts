import {
  ItemDefinition2,
  KindDefinition,
  RoomDefinition2,
  SPROUT_FORMAT,
  humaniseKind,
  sproutDefinitionProblems,
  sproutDefinitionWarnings,
  type ProblemOptions,
  type SproutBinaryOp,
  type SproutChanged,
  type SproutConsent,
  type SproutConsentKind,
  type SproutDefinition2,
  type SproutExpr,
  type SproutKindBody,
  type SproutMessage,
  type SproutOn,
  type SproutPass,
  type SproutStatement,
  type SproutTarget,
} from './sprout.js';
import { type RoomExit, type SproutField } from './definitions.js';

// The written Sprout (sprout.md §2, the grammar in §2.4; #338): a
// hand-written lexer and recursive-descent parser from one object's
// source to its `format: 2` definition, and a printer back. The parser
// runs at the boundary only — the save call compiles, the runtime never
// parses (§4). Problems carry a line and column for the editor; the
// compiler's semantic checks (`sproutDefinitionProblems`) run on the
// tree the parser built, so one call answers "will this save?".
//
// One source, one object (one row — sprout.md §4): `room <ident> { … }`
// or `object <ident> [: Kind] { … }`. Exits name rooms by identifier and
// the saver supplies the map to ids (a room's identifier is the saver's
// convention: `roomIdent`), or by the id itself as a string.
//
// Round trip: `printSprout(parse(x))` re-parses to the same tree — the
// spec asserts it construct by construct and over both seeded studios.

export interface SproutProblem {
  line: number;
  column: number;
  message: string;
}

export interface CompileOptions extends ProblemOptions {
  /** Room identifier → room id, for `exit "…" to <ident>`. */
  rooms?: ReadonlyMap<string, string>;
  /** Messages other objects in the zone send or broadcast, for the warnings. */
  zoneMessages?: readonly string[];
}

export interface CompileResult<D = SproutDefinition2> {
  /** Null when there are problems. */
  definition: D | null;
  problems: SproutProblem[];
  warnings: string[];
}

// --- lexer -------------------------------------------------------------------

type TokenKind = 'ident' | 'kind' | 'symbol' | 'string' | 'integer' | 'punct' | 'eof';

interface Token {
  kind: TokenKind;
  text: string;
  line: number;
  column: number;
}

const PUNCT = [
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '{',
  '}',
  '(',
  ')',
  '[',
  ']',
  ',',
  ':',
  '.',
  '<',
  '>',
  '+',
  '-',
  '!',
];

class SproutSyntaxError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(message);
  }
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const col = () => i - lineStart + 1;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '\n') {
      line++;
      i++;
      lineStart = i;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '#' || (ch === '/' && source[i + 1] === '/')) {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    const start = col();
    if (ch === '"') {
      let j = i + 1;
      let text = '';
      while (j < source.length && source[j] !== '"') {
        if (source[j] === '\\' && j + 1 < source.length) {
          const next = source[j + 1]!;
          text += next === 'n' ? '\n' : next;
          j += 2;
          continue;
        }
        if (source[j] === '\n')
          throw new SproutSyntaxError('A string does not span lines.', line, start);
        text += source[j];
        j++;
      }
      if (j >= source.length) throw new SproutSyntaxError('An unterminated string.', line, start);
      tokens.push({ kind: 'string', text, line, column: start });
      i = j + 1;
      continue;
    }
    if (ch === ':' && /[a-z]/.test(source[i + 1] ?? '')) {
      let j = i + 1;
      while (j < source.length && /[a-z0-9_]/.test(source[j]!)) j++;
      tokens.push({ kind: 'symbol', text: source.slice(i + 1, j), line, column: start });
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < source.length && /[0-9]/.test(source[j]!)) j++;
      tokens.push({ kind: 'integer', text: source.slice(i, j), line, column: start });
      i = j;
      continue;
    }
    if (ch === '_' && !/[a-z0-9_]/.test(source[i + 1] ?? '')) {
      tokens.push({ kind: 'ident', text: '_', line, column: start });
      i++;
      continue;
    }
    if (/[a-z]/.test(ch)) {
      let j = i;
      while (j < source.length && /[a-z0-9_]/.test(source[j]!)) j++;
      tokens.push({ kind: 'ident', text: source.slice(i, j), line, column: start });
      i = j;
      continue;
    }
    if (/[A-Z]/.test(ch)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j]!)) j++;
      tokens.push({ kind: 'kind', text: source.slice(i, j), line, column: start });
      i = j;
      continue;
    }
    const punct = PUNCT.find((p) => source.startsWith(p, i));
    if (punct) {
      tokens.push({ kind: 'punct', text: punct, line, column: start });
      i += punct.length;
      continue;
    }
    throw new SproutSyntaxError(`Unexpected character "${ch}".`, line, start);
  }
  tokens.push({ kind: 'eof', text: '', line, column: col() });
  return tokens;
}

// --- parser ------------------------------------------------------------------

const CONSENT_ARITY: Record<SproutConsentKind, number> = { depart: 1, release: 2, accept: 2 };

class Parser {
  private pos = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly rooms: ReadonlyMap<string, string> | undefined,
  ) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }
  private next(): Token {
    const t = this.peek();
    if (t.kind !== 'eof') this.pos++;
    return t;
  }
  private at(kind: TokenKind, text?: string): boolean {
    const t = this.peek();
    return t.kind === kind && (text === undefined || t.text === text);
  }
  private atWord(text: string): boolean {
    return this.at('ident', text);
  }
  private fail(message: string, token: Token = this.peek()): never {
    throw new SproutSyntaxError(message, token.line, token.column);
  }
  private expect(kind: TokenKind, text?: string, what?: string): Token {
    if (!this.at(kind, text)) {
      const found = this.peek().kind === 'eof' ? 'the end' : `"${this.peek().text}"`;
      this.fail(`Expected ${what ?? (text ? `"${text}"` : kind)}, found ${found}.`);
    }
    return this.next();
  }
  private word(text: string): Token {
    return this.expect('ident', text);
  }
  private ident(what = 'a name'): string {
    return this.expect('ident', undefined, what).text;
  }

  // -- the object --------------------------------------------------------------

  definition(): SproutDefinition2 | KindDefinition {
    const head = this.next();
    const isKind = head.kind === 'ident' && head.text === 'kind';
    if (head.kind !== 'ident' || (head.text !== 'room' && head.text !== 'object' && !isKind)) {
      this.fail(
        'A definition starts with `room <name> {`, `object <name> {` or `kind <Name> {`.',
        head,
      );
    }
    const ident = isKind
      ? this.expect('kind', undefined, "the kind's name (capitalised)").text
      : this.ident("the object's name");
    let inherit: string | null = null;
    if (this.at('punct', ':')) {
      this.next();
      inherit = this.expect('kind', undefined, 'a kind name (capitalised)').text;
    }
    if (this.atWord('in')) {
      this.fail("Where an object sits is the builder's (the row it lives in); leave `in` out.");
    }
    this.expect('punct', '{');
    const body = this.members(head.text === 'room');
    this.expect('punct', '}');
    if (!this.at('eof')) this.fail('One object per source; nothing may follow its closing brace.');
    const header = {
      format: SPROUT_FORMAT as 2,
      name: body.name ?? (isKind ? humaniseKind(ident) : humanise(ident)),
      names: body.names,
      prose: body.prose,
      inherit,
      source: null,
    };
    if (isKind) return { ...header, role: 'kind', kindName: ident, ...body.kind };
    return head.text === 'room'
      ? { ...header, role: 'room', exits: body.exits, ...body.kind }
      : { ...header, role: 'item', ...body.kind };
  }

  private members(room: boolean): {
    name: string | null;
    names: string[];
    prose: string;
    exits: RoomExit[];
    kind: SproutKindBody;
  } {
    const kind: SproutKindBody = {
      properties: [],
      remembers: [],
      describe: [],
      messages: [],
      handlers: [],
      hooks: [],
      passRules: [],
      consents: [],
    };
    let name: string | null = null;
    let names: string[] = [];
    let prose = '';
    const exits: RoomExit[] = [];
    while (!this.at('punct', '}') && !this.at('eof')) {
      const t = this.peek();
      if (t.kind === 'symbol') {
        this.next();
        if (t.text === 'name') {
          name = this.expect('string', undefined, 'the display name in quotes').text;
        } else if (t.text === 'names') {
          names = this.stringList();
        } else if (t.text === 'remembers') {
          kind.remembers = this.remembersList();
        } else {
          kind.properties.push(this.property(t.text));
        }
        continue;
      }
      if (t.kind !== 'ident')
        this.fail('Expected a property (`:name …`), a message, or a handler.');
      switch (t.text) {
        case 'prose':
          this.next();
          prose = this.expect('string', undefined, 'the prose in quotes').text;
          break;
        case 'describe':
          this.next();
          kind.describe = this.block(true);
          break;
        case 'on':
          this.next();
          kind.handlers.push(this.onHandler());
          break;
        case 'changed':
          this.next();
          kind.hooks.push(this.changedHook());
          break;
        case 'pass':
          this.next();
          kind.passRules.push(this.passRule());
          break;
        case 'depart':
        case 'release':
        case 'accept':
          this.next();
          kind.consents.push(this.consent(t.text));
          break;
        case 'exit':
          if (!room) this.fail('Only a room has exits.', t);
          this.next();
          exits.push(this.exit());
          break;
        default:
          kind.messages.push(this.message());
      }
    }
    return { name, names, prose, exits, kind };
  }

  private stringList(): string[] {
    this.expect('punct', '[');
    const out: string[] = [];
    while (!this.at('punct', ']')) {
      out.push(this.expect('string', undefined, 'a word in quotes').text);
      if (this.at('punct', ',')) this.next();
      else break;
    }
    this.expect('punct', ']');
    return out;
  }

  /** `:remembers [thrown: 0 min 0 max 99, met: false, mood: one_of [a, b] default a]` */
  private remembersList(): SproutField[] {
    this.expect('punct', '[');
    const out: SproutField[] = [];
    while (!this.at('punct', ']')) {
      const name = this.ident('a remembered property');
      this.expect('punct', ':');
      out.push(this.property(name));
      if (this.at('punct', ',')) this.next();
      else break;
    }
    this.expect('punct', ']');
    return out;
  }

  /** After the name: `true` | `0 min 0 max 3` | `one_of [a, b] default a`, with optional `default`. */
  private property(name: string): SproutField {
    if (this.atWord('default')) this.next();
    if (this.atWord('one_of')) {
      this.next();
      this.expect('punct', '[');
      const options: string[] = [];
      while (!this.at('punct', ']')) {
        options.push(this.optionWord());
        if (this.at('punct', ',')) this.next();
        else break;
      }
      this.expect('punct', ']');
      let def = options[0] ?? '';
      if (this.atWord('default')) {
        this.next();
        def = this.optionWord();
      }
      return { type: 'enum', name, options, default: def };
    }
    if (this.atWord('true') || this.atWord('false')) {
      return { type: 'boolean', name, default: this.next().text === 'true' };
    }
    // A picture (§2.9): `:image "m-…"` (a media id the uploader minted) or `:image media` (none yet).
    if (this.at('string')) return { type: 'media', name, default: this.next().text };
    if (this.atWord('media')) {
      this.next();
      return { type: 'media', name, default: null };
    }
    const value = this.integerLiteral();
    let min = Math.min(0, value);
    let max = Math.max(0, value);
    let bounded = false;
    while (this.atWord('min') || this.atWord('max')) {
      const which = this.next().text;
      const n = this.integerLiteral();
      if (which === 'min') min = n;
      else max = n;
      bounded = true;
    }
    if (!bounded) {
      // An unbounded declaration: the widest sensible range, as the form editor offers.
      min = Math.min(min, -999_999);
      max = Math.max(max, 999_999);
    }
    return { type: 'integer', name, default: value, min, max };
  }

  private optionWord(): string {
    if (this.at('string')) return this.next().text;
    if (this.at('symbol')) return this.next().text;
    return this.ident('an option');
  }

  private integerLiteral(): number {
    let sign = 1;
    if (this.at('punct', '-')) {
      this.next();
      sign = -1;
    }
    return sign * Number(this.expect('integer', undefined, 'a number').text);
  }

  private exit(): RoomExit {
    const label = this.expect('string', undefined, "the exit's label in quotes").text;
    this.word('to');
    if (this.at('string')) return { label, toRoomId: this.next().text };
    const t = this.expect('ident', undefined, 'the room it leads to');
    const id = this.rooms?.get(t.text);
    if (!id) this.fail(`No room is called "${t.text}" here.`, t);
    return { label, toRoomId: id };
  }

  // -- members ----------------------------------------------------------------

  private message(): SproutMessage {
    const start = this.peek();
    const name = this.ident('a message name');
    if (KEYWORDS.has(name))
      this.fail(`"${name}" is a keyword; a message needs another name.`, start);
    const args: SproutMessage['args'] = [];
    if (this.at('punct', '(')) {
      this.next();
      while (!this.at('punct', ')')) {
        const arg = this.ident('an argument name');
        this.expect('punct', ':');
        this.word('object');
        args.push({ name: arg, type: 'object' });
        if (this.at('punct', ',')) this.next();
        else break;
      }
      this.expect('punct', ')');
    }
    let when: SproutExpr | null = null;
    if (this.atWord('when')) {
      this.next();
      this.expect('punct', '(');
      when = this.expr();
      this.expect('punct', ')');
    }
    if (this.atWord('abstract')) {
      this.next();
      return { name, args, grammar: [], when, abstract: true, body: [] };
    }
    const grammar: string[] = [];
    const body = this.block(false, grammar);
    return { name, args, grammar, when, abstract: false, body };
  }

  private params(max: number, what: string): string[] {
    const out: string[] = [];
    if (!this.at('punct', '(')) return out;
    this.next();
    while (!this.at('punct', ')')) {
      const t = this.expect('ident', undefined, what);
      if (out.length >= max) this.fail(`At most ${max} parameter${max === 1 ? '' : 's'} here.`, t);
      out.push(t.text);
      if (this.at('punct', ',')) this.next();
      else break;
    }
    this.expect('punct', ')');
    return out;
  }

  /** `(from, value)` with `_` for a parameter left unnamed. */
  private optionalParams(): [string | null, string | null] {
    const [a = null, b = null] = this.params(2, 'a parameter name (or _)').map((p) =>
      p === '_' ? null : p,
    );
    return [a, b];
  }

  private onHandler(): SproutOn {
    const message = this.expect('symbol', undefined, 'the message (`:name`)').text;
    const [from, value] = this.optionalParams();
    return { message, from, value, body: this.block(false) };
  }

  private changedHook(): SproutChanged {
    const property = this.expect('symbol', undefined, 'the property (`:name`)').text;
    const [value, was] = this.optionalParams();
    return { property, value, was, body: this.block(false) };
  }

  private passRule(): SproutPass {
    let message: string | null;
    if (this.atWord('any')) {
      this.next();
      message = null;
    } else {
      message = this.expect('symbol', undefined, 'the message (`:name`) or `any`').text;
    }
    this.expect('punct', '(');
    const condition = this.expr();
    this.expect('punct', ')');
    return { message, condition };
  }

  private consent(guard: SproutConsentKind): SproutConsent {
    const start = this.peek();
    const params = this.params(CONSENT_ARITY[guard], 'a parameter name');
    if (params.includes('_')) this.fail('Name the parameters of a consent guard.', start);
    return { guard, params, body: this.block(false) };
  }

  // -- statements ----------------------------------------------------------------

  private block(describe: boolean, grammar?: string[]): SproutStatement[] {
    this.expect('punct', '{');
    const out: SproutStatement[] = [];
    while (!this.at('punct', '}') && !this.at('eof')) {
      if (grammar && this.atWord('grammar')) {
        this.next();
        grammar.push(this.expect('string', undefined, 'the grammar line in quotes').text);
        continue;
      }
      out.push(this.statement(describe));
    }
    this.expect('punct', '}');
    return out;
  }

  private statement(describe: boolean): SproutStatement {
    const t = this.peek();
    if (t.kind !== 'ident') this.fail('Expected a statement.');
    if (t.text === 'grammar') {
      this.fail('`grammar` lines go at the top of a message body, not inside a block.', t);
    }
    if ((t.text === 'room' || t.text === 'container') && this.peek(1).text === '.') {
      this.fail(
        'Only self may be written: tell the room (`send room :message`) and let it decide.',
        t,
      );
    }
    switch (t.text) {
      case 'if':
        return this.ifStatement(describe);
      case 'say':
        this.next();
        return {
          kind: 'say',
          text: this.expect('string', undefined, 'what to say, in quotes').text,
        };
      case 'text':
        this.next();
        return { kind: 'text', text: this.expect('string', undefined, 'the text, in quotes').text };
      case 'broadcast': {
        this.next();
        const message = this.expect('symbol', undefined, 'the message (`:name`)').text;
        return { kind: 'broadcast', message, value: this.optionalValue() };
      }
      case 'send': {
        this.next();
        const target = this.target();
        const message = this.expect('symbol', undefined, 'the message (`:name`)').text;
        return { kind: 'send', target, message, value: this.optionalValue() };
      }
      case 'show': {
        this.next();
        const target = this.atTarget() && this.peek(1).text !== '.' ? this.target() : null;
        const property = this.at('symbol') ? this.next().text : null;
        return { kind: 'show', target, property };
      }
      case 'move': {
        this.next();
        const what = this.target();
        this.word('to');
        return { kind: 'move', what, to: this.target() };
      }
      case 'spawn': {
        this.next();
        const kindName = this.expect('kind', undefined, 'a kind name (capitalised)').text;
        this.word('in');
        return { kind: 'spawn', kindName, in: this.target() };
      }
      case 'destroy':
        this.next();
        this.word('self');
        return { kind: 'destroy' };
      case 'each': {
        this.next();
        const variable = this.ident('a variable name');
        this.word('in');
        const target = this.target();
        return { kind: 'each', variable, in: target, body: this.block(describe) };
      }
      case 'allow':
        this.next();
        return { kind: 'allow' };
      case 'refuse':
        this.next();
        return {
          kind: 'refuse',
          text: this.expect('string', undefined, 'the reason, in quotes').text,
        };
      case 'self':
        return this.selfCall();
      case 'actor':
        return this.actorCall();
      default:
        return this.fail(`"${t.text}" is not a statement.`, t);
    }
  }

  private optionalValue(): SproutExpr | null {
    if (!this.at('punct', '(')) return null;
    this.next();
    const value = this.expr();
    this.expect('punct', ')');
    return value;
  }

  private ifStatement(describe: boolean): SproutStatement {
    this.word('if');
    this.expect('punct', '(');
    const cond = this.expr();
    this.expect('punct', ')');
    const then = this.block(describe);
    let otherwise: SproutStatement[] = [];
    if (this.atWord('else')) {
      this.next();
      otherwise = this.atWord('if') ? [this.ifStatement(describe)] : this.block(describe);
    }
    return { kind: 'if', cond, then, else: otherwise };
  }

  private selfCall(): SproutStatement {
    const t = this.word('self');
    this.expect('punct', '.');
    const method = this.ident('set or adjust');
    if (method !== 'set' && method !== 'adjust') {
      this.fail(`self.${method} is not a statement (self.set, self.adjust).`, t);
    }
    this.expect('punct', '(');
    const property = this.expect('symbol', undefined, 'the property (`:name`)').text;
    this.expect('punct', ',');
    const value = this.expr();
    this.expect('punct', ')');
    return method === 'set'
      ? { kind: 'set', property, value }
      : { kind: 'adjust', property, by: value };
  }

  private actorCall(): SproutStatement {
    const t = this.word('actor');
    this.expect('punct', '.');
    const method = this.ident('remember');
    if (method !== 'remember') this.fail(`actor.${method} is not a statement (actor.remember).`, t);
    this.expect('punct', '(');
    const property = this.expect('symbol', undefined, 'the property (`:name`)').text;
    this.expect('punct', ',');
    const value = this.expr();
    this.expect('punct', ')');
    return { kind: 'remember', property, value };
  }

  // -- expressions ---------------------------------------------------------------

  private expr(): SproutExpr {
    return this.binary(0);
  }

  private static readonly LEVELS: readonly (readonly string[])[] = [
    ['||'],
    ['&&'],
    ['==', '!='],
    ['<', '<=', '>', '>='],
    ['+', '-'],
  ];

  private binary(level: number): SproutExpr {
    if (level >= Parser.LEVELS.length) return this.unary();
    let left = this.binary(level + 1);
    while (this.peek().kind === 'punct' && Parser.LEVELS[level]!.includes(this.peek().text)) {
      const op = this.next().text as SproutBinaryOp;
      const right = this.binary(level + 1);
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private unary(): SproutExpr {
    if (this.at('punct', '!')) {
      this.next();
      return { kind: 'not', expr: this.unary() };
    }
    return this.primary();
  }

  private primary(): SproutExpr {
    const t = this.peek();
    if (t.kind === 'punct' && t.text === '(') {
      this.next();
      const inner = this.expr();
      this.expect('punct', ')');
      return inner;
    }
    if (t.kind === 'string') {
      this.next();
      return { kind: 'literal', value: t.text };
    }
    if (t.kind === 'integer' || (t.kind === 'punct' && t.text === '-')) {
      return { kind: 'literal', value: this.integerLiteral() };
    }
    if (t.kind === 'symbol') {
      this.next();
      return { kind: 'symbol', name: t.text };
    }
    if (t.kind === 'ident' && (t.text === 'true' || t.text === 'false')) {
      this.next();
      return { kind: 'literal', value: t.text === 'true' };
    }
    if (t.kind === 'ident' && t.text === 'none') {
      this.next();
      return { kind: 'literal', value: null };
    }
    if (this.atTarget()) {
      const target = this.target();
      if (target.kind === 'name' && !this.at('punct', '.')) {
        return { kind: 'ref', name: target.name };
      }
      if (target.kind === 'actor' && this.at('punct', '.') && this.peek(1).text === 'recall') {
        this.next();
        this.next();
        this.expect('punct', '(');
        const property = this.expect('symbol', undefined, 'the property (`:name`)').text;
        this.expect('punct', ')');
        return { kind: 'recall', property };
      }
      this.expect('punct', '.', 'a read: .get(:p), .is(Kind) or .count');
      const method = this.ident('get, is or count');
      if (method === 'get') {
        this.expect('punct', '(');
        const property = this.expect('symbol', undefined, 'the property (`:name`)').text;
        this.expect('punct', ')');
        return { kind: 'get', target, property };
      }
      if (method === 'is') {
        this.expect('punct', '(');
        const kindName = this.expect('kind', undefined, 'a kind name (capitalised)').text;
        this.expect('punct', ')');
        return { kind: 'is', target, kindName };
      }
      if (method === 'count') return { kind: 'count', target };
      if (method === 'recall') return this.fail('Only the actor recalls: actor.recall(:p).', t);
      return this.fail(`.${method} is not a read (get, is, count).`, t);
    }
    return this.fail('Expected a value.');
  }

  private atTarget(): boolean {
    return this.peek().kind === 'ident' && !KEYWORDS.has(this.peek().text);
  }

  private target(): SproutTarget {
    const t = this.expect('ident', undefined, 'self, room, container, actor, or a name');
    switch (t.text) {
      case 'self':
      case 'room':
      case 'container':
      case 'actor':
        return { kind: t.text };
      default:
        if (KEYWORDS.has(t.text)) this.fail(`"${t.text}" is a keyword, not a name.`, t);
        return { kind: 'name', name: t.text };
    }
  }
}

const KEYWORDS = new Set([
  'if',
  'else',
  'true',
  'false',
  'say',
  'text',
  'broadcast',
  'send',
  'show',
  'move',
  'spawn',
  'destroy',
  'each',
  'allow',
  'refuse',
  'grammar',
  'when',
  'abstract',
  'on',
  'changed',
  'pass',
  'any',
  'depart',
  'release',
  'accept',
  'describe',
  'prose',
  'exit',
  'object',
  'kind',
  'min',
  'max',
  'one_of',
  'default',
  'media',
  'none',
]);

/** `kick_wheel` → "Kick wheel". */
export function humanise(ident: string): string {
  const words = ident.replace(/_+/g, ' ').trim();
  return words === '' ? ident : words[0]!.toUpperCase() + words.slice(1);
}

/**
 * Source → definition, or problems. The definition carries the source
 * it came from (`source`), which the saver stores beside the AST (§4 c).
 */
export function compileSprout(source: string, options: CompileOptions = {}): CompileResult {
  return compileAny(source, options, 'object') as CompileResult;
}

/** A kind's source → its definition (#341). Refuses `object` / `room` headers, as `compileSprout` refuses `kind`. */
export function compileSproutKind(
  source: string,
  options: CompileOptions = {},
): CompileResult<KindDefinition> {
  return compileAny(source, options, 'kind') as CompileResult<KindDefinition>;
}

function compileAny(
  source: string,
  options: CompileOptions,
  expect: 'object' | 'kind',
): CompileResult<SproutDefinition2 | KindDefinition> {
  let tree: SproutDefinition2 | KindDefinition;
  try {
    tree = new Parser(tokenize(source), options.rooms).definition();
  } catch (err) {
    if (err instanceof SproutSyntaxError) {
      return {
        definition: null,
        problems: [{ line: err.line, column: err.column, message: err.message }],
        warnings: [],
      };
    }
    throw err;
  }
  if ((tree.role === 'kind') !== (expect === 'kind')) {
    const message =
      expect === 'kind'
        ? 'A kind starts with `kind <Name> {`; objects and rooms are written on their own pages.'
        : 'A kind is written in the kinds panel, not placed as an object or a room.';
    return { definition: null, problems: [{ line: 1, column: 1, message }], warnings: [] };
  }
  const schema =
    tree.role === 'room'
      ? RoomDefinition2
      : tree.role === 'kind'
        ? KindDefinition
        : ItemDefinition2;
  const parsed = schema.safeParse({ ...tree, source });
  if (parsed.success && options.zoneKinds) {
    const more = sproutDefinitionProblems(parsed.data, options);
    if (more.length > 0) {
      return {
        definition: null,
        problems: more.map((message) => ({ line: 1, column: 1, message })),
        warnings: [],
      };
    }
  }
  if (!parsed.success) {
    // Semantic problems have no position of their own; they point at the head.
    const seen = new Set<string>();
    const problems: SproutProblem[] = [];
    for (const issue of parsed.error.issues) {
      const message =
        issue.code === 'custom' ? issue.message : `${issue.path.join('.')}: ${issue.message}`;
      if (seen.has(message)) continue;
      seen.add(message);
      problems.push({ line: 1, column: 1, message });
    }
    return { definition: null, problems, warnings: [] };
  }
  return {
    definition: parsed.data,
    problems: [],
    warnings:
      parsed.data.role === 'kind'
        ? []
        : sproutDefinitionWarnings(parsed.data, options.zoneMessages),
  };
}

/** The problems of a definition that came from the form, in the compiler's shape. */
export function definitionProblems(def: SproutDefinition2): SproutProblem[] {
  return sproutDefinitionProblems(def).map((message) => ({ line: 1, column: 1, message }));
}

// --- printer -----------------------------------------------------------------

export interface PrintOptions {
  /** Room id → identifier, the inverse of CompileOptions.rooms; unmapped ids print as strings. */
  roomIdents?: ReadonlyMap<string, string>;
  /** The object's own identifier; derived from its name when absent. */
  ident?: string;
}

const IDENT = /^[a-z][a-z0-9_]{0,31}$/;

function str(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function option(word: string): string {
  return IDENT.test(word) ? word : str(word);
}

/** A display name as an identifier: "Kick wheel" → kick_wheel. */
export function identOf(name: string): string {
  const ident = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9]/, (d) => `n${d}`)
    .slice(0, 32);
  return ident === '' ? 'it' : ident;
}

function printField(f: SproutField): string {
  switch (f.type) {
    case 'boolean':
      return String(f.default);
    case 'integer':
      return f.min <= -999_999 && f.max >= 999_999
        ? String(f.default)
        : `${f.default} min ${f.min} max ${f.max}`;
    case 'enum':
      return `one_of [${f.options.map(option).join(' , ').replace(/ , /g, ', ')}] default ${option(f.default)}`;
    case 'media':
      return f.default === null ? 'media' : str(f.default);
  }
}

function printTarget(t: SproutTarget): string {
  return t.kind === 'name' ? t.name : t.kind;
}

const PRECEDENCE: Record<string, number> = {
  '||': 0,
  '&&': 1,
  '==': 2,
  '!=': 2,
  '<': 3,
  '<=': 3,
  '>': 3,
  '>=': 3,
  '+': 4,
  '-': 4,
};

function printExpr(e: SproutExpr, parent = -1, right = false): string {
  switch (e.kind) {
    case 'literal':
      return e.value === null
        ? 'none'
        : typeof e.value === 'string'
          ? str(e.value)
          : String(e.value);
    case 'symbol':
      return `:${e.name}`;
    case 'get':
      return `${printTarget(e.target)}.get(:${e.property})`;
    case 'recall':
      return `actor.recall(:${e.property})`;
    case 'ref':
      return e.name;
    case 'is':
      return `${printTarget(e.target)}.is(${e.kindName})`;
    case 'count':
      return `${printTarget(e.target)}.count`;
    case 'not': {
      const inner = printExpr(e.expr, 99);
      return `!${inner}`;
    }
    case 'binary': {
      const level = PRECEDENCE[e.op]!;
      const text = `${printExpr(e.left, level)} ${e.op} ${printExpr(e.right, level, true)}`;
      // Parenthesise when the parent binds tighter, or equally on the right (left-assoc).
      return level < parent || (level === parent && right) ? `(${text})` : text;
    }
  }
}

function printBlock(
  body: readonly SproutStatement[],
  indent: string,
  lead: string[] = [],
): string[] {
  const inner = indent + '  ';
  const lines = [...lead.map((l) => inner + l)];
  for (const s of body) lines.push(...printStatement(s, inner));
  return lines;
}

function printStatement(s: SproutStatement, indent: string): string[] {
  switch (s.kind) {
    case 'if': {
      const lines = [`${indent}if (${printExpr(s.cond)}) {`, ...printBlock(s.then, indent)];
      let tail = s;
      const elseLines: string[] = [];
      while (tail.else.length > 0) {
        const only = tail.else.length === 1 ? tail.else[0]! : null;
        if (only && only.kind === 'if') {
          elseLines.push(
            `${indent}} else if (${printExpr(only.cond)}) {`,
            ...printBlock(only.then, indent),
          );
          tail = only;
          continue;
        }
        elseLines.push(`${indent}} else {`, ...printBlock(tail.else, indent));
        break;
      }
      return [...lines, ...elseLines, `${indent}}`];
    }
    case 'set':
      return [`${indent}self.set(:${s.property}, ${printExpr(s.value)})`];
    case 'adjust':
      return [`${indent}self.adjust(:${s.property}, ${printExpr(s.by)})`];
    case 'say':
      return [`${indent}say ${str(s.text)}`];
    case 'text':
      return [`${indent}text ${str(s.text)}`];
    case 'broadcast':
      return [`${indent}broadcast :${s.message}${s.value ? `(${printExpr(s.value)})` : ''}`];
    case 'send':
      return [
        `${indent}send ${printTarget(s.target)} :${s.message}${s.value ? `(${printExpr(s.value)})` : ''}`,
      ];
    case 'remember':
      return [`${indent}actor.remember(:${s.property}, ${printExpr(s.value)})`];
    case 'show':
      return [
        `${indent}show${s.target ? ` ${printTarget(s.target)}` : ''}${s.property ? ` :${s.property}` : ''}`,
      ];
    case 'move':
      return [`${indent}move ${printTarget(s.what)} to ${printTarget(s.to)}`];
    case 'spawn':
      return [`${indent}spawn ${s.kindName} in ${printTarget(s.in)}`];
    case 'destroy':
      return [`${indent}destroy self`];
    case 'each':
      return [
        `${indent}each ${s.variable} in ${printTarget(s.in)} {`,
        ...printBlock(s.body, indent),
        `${indent}}`,
      ];
    case 'allow':
      return [`${indent}allow`];
    case 'refuse':
      return [`${indent}refuse ${str(s.text)}`];
  }
}

/** Definition → canonical Sprout. `compileSprout(printSprout(d))` yields `d` (with `source` set). */
export function printSprout(
  def: SproutDefinition2 | KindDefinition,
  options: PrintOptions = {},
): string {
  const ident = def.role === 'kind' ? def.kindName : (options.ident ?? identOf(def.name));
  const head =
    def.role === 'room'
      ? `room ${ident} {`
      : `${def.role === 'kind' ? 'kind' : 'object'} ${ident}${def.inherit ? `: ${def.inherit}` : ''} {`;
  const lines: string[] = [head];
  const in1 = '  ';
  const plain = def.role === 'kind' ? humaniseKind(ident) : humanise(ident);
  if (def.name !== plain) lines.push(`${in1}:name ${str(def.name)}`);
  if (def.names.length > 0) lines.push(`${in1}:names [${def.names.map(str).join(', ')}]`);
  for (const p of def.properties) lines.push(`${in1}:${p.name} ${printField(p)}`);
  if (def.remembers.length > 0) {
    lines.push(
      `${in1}:remembers [${def.remembers.map((f) => `${f.name}: ${printField(f)}`).join(', ')}]`,
    );
  }
  if (def.prose !== '') lines.push(`${in1}prose ${str(def.prose)}`);
  if (def.describe.length > 0) {
    lines.push('', `${in1}describe {`, ...printBlock(def.describe, in1), `${in1}}`);
  }
  for (const m of def.messages) {
    const args =
      m.args.length > 0 ? ` (${m.args.map((a) => `${a.name}: ${a.type}`).join(', ')})` : '';
    const when = m.when ? ` when (${printExpr(m.when)})` : '';
    if (m.abstract) {
      lines.push('', `${in1}${m.name}${args}${when} abstract`);
      continue;
    }
    lines.push(
      '',
      `${in1}${m.name}${args}${when} {`,
      ...printBlock(
        m.body,
        in1,
        m.grammar.map((g) => `grammar ${str(g)}`),
      ),
      `${in1}}`,
    );
  }
  for (const h of def.handlers) {
    const params =
      h.from || h.value
        ? ` (${[h.from ?? '_', h.value].filter((p) => p !== null).join(', ')})`
        : '';
    lines.push('', `${in1}on :${h.message}${params} {`, ...printBlock(h.body, in1), `${in1}}`);
  }
  for (const c of def.hooks) {
    const params =
      c.value || c.was ? ` (${[c.value ?? '_', c.was].filter((p) => p !== null).join(', ')})` : '';
    lines.push(
      '',
      `${in1}changed :${c.property}${params} {`,
      ...printBlock(c.body, in1),
      `${in1}}`,
    );
  }
  if (def.passRules.length > 0) lines.push('');
  for (const p of def.passRules) {
    lines.push(
      `${in1}pass ${p.message === null ? 'any' : `:${p.message}`} (${printExpr(p.condition)})`,
    );
  }
  for (const c of def.consents) {
    const params = c.params.length > 0 ? ` (${c.params.join(', ')})` : '';
    lines.push('', `${in1}${c.guard}${params} {`, ...printBlock(c.body, in1), `${in1}}`);
  }
  if (def.role === 'room' && def.exits.length > 0) {
    lines.push('');
    for (const e of def.exits) {
      const to = options.roomIdents?.get(e.toRoomId);
      lines.push(`${in1}exit ${str(e.label)} to ${to ?? str(e.toRoomId)}`);
    }
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}
