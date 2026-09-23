// `verb unlock { role target: Lockable  role tool  "unlock [target] with
// [tool]" }` (the spec's Verbs › Declaring a verb, Set roles, Optional
// tools, Value roles, Reserved names).
//
// A verb's body holds roles and phrases in any order. A member that
// cannot be read costs itself and the verb reads on, so an author owed
// three problems is owed all three. A role whose name or filler is
// refused is still kept, so its phrases are not refused a second time for
// naming it; the refusal already keeps the file from being used. Whether
// the roles and phrases agree with each other is the first tier's
// (`declare/verbs.ts`); which kind a role names is resolved a tier later.

import type {
  Ident,
  KindExpr,
  PhraseDeclaration,
  RoleDeclaration,
  RoleModifier,
  ValueFiller,
  VerbDeclaration,
} from '../ast.js';
import type { Token } from '../lexer.js';
import { isReserved } from '../reserved.js';
import { spanning, type Span } from '../../source/source.js';
import { punct, type Parser } from './parser.js';
import { kindName } from './bodies.js';
import { lowerCase, phrase } from './phrases.js';
import { recover, stepPast } from './recovery.js';

/**
 * The words that name a member of a kind, which the spec's Reserved
 * names keeps from naming a verb. Each is a reserved word too; these are
 * refused in their own words, because what an author meant by one is
 * the member.
 */
const MEMBER_WORDS: ReadonlySet<string> = new Set([
  'describe',
  'depart',
  'release',
  'accept',
  'permit',
  'do',
  'passage',
  'prose',
]);

/** The value fillers, by the word after a role's colon. */
const VALUE_FILLERS: ReadonlySet<string> = new Set(['symbol', 'integer', 'exit']);

/** A verb as written, for a remedy to show. */
const EXAMPLE = (name: string): string => `\`verb ${name} { role target  "${name} [target]" }\``;

/** How a role is filled, for a remedy to show. */
const FILLED_BY =
  'A role is filled by a kind (`role target: Container`), by `symbol` or `integer` for a value the visitor names, or by nothing.';

/** `verb <name> { … }`. Null where its name or its braces could not be read, having said why. */
export function verbDeclaration(p: Parser): VerbDeclaration | null {
  const keyword = p.next();
  const name = verbName(p);
  if (name === undefined) return null;

  const open = p.take('punct', '{');
  if (open === null) {
    // A verb called `passage` has its braces taken by the lexer as a
    // passage's words; they are this verb's, and are stepped over.
    if (p.at('passage-body')) {
      p.next();
      return null;
    }
    if (name !== null) {
      p.diagnostics.refuse(
        p.here(),
        `The roles and phrases of \`${name.text}\` go in braces.`,
        `Write ${EXAMPLE(name.text)}.`,
      );
    }
    recover(p);
    return null;
  }

  const read = verbBody(p, name?.text ?? 'verb');
  if (name === null) return null;
  const end = read.close?.at ?? read.last ?? open.at;
  return {
    kind: 'verb',
    at: spanning(keyword.at, end),
    name,
    roles: read.roles,
    phrases: read.phrases,
  };
}

/**
 * A verb's name, taken. Null where one was written and refused, and the
 * body after it is still to be read; undefined where none was written
 * and no brace follows, having stepped over what did.
 */
function verbName(p: Parser): Ident | null | undefined {
  const token = p.peek();
  if (token.kind === 'name' && !p.atDeclarationStart()) {
    p.next();
    if (MEMBER_WORDS.has(token.text)) {
      p.diagnostics.refuse(
        token.at,
        `\`${token.text}\` names a member of a kind, so it cannot name a verb.`,
        'Choose another word.',
      );
      return null;
    }
    if (isReserved(token.text)) {
      p.diagnostics.refuse(
        token.at,
        `\`${token.text}\` is a word of the language, so it cannot name a verb.`,
        'Choose another word.',
      );
      return null;
    }
    return p.ident(token);
  }
  if (token.kind === 'kind' && punct(p.peek(1), '{')) {
    p.next();
    p.diagnostics.refuse(
      token.at,
      `A verb's name is a lower-case word, and \`${token.text}\` starts with a capital.`,
      `Write ${EXAMPLE(lowerCase(token.text))}.`,
    );
    return null;
  }
  p.diagnostics.refuse(
    p.at('punct', '{') ? p.here() : token.at,
    '`verb` needs a name.',
    `A verb's name is a lower-case word: ${EXAMPLE('take')}.`,
  );
  if (p.at('punct', '{')) return null;
  recover(p);
  return undefined;
}

/** A verb's body as read: its roles and phrases, and its `}` where it was closed. */
interface VerbBody {
  readonly roles: RoleDeclaration[];
  readonly phrases: PhraseDeclaration[];
  readonly close: Token | null;
  /** The last thing read, for the span of a verb never closed. */
  readonly last: Span | null;
}

/** The roles and phrases of a verb whose `{` is taken, up to its `}`. `verb` names it. */
function verbBody(p: Parser, verb: string): VerbBody {
  const roles: RoleDeclaration[] = [];
  const phrases: PhraseDeclaration[] = [];
  let last: Span | null = null;
  const unclosed = (): VerbBody => {
    if (!(p.done && p.swallowedRest)) {
      p.diagnostics.refuse(
        p.done ? p.source.endSpan : p.peek().at,
        `\`${verb}\` is never closed.`,
        'Add a } after its roles and phrases.',
      );
    }
    return { roles, phrases, close: null, last };
  };

  for (;;) {
    const close = p.take('punct', '}');
    if (close !== null) return { roles, phrases, close, last };
    if (p.done || p.atDeclarationStart()) return unclosed();

    const token = p.peek();
    if (token.kind === 'name' && token.text === 'role') {
      const role = roleDeclaration(p);
      if (role !== null) {
        roles.push(role);
        last = role.at;
      }
      continue;
    }
    if (token.kind === 'string') {
      const read = phrase(p);
      last = token.at;
      if (read !== null) phrases.push(read);
      continue;
    }

    if (token.kind === 'name' && token.text === 'from') {
      p.diagnostics.refuse(
        token.at,
        "A verb does not say where a role's options come from.",
        'The object that plays the role says it, inside its `as <role> for <verb>`: `topic from :knows`.',
      );
    } else {
      p.diagnostics.refuse(
        token.at,
        `A verb is not made of ${p.describe(token)}.`,
        'It holds its roles, as `role target`, and its phrases in quotes, as `"take [target]"`.',
      );
    }
    if (!pastStray(p)) return unclosed();
  }
}

/**
 * Step over what a refusal named, to the next role, phrase or `}`: false
 * where the file ran out or a declaration may start first. The refused
 * token is taken unless the next declaration may begin there: then it
 * is the file's, and the verb is never closed.
 */
function pastStray(p: Parser): boolean {
  let first = true;
  let braces = 0;
  while (!p.done) {
    const token = p.peek();
    if (punct(token, '{')) {
      braces += 1;
    } else if (punct(token, '}')) {
      if (braces === 0) return true;
      braces -= 1;
    } else if (braces === 0) {
      if (p.atRecoveryStop()) return false;
      if (!first && (token.kind === 'string' || (token.kind === 'name' && token.text === 'role'))) {
        return true;
      }
      first = false;
      stepPast(p);
      continue;
    }
    first = false;
    p.next();
  }
  return false;
}

/**
 * `role <name> [: <filler>] [many] [optional]`, the word `role` next.
 * Null only where no name was written; a name or a filler refused still
 * gives the role, as the header says.
 */
function roleDeclaration(p: Parser): RoleDeclaration | null {
  const keyword = p.next();
  const token = p.peek();
  let name: Ident;
  if (token.kind === 'name' && token.text !== 'role' && !p.atDeclarationStart()) {
    p.next();
    name = p.ident(token);
    if (isReserved(token.text)) {
      p.diagnostics.refuse(
        token.at,
        `\`${token.text}\` is a word of the language, so it cannot name a role.`,
        'Choose another word.',
      );
    }
  } else if (token.kind === 'kind') {
    p.next();
    // Kept under the name the remedy offers, so a phrase that already
    // names it that way is not refused as well.
    const meant = lowerCase(token.text);
    name = { kind: 'ident', at: token.at, text: meant };
    p.diagnostics.refuse(
      token.at,
      `A role's name is a lower-case word, and \`${token.text}\` starts with a capital.`,
      `Write \`role ${meant}\`. A kind that fills it comes after a colon: \`role target: ${token.text}\`.`,
    );
  } else {
    p.diagnostics.refuse(
      endsRole(p) ? p.source.span(keyword.at.end) : token.at,
      '`role` needs a name.',
      "A role's name is a lower-case word: `role target`, `role tool: Key`.",
    );
    // Something that is no member's start is this line's, not the next.
    if (!endsRole(p) && !p.atRecoveryStop()) p.next();
    return null;
  }

  let at = name.at;
  const filler = roleFiller(p, name);
  if (filler !== null) at = filler.at;

  let many: RoleModifier | null = null;
  let optional: RoleModifier | null = null;
  for (;;) {
    const word = p.peek();
    if (word.kind !== 'name' || (word.text !== 'many' && word.text !== 'optional')) break;
    p.next();
    at = word.at;
    if ((word.text === 'many' ? many : optional) !== null) {
      p.diagnostics.refuse(
        word.at,
        `\`${name.text}\` is marked \`${word.text}\` twice.`,
        'Once says it. Remove the second.',
      );
      continue;
    }
    const modifier: RoleModifier = { kind: 'role-modifier', at: word.at, word: word.text };
    if (word.text === 'many') many = modifier;
    else optional = modifier;
  }
  // A set is never optional, so `optional` is refused and left off, in
  // whichever order the two were written.
  if (many !== null && optional !== null) {
    p.diagnostics.refuse(
      optional.at,
      `\`${name.text}\` is marked \`many\` and \`optional\`, and a set is never optional: a phrase that leaves it out binds the empty set.`,
      'Remove `optional`.',
    );
    optional = null;
  }

  return { kind: 'role', at: spanning(keyword.at, at), name, filler, many, optional };
}

/** Whether what comes next ends a role with nothing more in it. */
function endsRole(p: Parser): boolean {
  const token = p.peek();
  return (
    p.done ||
    punct(token, '}') ||
    token.kind === 'string' ||
    (token.kind === 'name' && token.text === 'role') ||
    p.atDeclarationStart()
  );
}

/**
 * What fills a role: after its colon, a kind or a value filler; or null
 * where none is written or the one written was refused, having said why.
 */
function roleFiller(p: Parser, name: Ident): KindExpr | ValueFiller | null {
  // `role topic:symbol` — the lexer reads a colon against a lower-case
  // word as a symbol, which is why a filler is written after a space.
  const glued = p.peek();
  if (glued.kind === 'symbol') {
    p.next();
    let written = glued.text;
    if (punct(p.peek(), '.') && p.peek(1).kind === 'kind') {
      p.next();
      written += `.${p.next().text}`;
    }
    p.diagnostics.refuse(
      glued.at,
      `\`:${glued.text}\` is read as a property's name: a colon straight before a lower-case word makes one.`,
      `Write \`role ${name.text}: ${written}\`, with a space after the colon.`,
    );
    return null;
  }
  const colon = p.take('punct', ':');
  if (colon === null) return null;

  const token = p.peek();
  if (token.kind === 'kind' || (token.kind === 'name' && punct(p.peek(1), '.'))) {
    return kindName(p);
  }
  if (token.kind === 'name' && VALUE_FILLERS.has(token.text)) {
    p.next();
    return {
      kind: 'value-filler',
      at: token.at,
      value: token.text as ValueFiller['value'],
    };
  }
  if (
    endsRole(p) ||
    (token.kind === 'name' && (token.text === 'many' || token.text === 'optional'))
  ) {
    p.diagnostics.refuse(
      p.source.span(colon.at.end),
      `\`${name.text}\` has a colon and nothing after it to fill the role.`,
      `${FILLED_BY} With nothing, leave the colon out.`,
    );
    return null;
  }
  p.next();
  const described = p.describe(token);
  p.diagnostics.refuse(
    token.at,
    `${described.charAt(0).toUpperCase()}${described.slice(1)} cannot fill a role.`,
    FILLED_BY,
  );
  return null;
}
