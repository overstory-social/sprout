// What a file writes of an extension, read (the spec's Extensions ›
// Activation and absence, What an extension may add): `extension media 2`
// at its top, naming one the world pins and its major version, and, in a
// body, `media.show(…)`, a statement of one the file names. A name the
// file names at its top starts an extension's statement wherever a
// statement starts, so `media.` there is never a binding's.

import type { ExtensionStatement, ExtensionUse } from '../ast-extensions.js';
import { isReserved } from '../reserved.js';
import { spanning } from '../../source/source.js';
import { expression } from './expressions.js';
import { punct, type Parser } from './parser.js';
import { firstOnItsLine } from './statements.js';

/**
 * The names the language binds in a body, which would read as the
 * extension's rather than the binding's where a file named one.
 */
const BOUND: ReadonlySet<string> = new Set(['self', 'actor', 'here', 'mover', 'elapsed']);

const USE_EXAMPLE =
  'Write the extension and the major version the manifest pins, as in `extension media 2`.';

/**
 * `extension media 2`, where `first` says nothing but other such lines
 * came before it in the file. Null having said why it is not one.
 */
export function extensionUse(p: Parser, first: boolean): ExtensionUse | null {
  const keyword = p.next();
  if (!first) {
    p.diagnostics.refuse(
      keyword.at,
      '`extension` belongs at the top of the file, before anything it declares.',
      'Move this line above the first declaration.',
    );
    restOfLine(p);
    return null;
  }
  const named = p.peek();
  if (named.kind === 'end' || firstOnItsLine(p, named)) {
    p.diagnostics.refuse(
      p.source.span(keyword.at.end),
      '`extension` does not say which extension.',
      USE_EXAMPLE,
    );
    return null;
  }
  if (named.kind !== 'name' || isReserved(named.text) || BOUND.has(named.text)) {
    p.diagnostics.refuse(
      named.at,
      named.kind === 'kind'
        ? `An extension's name is lower-case, and \`${named.text}\` starts with a capital.`
        : named.kind !== 'name'
          ? '`extension` does not say which extension.'
          : BOUND.has(named.text)
            ? `\`${named.text}\` is a name the language binds, so it cannot name an extension.`
            : `\`${named.text}\` is a word of the language, so it cannot name an extension.`,
      USE_EXAMPLE,
    );
    restOfLine(p);
    return null;
  }
  p.next();
  const major = p.peek();
  if (major.kind !== 'integer') {
    p.diagnostics.refuse(
      major.kind === 'end' || firstOnItsLine(p, major) ? p.source.span(named.at.end) : major.at,
      `\`extension ${named.text}\` does not say which major version.`,
      USE_EXAMPLE,
    );
    restOfLine(p);
    return null;
  }
  p.next();
  p.extensions.add(named.text);
  return {
    kind: 'extension-use',
    at: spanning(keyword.at, major.at),
    name: p.ident(named),
    major: { kind: 'integer', at: major.at, value: Number(major.text) },
  };
}

/** Step over what is left of a refused `extension` line, so the next line reads on its own. */
function restOfLine(p: Parser): void {
  while (!p.done && !firstOnItsLine(p, p.peek())) p.next();
}

/** Whether a statement of an extension the file names starts here: its name, then a dot. */
export function atExtensionStatement(p: Parser): boolean {
  const token = p.peek();
  return token.kind === 'name' && p.extensions.has(token.text) && punct(p.peek(1), '.');
}

/** `media.show(…)`: the extension, the statement's name, and its arguments. Null having said why. */
export function extensionStatement(p: Parser): ExtensionStatement | null {
  const read = expression(p);
  if (read === null) return null;
  if (read.kind === 'call' && read.receiver.kind === 'binding') {
    return {
      kind: 'extension-statement',
      at: read.at,
      extension: read.receiver.name,
      name: read.method,
      arguments: read.arguments,
    };
  }
  const extension = p.source.text.slice(read.at.start, read.at.end).split('.')[0]!;
  p.diagnostics.refuse(
    read.at,
    `A statement of the extension \`${extension}\` is its name and its arguments in brackets.`,
    `Write it as \`${extension}.<statement>(…)\`, as in \`${extension}.show(self.get(:image))\`.`,
  );
  return null;
}
