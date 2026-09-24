// `world printers_shop is sprout.World { … }` (the spec's The world
// model). What it composes and its body are read as a kind's are, by
// `bodies.ts`; what is its own is the table of its members, which adds
// what it says about visitors, and the objects sitting directly in it,
// to what any kind may hold.

import type { ObjectDeclaration, WorldDeclaration, WorldMember } from '../ast.js';
import { spanning } from '../../source/source.js';
import type { Parser } from './parser.js';
import {
  addEvents,
  addGuards,
  addPlays,
  addRemembers,
  apart,
  body,
  contains,
  startsMemberOf,
  type MemberReaders,
} from './bodies.js';
import { composition, kindName } from './composition.js';
import { without } from './without.js';
import { objectDeclaration } from './kinds.js';
import { passage } from './passages.js';
import { proseFile } from './prose-file.js';
import { objectPath } from './paths.js';
import { recover } from './recovery.js';

export function worldDeclaration(p: Parser): WorldDeclaration | null {
  const keyword = p.next();
  // As for an object: the next declaration's word is not this one's
  // name, and neither is `is`.
  const name = p.atDeclarationStart() || p.at('name', 'is') ? null : p.take('name');
  if (name === null) {
    p.diagnostics.refuse(
      p.peek().at,
      'A world needs a name.',
      'Write `world <name> is sprout.World { … }`, as in `world printers_shop is sprout.World { … }`.',
    );
    recover(p);
    return null;
  }

  const composes = composition(p, 'world', name);
  if (composes === null) {
    recover(p);
    return null;
  }

  if (p.take('punct', '{') === null) {
    p.diagnostics.refuse(
      p.here(),
      `\`${name.text}\` has nothing in it.`,
      'A world is written `world <name> is sprout.World { … }`, holding what it is made of.',
    );
    recover(p);
    return null;
  }

  const read = body(p, 'world', name, worldMembers(p, name.text));
  if (read === null) return null;
  return {
    kind: 'world',
    at: spanning(keyword.at, read.close.at),
    name: p.ident(name),
    composes,
    ...apart(read.members, isWorldMember),
  };
}

/** What may be written inside the world `owner` past its properties, and what reads each one. */
export function worldMembers(
  p: Parser,
  owner: string,
): MemberReaders<WorldMember | ObjectDeclaration> {
  const readers = new Map<string, () => WorldMember | ObjectDeclaration | null>();
  addRemembers(p, readers);
  readers.set('visitors', () => visitors(p));
  readers.set('contains', () => contains(p));
  readers.set('passage', () => passage(p, readers));
  readers.set('prose', () => proseFile(p));
  readers.set('without', () => without(p, startsMemberOf(p, readers)));
  addGuards(p, owner, readers);
  addPlays(p, owner, readers);
  addEvents(p, owner, readers);
  readers.set('object', () => objectDeclaration(p, true));
  return readers;
}

/** What the world's body read that is a member of it, and not an object sitting in it. */
function isWorldMember(member: WorldMember | ObjectDeclaration): member is WorldMember {
  return member.kind !== 'object';
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
