// `.prose` files, and the member that points at one (the spec's Prose ›
// Passages; The world model › Files). A kind writes `prose
// "mirror.prose"` so a reader of the kind can see that it has words and
// where they are, and the file holds nothing but passages, each read as a
// passage written in the kind's own braces is. Which file a name reaches,
// and whose passages they become, is the bundle's to say.

import type { PassageDeclaration, ProseFileDeclaration } from '../ast.js';
import type { Token } from '../lexer.js';
import { spanning } from '../../source/source.js';
import type { Parser } from './parser.js';
import { passage } from './passages.js';

/** The ending a `.prose` file's name has. */
export const PROSE_FILE = '.prose';

/**
 * `prose "mirror.prose"`, or null having said what to write. What is
 * written in its place is left to be read as whatever it is.
 */
export function proseFile(p: Parser): ProseFileDeclaration | null {
  const keyword = p.next();
  const named = p.peek();
  if (named.kind !== 'string') {
    p.diagnostics.refuse(
      p.source.span(keyword.at.end),
      '`prose` names the file its passages are in, in quotes.',
      'Write `prose "mirror.prose"`, naming a `.prose` file of this world.',
    );
    return null;
  }
  p.next();
  if (!named.text.endsWith(PROSE_FILE) || named.text.length === PROSE_FILE.length) {
    p.diagnostics.refuse(
      named.at,
      `\`prose\` names a \`${PROSE_FILE}\` file, and "${named.text}" is not one.`,
      'Write the file’s whole name, as in `prose "mirror.prose"`.',
    );
    return null;
  }
  return {
    kind: 'prose-file',
    at: spanning(keyword.at, named.at),
    file: { kind: 'string', at: named.at, value: named.text },
  };
}

/**
 * Every passage in a `.prose` file. Anything else written there is
 * refused once and stepped over to the next `passage`, so the passages
 * after it are still read.
 */
export function proseFileBody(p: Parser): PassageDeclaration[] {
  const readers = new Map<string, () => PassageDeclaration | null>();
  readers.set('passage', () => passage(p, readers));
  const passages: PassageDeclaration[] = [];
  while (!p.done) {
    if (atPassage(p.peek())) {
      p.tooDeepReported = false;
      const read = passage(p, readers);
      if (read !== null) passages.push(read);
      continue;
    }
    p.diagnostics.refuse(
      p.peek().at,
      'A `.prose` file holds passages, and nothing else.',
      'Write each as `passage greeting { … }`. What a kind is made of belongs in its `.sprout` file.',
    );
    p.next();
    while (!p.done && !atPassage(p.peek())) p.next();
  }
  return passages;
}

function atPassage(token: Token): boolean {
  return token.kind === 'name' && token.text === 'passage';
}
