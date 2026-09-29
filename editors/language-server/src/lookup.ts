import { positionOf, RESERVED_WORDS } from '@overstory/sprout/lang';

import {
  specifierOf,
  type Declared,
  type DeclaredAs,
  type DeclarationIndex,
} from './declarations.js';

// What the name under the cursor declares, and what may be written where
// the cursor is, following the spec's Imports: `sprout.Container` is a
// member of the namespace the file imports as `sprout`, and `Guard` in a
// file that imports `Ward as Guard` is that `Ward`. A dot after anything
// else is an object path, and its last name is read as a bare name. A
// bare name no import names is the world's own where the world declares
// it, and a library's where it does not: a name in a body may resolve
// from where the instance sits without an import, and one that needed an
// import is refused by the check, in words, beside the hover. `:lit` is a
// property, a memory, an option or a message. Every declaration a name could mean is offered, since a
// property is declared once in each kind that has it.

/** The name written around an offset. */
export interface Word {
  readonly text: string;
  /** What is written before it and a dot, `sprout` in `sprout.Container`. */
  readonly qualifier: string | null;
  /** Whether it was written after `:`, as a property or a message is. */
  readonly symbol: boolean;
  /** Where it starts and ends, as offsets into the text. */
  readonly start: number;
  readonly end: number;
}

const NAME = /[A-Za-z0-9_]/;

/** The name written at `offset`, or null where the cursor is not on one. */
export function wordAt(text: string, offset: number): Word | null {
  let start = offset;
  while (start > 0 && NAME.test(text[start - 1]!)) start--;
  let end = offset;
  while (end < text.length && NAME.test(text[end]!)) end++;
  if (start === end) return null;
  return { text: text.slice(start, end), ...before(text, start), start, end };
}

/** What is written before a name starting at `start`: a qualifier and its dot, or a colon. */
function before(text: string, start: number): { qualifier: string | null; symbol: boolean } {
  if (text[start - 1] === ':') return { qualifier: null, symbol: true };
  if (text[start - 1] !== '.') return { qualifier: null, symbol: false };
  const qualifier = /([A-Za-z_][A-Za-z0-9_]*)\.$/.exec(text.slice(0, start));
  return { qualifier: qualifier?.[1] ?? null, symbol: false };
}

const SYMBOLS: ReadonlySet<DeclaredAs> = new Set(['property', 'memory', 'option', 'message']);

/** Every declaration `word`, written in the file `file`, could name; the world's own first. */
export function declarationsNamed(index: DeclarationIndex, file: string, word: Word): Declared[] {
  const imported = index.imports.find(
    (one) =>
      one.file === file &&
      one.local === (word.qualifier ?? word.text) &&
      (one.name === null) === (word.qualifier !== null) &&
      one.message === (word.symbol && word.qualifier === null),
  );
  // A dot after anything but an imported namespace is an object path, and its last name a bare name.
  if (imported !== undefined) {
    const { from } = imported;
    const name = imported.name ?? word.text;
    return index.declared.filter(
      (one) => one.owner === null && one.name === name && specifierOf(one) === from,
    );
  }
  const named = index.declared.filter(
    (one) => one.name === word.text && (!word.symbol || SYMBOLS.has(one.as)),
  );
  const own = named.filter((one) => one.library === null);
  return own.length > 0 ? own : named;
}

/** The hover for `word`: each declaration it could name, as its head is written, and where. */
export function hoverOf(index: DeclarationIndex, file: string, word: Word): string | null {
  const found = declarationsNamed(index, file, word);
  if (found.length === 0) return null;
  return found
    .map((one) => {
      const { line } = positionOf(one.at);
      const owner = one.owner === null ? '' : ` of \`${one.owner}\``;
      const from = one.library === null ? '' : ` in the \`${one.library}\` library`;
      return `\`\`\`sprout\n${one.head}\n\`\`\`\n${one.as}${owner}${from}, ${one.at.source.name}:${line}`;
    })
    .join('\n\n---\n\n');
}

/** Where `word` is declared in the world's own files; a library's files are not on disk. */
export function definitionsOf(index: DeclarationIndex, file: string, word: Word): Declared[] {
  return declarationsNamed(index, file, word).filter((one) => one.library === null);
}

/** One thing that may be written at the cursor. */
export interface Completion {
  readonly label: string;
  readonly as: DeclaredAs | 'keyword';
  readonly detail: string;
}

/**
 * What may be written where `prefix`, the text of the line up to the
 * cursor in the file `file`, leaves off: after an imported namespace and
 * its dot, what it declares at its top level; after an object path's dot,
 * every declared name; after `:`, properties, memories, options and
 * messages; otherwise every declared name and the reserved words.
 */
export function completionsAt(index: DeclarationIndex, file: string, prefix: string): Completion[] {
  const qualified = /([A-Za-z_][A-Za-z0-9_]*)\.[A-Za-z0-9_]*$/.exec(prefix);
  const symbol = /:[A-Za-z0-9_]*$/.test(prefix);
  const namespace =
    qualified === null
      ? null
      : (index.imports.find(
          (one) => one.file === file && one.name === null && one.local === qualified[1],
        )?.from ?? null);
  const offered = index.declared.filter((one) =>
    namespace !== null
      ? one.owner === null && specifierOf(one) === namespace
      : symbol
        ? SYMBOLS.has(one.as)
        : one.library === null || one.owner === null,
  );
  const seen = new Set<string>();
  const out: Completion[] = [];
  for (const one of offered) {
    const key = `${one.as} ${one.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const owner = one.owner === null ? '' : ` of ${one.owner}`;
    out.push({ label: one.name, as: one.as, detail: `${one.as}${owner}` });
  }
  if (qualified === null && !symbol)
    for (const word of [...RESERVED_WORDS].sort())
      out.push({ label: word, as: 'keyword', detail: 'reserved word' });
  return out;
}
