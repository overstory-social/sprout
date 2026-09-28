// A file's `import` lines, read (the spec's The world model › Imports):
// names brought in from a file, `import {Key, Ward as Guard, :stir}` from
// the specifier `blacksmith/key`, or all of a library under a namespace,
// `import * as sprout` from `sprout`, each at the top of the file beside
// its `extension` lines and before anything it declares. What each specifier reaches, and
// whether it declares what is named, is the bundle's to say.

import type { ImportDeclaration, ImportedName } from '../ast-imports.js';
import type { Token } from '../lexer.js';
import { isReserved } from '../reserved.js';
import { spanning, type Span } from '../../source/source.js';
import type { Parser } from './parser.js';
import { firstOnItsLine } from './statements.js';
import { restOfLine } from './extensions.js';

/** A single quote, as a specifier is written between them. */
const Q = "'";

const EXAMPLE = `Write \`import {Key} from ${Q}blacksmith/key${Q}\`, or \`import * as sprout from ${Q}sprout${Q}\` for all of a library.`;

/**
 * `import …`, where `first` says nothing but `extension` and `import` lines
 * came before it in the file. Null having said why it is not one.
 */
export function importDeclaration(p: Parser, first: boolean): ImportDeclaration | null {
  const keyword = p.next();
  if (!first) {
    p.diagnostics.refuse(
      keyword.at,
      '`import` belongs at the top of the file, before anything it declares.',
      'Move this line above the first declaration.',
    );
    restOfLine(p);
    return null;
  }
  let names: ImportedName[] | null = null;
  let namespace = null;
  if (p.at('punct', '*')) {
    p.next();
    const alias = p.take('name', 'as') === null ? null : takeName(p);
    if (alias === null || alias.kind !== 'name') {
      return refused(
        p,
        keyword.at,
        'A namespace import names the namespace after `as`.',
        `Write \`import * as sprout from ${Q}sprout${Q}\`.`,
      );
    }
    namespace = p.ident(alias);
  } else if (p.take('punct', '{') !== null) {
    names = [];
    while (!p.at('punct', '}')) {
      const item = importedName(p);
      if (item === null)
        return refused(
          p,
          keyword.at,
          'An import lists the names it brings in, between braces.',
          EXAMPLE,
        );
      names.push(item);
      if (p.take('punct', ',') === null) break;
    }
    if (p.take('punct', '}') === null) {
      return refused(
        p,
        keyword.at,
        'The names this import brings in are never closed.',
        'Add a } after the last of them.',
      );
    }
    if (names.length === 0) {
      return refused(p, keyword.at, 'This import brings in nothing.', EXAMPLE);
    }
  } else {
    return refused(p, keyword.at, '`import` does not say what it brings in.', EXAMPLE);
  }
  if (p.take('name', 'from') === null) {
    return refused(p, keyword.at, '`import` does not say where from.', EXAMPLE);
  }
  const from = p.peek();
  if (from.kind !== 'string' || from.text.trim() === '' || firstOnItsLine(p, from)) {
    return refused(p, keyword.at, 'An import names where it is from in quotes.', EXAMPLE);
  }
  p.next();
  return {
    kind: 'import',
    at: spanning(keyword.at, from.at),
    names,
    namespace,
    from: { kind: 'ident', at: from.at, text: from.text },
  };
}

/** `Key`, `take`, `:stir`, each with an optional `as` and its name here. */
function importedName(p: Parser): ImportedName | null {
  const named = takeName(p);
  if (named === null) return null;
  const message = named.kind === 'symbol';
  let alias = null;
  if (p.take('name', 'as') !== null) {
    const written = takeName(p);
    if (written === null || (written.kind === 'symbol') !== message) return null;
    alias = p.ident(written);
  }
  return {
    kind: 'imported-name',
    at: alias === null ? named.at : spanning(named.at, alias.at),
    name: p.ident(named),
    message,
    alias,
  };
}

/** A name that may be imported: a kind, a lower-case word that is not the language's, or a message. */
function takeName(p: Parser): Token | null {
  const token = p.peek();
  if (token.kind === 'kind' || token.kind === 'symbol') return p.next();
  if (token.kind === 'name' && !isReserved(token.text)) return p.next();
  return null;
}

/** Refuse at `at`, step over the rest of the line, and give nothing. */
function refused(p: Parser, at: Span, message: string, remedy: string): null {
  p.diagnostics.refuse(at, message, remedy);
  restOfLine(p);
  return null;
}
