// What a world, a kind and an object share: the kinds written after the
// colon, a body of members in braces, and the members any of them may
// write (the spec's Kinds, composition and libraries › Declaring and
// composing, Suppressing a contribution; The world model). Each owner
// reads its body through one table of the words its members begin with,
// and the message for a word it does not read is built from that same
// table, so the two cannot drift.

import {
  writtenMember,
  type ContainsDeclaration,
  type KindExpr,
  type KindMember,
  type MemberRef,
  type PropertyDeclaration,
  type RemembersDeclaration,
  type WithoutDeclaration,
} from '../ast.js';
import type { Token } from '../lexer.js';
import { spanning, type Span } from '../../source/source.js';
import { punct, readable, type Parser } from './parser.js';
import { property, remembers } from './properties.js';
import { stepPast } from './recovery.js';

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
  const readers = new Map<string, () => KindMember | null>([['contains', () => contains(p)]]);
  readers.set('without', () => without(p, readers));
  return readers;
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
    if (close !== null) {
      membersAfterClose(p, name, readers);
      return { members, close };
    }
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
        `It holds its properties, ${readable([...readers.keys()])}.`,
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

/** One member-shaped token found after a body's own `}`, and how it reads in the refusal. */
interface FoundMember {
  readonly at: Span;
  readonly text: string;
}

/**
 * Members written after the `}` that closes a body, as a stray one
 * left inside a member's own text leaves them: a property, a
 * `:remembers`, or one of the body's keyword members (`contains`,
 * `visitors`, `without`), found before the next declaration or the end
 * of the file. A brace count alone cannot tell such a stray closer from
 * the body's own, so every member after it is named in one refusal
 * instead of being lost the way stepping straight to the next
 * declaration would lose them; what is named is then stepped over,
 * through the body's own true `}` where one follows before the next
 * declaration, so the file's reader is not handed the same tokens
 * again.
 */
function membersAfterClose<M>(p: Parser, name: Token, readers: MemberReaders<M>): void {
  const found: FoundMember[] = [];
  let depth = 0;
  let ahead = 0;
  for (;;) {
    const token = p.peek(ahead);
    if (token.kind === 'end' || p.atRecoveryStop(ahead)) break;
    if (punct(token, '[')) {
      depth += 1;
      ahead += 1;
      continue;
    }
    if (depth > 0) {
      if (punct(token, ']')) depth -= 1;
      ahead += 1;
      continue;
    }
    if (punct(token, '{')) break;
    if (punct(token, '}')) {
      ahead += 1;
      break;
    }
    if (memberReader(p, token, readers) === null) {
      // Not member-shaped itself — the orphaned rest of a member's own
      // value, most likely — so it is skipped over rather than taken
      // as proof that nothing here is stray: only reaching the next
      // declaration or the end of the file with `found` still empty
      // says that.
      ahead += 1;
      continue;
    }
    if (token.kind === 'symbol' && token.text === 'remembers') {
      // What a `:remembers` holds is named entry by entry, as a stray
      // one inside its own brackets is (`entriesAfterClose`), so its
      // own remedy says which memory was lost and not merely that one
      // was.
      const before = found.length;
      ahead = remembersEntries(p, ahead, found);
      if (found.length === before) found.push({ at: token.at, text: ':remembers' });
      continue;
    }
    found.push({ at: token.at, text: token.text });
    ahead += 1;
  }
  if (found.length === 0) return;
  p.diagnostics.refuse(
    found[0]!.at,
    `${readable(found.map((member) => member.text))} ${
      found.length === 1 ? 'is' : 'are'
    } written after the \`}\` that ends \`${name.text}\`.`,
    `Everything \`${name.text}\` is made of goes inside its braces. Take out the \`}\` that ends it too early.`,
  );
  for (let i = 0; i < ahead; i++) p.next();
}

/**
 * The names of a `:remembers`'s own entries, from just past its keyword
 * at `ahead`, appended to `found`; and where the scan left off, past its
 * own `]` where one closes it. Where no `[` follows the keyword at all,
 * only the keyword itself is stepped past, leaving what follows for the
 * outer scan to read on its own terms.
 */
function remembersEntries(p: Parser, ahead: number, found: FoundMember[]): number {
  let at = ahead + 1;
  if (!punct(p.peek(at), '[')) return at;
  at += 1;
  let depth = 0;
  for (;;) {
    const token = p.peek(at);
    if (token.kind === 'end') return at;
    if (punct(token, '[')) {
      depth += 1;
    } else if (punct(token, ']')) {
      if (depth === 0) return at + 1;
      depth -= 1;
    } else if (depth === 0 && token.kind === 'name' && punct(p.peek(at + 1), ':')) {
      found.push({ at: token.at, text: token.text });
    }
    at += 1;
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
      stepPast(p);
      continue;
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

/** How a `without` is written, for a remedy to show. */
const WITHOUT_EXAMPLE = '`without changed :lit from sprout.LightSource`';

/**
 * `without changed :lit from sprout.LightSource` — a member a composed
 * kind contributes, left out (the spec's Suppressing a contribution).
 * `readers` is the body's own table, so that a member written after a
 * `without` with nothing in it is left for the body to read.
 */
export function without<M>(p: Parser, readers: MemberReaders<M>): WithoutDeclaration | null {
  const keyword = p.next();
  const member = memberNamed(p, keyword.at, readers);
  if (member === null) return null;
  const written = `without ${writtenMember(member)}`;

  const from = p.take('name', 'from');
  if (from === null) {
    p.diagnostics.refuse(
      endOf(p, member.at),
      `\`${written}\` does not say which kind it comes from.`,
      `Write \`from\` and the kind that declares it: \`${written} from <Kind>\`, as in ${WITHOUT_EXAMPLE}.`,
    );
    return null;
  }
  const first = p.peek();
  if (first.kind !== 'kind' && !(first.kind === 'name' && punct(p.peek(1), '.'))) {
    p.diagnostics.refuse(
      endsHere(p, readers) ? endOf(p, from.at) : first.at,
      `After \`from\` comes the kind that declares \`${writtenMember(member)}\`.`,
      `Name it as it is composed, with its capital: ${WITHOUT_EXAMPLE}.`,
    );
    return null;
  }
  const source = kindName(p);
  if (source === null) return null;
  return { kind: 'without', at: spanning(keyword.at, source.at), member, source };
}

const GUARDS: ReadonlySet<string> = new Set(['depart', 'release', 'accept']);

/**
 * The member a `without` names: `on :m`, `changed :p`, a guard, or `as
 * <role> for <verb>`. Null having said why.
 */
function memberNamed<M>(p: Parser, keyword: Span, readers: MemberReaders<M>): MemberRef | null {
  const token = p.peek();
  if (token.kind === 'name' && (token.text === 'on' || token.text === 'changed')) {
    p.next();
    const named = namePart(p, 'symbol', readers);
    if (named === null) {
      const handler = token.text === 'on';
      p.diagnostics.refuse(
        endsHere(p, readers) ? endOf(p, token.at) : p.peek().at,
        handler
          ? '`on` names the message a handler answers, with its colon.'
          : '`changed` names the property a hook watches, with its colon.',
        handler
          ? 'Write `without on :<message> from <Kind>`, as in `without on :stir from Bellows`.'
          : `Write \`without changed :<property> from <Kind>\`, as in ${WITHOUT_EXAMPLE}.`,
      );
      return null;
    }
    const at = spanning(token.at, named.at);
    return token.text === 'on'
      ? { kind: 'handler-ref', at, message: p.ident(named) }
      : { kind: 'hook-ref', at, property: p.ident(named) };
  }
  if (token.kind === 'name' && GUARDS.has(token.text)) {
    p.next();
    return {
      kind: 'guard-ref',
      at: token.at,
      guard: token.text as 'depart' | 'release' | 'accept',
    };
  }
  if (token.kind === 'name' && token.text === 'as') {
    p.next();
    const role = namePart(p, 'name', readers);
    const said = role === null ? null : p.take('name', 'for');
    const verb = said === null ? null : namePart(p, 'name', readers);
    if (role === null || verb === null) {
      p.diagnostics.refuse(
        endsHere(p, readers) ? endOf(p, (said ?? role ?? token).at) : p.peek().at,
        '`as` names a role and the verb it plays it for.',
        'Write `without as <role> for <verb> from <Kind>`, as in `without as target for unlock from Lock`.',
      );
      return null;
    }
    return {
      kind: 'role-ref',
      at: spanning(token.at, verb.at),
      role: p.ident(role),
      verb: p.ident(verb),
    };
  }

  // Nothing where the member goes: the body's next member, its brace, or
  // `from` straight after the word.
  const beforeFrom = p.peek(1).kind === 'name' && p.peek(1).text === 'from';
  if ((token.kind === 'name' && token.text === 'from') || (endsHere(p, readers) && !beforeFrom)) {
    p.diagnostics.refuse(
      keyword,
      '`without` does not say what to leave out.',
      `Name a handler, a hook, a guard or a role, and the kind it comes from: ${WITHOUT_EXAMPLE}.`,
    );
    return null;
  }
  p.diagnostics.refuse(
    token.at,
    `\`without\` names a handler, a hook, a guard or a role, not ${p.describe(token)}.`,
    token.kind === 'symbol'
      ? `A handler is written \`on :${token.text}\` and a hook \`changed :${token.text}\`, as in ${WITHOUT_EXAMPLE}.`
      : `Write one as it is declared: \`on :<message>\`, \`changed :<property>\`, \`depart\`, \`release\`, \`accept\` or \`as <role> for <verb>\`, as in ${WITHOUT_EXAMPLE}.`,
  );
  // A member word written in its place is part of this line, not the
  // next member, so the body does not read it again.
  if (memberReader(p, token, readers) !== null) p.next();
  return null;
}

/**
 * The name a member form writes next, `:lit` after `changed` or `target`
 * after `as`, or null. A word that begins the body's next member is taken
 * only where `from` follows it, so a `without` left unfinished does not
 * take the line after it: `without changed` over `:open true` leaves the
 * property to be read.
 */
function namePart<M>(p: Parser, kind: 'symbol' | 'name', readers: MemberReaders<M>): Token | null {
  const token = p.peek();
  if (token.kind !== kind || (kind === 'name' && (token.text === 'from' || token.text === 'for'))) {
    return null;
  }
  const next = p.peek(1);
  const fromFollows = next.kind === 'name' && next.text === 'from';
  if (memberReader(p, token, readers) !== null && !fromFollows && !endsAfter(p, readers)) {
    return null;
  }
  return p.next();
}

/**
 * Whether the token after the next one ends a member: the body's brace,
 * the end of the file, or the start of another member.
 */
function endsAfter<M>(p: Parser, readers: MemberReaders<M>): boolean {
  const after = p.peek(1);
  return punct(after, '}') || after.kind === 'end' || memberReader(p, after, readers) !== null;
}

/**
 * Whether what comes next is not part of this member: the body's brace,
 * the end of the file, a declaration, or the next member.
 */
function endsHere<M>(p: Parser, readers: MemberReaders<M>): boolean {
  const token = p.peek();
  return (
    punct(token, '}') ||
    p.done ||
    p.atDeclarationStart() ||
    memberReader(p, token, readers) !== null
  );
}

/** The zero-width span just after something, where what should follow it is missing. */
function endOf(p: Parser, at: Span): Span {
  return p.source.span(at.end, at.end);
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
