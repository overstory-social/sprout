// `kind Crate is sprout.Container { … }` and `object bench is Bench { … }`
// (the spec's Kinds, composition and libraries › Declaring and composing,
// The world model › Objects). What each composes and its body are read
// by `bodies.ts`, as a world's are; which kinds those name is resolved a
// tier later. A kind writes its braces and stands at a file's top level.
// An object's body is optional, and it is written in the body of what
// holds it, so it never names its container: an `object` at a file's top
// level is read whole and refused.

import type { KindDeclaration, KindMember, ObjectDeclaration } from '../ast.js';
import type { Token } from '../lexer.js';
import { spanning, type Span } from '../../source/source.js';
import { punct, type Parser } from './parser.js';
import { apart, body, kindMembers } from './bodies.js';
import { composition, writtenKind } from './composition.js';
import { objectPath } from './paths.js';
import { recover, skipBracketed } from './recovery.js';

/** `kind Crate is sprout.Container { … }`, or with no `is`, composing nothing. */
export function kindDeclaration(p: Parser): KindDeclaration | null {
  const keyword = p.next();
  const name = p.take('kind');
  if (name === null) {
    p.diagnostics.refuse(
      atComposition(p) ? p.here() : p.peek().at,
      'A kind needs a name.',
      'A name for a kind starts with a capital: `kind Crate is sprout.Container { … }`.',
    );
    recover(p);
    return null;
  }

  const composes = composition(p, 'kind', name);
  if (composes === null) {
    recover(p);
    return null;
  }

  if (p.take('punct', '{') === null) {
    const head = `kind ${name.text}${composes.length === 0 ? '' : ` is ${composes.map(writtenKind).join(', ')}`}`;
    p.diagnostics.refuse(
      p.here(),
      `\`${name.text}\` has no braces.`,
      `A kind holds what it is made of in braces, and writes them when they hold nothing: \`${head} { }\`.`,
    );
    recover(p);
    return null;
  }

  const read = body(
    p,
    'kind',
    name,
    kindMembers(p, name.text, () => objectDeclaration(p, true)),
  );
  if (read === null) return null;
  return {
    kind: 'kind',
    at: spanning(keyword.at, read.close.at),
    name: p.ident(name),
    composes,
    ...apart(read.members, isKindMember),
  };
}

/**
 * `object bench is Bench`, and a body after it where one is written. A
 * `nested` one is written in another body, which its caller is reading;
 * null having said why, and the caller steps over the rest.
 */
export function objectDeclaration(p: Parser, nested: boolean): ObjectDeclaration | null {
  const keyword = p.next();
  // A word that starts the next declaration is not this one's name:
  // `object` with its name forgotten must not take `enum Ward { … }`'s
  // word and then its braces for a body, nor `is` for a name, nor the
  // body's next `remembers` block, a reserved word no object is named.
  const block = p.at('name', 'remembers') && punct(p.peek(1), '{');
  const name = p.atDeclarationStart() || p.at('name', 'is') || block ? null : p.take('name');
  if (name === null) {
    p.diagnostics.refuse(
      atComposition(p) ? p.here() : p.peek().at,
      'An object needs a name.',
      "An object's name is a lower-case word: `object bench is Bench { … }`.",
    );
    return null;
  }

  const composes = composition(p, 'object', name);
  if (composes === null) return null;
  const container = namesItsContainer(p, name);
  const head = container ?? composes.at(-1)?.at ?? name.at;

  const open = p.peek();
  if (!punct(open, '{')) {
    return {
      kind: 'object',
      at: spanning(keyword.at, head),
      name: p.ident(name),
      composes,
      members: [],
      objects: [],
    };
  }
  p.next();
  // Objects nest in objects, and each body is a level of the parser's
  // own depth, as a block's braces are.
  if (!p.deeper(open.at, 'Take some of the braces out.')) {
    skipBracketed(p, '}');
    return null;
  }
  const read = body(
    p,
    'object',
    name,
    kindMembers(p, name.text, () => objectDeclaration(p, true)),
    nested,
  );
  p.depth -= 1;
  if (read === null) return null;
  return {
    kind: 'object',
    at: spanning(keyword.at, read.close.at),
    name: p.ident(name),
    composes,
    ...apart(read.members, isKindMember),
  };
}

/**
 * An `object` at a file's top level: read whole, so its body is checked
 * and none of it is taken for the next declaration, and refused, since an
 * object is written inside the world or inside what holds it.
 */
export function topLevelObject(p: Parser): null {
  const keyword = p.peek();
  const declared = objectDeclaration(p, false);
  if (declared === null) {
    recover(p);
    return null;
  }
  p.diagnostics.refuse(
    spanning(keyword.at, declared.name.at),
    `\`${declared.name.text}\` is written outside the world, and an object is written inside what holds it.`,
    `Move \`object ${declared.name.text} …\` into the braces of the world, \`world <name> is sprout.World { … }\`, or of the object that holds it.`,
  );
  return null;
}

/**
 * `in hall` after an object's kinds, read and refused: the body an
 * object is written in is its container. Where it ends, or null where
 * none was written.
 */
function namesItsContainer(p: Parser, name: Token): Span | null {
  const word = p.take('name', 'in');
  if (word === null) return null;
  const head = p.take('name');
  const path = head === null ? null : objectPath(p, head);
  const container = path?.parts.map((part) => part.text).join('.') ?? null;
  p.diagnostics.refuse(
    word.at,
    'An object does not name what holds it: the body it is written in is its container.',
    container === null
      ? `Take out \`in\`, and write \`object ${name.text} …\` inside the braces of what holds it.`
      : `Take out \`in ${container}\`, and write \`object ${name.text} …\` inside the braces of \`${container}\`.`,
  );
  return path?.at ?? word.at;
}

/** Whether a declaration's kinds or its body start here, where its name should have been. */
function atComposition(p: Parser): boolean {
  return p.at('punct', '{') || p.at('punct', ':') || p.at('name', 'is');
}

/** What a body read that is a member of it, and not an object written in it. */
function isKindMember(member: KindMember | ObjectDeclaration): member is KindMember {
  return member.kind !== 'object';
}
