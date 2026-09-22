// Expressions, and the `let` that names one (the spec's Properties ›
// Precedence, Naming a value).
//
// Precedence climbing over one table. Every operand of a given level
// is read at the level above it, and the loop at each level consumes
// its own operators left to right, so `a - b - c` is `(a - b) - c`.
//
// Nothing here recurses without a bound. Parentheses, call arguments
// and stacked prefix operators all count against `DEEPEST`; a chain
// of operators at one level is read by the loop rather than by
// recursion.

import type { BinaryOperator, Expr, LetStatement, UnaryOperator } from '../ast.js';
import type { Token } from '../lexer.js';
import { isReserved } from '../reserved.js';
import { spanning, type Span } from '../../source/source.js';
import type { Parser } from './parser.js';
import { separator, skipBracketed } from './recovery.js';
import { atFraction } from './types.js';

/**
 * How tightly each binary operator binds, loosest first: the
 * conventional order the spec's Properties › Precedence states, under
 * which `p != self && chance(4)` reads as `(p != self) && chance(4)`
 * and no other way.
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

/** An expression, or null having said why it is not one. */
export function expression(p: Parser, level: number = LOOSEST): Expr | null {
  if (level > TIGHTEST) return unary(p);
  let left = expression(p, level + 1);
  if (left === null) return null;
  for (;;) {
    const token = p.peek();
    if (token.kind !== 'punct' || BINARY_PRECEDENCE.get(token.text) !== level) return left;
    p.next();
    const right = expression(p, level + 1);
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
function unary(p: Parser): Expr | null {
  const operators: Token[] = [];
  let refused = false;
  while (p.peek().kind === 'punct' && PREFIX.has(p.peek().text)) {
    const token = p.next();
    // Against `p.depth`, which parentheses, lists and call
    // arguments all share. A counter of its own would give every
    // bracketed level a fresh allowance of signs on top of the
    // shared one, so a bracket at the bound could still hold a wall
    // of signs and reach twice as deep.
    // Its own remedy: a wall of signs has no bracket in it, and
    // telling the author to take some brackets out names something
    // they did not write.
    if (!p.deeper(token.at, 'Take some of the signs out.')) {
      refused = true;
      break;
    }
    operators.push(token);
  }
  try {
    return refused ? null : applyPrefix(p, operators);
  } finally {
    p.depth -= operators.length;
  }
}

/** The operators of a prefix stack, applied to what they were written before. */
function applyPrefix(p: Parser, operators: readonly Token[]): Expr | null {
  let expr = postfix(p);
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
function postfix(p: Parser): Expr | null {
  let expr = primary(p);
  if (expr === null) return null;
  while (p.at('punct', '.')) {
    p.next();
    const name = p.take('name');
    if (name === null) {
      p.diagnostics.refuse(
        p.peek().at,
        'A dot needs the name of something to read after it.',
        'Write what to read, as in `self.count` or `self.get(:wear)`.',
      );
      return null;
    }
    const open = p.take('punct', '(');
    if (open === null) {
      expr = {
        kind: 'member',
        at: spanning(expr.at, name.at),
        receiver: expr,
        member: p.ident(name),
      };
      continue;
    }
    const read = argumentList(p, open);
    if (read === null) return null;
    expr = {
      kind: 'call',
      at: spanning(expr.at, read.at),
      receiver: expr,
      method: p.ident(name),
      arguments: read.arguments,
    };
  }
  return expr;
}

/** A whole expression in brackets, a value, a name, a symbol or a kind. */
function primary(p: Parser): Expr | null {
  const token = p.peek();

  if (token.kind === 'punct' && token.text === '(') {
    const open = p.next();
    if (!p.deeper(open.at)) {
      skipBracketed(p, ')');
      return null;
    }
    try {
      const inner = expression(p);
      if (inner === null) {
        // Give up on the whole bracket, not on its contents: leaving
        // the closer behind hands it to whatever is reading around
        // this, which takes it for its own and ends early.
        skipBracketed(p, ')');
        return null;
      }
      const close = p.take('punct', ')');
      if (close === null) {
        p.diagnostics.refuse(
          p.done ? p.source.endSpan : p.peek().at,
          'This bracket is never closed.',
          'Add a ) after what it holds.',
        );
        skipBracketed(p, ')');
        return null;
      }
      return inner;
    } finally {
      p.depth -= 1;
    }
  }

  if (token.kind === 'integer') {
    p.next();
    if (atFraction(p)) return null;
    return { kind: 'integer', at: token.at, value: Number(token.text) };
  }
  if (token.kind === 'string') {
    p.next();
    return { kind: 'string', at: token.at, value: token.text };
  }
  if (token.kind === 'symbol') {
    p.next();
    return { kind: 'symbol-expr', at: token.at, name: p.ident(token) };
  }
  if (token.kind === 'kind') {
    p.next();
    return { kind: 'kind-expr', at: token.at, library: null, name: p.ident(token) };
  }
  if (token.kind === 'name') {
    if (token.text === 'true' || token.text === 'false') {
      p.next();
      return { kind: 'boolean', at: token.at, value: token.text === 'true' };
    }
    // `sprout.Container` is a kind, where `actor.recall` is a read:
    // what follows the dot decides, the same way it does for a type.
    if (p.peek(1).kind === 'punct' && p.peek(1).text === '.' && p.peek(2).kind === 'kind') {
      const library = p.next();
      p.next();
      const name = p.next();
      return {
        kind: 'kind-expr',
        at: spanning(library.at, name.at),
        library: p.ident(library),
        name: p.ident(name),
      };
    }
    if (p.peek(1).kind === 'punct' && p.peek(1).text === '(') {
      const name = p.next();
      const open = p.next();
      const read = argumentList(p, open);
      if (read === null) return null;
      return {
        kind: 'free-call',
        at: spanning(name.at, read.at),
        name: p.ident(name),
        arguments: read.arguments,
      };
    }
    p.next();
    return { kind: 'binding', at: token.at, name: p.ident(token) };
  }

  p.diagnostics.refuse(
    token.at,
    `${p.describe(token)} is not something to read.`,
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
function argumentList(p: Parser, open: Token): { arguments: Expr[]; at: Span } | null {
  if (!p.deeper(open.at)) {
    skipBracketed(p, ')');
    return null;
  }
  try {
    const args: Expr[] = [];
    let missingComma: Span | null = null;
    for (;;) {
      const close = p.take('punct', ')');
      if (close !== null) return { arguments: args, at: spanning(open.at, close.at) };
      if (p.done) {
        p.diagnostics.refuse(
          p.source.endSpan,
          'This bracket is never closed.',
          'Add a ) after what it holds.',
        );
        return null;
      }
      const before = p.peek();
      const argument = expression(p);
      if (argument === null) {
        if (p.done) return null;
        if (p.peek().at.start === before.at.start) p.next();
        separator(p, ')');
        missingComma = null;
        continue;
      }
      if (missingComma !== null) {
        p.diagnostics.refuse(
          missingComma,
          'A reading needs a comma between what it is given.',
          'Write `self.set(:wear, 1)`.',
        );
        missingComma = null;
      }
      args.push(argument);
      if (separator(p, ')') === 'missing') missingComma = p.here();
    }
  } finally {
    p.depth -= 1;
  }
}

/**
 * `let ribs = tools.count(Rib)`. The name is lower-case like every
 * other binding, and there is no type to write: a `let` takes its
 * type from what it names, exactly.
 */
export function letStatement(p: Parser): LetStatement | null {
  const keyword = p.take('name', 'let');
  if (keyword === null) {
    p.diagnostics.refuse(
      p.peek().at,
      `${p.describe(p.peek())} does not name a value.`,
      'Write `let <name> = <what it names>`.',
    );
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
  const value = expression(p);
  if (value === null) return null;
  return { kind: 'let', at: spanning(keyword.at, value.at), name: p.ident(name), value };
}
