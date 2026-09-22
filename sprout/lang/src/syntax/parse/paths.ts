// A path to an object: `composing_room`, `kiln.shelf` (the spec's Verbs ›
// Places inside places, Names › Identifiers and scope). An object's `in`
// and a world's `visitors arrive at` are read through it, and an exit's
// destination will be. What is recorded is what was written; which
// object it reaches is `declare/tree.ts`'s to say.
//
// A path is written without spaces around its dots, the way `sprout.Ward`
// is, so a dot standing apart from its names is refused rather than
// guessed at.

import type { Ident, ObjectPath } from '../ast.js';
import type { Token } from '../lexer.js';
import { spanning } from '../../source/source.js';
import { punct, type Parser } from './parser.js';

/** What a remedy offers as a path, for someone who has not seen one. */
const EXAMPLE = '`kiln.shelf`';

/**
 * The rest of a path whose first name, `head`, the caller has taken:
 * each `.name` after it. Null having said why where a step is missing or
 * is not a name; every step is still read, so one path is one account.
 */
export function objectPath(p: Parser, head: Token): ObjectPath | null {
  const parts: Ident[] = [p.ident(head)];
  let last: Token = head;
  let refused = false;
  const written = (): string => parts.map((part) => part.text).join('.');

  while (p.at('punct', '.')) {
    const dot = p.next();
    const next = p.peek();

    // A word that starts the next declaration is not a step of this
    // path: `in kiln.` and then `object shelf: …` is a dot left over,
    // and the object after it is the file's.
    if (next.kind === 'name' && !p.atDeclarationStart()) {
      p.next();
      if (dot.at.start !== last.at.end || next.at.start !== dot.at.end) {
        p.diagnostics.refuse(
          spanning(last.at, next.at),
          'A path is written without spaces around its dots.',
          `Write \`${written()}.${next.text}\`.`,
        );
        refused = true;
      }
      parts.push(p.ident(next));
      last = next;
      continue;
    }

    if (next.kind === 'kind' || next.kind === 'integer') {
      p.next();
      p.diagnostics.refuse(
        next.at,
        next.kind === 'kind'
          ? `\`${next.text}\` starts with a capital, so it is not the name of anything in \`${written()}\`.`
          : `\`${next.text}\` is a number, not the name of anything in \`${written()}\`.`,
        `After a dot comes the name of what is inside the thing before it, in lower case, as in ${EXAMPLE}.`,
      );
      refused = true;
      last = next;
      continue;
    }

    if (punct(next, '.')) {
      // The loop takes the second dot next, and reads on from there.
      p.diagnostics.refuse(
        next.at,
        'Two dots in a row leave a name out.',
        `Write one name between each pair of dots, as in ${EXAMPLE}.`,
      );
      refused = true;
      last = dot;
      continue;
    }

    p.diagnostics.refuse(
      dot.at,
      'This path ends in a dot.',
      `After a dot comes the name of what is inside the thing before it, as in ${EXAMPLE}; or take the dot out.`,
    );
    return null;
  }

  if (refused) return null;
  return { kind: 'path', at: spanning(head.at, last.at), parts };
}
