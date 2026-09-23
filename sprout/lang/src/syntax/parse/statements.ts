// Statements: blocks, `if`, `refuse` and `allow`; `let`; the two that
// change what exists, `spawn` and `destroy`; and a call written as a
// statement (the spec's Movement and consent; Properties › Naming a
// value; The world model › Spawning, Destroying). A `let` is here rather
// than with expressions because its value may be a statement: `spawn` is
// the one statement that also yields a binding.
//
// Each reader takes its statement or refuses it once, having said what to
// write instead; nothing is guessed. A statement that could not be read
// costs itself, and its block reads on from the next statement or its own
// `}`. What a statement's parts mean — which kind, which passage, whose
// body, and where each statement may stand — is the checker's.

import type {
  Block,
  DestroyStatement,
  Expr,
  IfStatement,
  KindExpr,
  LetStatement,
  RefuseStatement,
  SpawnStatement,
  Statement,
} from '../ast.js';
import type { Token } from '../lexer.js';
import { isReserved } from '../reserved.js';
import { spanning, type Span } from '../../source/source.js';
import { kindName } from './bodies.js';
import { expression } from './expressions.js';
import { punct, type Parser } from './parser.js';
import { readable } from '../../source/words.js';
import { objectPath } from './paths.js';
import { skipBracketed } from './recovery.js';

/**
 * What a block is read inside. Its fields say what no statement can see
 * for itself: whose body it is in, where that body's next member starts,
 * and whether the block was found never closed, which every block around
 * it then stops at without saying so again.
 */
export interface Enclosing {
  /** The kind, object or world the statements are written in, for a remedy that names it. */
  readonly owner: string | null;
  /** The word the outermost block belongs to, as a refusal of it names it: `accept`. */
  readonly within: string | null;
  /**
   * Whether a body encloses the block, and so says itself that it is
   * never closed where the file ends or a declaration starts inside it.
   */
  readonly enclosed: boolean;
  /** Whether a token starts the enclosing body's next member, which no statement does. */
  readonly startsMember: (token: Token) => boolean;
  /** Set once a block is found never closed, having been said. */
  unclosed: boolean;
}

/** A statement read on its own, with no body around it. */
export function onItsOwn(): Enclosing {
  return {
    owner: null,
    within: null,
    enclosed: false,
    startsMember: () => false,
    unclosed: false,
  };
}

type Reader = (p: Parser, within: Enclosing) => Statement | null;

/** Each statement this compiler reads, by the word it starts with. */
const STATEMENTS: ReadonlyMap<string, Reader> = new Map<string, Reader>([
  ['if', ifStatement],
  ['refuse', refuseStatement],
  ['allow', allowStatement],
  ['let', (p) => letStatement(p)],
  ['spawn', (p) => spawnStatement(p)],
  ['destroy', (p) => destroyStatement(p)],
]);

/** One statement, or null having said why it is not one. */
export function statement(p: Parser, within: Enclosing = onItsOwn()): Statement | null {
  const token = p.peek();
  if (token.kind === 'name') {
    const reader = STATEMENTS.get(token.text);
    if (reader !== undefined) return reader(p, within);
    if (token.text === 'else') return danglingElse(p, within);
    if (!isReserved(token.text)) return expressionStatement(p);
  }
  notAStatement(p, token);
  return null;
}

/** The refusal for a token that starts no statement this compiler reads. */
export function notAStatement(p: Parser, token: Token): void {
  p.diagnostics.refuse(
    token.at,
    `${p.describe(token)} does not start a statement this compiler reads.`,
    `A statement starts with ${readable([...STATEMENTS.keys()])}, or is a call that writes, as in \`self.set(:open, true)\`.`,
  );
}

/**
 * `{ … }` — the statements up to the `}` that closes them, the `{` next.
 * A statement that could not be read costs itself and the block reads
 * on. Null where the block is too deep to read, or is never closed:
 * where the enclosing body's next member starts inside it, that is said
 * here and marked on `within`; where the file ends or a declaration
 * starts, the enclosing body says it.
 */
export function block(p: Parser, within: Enclosing): Block | null {
  const open = p.next();
  if (!p.deeper(open.at, 'Take some of the braces out.')) {
    skipBracketed(p, '}');
    return null;
  }
  try {
    const statements: Statement[] = [];
    for (;;) {
      const close = p.take('punct', '}');
      if (close !== null) return { kind: 'block', at: spanning(open.at, close.at), statements };
      if (endsBlock(p, within)) {
        neverClosed(p, within);
        return null;
      }
      const token = p.peek();
      const read = statement(p, within);
      if (within.unclosed) return null;
      if (read !== null) {
        statements.push(read);
        continue;
      }
      if (p.peek().at.start === token.at.start && !punct(token, '}') && !endsBlock(p, within)) {
        p.next();
      }
      recoverToStatement(p, within);
    }
  } finally {
    p.depth -= 1;
  }
}

/** Whether nothing more of a block can be here: the file ended, or a declaration or a member starts. */
function endsBlock(p: Parser, within: Enclosing): boolean {
  return p.done || p.atDeclarationStart() || within.startsMember(p.peek());
}

/** A block that ran into what cannot be inside it, said once for every block it was in. */
function neverClosed(p: Parser, within: Enclosing): void {
  within.unclosed = true;
  if (within.enclosed && (p.done || p.atDeclarationStart())) return;
  const inside = 'Every { inside it, after an `if` or an `else`, needs its own }.';
  p.diagnostics.refuse(
    p.done ? p.source.endSpan : p.peek().at,
    within.within === null
      ? 'This block is never closed.'
      : `\`${within.within}\` is never closed.`,
    within.within === null
      ? `Add a } where it ends. ${inside}`
      : `Add a } where what \`${within.within}\` decides ends. ${inside}`,
  );
}

/** The words a statement starts with, where recovery stops to read the next one. */
const STARTS: ReadonlySet<string> = new Set(STATEMENTS.keys());

/**
 * Step over the rest of a statement that could not be read, to the next
 * statement at this depth or the block's own `}`. Braces and brackets
 * nest. A word that starts a member or a declaration is never inside a
 * statement, so recovery stops at one at any depth and leaves it for the
 * block to find never closed; a property's name stops it only where it
 * starts a line, since a symbol is also an expression's.
 */
function recoverToStatement(p: Parser, within: Enclosing): void {
  let braces = 0;
  let brackets = 0;
  // Just past a `}` that closed a block the refused statement held, as
  // the start of a line is, is where the next statement may begin.
  let afterBlock = false;
  while (!p.done) {
    const token = p.peek();
    const startsLine = firstOnItsLine(p, token);
    const boundary = startsLine || afterBlock;
    afterBlock = false;
    if (p.atDeclarationStart()) return;
    if (token.kind === 'name' && within.startsMember(token)) return;
    if (token.kind === 'symbol' && brackets === 0 && startsLine && within.startsMember(token)) {
      return;
    }
    if (punct(token, '{')) braces += 1;
    else if (punct(token, '}')) {
      if (braces === 0) return;
      braces -= 1;
      afterBlock = braces === 0;
    } else if (punct(token, '(') || punct(token, '[')) brackets += 1;
    else if ((punct(token, ')') || punct(token, ']')) && brackets > 0) brackets -= 1;
    else if (braces === 0 && brackets === 0 && token.kind === 'name') {
      if (STARTS.has(token.text)) return;
      // `self.set(…)` on a line of its own is a statement of its own.
      if (boundary && !isReserved(token.text) && punct(p.peek(1), '.')) return;
    }
    p.next();
  }
}

/** Whether nothing but blanks stands before a token on its line. */
function firstOnItsLine(p: Parser, token: Token): boolean {
  const text = p.source.text;
  const lineStart = text.lastIndexOf('\n', token.at.start - 1) + 1;
  return text.slice(lineStart, token.at.start).trim() === '';
}

/**
 * `if (self.count >= 8) { … } else if (…) { … } else { … }`. The chain is
 * read in a loop and built from its tail, so a long `else if` chain costs
 * no depth. A link that cannot be read costs the whole statement.
 */
function ifStatement(p: Parser, within: Enclosing): IfStatement | null {
  const links: { keyword: Token; condition: Expr; then: Block }[] = [];
  let last: Block | null = null;
  let keyword = p.next();
  for (;;) {
    const condition = ifCondition(p, keyword);
    if (condition === null) return null;
    if (!p.at('punct', '{')) {
      p.diagnostics.refuse(
        p.done ? p.source.endSpan : p.peek().at,
        'What `if` decides goes in braces.',
        'Write `if (<condition>) { … }`, as in `if (self.count >= 8) { refuse full }`.',
      );
      return null;
    }
    const then = block(p, within);
    if (then === null) return null;
    links.push({ keyword, condition, then });
    const otherwise = p.take('name', 'else');
    if (otherwise === null) break;
    if (p.at('name', 'if')) {
      keyword = p.next();
      continue;
    }
    if (!p.at('punct', '{')) {
      p.diagnostics.refuse(
        p.done ? p.source.endSpan : p.peek().at,
        'What `else` does goes in braces.',
        'Write `else { … }`, or `else if (<condition>) { … }`.',
      );
      return null;
    }
    last = block(p, within);
    if (last === null) return null;
    break;
  }
  let built: Block | IfStatement | null = last;
  for (let i = links.length - 1; i >= 0; i--) {
    const { keyword: word, condition, then } = links[i]!;
    built = {
      kind: 'if',
      at: spanning(word.at, (built ?? then).at),
      condition,
      then,
      otherwise: built,
    };
  }
  return built as IfStatement;
}

/** `(self.count >= 8)` after an `if`: one expression in brackets. Null having said why. */
function ifCondition(p: Parser, keyword: Token): Expr | null {
  const needed = (at: Span): null => {
    p.diagnostics.refuse(
      at,
      '`if` needs a condition in brackets.',
      'Write `if (<condition>) { … }`, as in `if (self.count >= 8) { … }`.',
    );
    return null;
  };
  const open = p.take('punct', '(');
  if (open === null) return needed(p.done ? p.source.span(keyword.at.end) : p.peek().at);
  if (p.at('punct', ')')) {
    needed(p.here());
    p.next();
    return null;
  }
  if (!p.deeper(open.at)) {
    skipBracketed(p, ')');
    return null;
  }
  try {
    const condition = expression(p);
    if (condition === null) {
      skipBracketed(p, ')');
      return null;
    }
    if (p.take('punct', ')') === null) {
      p.diagnostics.refuse(
        p.done ? p.source.endSpan : p.peek().at,
        "The `if`'s condition ends here, and its bracket is never closed.",
        'Add a ) after the condition, before its `{`.',
      );
      skipBracketed(p, ')');
      return null;
    }
    return condition;
  } finally {
    p.depth -= 1;
  }
}

/**
 * `else` where no `if` has just closed. Refused at the word; what it
 * holds is read, so a problem inside is still said, and dropped.
 */
function danglingElse(p: Parser, within: Enclosing): null {
  const word = p.next();
  p.diagnostics.refuse(
    word.at,
    "`else` follows an `if`'s closing brace.",
    'Write it straight after the } of the `if` it belongs to: `if (<condition>) { … } else { … }`.',
  );
  if (p.at('name', 'if')) ifStatement(p, within);
  else if (p.at('punct', '{')) block(p, within);
  return null;
}

/**
 * `refuse "No room here."` or `refuse full` — the words in quotes, or the
 * name of a passage. A word that starts a statement, or a name read
 * through a dot, is not a passage's name, so `refuse` with nothing after
 * it never takes the next statement for one.
 */
function refuseStatement(p: Parser, within: Enclosing): RefuseStatement | null {
  const keyword = p.next();
  const token = p.peek();
  if (token.kind === 'string') {
    p.next();
    return {
      kind: 'refuse',
      at: spanning(keyword.at, token.at),
      said: { kind: 'string', at: token.at, value: token.text },
    };
  }
  // A word the next statement or member starts with, or a property's
  // name on a line of its own, is not this refusal's: it is left to be
  // read. Anything else standing where the reason goes is the reason,
  // written wrong, and is taken with it.
  const ahead =
    token.kind === 'name'
      ? STARTS.has(token.text) || token.text === 'else' || within.startsMember(token)
      : token.kind === 'symbol' && firstOnItsLine(p, token) && within.startsMember(token);
  const read = token.kind === 'name' && !punct(p.peek(1), '.') && !punct(p.peek(1), '(');
  if (read && !ahead) {
    p.next();
    return { kind: 'refuse', at: spanning(keyword.at, token.at), said: p.ident(token) };
  }
  const nothing =
    ahead ||
    p.done ||
    punct(token, '}') ||
    p.atDeclarationStart() ||
    (token.kind === 'name' && !read);
  if (!nothing && token.kind !== 'punct') p.next();
  const passage = within.owner === null ? 'a passage' : `a passage of \`${within.owner}\``;
  p.diagnostics.refuse(
    nothing ? p.source.span(keyword.at.end) : token.at,
    '`refuse` says why.',
    `Write the words in quotes, as in \`refuse "No room here."\`, or name ${passage}, as in \`refuse full\`.`,
  );
  return null;
}

/** `allow` — the word alone. */
function allowStatement(p: Parser): Statement {
  const keyword = p.next();
  return { kind: 'allow', at: keyword.at };
}

/** `self.set(:open, true)` — an expression standing as a statement. */
function expressionStatement(p: Parser): Statement | null {
  const read = expression(p);
  if (read === null) return null;
  return { kind: 'expression-statement', at: read.at, expression: read };
}

/**
 * `let ribs = tools.count(Rib)`, or `let cup = spawn Cup in self`. The
 * name is lower-case like every other binding, and there is no type to
 * write: a `let` takes its type from what it names, exactly.
 */
export function letStatement(p: Parser): LetStatement | null {
  const keyword = p.take('name', 'let');
  if (keyword === null) {
    notAStatement(p, p.peek());
    return null;
  }
  const name = p.take('name');
  if (name === null) {
    p.diagnostics.refuse(
      p.peek().at,
      p.peek().kind === 'kind'
        ? `A name for a value starts with a small letter, and \`${p.peek().text}\` starts with a capital.`
        : 'A `let` needs a name.',
      'Write `let <name> = <what it names>`, as in `let ribs = tools.count(Rib)`.',
    );
    return null;
  }
  if (isReserved(name.text)) {
    p.diagnostics.refuse(
      name.at,
      `\`${name.text}\` is a word of the language, so it cannot name a value.`,
      'Choose another name for it, as in `let ribs = <what it names>`.',
    );
    return null;
  }
  if (p.at('punct', ':')) {
    p.diagnostics.refuse(
      p.peek().at,
      'A `let` takes its type from what it names, so there is none to write.',
      `Write \`let ${name.text} = <what it names>\`.`,
    );
    return null;
  }
  if (p.take('punct', '=') === null) {
    p.diagnostics.refuse(
      p.here(),
      `\`${name.text}\` is not given anything to name.`,
      `Write \`let ${name.text} = <what it names>\`.`,
    );
    return null;
  }
  const value: Expr | SpawnStatement | null = p.at('name', 'spawn')
    ? spawnStatement(p)
    : expression(p);
  if (value === null) return null;
  return { kind: 'let', at: spanning(keyword.at, value.at), name: p.ident(name), value };
}

/**
 * `spawn Cup in actor`: a kind, then `in` and what the new instance goes
 * into — a binding or an identifier, or a dotted path to one. The kind is
 * read as every kind is, so a word that is not one is refused in the same
 * words wherever it stands.
 */
export function spawnStatement(p: Parser): SpawnStatement | null {
  const keyword = p.take('name', 'spawn');
  if (keyword === null) {
    notAStatement(p, p.peek());
    return null;
  }
  if (p.done || punct(p.peek(), '}')) {
    p.diagnostics.refuse(
      p.source.span(keyword.at.end),
      '`spawn` does not say what kind of thing to make.',
      'Write the kind and where it goes, as in `spawn Cup in self`.',
    );
    return null;
  }
  const spawned = kindName(p);
  if (spawned === null) return null;
  const kind = written(spawned);

  if (p.take('name', 'in') === null) {
    p.diagnostics.refuse(
      p.source.span(spawned.at.end),
      `\`spawn ${kind}\` does not say where the new one goes.`,
      `Write \`in\` and what it goes into: \`spawn ${kind} in self\`.`,
    );
    return null;
  }

  const head = p.peek();
  if (head.kind !== 'name') {
    p.diagnostics.refuse(
      head.kind === 'end' ? p.source.endSpan : head.at,
      `After \`in\` comes the thing the new \`${kind}\` goes into.`,
      `Name it in lower case, as in \`spawn ${kind} in self\` or \`spawn ${kind} in actor\`.`,
    );
    return null;
  }
  p.next();
  const container = objectPath(p, head);
  if (container === null) return null;
  return {
    kind: 'spawn',
    at: spanning(keyword.at, container.at),
    spawned,
    container,
  };
}

/**
 * `destroy self`, the only form: an object removes only itself, since
 * itself is the only thing it may write. Anything else written after
 * `destroy` is refused once, and stepped over with its dots.
 */
export function destroyStatement(p: Parser): DestroyStatement | null {
  const keyword = p.take('name', 'destroy');
  if (keyword === null) {
    notAStatement(p, p.peek());
    return null;
  }
  const target = p.peek();
  if (target.kind === 'name' && target.text === 'self' && !punct(p.peek(1), '.')) {
    p.next();
    return { kind: 'destroy', at: spanning(keyword.at, target.at) };
  }
  if (target.kind === 'end' || punct(target, '}')) {
    p.diagnostics.refuse(
      p.source.span(keyword.at.end),
      '`destroy` does not say what to remove.',
      'Write `destroy self`: an object removes only itself.',
    );
    return null;
  }
  p.diagnostics.refuse(
    stepOverTarget(p),
    '`destroy` removes only the object whose body runs it.',
    'Write `destroy self`. To be rid of something else, send it a message and let it destroy itself.',
  );
  return null;
}

/**
 * What an author wrote after `destroy` in place of `self`: a word and the
 * dotted steps after it, or one token that is no word. Taken whole, so
 * one wrong target is one refusal.
 */
function stepOverTarget(p: Parser): Span {
  const first = p.peek();
  if (first.kind !== 'name' && first.kind !== 'kind') {
    if (first.kind !== 'punct') p.next();
    return first.at;
  }
  let last = p.next();
  while (punct(p.peek(), '.') && (p.peek(1).kind === 'name' || p.peek(1).kind === 'kind')) {
    p.next();
    last = p.next();
  }
  return spanning(first.at, last.at);
}

/** A kind as the author wrote it: `Cup`, `sprout.Container`. */
function written(kind: KindExpr): string {
  return kind.library === null ? kind.name.text : `${kind.library.text}.${kind.name.text}`;
}
