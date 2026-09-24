// `remembers { :handled false :visits 0 min 0 max 99 }`, as a world, a
// kind or an object writes one (the spec's Properties › Per-actor
// memory). Each entry is read by `property`, the reader a property
// declaration uses, so an entry is written, typed and refused exactly as
// a property is. The colon form, `:remembers [visits: 0]`, is refused
// with the block rewritten from what was written.

import type { PropertyDeclaration, RemembersDeclaration } from '../ast.js';
import type { Token } from '../lexer.js';
import { spanning, type Span } from '../../source/source.js';
import { punct, type Parser } from './parser.js';
import { property } from './properties.js';
import { stepPast } from './recovery.js';

/** How a block is written, for a remedy where nothing better can be rewritten. */
const EXAMPLE = 'remembers { :visits 0 min 0 max 99 }';

/**
 * A `remembers` block, its word next. `startsMember` says where the
 * enclosing body's next member starts, which ends a block never closed.
 * Null having said why.
 */
export function remembers(
  p: Parser,
  startsMember: (token: Token) => boolean,
): RemembersDeclaration | null {
  const keyword = p.next();
  if (p.take('punct', '{') === null) {
    p.diagnostics.refuse(
      p.here(),
      'What an object remembers goes in braces.',
      `Write \`${EXAMPLE}\`, each entry written as a property is.`,
    );
    return null;
  }
  const properties: PropertyDeclaration[] = [];
  const block = (end: Span): RemembersDeclaration => ({
    kind: 'remembers',
    at: spanning(keyword.at, end),
    properties,
  });
  // An entry that could not be read costs that entry, and the block keeps
  // the rest, since the refusal already keeps the file from being used.
  for (let last = keyword.at; ;) {
    const close = p.take('punct', '}');
    if (close !== null) return block(close.at);
    const token = p.peek();
    // The body's next member, a declaration or the file's end: the block
    // was never closed, and what follows is not its to take.
    if (p.done || p.atDeclarationStart() || (token.kind === 'name' && startsMember(token))) {
      p.diagnostics.refuse(
        p.done ? p.source.endSpan : token.at,
        'This `remembers` block is never closed.',
        'Add a } after what it remembers.',
      );
      return block(last);
    }
    if (token.kind === 'symbol') {
      const declared = property(p);
      if (declared !== null) {
        properties.push(declared);
        last = declared.at;
        continue;
      }
      // A file that ran out inside the entry has been explained by what
      // read it, and the block's close is the same missing text.
      if (p.done) return block(last);
      recoverToEntry(p, startsMember);
      continue;
    }
    notAnEntry(p, token);
    recoverToEntry(p, startsMember);
  }
}

/** A token inside a `remembers` block that does not start a property, refused and stepped past. */
function notAnEntry(p: Parser, token: Token): void {
  if (punct(token, ',')) {
    p.diagnostics.refuse(
      token.at,
      'A `remembers` block does not put commas between what it remembers.',
      'Take out the comma, and write each property after the one before, as in `remembers { :handled false :visits 0 }`.',
    );
    p.next();
    return;
  }
  p.diagnostics.refuse(
    token.at,
    `A \`remembers\` block holds properties, and ${p.subject(token, false)} is not one.`,
    token.kind === 'name'
      ? `Write \`:${token.text}\` and its value, as a property is written.`
      : 'Write each entry as a property is, with the colon before its name: `:visits 0`.',
  );
  p.next();
  // `visits: 0` is a property with its colon after the name, and that
  // colon is the entry's own.
  if (token.kind === 'name' && p.at('punct', ':')) p.next();
}

/**
 * Step over what is left of an entry that could not be read, to the next
 * property, the block's `}`, the body's next member or a declaration.
 * Braces nest, and a `[`…`]` is stepped over whole, so nothing the entry
 * wrote in brackets is taken for an entry or for the block's close.
 */
function recoverToEntry(p: Parser, startsMember: (token: Token) => boolean): void {
  let braces = 0;
  while (!p.done) {
    const token = p.peek();
    if (punct(token, '{')) braces += 1;
    else if (punct(token, '}')) {
      if (braces === 0) return;
      braces -= 1;
    } else if (braces === 0) {
      if (token.kind === 'symbol' || (token.kind === 'name' && startsMember(token))) return;
      // Strictly, as the block's own loop asks: a word that only spells
      // a declaration, `message foo`, is the abandoned entry's own text.
      if (p.atDeclarationStart()) return;
      stepPast(p);
      continue;
    }
    p.next();
  }
}

/**
 * `:remembers [visits: 0 min 0 max 99]`, its symbol next: refused, with
 * the remedy the block its entries make, and the list stepped over, as
 * far as its `]` or, never closed, up to what follows it. Always null.
 */
export function rememberedAsList(p: Parser, startsMember: (token: Token) => boolean): null {
  const symbol = p.next();
  const { length, closed } = listExtent(p, startsMember);
  const tokens: Token[] = [];
  for (let i = 0; i < length; i++) tokens.push(p.next());
  const block = closed ? asBlock(p, tokens) : null;
  p.diagnostics.refuse(
    symbol.at,
    'What an object remembers is written as a `remembers` block, with no colon before `remembers` and its properties in braces.',
    block === null
      ? `Write \`${EXAMPLE}\`, each entry written as a property is.`
      : `Write \`${block}\`.`,
  );
  return null;
}

/**
 * How many tokens the `[` here spans, and whether its own `]` closes it
 * before a brace, the next member, a declaration or the file's end, where
 * a list never closed stops short of what follows it.
 */
function listExtent(
  p: Parser,
  startsMember: (token: Token) => boolean,
): { length: number; closed: boolean } {
  if (!punct(p.peek(), '[')) return { length: 0, closed: false };
  let depth = 0;
  for (let ahead = 0; ; ahead++) {
    const token = p.peek(ahead);
    // Loosely, as recovery asks, but never of an entry's own name: the
    // word before a colon is `world` in `[world: 1]`, not a declaration.
    const entryName = punct(p.peek(ahead + 1), ':');
    const member = token.kind === 'symbol' || (token.kind === 'name' && startsMember(token));
    const next = member || p.atRecoveryStop(ahead);
    const ends = token.kind === 'end' || punct(token, '{') || punct(token, '}');
    if (ends || (next && !entryName)) return { length: ahead, closed: false };
    if (punct(token, '[')) depth += 1;
    else if (punct(token, ']') && --depth === 0) return { length: ahead + 1, closed: true };
  }
}

/**
 * The block the entries of `[visits: 0, handled: false]` make, each
 * `name: …` written `:name …`, from the tokens `[` through `]`; null
 * where an entry is not written that way.
 */
function asBlock(p: Parser, tokens: readonly Token[]): string | null {
  const entries: Token[][] = [[]];
  let depth = 0;
  for (const token of tokens.slice(1, -1)) {
    if (punct(token, '[')) depth += 1;
    else if (punct(token, ']')) depth -= 1;
    if (depth === 0 && punct(token, ',')) entries.push([]);
    else entries.at(-1)!.push(token);
  }
  const written: string[] = [];
  for (const entry of entries) {
    if (entry.length === 0) continue;
    const [name, colon, first] = entry;
    if (name?.kind !== 'name' || colon === undefined || !punct(colon, ':') || first === undefined) {
      return null;
    }
    const value = p.source.text.slice(first.at.start, entry.at(-1)!.at.end).replace(/\s+/g, ' ');
    written.push(`:${name.text} ${value}`);
  }
  return written.length === 0 ? 'remembers { }' : `remembers { ${written.join(' ')} }`;
}
