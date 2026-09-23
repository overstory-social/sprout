// `world printers_shop: sprout.World { … }` (the spec's The world model).
// What it composes and its body are read as a kind's are, by `bodies.ts`;
// what is its own is the table of its members, which adds what it says
// about visitors to what any kind may hold.

import type { WorldDeclaration, WorldMember } from '../ast.js';
import { spanning } from '../../source/source.js';
import type { Parser } from './parser.js';
import { body, composition, contains, kindName, without, type MemberReaders } from './bodies.js';
import { passage } from './passages.js';
import { objectPath } from './paths.js';
import { recover } from './recovery.js';

export function worldDeclaration(p: Parser): WorldDeclaration | null {
  const keyword = p.next();
  // As for an object: the next declaration's word is not this one's name.
  const name = p.atDeclarationStart() ? null : p.take('name');
  if (name === null) {
    p.diagnostics.refuse(
      p.peek().at,
      'A world needs a name.',
      'Write `world <name>: sprout.World { … }`, as in `world printers_shop: sprout.World { … }`.',
    );
    recover(p);
    return null;
  }

  const composes = composition(p, 'world');
  if (composes === null) {
    recover(p);
    return null;
  }

  if (p.take('punct', '{') === null) {
    p.diagnostics.refuse(
      p.here(),
      `\`${name.text}\` has nothing in it.`,
      'A world is written `world <name>: sprout.World { … }`, holding what it is made of.',
    );
    recover(p);
    return null;
  }

  const read = body(p, 'world', name, worldMembers(p));
  if (read === null) return null;
  return {
    kind: 'world',
    at: spanning(keyword.at, read.close.at),
    name: p.ident(name),
    composes,
    members: read.members,
  };
}

/** What may be written inside a world past its properties, and what reads each one. */
function worldMembers(p: Parser): MemberReaders<WorldMember> {
  const readers = new Map<string, () => WorldMember | null>([
    ['visitors', () => visitors(p)],
    ['contains', () => contains(p)],
  ]);
  readers.set('passage', () => passage(p, readers));
  readers.set('without', () => without(p, readers));
  return readers;
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
    const head = p.take('name');
    if (head === null) {
      p.diagnostics.refuse(
        p.peek().at,
        'A world says where visitors arrive.',
        'Write `visitors arrive at <name>`, naming the place they begin in.',
      );
      return null;
    }
    const place = objectPath(p, head);
    if (place === null) return null;
    return { kind: 'visitors-arrive-at', at: spanning(keyword.at, place.at), place };
  }
  p.diagnostics.refuse(
    p.peek().at,
    'A world says two things about visitors: what they are, and where they arrive.',
    'Write `visitors are <Kind>` or `visitors arrive at <name>`.',
  );
  return null;
}
