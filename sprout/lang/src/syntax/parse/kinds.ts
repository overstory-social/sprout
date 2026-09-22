// `kind Crate: sprout.Container { … }` and `object bench: Bench in
// composing_room { … }` (the spec's Kinds, composition and libraries ›
// Declaring and composing, The world model › Objects). What each composes
// and its body are read by `bodies.ts`, as a world's are; which kinds
// those name is resolved a tier later. A kind writes its braces; an
// object's body is optional, and its container is not.

import type { Ident, KindDeclaration, KindExpr, ObjectDeclaration } from '../ast.js';
import type { Token } from '../lexer.js';
import { spanning } from '../../source/source.js';
import type { Parser } from './parser.js';
import { body, composition, kindMembers } from './bodies.js';
import { recover } from './recovery.js';

/** `kind Crate: sprout.Container { … }`, or with no colon, composing nothing. */
export function kindDeclaration(p: Parser): KindDeclaration | null {
  const keyword = p.next();
  const name = p.take('kind');
  if (name === null) {
    p.diagnostics.refuse(
      p.at('punct', '{') || p.at('punct', ':') ? p.here() : p.peek().at,
      'A kind needs a name.',
      'A name for a kind starts with a capital: `kind Crate: sprout.Container { … }`.',
    );
    recover(p);
    return null;
  }

  const composes = composition(p, 'kind');
  if (composes === null) {
    recover(p);
    return null;
  }

  if (p.take('punct', '{') === null) {
    const head = `kind ${name.text}${composes.length === 0 ? '' : `: ${composes.map(written).join(', ')}`}`;
    p.diagnostics.refuse(
      p.here(),
      `\`${name.text}\` has no braces.`,
      `A kind holds what it is made of in braces, and writes them when they hold nothing: \`${head} { }\`.`,
    );
    recover(p);
    return null;
  }

  const read = body(p, 'kind', name, kindMembers(p));
  if (read === null) return null;
  return {
    kind: 'kind',
    at: spanning(keyword.at, read.close.at),
    name: p.ident(name),
    composes,
    members: read.members,
  };
}

/** `object bench: Bench in composing_room`, and a body after it where one is written. */
export function objectDeclaration(p: Parser): ObjectDeclaration | null {
  const keyword = p.next();
  // A word that starts the next declaration is not this one's name:
  // `object` with its name forgotten must not take `enum Ward { … }`'s
  // word and then its braces for a body.
  const name = p.atDeclarationStart() ? null : p.take('name');
  if (name === null) {
    p.diagnostics.refuse(
      p.at('punct', '{') || p.at('punct', ':') ? p.here() : p.peek().at,
      'An object needs a name.',
      "An object's name is a lower-case word: `object bench: Bench in composing_room { … }`.",
    );
    recover(p);
    return null;
  }

  const composes = composition(p, 'object');
  if (composes === null) {
    recover(p);
    return null;
  }

  const container = containerOf(p, name);
  if (container === null) {
    // A body written after it is still read, so what it holds is checked
    // and nothing in it is taken for the next declaration.
    if (p.take('punct', '{') !== null) body(p, 'object', name, kindMembers(p));
    else recover(p);
    return null;
  }

  if (p.take('punct', '{') === null) {
    return {
      kind: 'object',
      at: spanning(keyword.at, container.at),
      name: p.ident(name),
      composes,
      container,
      members: [],
    };
  }
  const read = body(p, 'object', name, kindMembers(p));
  if (read === null) return null;
  return {
    kind: 'object',
    at: spanning(keyword.at, read.close.at),
    name: p.ident(name),
    composes,
    container,
    members: read.members,
  };
}

/** `in composing_room` — what holds an object, which every object says. */
function containerOf(p: Parser, name: Token): Ident | null {
  if (p.take('name', 'in') === null) {
    p.diagnostics.refuse(
      p.here(),
      'An object says what holds it.',
      'Write `in` and the name of its container after its kinds: `object bench: Bench in composing_room { … }`.',
    );
    return null;
  }
  const held = p.take('name');
  if (held === null) {
    p.diagnostics.refuse(
      p.at('punct', '{') || p.done ? p.here() : p.peek().at,
      `After \`in\` comes the name of what holds \`${name.text}\`.`,
      'A container is named as it was declared, in lower case: `object bench: Bench in composing_room { … }`.',
    );
    return null;
  }
  return p.ident(held);
}

/** A composed kind as the author wrote it, for a remedy that repeats it. */
function written(kind: KindExpr): string {
  return kind.library === null ? kind.name.text : `${kind.library.text}.${kind.name.text}`;
}
