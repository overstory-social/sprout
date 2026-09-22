// Types and the values written in their place: `boolean`, `Ward`,
// `sprout.Ward`, `[Ward]`, and `false`, `4`, `"a line"`, `wet`, `[oak,
// silver]` (the spec's Properties › The types, Lists).

import type { Literal, TypeExpr } from '../ast.js';
import type { Token } from '../lexer.js';
import { spanning, type Span } from '../../source/source.js';
import { punct, type Parser } from './parser.js';
import { separator, skipBracketed } from './recovery.js';

/**
 * The type names that are the language's own. They are read as types
 * wherever a type may be written. They are reserved words too, so
 * nothing else — an option, a binding — may be called by one.
 */
export const BUILT_IN_TYPE_WORDS = new Set(['boolean', 'integer', 'string', 'object']);

/** `boolean`, `Drying`, `sprout.Ward`, `[Ward]`. */
export function typeExpr(p: Parser): TypeExpr | null {
  const open = p.take('punct', '[');
  if (open !== null) {
    if (!p.deeper(open.at)) {
      skipBracketed(p, ']');
      return null;
    }
    try {
      // Every way out of here but the good one gives up on the whole
      // list type, so it steps over the rest of it: leaving the
      // closer behind hands it to whatever is reading around this,
      // which takes it for its own and ends early.
      const element = typeExpr(p);
      if (element === null) {
        skipBracketed(p, ']');
        return null;
      }
      const close = p.take('punct', ']');
      if (close !== null) {
        return { kind: 'list-type', at: spanning(open.at, close.at), element };
      }
      if (p.at('punct', ',')) {
        // `[Ward, oak]` is a list VALUE whose first element was
        // capitalised, not a list type with too much in it. Saying
        // "never closed" would point at a bracket the author wrote
        // correctly.
        p.diagnostics.refuse(
          p.peek().at,
          'A list type names one element type.',
          'Write `[Ward]` for a list of wards. A list of values is written with its values: `[oak, silver]`.',
        );
        skipBracketed(p, ']');
        return null;
      }
      p.diagnostics.refuse(
        p.here(),
        'A list type is never closed.',
        'Write the element type in brackets, as in `[Ward]`.',
      );
      skipBracketed(p, ']');
      return null;
    } finally {
      p.depth -= 1;
    }
  }

  const first = p.peek();
  // A word that starts a declaration is not a type, `object` included,
  // which is both: in `message :m with` and then `object bench: Bench in
  // hall`, the type was left out and the object is the file's.
  if (p.atDeclarationStart()) {
    p.diagnostics.refuse(
      first.at,
      `\`${first.text}\` starts a declaration, so the type before it is missing.`,
      'Write `boolean`, `integer`, `string`, the name of an enum, or `[…]` for a list of those.',
    );
    return null;
  }
  if (first.kind === 'kind') {
    p.next();
    return { kind: 'named-type', at: first.at, library: null, name: p.ident(first) };
  }
  // Before the library branch: `boolean.` is the language's own word
  // followed by a stray dot, never a library called `boolean`.
  if (first.kind === 'name' && BUILT_IN_TYPE_WORDS.has(first.text)) {
    p.next();
    return { kind: 'named-type', at: first.at, library: null, name: p.ident(first) };
  }
  if (first.kind === 'name' && p.peek(1).kind === 'punct' && p.peek(1).text === '.') {
    const library = p.next();
    p.next();
    const named = p.take('kind');
    if (named === null) {
      p.diagnostics.refuse(
        p.peek().at,
        `\`${library.text}.\` is not followed by a name.`,
        "A library's kind or enum starts with a capital, as in `sprout.Ward`.",
      );
      return null;
    }
    return {
      kind: 'named-type',
      at: spanning(library.at, named.at),
      library: p.ident(library),
      name: p.ident(named),
    };
  }
  p.diagnostics.refuse(
    first.at,
    `${p.describe(first)} is not a type.`,
    'Write `boolean`, `integer`, `string`, the name of an enum, or `[…]` for a list of those.',
  );
  return null;
}

/** Whether what comes next is a type rather than a value. */
export function atType(p: Parser): boolean {
  const first = p.peek();
  if (first.kind === 'kind') return true;
  if (first.kind === 'name' && BUILT_IN_TYPE_WORDS.has(first.text)) return true;
  if (first.kind === 'name' && p.peek(1).kind === 'punct' && p.peek(1).text === '.') {
    return true;
  }
  // `[Ward]` is a list type and `[oak]` is a list value; the capital
  // tells them apart. Only the first element is looked at, which is
  // why `typeExpr` says something accurate about `[Ward, oak]`.
  if (first.kind === 'punct' && first.text === '[') {
    let ahead = 1;
    while (p.peek(ahead).kind === 'punct' && p.peek(ahead).text === '[') ahead += 1;
    const inner = p.peek(ahead);
    if (inner.kind === 'kind') return true;
    if (inner.kind === 'name' && BUILT_IN_TYPE_WORDS.has(inner.text)) return true;
    if (
      inner.kind === 'name' &&
      p.peek(ahead + 1).kind === 'punct' &&
      p.peek(ahead + 1).text === '.'
    ) {
      return true;
    }
  }
  return false;
}

/** `false`, `4`, `"a line"`, `wet`, `[oak, silver]`. */
export function literal(p: Parser): Literal | null {
  const token = p.peek();
  if (token.kind === 'punct' && token.text === '-') {
    p.next();
    const digits = p.take('integer');
    if (digits === null) {
      p.diagnostics.refuse(
        p.peek().at,
        'A minus sign needs a number after it.',
        'Write a whole number, as in `-3`.',
      );
      // What the sign stands before goes with it, as one value: left
      // in the stream, a `]` inside `-[1]` would end the list around it.
      skipValue(p);
      return null;
    }
    if (atFraction(p)) return null;
    return { kind: 'integer', at: spanning(token.at, digits.at), value: -Number(digits.text) };
  }
  if (token.kind === 'integer') {
    p.next();
    if (atFraction(p)) return null;
    return { kind: 'integer', at: token.at, value: Number(token.text) };
  }
  if (token.kind === 'string') {
    p.next();
    return { kind: 'string', at: token.at, value: token.text };
  }
  if (token.kind === 'name' && (token.text === 'true' || token.text === 'false')) {
    p.next();
    return { kind: 'boolean', at: token.at, value: token.text === 'true' };
  }
  if (token.kind === 'name') {
    p.next();
    return { kind: 'option-literal', at: token.at, name: p.ident(token) };
  }
  if (token.kind === 'punct' && token.text === '[') {
    const open = p.next();
    if (!p.deeper(open.at)) {
      skipBracketed(p, ']');
      return null;
    }
    try {
      return listLiteral(p, open);
    } finally {
      p.depth -= 1;
    }
  }
  p.diagnostics.refuse(
    token.at,
    `${p.describe(token)} is not a value.`,
    'Write `true` or `false`, a whole number, text in quotes, an option of an enum, or a list.',
  );
  return null;
}

/**
 * A decimal point after a number. Sprout has no fractions, and an
 * author who wrote one is owed that sentence rather than a complaint
 * about the separator their `.` ran into.
 */
export function atFraction(p: Parser): boolean {
  if (!(p.at('punct', '.') && p.peek(1).kind === 'integer')) return false;
  const dot = p.next();
  const rest = p.next();
  p.diagnostics.refuse(
    spanning(dot.at, rest.at),
    'Sprout has no fractions.',
    'Write a whole number. A quantity that needs halves is counted in halves.',
  );
  return true;
}

/** `[oak, silver]`, the brackets already open. */
function listLiteral(p: Parser, open: Token): Literal | null {
  const elements: Literal[] = [];
  let missingComma: Span | null = null;
  // Said once, at the element that breaks it, and then read on: the
  // cap is one fact about one list, and an author whose list is two
  // too long is still owed whatever else is wrong inside it. The
  // declaration is refused at the end rather than truncated, because
  // a silent drop is the one thing a full list must never be.
  let overCap = false;
  for (;;) {
    const close = p.take('punct', ']');
    if (close !== null) {
      if (overCap) return null;
      return { kind: 'list-literal', at: spanning(open.at, close.at), elements };
    }
    if (p.done || p.atDeclarationStart()) {
      // A word that starts a declaration is not an element, however
      // it reads as one — the lexer hands `enum` over as a plain
      // name, so `literal()` takes it and the hunt for a `]` walks on
      // through the rest of the file. What FOLLOWS the word decides:
      // `[oak, enum]` is still read as a list of two words here, and
      // `enum` is answered for where the option set is checked.
      p.diagnostics.refuse(
        p.done ? p.source.endSpan : p.peek().at,
        'This list is never closed.',
        'Add a ] after its elements.',
      );
      return null;
    }
    const before = p.peek();
    const element = literal(p);
    if (element === null) {
      // An author owed three problems is owed all three, so the list
      // reads ON — past the element it could not read, and not past
      // everything up to the next comma, which would swallow the
      // well-formed elements in between without saying so.
      //
      // Unless the file itself ran out inside that element, in which
      // case whatever it already said is the whole explanation.
      // Looping back to the top would have every list enclosing this
      // one say "never closed" about the same exhausted file, once
      // per level of nesting.
      //
      // Nor past a word that starts a DECLARATION: `file()` is still
      // reading behind a property inside a world, and hunting for a
      // `]` would swallow every declaration after it. `[oak, enum]`
      // is still read as a list of two words, because
      // `atDeclarationStart` asks what FOLLOWS the word.
      if (p.done || p.atDeclarationStart()) return null;
      if (p.peek().at.start === before.at.start) p.next();
      separator(p, ']');
      missingComma = null;
      continue;
    }
    if (missingComma !== null) {
      p.diagnostics.refuse(
        missingComma,
        'A list needs a comma between its elements.',
        'Write `[oak, silver]`.',
      );
      missingComma = null;
    }
    if (elements.length >= p.caps.listElements) {
      if (!overCap) {
        p.diagnostics.refuse(
          element.at,
          `A list holds at most ${p.caps.listElements} things.`,
          'Take some out, or hold them somewhere that is not a list.',
        );
        overCap = true;
      }
    } else {
      elements.push(element);
    }
    if (separator(p, ']') === 'missing') missingComma = p.here();
  }
}

/**
 * Step over one written value without reading it. Only what can begin
 * a value is taken, so a property that ends where its default should
 * have been takes nothing and the separator after it stays where the
 * loop around this is waiting for it.
 */
export function skipValue(p: Parser): void {
  // A sign belongs to the value it stands before, whatever that is:
  // `-[1]` is one value written wrong, and a sign is never the start
  // of anything that could follow it.
  while (p.at('punct', '-')) p.next();
  if (p.at('punct', '[')) {
    p.next();
    skipBracketed(p, ']');
    return;
  }
  // A written number, `1.5` too: Sprout has no fractions, but an
  // author who wrote one wrote it as part of this property.
  if (p.peek().kind === 'integer') {
    p.next();
    if (p.at('punct', '.') && p.peek(1).kind === 'integer') {
      p.next();
      p.next();
    }
    return;
  }
  if (p.peek().kind === 'string') {
    p.next();
    return;
  }
  // An option, unless a colon after it makes it the name of the next
  // entry of a `:remembers`, or it is the `min` or `max` that goes on
  // with the property's tail.
  const word = p.peek();
  if (
    word.kind === 'name' &&
    word.text !== 'min' &&
    word.text !== 'max' &&
    !punct(p.peek(1), ':')
  ) {
    p.next();
  }
}
