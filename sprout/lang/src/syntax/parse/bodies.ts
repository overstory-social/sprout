// What a world, a kind and an object share: a body of members in braces,
// and the members any of them may write (the spec's Kinds, composition
// and libraries › Declaring and composing; The world model); the kinds
// written after `is` are `composition.ts`'s, and `without` is
// `without.ts`'s. Each owner
// reads its body through one table of the words its members begin with,
// and the message for a word it does not read is built from that same
// table, so the two cannot drift. `object` is one of those words, since
// an object is written in the body of what holds it.

import {
  GUARD_NAMES,
  type ContainsDeclaration,
  type GuardDeclaration,
  type HandlerDeclaration,
  type HookDeclaration,
  type KindMember,
  type ObjectDeclaration,
  type PassDeclaration,
  type PlayDeclaration,
  type PropertyDeclaration,
  type RemembersDeclaration,
} from '../ast.js';
import type { Token } from '../lexer.js';
import type { Node } from '../../source/nodes.js';
import { spanning, type Span } from '../../source/source.js';
import { punct, type Parser } from './parser.js';
import { readable } from '../../source/words.js';
import { guard, isGuardName } from './guards.js';
import { handler, hook } from './handlers.js';
import { passRule } from './passes.js';
import { isPassage, passage } from './passages.js';
import { property, remembers } from './properties.js';
import { stepPast } from './recovery.js';
import { play } from './roles.js';
import { ARTICLE, type Owner } from './composition.js';
import { without } from './without.js';

/** What may be written inside a body, by the word each member begins with. */
export type MemberReaders<M> = ReadonlyMap<string, () => M | null>;

/** A member any body may hold, and a property or a `:remembers`, which every body holds. */
type Member<M> = M | PropertyDeclaration | RemembersDeclaration;

/** A body as read: its members, and the brace that closed it. */
export interface Body<M> {
  readonly members: Member<M>[];
  readonly close: Token;
}

/** What reads an object written in a body, `object bench is Bench { … }`. */
export type ObjectReader = () => ObjectDeclaration | null;

/**
 * What a kind's body or an object's may hold, past its properties, the
 * objects written in it among them. `owner` is its name.
 */
export function kindMembers(
  p: Parser,
  owner: string,
  object: ObjectReader,
): MemberReaders<KindMember | ObjectDeclaration> {
  const readers = new Map<string, () => KindMember | ObjectDeclaration | null>([
    ['contains', () => contains(p)],
  ]);
  readers.set('passage', () => passage(p, readers));
  readers.set('without', () => without(p, startsMemberOf(p, readers)));
  addGuards(p, owner, readers);
  addPlays(p, owner, readers);
  addEvents(p, owner, readers);
  readers.set('object', object);
  return readers;
}

/** Whether a token starts one of the members `readers` reads, a property among them. */
export function startsMemberOf<M>(p: Parser, readers: MemberReaders<M>): (token: Token) => boolean {
  return (token) => memberReader(p, token, readers) !== null;
}

/** A body's members apart from the objects written in it, which the AST holds on their own. */
export function apart<M extends Node>(
  read: readonly (M | ObjectDeclaration)[],
  isMember: (member: M | ObjectDeclaration) => member is M,
): { members: M[]; objects: ObjectDeclaration[] } {
  return {
    members: read.filter(isMember),
    objects: read.filter((member): member is ObjectDeclaration => !isMember(member)),
  };
}

/**
 * The three guards, added to a body's table. A guard never closed ends
 * where the body's next member starts, which the same table says.
 */
export function addGuards<M>(
  p: Parser,
  owner: string,
  readers: Map<string, () => M | GuardDeclaration | null>,
): void {
  const startsMember = startsMemberOf(p, readers);
  for (const name of GUARD_NAMES) readers.set(name, () => guard(p, owner, startsMember));
}

/**
 * `as <role> for <verb> { … }`, added to a body's table. A play never
 * closed ends where the body's next member starts, which the same table
 * says.
 */
export function addPlays<M>(
  p: Parser,
  owner: string,
  readers: Map<string, () => M | PlayDeclaration | null>,
): void {
  const startsMember = startsMemberOf(p, readers);
  readers.set('as', () => play(p, owner, startsMember));
}

/**
 * Handlers, hooks and pass rules, added to a body's table. One never
 * closed ends where the body's next member starts, which the same table
 * says.
 */
export function addEvents<M>(
  p: Parser,
  owner: string,
  readers: Map<string, () => M | HandlerDeclaration | HookDeclaration | PassDeclaration | null>,
): void {
  const startsMember = startsMemberOf(p, readers);
  readers.set('on', () => handler(p, owner, startsMember));
  readers.set('changed', () => hook(p, owner, startsMember));
  readers.set('pass', () => passRule(p, startsMember));
}

/**
 * The members of a body whose `{` is already taken, up to its `}`. A
 * member that could not be read costs that member and the body reads on,
 * since an author owed three problems is owed all three; null where the
 * body is never closed, having said so. A `nested` body is an object's
 * inside another body, whose own members may follow its `}`.
 */
export function body<M extends Node>(
  p: Parser,
  owner: Owner,
  name: Token,
  readers: MemberReaders<M>,
  nested = false,
): Body<M> | null {
  const members: Member<M>[] = [];
  const unclosed = (): null => {
    if (p.done && p.swallowedRest) return null;
    // A passage closes at the first `}` it holds no `{` for, so one slot
    // left open inside it takes the body's own closer as the passage's.
    const last = members.at(-1);
    const passage = last !== undefined && isPassage(last) ? last : null;
    p.diagnostics.refuse(
      p.done ? p.source.endSpan : p.peek().at,
      `\`${name.text}\` is never closed.`,
      passage === null
        ? `Add a } after what the ${owner} is made of.`
        : `Add a } after what the ${owner} is made of. If there is one, a { inside the passage \`${passage.name.text}\` has no } of its own, and took it.`,
    );
    return null;
  };

  for (;;) {
    const close = p.take('punct', '}');
    if (close !== null) {
      if (!nested) membersAfterClose(p, name, readers);
      return { members, close };
    }
    if (p.done) return unclosed();

    // A word that starts a DECLARATION is not a member, however it
    // reads as one. `kind K { enum Ward { oak } }` is a kind that was
    // never closed, and the enum is the file's; saying "a kind is not
    // made of `enum`" as well leaves its braces orphaned and the enum
    // reparsed as a sibling of the kind that held it. `object` is the
    // one such word a body reads as a member of its own.
    if (p.atDeclarationStart() && memberReader(p, p.peek(), readers) === null) return unclosed();

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
    // A property or a `:remembers` that could not be read may have
    // failed exactly at the `}` that would otherwise be taken for the
    // body's own: `:faulty }` with no value, read on into the next
    // member. Real members standing between here and the body's true
    // close say this `}` is not the body's, and reading past it keeps
    // them from being merely named after a closer that was never truly
    // here.
    if (token.kind === 'symbol' && p.at('punct', '}') && membersFollow(p, readers, 1)) {
      p.next();
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
 * `visitors`, `without`, a guard), found before the next declaration or the end
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
    // A property is named as it was written, colon and all; a word-led
    // member by its first word, since the table only reads a member by
    // that word and cannot yet say which of its forms this one is. Two
    // members that read the same way, `visitors are` and `visitors
    // arrive at` alike, are named once and not twice: the remedy is the
    // same for both, and a name repeated says nothing a single one does
    // not.
    const text =
      token.kind === 'symbol'
        ? `:${token.text}`
        : (playHeadAt(p, ahead) ?? eventHeadAt(p, ahead) ?? token.text);
    if (!found.some((member) => member.text === text)) found.push({ at: token.at, text });
    ahead += 1;
    // A guard's brackets and block are its own, and are stepped over
    // with it, so its `{` does not end the scan and its statements are
    // not taken for members.
    if (token.kind === 'name' && isGuardName(token.text)) ahead = pastGuard(p, ahead);
    // A play's head and braces are its own in the same way.
    if (token.kind === 'name' && token.text === 'as') ahead = pastPlay(p, ahead);
    // So are a handler's, a hook's and a pass rule's, past what they name.
    if (token.kind === 'name' && EVENT_WORDS.has(token.text)) ahead = pastEvent(p, ahead);
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
 * Past a guard's `( … )` and `{ … }`, from just after its word at
 * `ahead`, where each is written and closes; otherwise where it stopped.
 */
function pastGuard(p: Parser, ahead: number): number {
  let at = ahead;
  for (const [open, close] of [
    ['(', ')'],
    ['{', '}'],
  ] as const) {
    if (!punct(p.peek(at), open)) return at;
    let depth = 0;
    for (let scan = at; ; scan++) {
      const token = p.peek(scan);
      if (token.kind === 'end' || p.atDeclarationStart(scan)) return at;
      if (punct(token, open)) depth += 1;
      else if (punct(token, close) && --depth === 0) {
        at = scan + 1;
        break;
      }
    }
  }
  return at;
}

/** The words a handler, a hook and a pass rule begin with. */
const EVENT_WORDS: ReadonlySet<string> = new Set(['on', 'changed', 'pass']);

/** `on :stir`, `changed :lit`, `pass :m` or `pass any`, where one is written at `ahead`; else null. */
function eventHeadAt(p: Parser, ahead: number): string | null {
  const word = p.peek(ahead);
  const named = p.peek(ahead + 1);
  if (word.kind !== 'name' || !EVENT_WORDS.has(word.text)) return null;
  if (named.kind === 'symbol') return `${word.text} :${named.text}`;
  if (word.text === 'pass' && named.kind === 'name' && named.text === 'any') return 'pass any';
  return null;
}

/**
 * Past what a handler, a hook or a pass rule names, from just after its
 * word at `ahead`, and then its brackets and its block where each is
 * written and closes; otherwise where it stopped.
 */
function pastEvent(p: Parser, ahead: number): number {
  const named = p.peek(ahead);
  const at =
    named.kind === 'symbol' || (named.kind === 'name' && named.text === 'any') ? ahead + 1 : ahead;
  return pastBracketed(p, pastBracketed(p, at, '(', ')'), '{', '}');
}

/** Past a bracketed stretch opening at `ahead` and closing before any declaration; else `ahead`. */
function pastBracketed(p: Parser, ahead: number, open: string, close: string): number {
  if (!punct(p.peek(ahead), open)) return ahead;
  let depth = 0;
  for (let scan = ahead; ; scan++) {
    const token = p.peek(scan);
    if (token.kind === 'end' || p.atDeclarationStart(scan)) return ahead;
    if (punct(token, open)) depth += 1;
    else if (punct(token, close) && --depth === 0) return scan + 1;
  }
}

/** `as target for unlock`, where a play's whole head is written at `ahead`; else null. */
function playHeadAt(p: Parser, ahead: number): string | null {
  const [as, role, word, verb] = [0, 1, 2, 3].map((i) => p.peek(ahead + i));
  const named = (token: Token | undefined): boolean => token?.kind === 'name';
  if (as?.text !== 'as' || !named(as) || !named(role) || word?.text !== 'for' || !named(verb)) {
    return null;
  }
  return `as ${role!.text} for ${verb!.text}`;
}

/**
 * Past a play's `<role> for <verb>` and its `{ … }`, from just after its
 * `as` at `ahead`, where each is written and closes; otherwise where it
 * stopped.
 */
function pastPlay(p: Parser, ahead: number): number {
  let at = ahead;
  for (let words = 0; words < 3; words++) {
    const token = p.peek(at);
    if (token.kind !== 'name' && token.kind !== 'kind') break;
    at += 1;
  }
  if (!punct(p.peek(at), '{')) return at;
  let depth = 0;
  for (let scan = at; ; scan++) {
    const token = p.peek(scan);
    if (token.kind === 'end' || p.atDeclarationStart(scan)) return at;
    if (punct(token, '{')) depth += 1;
    else if (punct(token, '}') && --depth === 0) return scan + 1;
  }
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
 * Whether a member starts somewhere before the next `}` at this depth,
 * looking from `ahead` tokens past the cursor. Called only where a `}`
 * stands right where a property's value was refused, to tell that `}`
 * from the body's own: one with a member waiting past it is not the
 * body's true close. A `[` is tracked so a bare word inside a list value
 * is never taken for the start of one.
 */
function membersFollow<M>(p: Parser, readers: MemberReaders<M>, ahead: number): boolean {
  let depth = 0;
  for (;;) {
    const token = p.peek(ahead);
    if (token.kind === 'end') return false;
    const member = depth === 0 && memberReader(p, token, readers) !== null;
    if (!member && p.atRecoveryStop(ahead)) return false;
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
    if (punct(token, '{') || punct(token, '}')) return false;
    if (member) return true;
    ahead += 1;
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
      // is no more trustworthy than anything else. `object` is a member
      // of the body before it is a declaration.
      if (memberReader(p, token, readers) !== null) return true;
      if (p.atRecoveryStop()) return false;
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
