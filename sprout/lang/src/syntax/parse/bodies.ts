// What a world, a kind and an object share: the kinds written after the
// colon, and a body of members in braces (the spec's Kinds, composition
// and libraries › Declaring and composing, The world model). Each owner
// reads its body through one table of the words its members begin with,
// and the message for a word it does not read is built from that same
// table, so the two cannot drift.

import type {
  ContainsDeclaration,
  KindExpr,
  KindMember,
  PropertyDeclaration,
  RemembersDeclaration,
} from '../ast.js';
import type { Token } from '../lexer.js';
import { spanning } from '../../source/source.js';
import { punct, readable, type Parser } from './parser.js';
import { property, remembers } from './properties.js';
import { closedBracketRun } from './recovery.js';

/** What declares a body, as its messages name it. */
export type Owner = 'world' | 'kind' | 'object';

const ARTICLE: Readonly<Record<Owner, string>> = {
  world: 'A world',
  kind: 'A kind',
  object: 'An object',
};

/** How each owner is written, with `kinds` after its colon, for a remedy to show. */
const WRITTEN: Readonly<Record<Owner, (kinds: string) => string>> = {
  world: (kinds) => `world <name>: ${kinds} { … }`,
  kind: (kinds) => `kind <Name>: ${kinds} { … }`,
  object: (kinds) => `object <name>: ${kinds} in <container> { … }`,
};

/** What may be written inside a body, by the word each member begins with. */
export type MemberReaders<M> = ReadonlyMap<string, () => M | null>;

/** A member any body may hold, and a property or a `:remembers`, which every body holds. */
type Member<M> = M | PropertyDeclaration | RemembersDeclaration;

/** A body as read: its members, and the brace that closed it. */
export interface Body<M> {
  readonly members: Member<M>[];
  readonly close: Token;
}

/**
 * `: sprout.World, victorian.Voice` — the kinds a declaration composes, as
 * written, or none where no colon follows its name. Null having said why
 * where one could not be read; the caller steps over the rest.
 */
export function composition(p: Parser, owner: Owner): KindExpr[] | null {
  const composes: KindExpr[] = [];
  if (p.take('punct', ':') === null) return composes;
  for (;;) {
    const composed = kindName(p);
    if (composed === null) return null;
    composes.push(composed);
    if (p.take('punct', ',') !== null) continue;
    // Every other comma-separated list says so when the comma is
    // missing; letting what follows complain instead would name the
    // wrong problem.
    if (!atKindName(p)) return composes;
    p.diagnostics.refuse(
      p.here(),
      `${ARTICLE[owner]} needs a comma between the kinds it composes.`,
      `Write \`${WRITTEN[owner]('one.Kind, Another')}\`.`,
    );
  }
}

/** What a kind's body or an object's may hold, past its properties. */
export function kindMembers(p: Parser): MemberReaders<KindMember> {
  return new Map<string, () => KindMember | null>([['contains', () => contains(p)]]);
}

/**
 * The members of a body whose `{` is already taken, up to its `}`. A
 * member that could not be read costs that member and the body reads on,
 * since an author owed three problems is owed all three; null where the
 * body is never closed, having said so.
 */
export function body<M>(
  p: Parser,
  owner: Owner,
  name: Token,
  readers: MemberReaders<M>,
): Body<M> | null {
  const unclosed = (): null => {
    p.diagnostics.refuse(
      p.done ? p.source.endSpan : p.peek().at,
      `\`${name.text}\` is never closed.`,
      `Add a } after what the ${owner} is made of.`,
    );
    return null;
  };

  const members: Member<M>[] = [];
  for (;;) {
    const close = p.take('punct', '}');
    if (close !== null) return { members, close };
    if (p.done) return unclosed();

    // A word that starts a DECLARATION is not a member, however it
    // reads as one. `kind K { enum Ward { oak } }` is a kind that was
    // never closed, and the enum is the file's; saying "a kind is not
    // made of `enum`" as well leaves its braces orphaned and the enum
    // reparsed as a sibling of the kind that held it.
    if (p.atDeclarationStart()) return unclosed();

    // Whether a word IS a member and whether reading it SUCCEEDED are
    // two questions, and answering them in one expression is how a
    // member that failed gets reported as a word nobody knows.
    const token = p.peek();
    const read = memberReader(p, token, readers);
    if (read === null) {
      p.diagnostics.refuse(
        token.at,
        `${ARTICLE[owner]} is not made of ${p.describe(token)}.`,
        `It holds its properties, and ${readable([...readers.keys()])}.`,
      );
    }
    const member = read === null ? null : read();
    if (member !== null) {
      members.push(member);
      continue;
    }
    // The declaration is still returned with what did read, since the
    // refusal already keeps the file from being used. A word no reader
    // took is stepped over, unless the next declaration may begin
    // there: then it is the file's.
    if (p.peek().at.start === token.at.start && !p.atRecoveryStop()) p.next();
    if (!recoverToMember(p, readers)) return unclosed();
  }
}

/**
 * Step over the rest of a member that could not be read, to the next
 * member or the body's own `}`; false where the file ran out or a
 * declaration starts first. Braces nest, and so does a `[` closed before
 * any brace, so nothing inside a list is taken for a member, while a `[`
 * never closed is one token and cannot take the members after it in
 * silence.
 */
function recoverToMember<M>(p: Parser, readers: MemberReaders<M>): boolean {
  let braces = 0;
  while (!p.done) {
    const token = p.peek();
    if (punct(token, '{')) {
      braces += 1;
    } else if (punct(token, '}')) {
      if (braces === 0) return true;
      braces -= 1;
    } else if (braces === 0) {
      // As in `recoverInBraces`: below the body's own depth a keyword
      // is no more trustworthy than anything else.
      if (p.atRecoveryStop()) return false;
      if (memberReader(p, token, readers) !== null) return true;
      const run = punct(token, '[') ? closedBracketRun(p) : 0;
      for (let i = 1; i < run; i++) p.next();
    }
    p.next();
  }
  return false;
}

/** What reads the member a word begins, or null where it begins none. */
function memberReader<M>(
  p: Parser,
  token: Token,
  readers: MemberReaders<M>,
): (() => Member<M> | null) | null {
  // A property is written with its colon, and `:remembers` is the one
  // symbol that is not one.
  if (token.kind === 'symbol') {
    return token.text === 'remembers' ? () => remembers(p) : () => property(p);
  }
  return token.kind === 'name' ? (readers.get(token.text) ?? null) : null;
}

/**
 * `contains`, or `contains actors` — the one line that makes a place.
 *
 * A word after it that is not `actors` is left where it is rather than
 * being swallowed: it goes back to the member table, which says what the
 * body is made of and names the word the author wrote. So `contains
 * actor`, singular, points at `actor`, which is where the mistake is.
 */
export function contains(p: Parser): ContainsDeclaration | null {
  const keyword = p.next();
  const actors = p.take('name', 'actors');
  return {
    kind: 'contains',
    at: actors === null ? keyword.at : spanning(keyword.at, actors.at),
    actors: actors !== null,
  };
}

/** Whether a kind's name starts here, which is how a missing comma is told from an end. */
function atKindName(p: Parser): boolean {
  const first = p.peek();
  if (first.kind === 'kind') return true;
  return first.kind === 'name' && punct(p.peek(1), '.') && p.peek(2).kind === 'kind';
}

/** `Key` or `sprout.Container` — a kind as written, wherever one is written. */
export function kindName(p: Parser): KindExpr | null {
  const first = p.peek();
  if (first.kind === 'kind') {
    p.next();
    return { kind: 'kind-expr', at: first.at, library: null, name: p.ident(first) };
  }
  if (first.kind === 'name' && punct(p.peek(1), '.')) {
    const library = p.next();
    p.next();
    const named = p.take('kind');
    if (named !== null) {
      return {
        kind: 'kind-expr',
        at: spanning(library.at, named.at),
        library: p.ident(library),
        name: p.ident(named),
      };
    }
    p.diagnostics.refuse(
      p.peek().at,
      `\`${library.text}.\` is not followed by the name of a kind.`,
      'A kind starts with a capital letter, as in `sprout.Container`.',
    );
    return null;
  }
  p.diagnostics.refuse(
    first.at,
    `${p.describe(first)} is not the name of a kind.`,
    'A kind starts with a capital letter, as in `Creature` or `sprout.Container`.',
  );
  return null;
}
