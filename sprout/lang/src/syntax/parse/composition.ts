// The kinds a world, a kind or an object composes, written after `is`
// (the spec's Kinds, composition and libraries › Declaring and
// composing), and a kind as written wherever one is: `Key`,
// `sprout.Container`. A colon written for `is` is read and refused, with
// the `is` form as the remedy.

import type { KindExpr } from '../ast.js';
import type { Token } from '../lexer.js';
import { spanning } from '../../source/source.js';
import { punct, type Parser } from './parser.js';

/** What declares a body, as its messages name it. */
export type Owner = 'world' | 'kind' | 'object';

export const ARTICLE: Readonly<Record<Owner, string>> = {
  world: 'A world',
  kind: 'A kind',
  object: 'An object',
};

/** How each owner is written, `name` and then `kinds` after `is`, for a remedy to show. */
const WRITTEN: Readonly<Record<Owner, (name: string, kinds: string) => string>> = {
  world: (name, kinds) => `world ${name} is ${kinds} { … }`,
  kind: (name, kinds) => `kind ${name} is ${kinds} { … }`,
  object: (name, kinds) => `object ${name} is ${kinds} { … }`,
};

/** Each owner's name as a remedy shows it where the name is not the point. */
const PLACEHOLDER: Readonly<Record<Owner, string>> = {
  world: '<name>',
  kind: '<Name>',
  object: '<name>',
};

/**
 * `is sprout.World, victorian.Voice` — the kinds the declaration `name`
 * composes, as written, or none where no `is` follows its name. A colon
 * in its place is read and refused, with `is` as the remedy (the spec's
 * Declaring and composing). Null having said why where a kind could not
 * be read; the caller steps over the rest.
 */
export function composition(p: Parser, owner: Owner, name: Token): KindExpr[] | null {
  const composes: KindExpr[] = [];
  const colon = p.take('punct', ':');
  if (colon === null && p.take('name', 'is') === null) return composes;
  let read = true;
  for (;;) {
    const composed = kindName(p);
    if (composed === null) {
      read = false;
      break;
    }
    composes.push(composed);
    if (p.take('punct', ',') !== null) continue;
    // Every other comma-separated list says so when the comma is
    // missing; letting what follows complain instead would name the
    // wrong problem.
    if (!atKindName(p)) break;
    p.diagnostics.refuse(
      p.here(),
      `${ARTICLE[owner]} needs a comma between the kinds it composes.`,
      `Write \`${WRITTEN[owner](PLACEHOLDER[owner], 'one.Kind, Another')}\`.`,
    );
  }
  if (colon !== null) {
    const kinds = read && composes.length > 0 ? composes.map(writtenKind).join(', ') : '<Kind>';
    p.diagnostics.refuse(
      colon.at,
      `${ARTICLE[owner]} composes its kinds with \`is\`, not a colon.`,
      `Write \`${WRITTEN[owner](name.text, kinds)}\`.`,
    );
  }
  return read ? composes : null;
}

/** A composed kind as the author wrote it, for a remedy that repeats it. */
export function writtenKind(kind: KindExpr): string {
  return kind.library === null ? kind.name.text : `${kind.library.text}.${kind.name.text}`;
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
    `${p.subject(first, true)} is not the name of a kind.`,
    'A kind starts with a capital letter, as in `Creature` or `sprout.Container`.',
  );
  return null;
}
