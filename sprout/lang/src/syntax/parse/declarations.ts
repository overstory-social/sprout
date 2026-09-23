// A file, and the declarations it holds: `enum`, `kind`, `message`,
// `verb` and `world` (the spec's Properties › Enums, Kinds › Declaring
// and composing, Events › Declaring a message, Verbs › Declaring a verb,
// The world model). `DECLARATION_READERS` is the one table of the words
// a declaration starts with; `object` is among them so an object written
// at the top level is read whole and refused there, never skipped.

import type { Declaration, EnumDeclaration, EnumOption, MessageDeclaration } from '../ast.js';
import { isReserved } from '../reserved.js';
import { spanning, type Span } from '../../source/source.js';
import type { DeclarationReader, Parser } from './parser.js';
import { readable } from '../../source/words.js';
import { recover, recoverInBraces, separator } from './recovery.js';
import { typeExpr } from './types.js';
import { isGuardName } from './guards.js';
import { kindDeclaration, topLevelObject } from './kinds.js';
import { verbDeclaration } from './verbs.js';
import { worldDeclaration } from './world.js';

/** Every declaration in the file, in the order they were written. */
export function file(p: Parser): Declaration[] {
  const declarations: Declaration[] = [];
  while (!p.done) {
    const token = p.peek();
    const read = token.kind === 'name' ? p.readers.get(token.text) : undefined;
    if (read !== undefined) {
      // Each declaration is owed its own account of being too deep.
      p.tooDeepReported = false;
      const declared = read(p);
      if (declared !== null) declarations.push(declared);
      continue;
    }
    if (token.kind === 'name' && token.text === 'passage') {
      p.diagnostics.refuse(
        token.at,
        'A passage belongs to a kind, an object or the world, and is written inside its braces.',
        'Move it into the body of the one whose words these are, as in `kind Mirror { passage greeting { … } }`.',
      );
      p.next();
      recover(p);
      continue;
    }
    if (token.kind === 'name' && isGuardName(token.text)) {
      p.diagnostics.refuse(
        token.at,
        `\`${token.text}\` belongs to a kind, an object or the world, and is written inside its braces.`,
        `Move it into the body of the one it speaks for, as in \`kind Crate { accept (item, from) { … } }\`.`,
      );
      p.next();
      recover(p);
      continue;
    }
    p.diagnostics.refuse(
      token.at,
      `Sprout does not know what to do with "${token.text}" here.`,
      `A file holds declarations, and this compiler reads ${readable([...p.readers.keys()])}.`,
    );
    p.next();
    recover(p);
  }
  return declarations;
}

/** `enum Ward { oak, silver }` */
function enumDeclaration(p: Parser): EnumDeclaration | null {
  const keyword = p.next();

  const named = p.take('kind');
  if (named === null) {
    p.diagnostics.refuse(
      p.at('punct', '{') ? p.here() : p.peek().at,
      'An enum needs a name.',
      'A name for an enum starts with a capital: `enum Ward { oak, silver }`.',
    );
    recover(p);
    return null;
  }
  const name = p.ident(named);

  if (p.take('punct', '{') === null) {
    p.diagnostics.refuse(
      p.here(),
      `The options of \`${name.text}\` go in braces.`,
      `Write \`enum ${name.text} { oak, silver }\`, listing the values it can hold.`,
    );
    recover(p);
    return null;
  }

  const unclosed = (at: Span): void => {
    p.diagnostics.refuse(at, `\`${name.text}\` is never closed.`, 'Add a } after its options.');
  };

  const options: EnumOption[] = [];
  let refused = false;
  /** Where a comma should have been, held until the next option proves it was wanted. */
  let missingComma: Span | null = null;

  for (;;) {
    if (p.done) {
      unclosed(p.source.endSpan);
      refused = true;
      break;
    }
    if (p.at('punct', '}')) {
      p.next();
      break;
    }
    if (p.atDeclarationStart()) {
      unclosed(p.peek().at);
      refused = true;
      break;
    }

    const word = p.take('name');
    if (word === null) {
      const wrong = p.peek();
      p.diagnostics.refuse(
        wrong.at,
        `\`${name.text}\` cannot hold ${p.describe(wrong)}.`,
        'An option is a lower-case word: `oak`, `touch_dry`, `the_press`.',
      );
      // `recoverInBraces` gives up for two reasons: the file ran out,
      // or it found the next declaration and left it unconsumed. The
      // second has a token to point at, and pointing past it at the
      // end of the file names the wrong place.
      if (!recoverInBraces(p)) {
        unclosed(p.done ? p.source.endSpan : p.peek().at);
      }
      refused = true;
      break;
    }

    // A word read, so a separator really was wanted before it —
    // whether or not that word may stand as an option. A word the
    // author has to replace anyway is left out of what the remedy
    // offers to write.
    if (missingComma !== null) {
      const written = options.map((option) => option.name.text);
      if (!isReserved(word.text)) written.push(word.text);
      p.diagnostics.refuse(
        missingComma,
        `\`${name.text}\` needs a comma between its options.`,
        `Write \`enum ${name.text} { ${[...written, '…'].join(', ')} }\`.`,
      );
      missingComma = null;
    }

    if (isReserved(word.text)) {
      // A word of the language is still READ here, so the enum keeps
      // its other options and the declarations after it survive; it
      // is refused at the word and left out of the option set.
      p.diagnostics.refuse(
        word.at,
        `\`${word.text}\` is a word of the language, so it cannot be an option of \`${name.text}\`.`,
        'Choose another word for it.',
      );
      refused = true;
    } else {
      options.push({ kind: 'option', at: word.at, name: p.ident(word) });
    }

    // A comma after the LAST option is allowed, so the loop simply
    // reads on and finds the brace.
    if (separator(p, '}') === 'missing') missingComma = p.here();
  }

  if (options.length === 0) {
    // Whatever went wrong has already been named; saying the enum has
    // no options as well reports one mistake twice.
    if (refused) return null;
    p.diagnostics.refuse(
      name.at,
      `\`${name.text}\` has no options, so nothing could ever hold one.`,
      `Write the values it can take: \`enum ${name.text} { oak, silver }\`.`,
    );
    return null;
  }

  const last = options.at(-1)!;
  return { kind: 'enum', at: spanning(keyword.at, last.at), name, options };
}

/** `message :stir`, `message :illuminating with boolean` */
function messageDeclaration(p: Parser): MessageDeclaration | null {
  const keyword = p.next();
  const named = p.take('symbol');
  if (named === null) {
    p.diagnostics.refuse(
      p.peek().at,
      'A message needs a name.',
      "A message's name has a colon before it: `message :stir`.",
    );
    recover(p);
    return null;
  }
  const name = p.ident(named);
  if (p.take('name', 'with') === null) {
    return { kind: 'message', at: spanning(keyword.at, named.at), name, carries: null };
  }
  const carries = typeExpr(p);
  if (carries === null) {
    recover(p);
    return null;
  }
  return { kind: 'message', at: spanning(keyword.at, carries.at), name, carries };
}

/** Each declaration this compiler reads, and what reads it. */
export const DECLARATION_READERS: ReadonlyMap<string, DeclarationReader> = new Map<
  string,
  DeclarationReader
>([
  ['enum', enumDeclaration],
  ['kind', kindDeclaration],
  ['message', messageDeclaration],
  ['object', topLevelObject],
  ['verb', verbDeclaration],
  ['world', worldDeclaration],
]);
