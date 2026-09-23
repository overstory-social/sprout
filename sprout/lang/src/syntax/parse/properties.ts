// A property as a kind or an object writes one, `:wear 0 min 0 max 99`,
// and the entries of a `:remembers` (the spec's Properties › Declaring a
// property, Per-actor memory). Both read what follows the name through
// one path, so the two places cannot disagree about what a property is.

import type {
  Ident,
  IntegerLiteral,
  Literal,
  NamedType,
  OptionLiteral,
  PropertyDeclaration,
  RemembersDeclaration,
} from '../ast.js';
import type { Token } from '../lexer.js';
import { spanning, type Span } from '../../source/source.js';
import { punct, type Parser } from './parser.js';
import { readable } from '../../source/words.js';
import { separator, stepPast } from './recovery.js';
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
      `A property starts with its name, and ${p.describe(p.peek())} is not one.`,
      'Write `:wear 0`, with a colon before the name.',
    );
    return null;
  }
  return propertyBody(p, p.ident(symbol), symbol.at);
}

/** `:remembers [handled: false, visits: 0 min 0 max 99]` */
export function remembers(p: Parser): RemembersDeclaration | null {
  const symbol = p.take('symbol');
  if (symbol === null || symbol.text !== 'remembers') {
    p.diagnostics.refuse(
      (symbol ?? p.peek()).at,
      'This is not a `:remembers`.',
      'Write `:remembers [visits: 0]`.',
    );
    return null;
  }
  if (p.take('punct', '[') === null) {
    p.diagnostics.refuse(
      p.here(),
      'What an object remembers goes in brackets.',
      'Write `:remembers [handled: false, visits: 0 min 0 max 99]`.',
    );
    return null;
  }

  p.withinEntries = true;
  try {
    return entries(p, symbol);
  } finally {
    p.withinEntries = false;
  }
}

/** The entries of a `:remembers`, its `[` already taken, through the `]` that closes it. */
function entries(p: Parser, symbol: Token): RemembersDeclaration | null {
  const properties: PropertyDeclaration[] = [];
  let missingComma: Span | null = null;
  for (;;) {
    const close = p.take('punct', ']');
    if (close !== null) {
      entriesAfterClose(p);
      return { kind: 'remembers', at: spanning(symbol.at, close.at), properties };
    }
    if (p.done || p.atDeclarationStart()) {
      // As in `listLiteral`: a word that starts a declaration ends the
      // hunt, because otherwise it runs to the end of the file.
      p.diagnostics.refuse(
        p.done ? p.source.endSpan : p.peek().at,
        'This `:remembers` is never closed.',
        'Add a ] after what it remembers.',
      );
      return null;
    }

    const declared = rememberedProperty(p);
    if (declared === null) {
      // As in `listLiteral`, including that a file which ran out inside
      // the entry has already been explained by whatever read it, and
      // that a word starting a declaration ends the hunt.
      if (p.done || p.atDeclarationStart()) return null;
      recoverToEntry(p);
      separator(p, ']');
      missingComma = null;
      continue;
    }
    if (missingComma !== null) {
      p.diagnostics.refuse(
        missingComma,
        'A `:remembers` needs a comma between what it remembers.',
        'Write `:remembers [handled: false, visits: 0]`.',
      );
      missingComma = null;
    }
    properties.push(declared);
    if (separator(p, ']') === 'missing') missingComma = p.here();
  }
}

/**
 * Step over what is left of an entry that could not be read, to its own
 * comma or the list's closing `]` at depth zero, by `stepPast`, so a
 * bracket the entry wrote correctly is never taken for the list's own.
 */
function recoverToEntry(p: Parser): void {
  while (!p.done) {
    const token = p.peek();
    if (punct(token, ',') || punct(token, ']') || p.atRecoveryStop()) return;
    stepPast(p);
  }
}

/**
 * Entries written after the `]` that ends a `:remembers`, as a stray
 * `]` leaves them: `[visits: 0 min ], walks: 1]`. The first `]` is
 * taken as the end, since nothing before it can tell a stray closer
 * from its own; every entry after it is named, so none is lost in
 * silence, and where a `]` of their own closes them they are stepped
 * over through it, so what reads next is not handed the same mistake.
 */
function entriesAfterClose(p: Parser): void {
  const names: Token[] = [];
  let depth = 0;
  let closed = 0;
  let before: Token | null = null;
  for (let ahead = 0; ; ahead++) {
    const token = p.peek(ahead);
    // Where a member, a brace, the file's end or a declaration comes
    // first, the entries are not stepped over: what follows is someone
    // else's. A declaration is asked about loosely, as recovery asks,
    // because a false yes costs only the naming while a false no takes
    // a declaration's header for entries and swallows it; the one word
    // spared is an entry's own name, after a comma and before a colon,
    // as in `], world: 1]`.
    const entryName = before !== null && punct(before, ',') && punct(p.peek(ahead + 1), ':');
    if (
      token.kind === 'end' ||
      token.kind === 'symbol' ||
      punct(token, '{') ||
      punct(token, '}') ||
      (!entryName && p.atRecoveryStop(ahead))
    ) {
      break;
    }
    if (punct(token, '[')) {
      depth += 1;
    } else if (punct(token, ']')) {
      if (depth === 0) {
        closed = ahead + 1;
        break;
      }
      depth -= 1;
    } else if (depth === 0 && token.kind === 'name' && entryName) {
      names.push(token);
    }
    before = token;
  }
  if (names.length === 0) return;
  p.diagnostics.refuse(
    names[0]!.at,
    `${readable(names.map((name) => name.text))} ${names.length === 1 ? 'is' : 'are'} written after the \`]\` that ends this \`:remembers\`.`,
    'Everything it remembers goes inside its brackets. Take out the `]` that ends it too early.',
  );
  for (let i = 0; i < closed; i++) p.next();
}

/** `visits: 0 min 0 max 99` — one entry of a `:remembers`. */
function rememberedProperty(p: Parser): PropertyDeclaration | null {
  const named = p.take('name');
  if (named === null) {
    p.diagnostics.refuse(
      p.peek().at,
      `A remembered property starts with its name, and ${p.describe(p.peek())} is not one.`,
      'Write `visits: 0`, with the name first and no colon before it.',
    );
    return null;
  }
  if (p.take('punct', ':') === null) {
    p.diagnostics.refuse(
      p.here(),
      `\`${named.text}\` needs a colon between its name and its value.`,
      `Write \`${named.text}: 0\`.`,
    );
    return null;
  }
  return propertyBody(p, p.ident(named), named.at);
}

/**
 * Refuses a value that is missing exactly where the next declaration's
 * word stands, before it can be taken for a bare option. Left unchecked,
 * `:faulty` with nothing after it and `message :omega` on the next line
 * would read `message` as `:faulty`'s value and lose the declaration
 * with it — the parser's invariant that a defect in one item never
 * loses a well-formed neighbour in silence. True where it refused.
 */
function missingValueBeforeDeclaration(p: Parser, name: Ident): boolean {
  if (!p.atDeclarationStart()) return false;
  p.diagnostics.refuse(
    p.here(),
    `\`:${name.text}\` has no value where one should be.`,
    'Write an option of the type, or a literal, before the next declaration.',
  );
  return true;
}

/**
 * What follows a property's name, in either place it can be written:
 * an optional type, then a default, then an optional integer range.
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
