// A property as a kind or an object writes one, `:wear 0 min 0 max 99`
// (the spec's Properties › Declaring a property). A `remembers` block
// reads each of its entries here too, so the two places cannot disagree
// about what a property is.

import type {
  Ident,
  IntegerLiteral,
  Literal,
  NamedType,
  OptionLiteral,
  PropertyDeclaration,
} from '../ast.js';
import { spanning, type Span } from '../../source/source.js';
import { punct, type Parser } from './parser.js';
import { atFraction, atType, BUILT_IN_TYPE_WORDS, literal, skipValue, typeExpr } from './types.js';

/** `Ward`, `sprout.Ward` — a named type as it was written. */
function spellNamedType(type: NamedType): string {
  return type.library === null ? type.name.text : `${type.library.text}.${type.name.text}`;
}

/** `:wear 0 min 0 max 99` — a property as a kind or an object writes one. */
export function property(p: Parser): PropertyDeclaration | null {
  const symbol = p.take('symbol');
  if (symbol === null) {
    p.diagnostics.refuse(
      p.peek().at,
      `A property starts with its name, and ${p.subject(p.peek(), false)} is not one.`,
      'Write `:wear 0`, with a colon before the name.',
    );
    return null;
  }
  return propertyBody(p, p.ident(symbol), symbol.at);
}

/**
 * Refuses a value that is missing exactly where the next declaration's
 * word stands, or a `remembers` block's, before it can be taken for a
 * bare option. Left unchecked, `:faulty` with nothing after it and
 * `message :omega` on the next line would read `message` as `:faulty`'s
 * value and lose the declaration with it — the parser's invariant that
 * a defect in one item never loses a well-formed neighbour in silence.
 * True where it refused.
 */
function missingValueBeforeDeclaration(p: Parser, name: Ident): boolean {
  const block = p.at('name', 'remembers') && punct(p.peek(1), '{');
  if (!block && !p.atDeclarationStart()) return false;
  p.diagnostics.refuse(
    p.here(),
    `\`:${name.text}\` has no value where one should be.`,
    `Write an option of the type, or a literal, before the next ${block ? '`remembers` block' : 'declaration'}.`,
  );
  return true;
}

/**
 * What follows a property's name: an optional type, then a default, then an optional integer range.
 * An enum and the option a property starts at may be written as one
 * instead — `:ward Ward.iron`, or `:ward sprout.Ward.iron` with the
 * enum's library (the spec's Properties › Declaring a property).
 */
function propertyBody(p: Parser, name: Ident, from: Span): PropertyDeclaration | null {
  const wantedType = atType(p);
  const type = wantedType ? typeExpr(p) : null;
  if (wantedType && type === null) {
    skipPropertyTail(p);
    return null;
  }

  let value: Literal | null = null;
  if (type !== null && p.at('punct', '.')) {
    const dot = p.next();
    // Only an enum has options, so a dot after anything else is a
    // default written the wrong way round.
    if (type.kind !== 'named-type' || BUILT_IN_TYPE_WORDS.has(type.name.text)) {
      p.diagnostics.refuse(
        dot.at,
        `\`:${name.text}\` writes a dot after a type that has no options.`,
        'Only an enum names its option after a dot, as in `:ward Ward.iron`. Write `default` and the value instead.',
      );
      return null;
    }
    value = qualifiedDefault(p, name, type);
    if (value === null) return null;
  } else if (type === null) {
    if (missingValueBeforeDeclaration(p, name)) return null;
    value = literal(p);
    if (value === null) return null;
  } else if (p.take('name', 'default') !== null) {
    if (missingValueBeforeDeclaration(p, name)) return null;
    value = literal(p);
    if (value === null) return null;
  } else {
    p.diagnostics.refuse(
      p.here(),
      `\`:${name.text}\` has a type and no value to start at.`,
      'Every instance starts at a default: write `default` and the value.',
    );
    return null;
  }

  let min: PropertyDeclaration['min'] = null;
  let max: PropertyDeclaration['max'] = null;
  for (;;) {
    const which = p.at('name', 'min') ? 'min' : p.at('name', 'max') ? 'max' : null;
    if (which === null) break;
    const word = p.next();
    // A refused bound costs the property, and the bounds written
    // after it are its own text, not a sibling to be read next.
    const bound = integerBound(p, which);
    if (bound === null) {
      skipPropertyTail(p);
      return null;
    }
    if ((which === 'min' ? min : max) !== null) {
      p.diagnostics.refuse(word.at, `\`:${name.text}\` says ${which} twice.`, 'Write it once.');
      skipPropertyTail(p);
      return null;
    }
    if (which === 'min') min = bound;
    else max = bound;
  }

  // Whichever part ends last, which is not always the max: `max 1 min 2`
  // is as legal as `min 2 max 1` and ends at the min.
  const parts = [value, min, max].filter((part) => part !== null);
  const end = parts.reduce((latest, part) => (part.at.end >= latest.at.end ? part : latest));
  return { kind: 'property', at: spanning(from, end.at), name, type, default: value, min, max };
}

/**
 * The option in `:ward Ward.iron`, the dot already read: the enum and
 * the option the property starts at, written as one. That spelling IS
 * the default, so no `default` may follow it.
 */
function qualifiedDefault(p: Parser, name: Ident, type: NamedType): OptionLiteral | null {
  if (missingValueBeforeDeclaration(p, name)) return null;
  const word = p.take('name');
  if (word === null) {
    const wrong = p.peek();
    p.diagnostics.refuse(
      wrong.at,
      `\`${spellNamedType(type)}.\` cannot name ${p.describe(wrong)}.`,
      'An option is a lower-case word, as in `:ward Ward.iron`.',
    );
    return null;
  }
  const option: OptionLiteral = { kind: 'option-literal', at: word.at, name: p.ident(word) };
  const again = p.take('name', 'default');
  if (again !== null) {
    p.diagnostics.refuse(
      again.at,
      `\`:${name.text}\` says its default twice.`,
      `\`${spellNamedType(type)}.${option.name.text}\` already says what it starts at. Remove the \`default\` after it.`,
    );
    return null;
  }
  return option;
}

/**
 * The whole number after a `min` or a `max`, sign and all; the spec's
 * Properties › Declaring a property gives a range as integers. Anything
 * else is refused at the token it starts with, whatever is wrong inside
 * it, and stepped over as one value, so a closer after the bound is
 * left for the loop that is waiting for it.
 */
function integerBound(p: Parser, which: 'min' | 'max'): IntegerLiteral | null {
  const start = p.peek();
  const sign = punct(start, '-') && p.peek(1).kind === 'integer' ? p.next() : null;
  const digits = p.take('integer');
  if (digits === null) {
    p.diagnostics.refuse(
      start.at,
      `A ${which} is a whole number.`,
      `Write \`${which} 0\`, or leave it out.`,
    );
    skipValue(p);
    return null;
  }
  // `min 1.5` is told there are no fractions, which says more than
  // that a min is a whole number.
  if (atFraction(p)) return null;
  const value = Number(digits.text);
  return {
    kind: 'integer',
    at: spanning((sign ?? digits).at, digits.at),
    value: sign === null ? value : -value,
  };
}

/**
 * Step over the rest of a property whose type could not be read: its
 * default and its bounds, which are the abandoned property's own text
 * and not a sibling. Left in the stream they are read as something
 * else, and the author is told about a mistake they did not make.
 */
function skipPropertyTail(p: Parser): void {
  if (p.take('name', 'default') !== null) skipValue(p);
  while (p.at('name', 'min') || p.at('name', 'max')) {
    p.next();
    skipValue(p);
  }
}
