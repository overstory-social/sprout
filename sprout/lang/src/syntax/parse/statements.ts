// Statements: `let`, and the two that change what exists, `spawn` and
// `destroy` (the spec's Properties › Naming a value; The world model ›
// Spawning, Destroying). A `let` is here rather than with expressions
// because its value may be a statement: `spawn` is the one statement that
// also yields a binding.
//
// Each reader takes its statement or refuses it once, having said what to
// write instead; nothing is guessed. What a statement's parts mean — which
// kind, which container, whose body — is the checker's.

import type {
  DestroyStatement,
  Expr,
  KindExpr,
  LetStatement,
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

/** Each statement this compiler reads, by the word it starts with. */
const STATEMENTS: ReadonlyMap<string, (p: Parser) => Statement | null> = new Map<
  string,
  (p: Parser) => Statement | null
>([
  ['let', letStatement],
  ['spawn', spawnStatement],
  ['destroy', destroyStatement],
]);

/** One statement, or null having said why it is not one. */
export function statement(p: Parser): Statement | null {
  const token = p.peek();
  const reader = token.kind === 'name' ? STATEMENTS.get(token.text) : undefined;
  if (reader !== undefined) return reader(p);
  notAStatement(p, token);
  return null;
}

/** The refusal for a token that starts no statement this compiler reads. */
export function notAStatement(p: Parser, token: Token): void {
  p.diagnostics.refuse(
    token.at,
    `${p.describe(token)} does not start a statement this compiler reads.`,
    `A statement starts with ${readable([...STATEMENTS.keys()])}, as in \`let cup = spawn Cup in self\`.`,
  );
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
