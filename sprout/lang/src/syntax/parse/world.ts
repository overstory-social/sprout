// `world printers_shop: victorian.Voice { … }` (the spec's The world
// model). The message for a word it does not read is built from the same
// table that reads its members, so the two cannot drift.

import type { ContainsDeclaration, KindExpr, WorldDeclaration, WorldMember } from '../ast.js';
import type { Token } from '../lexer.js';
import { spanning } from '../../source/source.js';
import { punct, readable, type Parser } from './parser.js';
import { property, remembers } from './properties.js';
import { closedBracketRun, recover } from './recovery.js';

export function worldDeclaration(p: Parser): WorldDeclaration | null {
  const keyword = p.next();
  const name = p.take('name');
  if (name === null) {
    p.diagnostics.refuse(
      p.peek().at,
      'A world needs a name.',
      'Write `world <name>: sprout.World { … }`, as in `world printers_shop: sprout.World { … }`.',
    );
    recover(p);
    return null;
  }

  const composes: KindExpr[] = [];
  if (p.take('punct', ':') !== null) {
    for (;;) {
      const composed = kindName(p);
      if (composed === null) {
        recover(p);
        return null;
      }
      composes.push(composed);
      if (p.take('punct', ',') !== null) continue;
      // Every other comma-separated list in this file says so when
      // the comma is missing; letting the brace complain instead
      // would name the wrong problem.
      if (!atKindName(p)) break;
      p.diagnostics.refuse(
        p.here(),
        'A world needs a comma between the kinds it composes.',
        'Write `world <name>: one.Kind, Another { … }`.',
      );
    }
  }

  const open = p.take('punct', '{');
  if (open === null) {
    p.diagnostics.refuse(
      p.here(),
      `\`${name.text}\` has nothing in it.`,
      'A world is written `world <name>: sprout.World { … }`, holding what it is made of.',
    );
    recover(p);
    return null;
  }

  const members: WorldMember[] = [];
  const readers = worldMembers(p);
  for (;;) {
    const close = p.take('punct', '}');
    if (close !== null) {
      return {
        kind: 'world',
        at: spanning(keyword.at, close.at),
        name: p.ident(name),
        composes,
        members,
      };
    }
    if (p.done) {
      p.diagnostics.refuse(
        p.source.endSpan,
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
    if (p.atDeclarationStart()) {
      p.diagnostics.refuse(
        p.peek().at,
        `\`${name.text}\` is never closed.`,
        'Add a } after what the world is made of.',
      );
      return null;
    }

    // Whether a word IS a member and whether reading it SUCCEEDED are
    // two questions, and answering them in one expression is how a
    // member that failed gets reported as a word nobody knows.
    const token = p.peek();
    const read = worldMemberReader(p, token, readers);
    if (read === null) {
      p.diagnostics.refuse(
        token.at,
        `A world is not made of ${p.describe(token)}.`,
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
    if (p.peek().at.start === token.at.start && !p.atRecoveryStop()) p.next();
    if (!recoverToMember(p, readers)) {
      p.diagnostics.refuse(
        p.done ? p.source.endSpan : p.peek().at,
        `\`${name.text}\` is never closed.`,
        'Add a } after what the world is made of.',
      );
      return null;
    }
  }
}

/** What may be written inside a world, and what reads each one. */
function worldMembers(p: Parser): ReadonlyMap<string, () => WorldMember | null> {
  return new Map<string, () => WorldMember | null>([
    ['visitors', () => visitors(p)],
    ['contains', () => contains(p)],
  ]);
}

/**
 * Step over the rest of a world member that could not be read, to the
 * next member or the body's own `}`; false where the file ran out or a
 * declaration starts first. Braces nest, and so does a `[` closed
 * before any brace, so nothing inside a list is taken for a member,
 * while a `[` never closed is one token and cannot take the members
 * after it in silence.
 */
function recoverToMember(
  p: Parser,
  readers: ReadonlyMap<string, () => WorldMember | null>,
): boolean {
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
      if (worldMemberReader(p, token, readers) !== null) return true;
      const run = punct(token, '[') ? closedBracketRun(p) : 0;
      for (let i = 1; i < run; i++) p.next();
    }
    p.next();
  }
  return false;
}

/** What reads the member a word begins, or null where it begins none. */
function worldMemberReader(
  p: Parser,
  token: Token,
  readers: ReadonlyMap<string, () => WorldMember | null>,
): (() => WorldMember | null) | null {
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
 * A word after it that is not `actors` is left where it is rather
 * than being swallowed: it goes back to the member table, which says
 * what a world is made of and names the word the author wrote. So
 * `contains actor`, singular, points at `actor`, which is where the
 * mistake is.
 */
function contains(p: Parser): ContainsDeclaration | null {
  const keyword = p.next();
  const actors = p.take('name', 'actors');
  return {
    kind: 'contains',
    at: actors === null ? keyword.at : spanning(keyword.at, actors.at),
    actors: actors !== null,
  };
}

/** `visitors are Creature`, `visitors arrive at composing_room`. */
function visitors(p: Parser): WorldMember | null {
  const keyword = p.next();
  if (p.take('name', 'are') !== null) {
    const visitor = kindName(p);
    if (visitor === null) return null;
    return { kind: 'visitors-are', at: spanning(keyword.at, visitor.at), visitor };
  }
  if (p.take('name', 'arrive') !== null) {
    if (p.take('name', 'at') === null) {
      p.diagnostics.refuse(
        p.peek().at,
        'A world says where visitors arrive AT.',
        'Write `visitors arrive at <name>`, naming the place they begin in.',
      );
      return null;
    }
    const place = p.take('name');
    if (place === null) {
      p.diagnostics.refuse(
        p.peek().at,
        'A world says where visitors arrive.',
        'Write `visitors arrive at <name>`, naming the place they begin in.',
      );
      return null;
    }
    return {
      kind: 'visitors-arrive-at',
      at: spanning(keyword.at, place.at),
      place: p.ident(place),
    };
  }
  p.diagnostics.refuse(
    p.peek().at,
    'A world says two things about visitors: what they are, and where they arrive.',
    'Write `visitors are <Kind>` or `visitors arrive at <name>`.',
  );
  return null;
}

/** Whether a kind's name starts here, which is how a missing comma is told from an end. */
function atKindName(p: Parser): boolean {
  const first = p.peek();
  if (first.kind === 'kind') return true;
  return (
    first.kind === 'name' &&
    p.peek(1).kind === 'punct' &&
    p.peek(1).text === '.' &&
    p.peek(2).kind === 'kind'
  );
}

/** `Key` or `sprout.Container` — a kind as written, wherever one is written. */
function kindName(p: Parser): KindExpr | null {
  const first = p.peek();
  if (first.kind === 'kind') {
    p.next();
    return { kind: 'kind-expr', at: first.at, library: null, name: p.ident(first) };
  }
  if (first.kind === 'name' && p.peek(1).kind === 'punct' && p.peek(1).text === '.') {
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
