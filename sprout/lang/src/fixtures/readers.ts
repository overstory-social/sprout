// The parser context the specs under `syntax/parse/` call their own
// module's readers with: a `Parser` over a string, standing where the
// reader starts, with what a body would hand a member reader. Every
// reader there takes this context and nothing else reaches it, so a spec
// that calls one through it exercises that reader and no entry point
// around it. Spec support: the package build leaves it out.

import { Diagnostics, type Diagnostic } from '../source/diagnostics.js';
import { SourceFile } from '../source/source.js';
import type { StaticCaps } from '../bundle/limits.js';
import type { ObjectDeclaration, WorldMember } from '../syntax/ast.js';
import type { Token } from '../syntax/lexer.js';
import {
  apart,
  body,
  kindMembers,
  startsMemberOf,
  type MemberReaders,
} from '../syntax/parse/bodies.js';
import type { Owner } from '../syntax/parse/composition.js';
import { DECLARATION_READERS } from '../syntax/parse/declarations.js';
import { objectDeclaration } from '../syntax/parse/kinds.js';
import { Parser, type DeclarationReader } from '../syntax/parse/parser.js';
import { worldMembers } from '../syntax/parse/world.js';

export interface Over {
  /** The file's name, as a location names it. */
  readonly name?: string;
  readonly caps?: StaticCaps;
  /** The declarations the parser knows; this compiler's own where none are given. */
  readonly readers?: ReadonlyMap<string, DeclarationReader>;
  /** Where what it says goes; a fresh collection where none is given. */
  readonly diagnostics?: Diagnostics;
}

/** A parser over `text`, standing at its first token. */
export function parserOver(
  text: string,
  { name = 'ward.sprout', caps, readers, diagnostics = new Diagnostics() }: Over = {},
) {
  const source = new SourceFile(name, text);
  const p = new Parser(source, diagnostics, readers ?? DECLARATION_READERS, caps);
  return { p, source, diagnostics };
}

/** What `reader` read from the start of `text`, the parser it left, and what was said. */
export function readWith<T>(reader: (p: Parser) => T, text: string, over: Over = {}) {
  const { p, source, diagnostics } = parserOver(text, over);
  const read = reader(p);
  return { read, p, source, diagnostics, refusals: diagnostics.refusals as readonly Diagnostic[] };
}

/** The source from the parser's next token on, which is what a reader left for whatever follows. */
export const rest = (p: Parser): string => p.source.text.slice(p.peek().at.start);

/**
 * `members` written in the body of `kind <owner> { … }`, one member to a
 * line and the first on line 2, and the offset in the file where they
 * start.
 */
export function inKind(members: string, owner = 'Crate') {
  const open = `kind ${owner} {\n  `;
  return { text: `${open}${members}\n}\n`, at: open.length };
}

/**
 * A parser standing at `at` in `text`, where a body's member starts, with
 * the member readers a kind named `owner` reads its body with and the
 * test they give of whether a token starts a member: what a member
 * reader is handed by the body it is in.
 */
export function atMember(text: string, at: number, owner = 'Crate', over: Over = {}) {
  const reading = parserOver(text, over);
  const { p } = reading;
  while (!p.done && p.peek().at.start < at) p.next();
  const readers = kindMembers(p, owner, () => objectDeclaration(p, true));
  const startsMember: (token: Token) => boolean = startsMemberOf(p, readers);
  return { ...reading, readers, startsMember };
}

/** `members` in a kind's body, as `inKind` writes them, with the parser standing at the first. */
export function inKindBody(members: string, owner = 'Crate', over: Over = {}) {
  const { text, at } = inKind(members, owner);
  return atMember(text, at, owner, { name: 'k.sprout', ...over });
}

/**
 * The body `text` opens with, read by `body` with the member readers an
 * `owner` of that noun reads it with: its word and name, then everything
 * to its `{`, are stepped over as the owner's own reader takes them. An
 * object's body is read as one written inside another body is.
 */
export function readBody(text: string, owner: Owner = 'kind', name = 'b.sprout') {
  const { p, diagnostics } = parserOver(text, { name });
  p.next();
  const named = p.next();
  while (!p.done && !p.at('punct', '{')) p.next();
  p.next();
  const readers: MemberReaders<WorldMember | ObjectDeclaration> =
    owner === 'world'
      ? worldMembers(p, named.text)
      : kindMembers(p, named.text, () => objectDeclaration(p, true));
  const read = body(p, owner, named, readers, owner === 'object');
  const split =
    read === null
      ? { members: [], objects: [] }
      : apart(read.members, (m): m is WorldMember => m.kind !== 'object');
  return { read, ...split, p, refusals: diagnostics.refusals as readonly Diagnostic[] };
}
