// `act <verb> (<role>: <binding>, …)`, read (the spec's Verbs › Acting).
// The verb is named by its name alone, and its roles in brackets, each
// named and then filled by a binding or an identifier; the brackets are
// written even when empty, and a comma may follow the last role.
//
// A refused `act` costs only itself. Inside its brackets nothing is read
// past a brace, or past the next statement or the body's next member
// where one starts a line, so a bracket left open never swallows the rest
// of the block.

import type { ActRole, ActStatement, ObjectPath } from '../ast.js';
import type { Token } from '../lexer.js';
import { spanning, type Span } from '../../source/source.js';
import { punct, type Parser } from './parser.js';
import { objectPath } from './paths.js';
import {
  firstOnItsLine,
  notAStatement,
  onItsOwn,
  startsNext,
  type Enclosing,
} from './statements.js';

/** The form written right, for every remedy that shows it. */
const EXAMPLE = '`act nuzzle (target: p)`';

/**
 * `act nuzzle (target: p)`: the word, the verb's name, and its roles in
 * brackets. Null having said once why it is not one.
 */
export function actStatement(p: Parser, within: Enclosing = onItsOwn()): ActStatement | null {
  const keyword = p.take('name', 'act');
  if (keyword === null) {
    notAStatement(p, p.peek());
    return null;
  }
  const head = p.peek();
  if (head.kind === 'kind') {
    p.next();
    p.diagnostics.refuse(
      head.at,
      `\`${head.text}\` starts with a capital, and a verb's name does not.`,
      `Write the verb's name in lower case, as in ${EXAMPLE}.`,
    );
    return null;
  }
  if (
    head.kind !== 'name' ||
    callStartsLine(p) ||
    startsNext(p, within, head) ||
    p.atDeclarationStart()
  ) {
    p.diagnostics.refuse(
      head.kind === 'name' || head.kind === 'end' || punct(head, '}') || punct(head, '(')
        ? p.source.span(keyword.at.end)
        : head.at,
      '`act` does not say which verb to perform.',
      `Write the verb and its roles, as in ${EXAMPLE}.`,
    );
    return null;
  }
  p.next();
  const verb = p.ident(head);
  if (punct(p.peek(), '.') && p.peek(1).kind === 'name') {
    p.next();
    const last = p.next();
    p.diagnostics.refuse(
      spanning(head.at, last.at),
      '`act` names a verb by its name alone.',
      `Write \`act ${last.text} (…)\`: a verb's name reaches this world's own verb first, then the standard library's.`,
    );
    return null;
  }

  const open = p.take('punct', '(');
  if (open === null) {
    p.diagnostics.refuse(
      p.source.span(head.at.end),
      `\`act ${verb.text}\` names its roles in brackets.`,
      `Write \`act ${verb.text} (target: p)\`, or \`act ${verb.text} ()\` where it has no roles to fill.`,
    );
    return null;
  }

  const roles: ActRole[] = [];
  for (;;) {
    const close = p.take('punct', ')');
    if (close !== null) return { kind: 'act', at: spanning(keyword.at, close.at), verb, roles };
    if (endsBrackets(p, within)) return neverClosed(p, verb.text);
    const role = actRole(p, within, verb.text);
    if (role === null) {
      skipToClose(p, within);
      return null;
    }
    roles.push(role);
    if (p.take('punct', ',') !== null || p.at('punct', ')')) continue;
    if (endsBrackets(p, within)) return neverClosed(p, verb.text);
    p.diagnostics.refuse(
      p.peek().at,
      `The roles inside \`act ${verb.text} (…)\` are separated by commas.`,
      `Write a comma between each two, as in \`act ${verb.text} (target: p, tool: q)\`.`,
    );
    skipToClose(p, within);
    return null;
  }
}

/** `target: p` — one role named and filled. Null having said why. */
function actRole(p: Parser, within: Enclosing, verb: string): ActRole | null {
  const name = p.peek();
  if (name.kind !== 'name') {
    p.diagnostics.refuse(
      name.at,
      `Inside \`act ${verb} (…)\` each role is named before what fills it, and ${p.describe(name)} is not a role's name.`,
      `Write \`<role>: <what fills it>\`, as in ${EXAMPLE}.`,
    );
    return null;
  }
  p.next();
  const role = p.ident(name);

  // `target:p` is one symbol to the lexer, and means what `target: p` does.
  const joined = p.peek();
  if (joined.kind === 'symbol' && joined.at.start === name.at.end) {
    p.next();
    const at = p.source.span(joined.at.start + 1, joined.at.end);
    const filler: ObjectPath = {
      kind: 'path',
      at,
      parts: [{ kind: 'ident', at, text: joined.text }],
    };
    return { kind: 'act-role', at: spanning(name.at, at), role, filler };
  }

  const colon = p.take('punct', ':');
  const filler = p.peek();
  const missing =
    colon === null ||
    filler.kind === 'end' ||
    punct(filler, ')') ||
    punct(filler, ',') ||
    endsBrackets(p, within);
  if (missing) {
    p.diagnostics.refuse(
      p.source.span((colon ?? name).at.end),
      `\`${role.text}\` is not given anything to fill it.`,
      `Write \`${role.text}: <what fills it>\`, as in \`act ${verb} (${role.text}: p)\`.`,
    );
    return null;
  }
  if (filler.kind !== 'name') {
    if (filler.kind !== 'punct') p.next();
    p.diagnostics.refuse(
      filler.at,
      `\`${role.text}\` is filled by the name of something in reach, and ${written(filler)} is not one.`,
      `Name something in reach in lower case, as in \`${role.text}: p\`, where \`p\` is a binding or a role.`,
    );
    return null;
  }
  p.next();
  const path = objectPath(p, filler);
  if (path === null) return null;
  return { kind: 'act-role', at: spanning(name.at, path.at), role, filler: path };
}

/** A token standing where a role's filler goes, as a refusal names it. */
function written(token: Token): string {
  switch (token.kind) {
    case 'symbol':
      return `\`:${token.text}\``;
    case 'integer':
      return `the number ${token.text}`;
    case 'string':
      return 'text in quotes';
    case 'passage-body':
      return "a passage's words in braces";
    default:
      return `\`${token.text}\``;
  }
}

/**
 * Whether nothing more of an `act`'s brackets can be here: the file
 * ended, a brace or a declaration starts, or the next statement or
 * member starts a line, a call such as `self.set(…)` among them.
 */
function endsBrackets(p: Parser, within: Enclosing): boolean {
  const token = p.peek();
  return (
    p.done ||
    punct(token, '{') ||
    punct(token, '}') ||
    p.atDeclarationStart() ||
    (firstOnItsLine(p, token) && startsNext(p, within, token)) ||
    callStartsLine(p)
  );
}

/** An `act` whose bracket is never closed, said where its reading stopped. */
function neverClosed(p: Parser, verb: string): null {
  const at: Span = p.done ? p.source.endSpan : p.peek().at;
  p.diagnostics.refuse(
    at,
    `The bracket after \`act ${verb}\` is never closed.`,
    'Add a ) after its last role.',
  );
  return null;
}

/** Whether a call, `self.set(…)`, starts a line here: a statement of its own. */
function callStartsLine(p: Parser): boolean {
  const head = p.peek();
  return (
    head.kind === 'name' &&
    firstOnItsLine(p, head) &&
    punct(p.peek(1), '.') &&
    p.peek(2).kind === 'name' &&
    punct(p.peek(3), '(')
  );
}

/**
 * Step over the rest of a refused `act`'s brackets: through the `)` that
 * closes them, or up to where they could not go on, taking nothing more.
 */
function skipToClose(p: Parser, within: Enclosing): void {
  let depth = 0;
  while (!endsBrackets(p, within)) {
    const token: Token = p.next();
    if (punct(token, '(')) depth += 1;
    else if (punct(token, ')')) {
      if (depth === 0) return;
      depth -= 1;
    }
  }
}
