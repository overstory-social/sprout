// The imports each of a world's files needs, worked out from what it
// writes (the spec's The world model › Imports): a name another of the
// world's files declares at its top level, from that file; one a library
// declares, from the library; and `sprout.` written anywhere, the library
// as a namespace. The generated skill's bench adds them to each example
// it compiles, and they are what an author would write by hand.

import type { LibrarySource } from './bundle.js';
import { engineMessage } from '../declare/engine-messages.js';
import { Diagnostics } from '../source/diagnostics.js';
import { nodesOf } from '../source/nodes.js';
import type { SourceFile } from '../source/source.js';
import type { Declaration, Ident } from '../syntax/ast.js';
import { parseDeclarations } from '../syntax/parse.js';
import { BUILT_IN_TYPE_WORDS } from '../syntax/parse/types.js';

/** A single quote, as an import's specifier is written between them. */
const Q = "'";

/** The name each top-level declaration goes by, a message by its colon. */
function namesOf(declared: readonly Declaration[]): string[] {
  return declared.flatMap((one) => {
    switch (one.kind) {
      case 'kind':
      case 'enum':
      case 'verb':
        return [one.name.text];
      case 'message':
        return [`:${one.name.text}`];
      default:
        return [];
    }
  });
}

/** Every name a file writes that an import could bring in, and each library it writes as `library.Name`. */
function written(declared: readonly Declaration[]): {
  names: Set<string>;
  namespaces: Set<string>;
} {
  const names = new Set<string>();
  const namespaces = new Set<string>();
  for (const node of nodesOf(declared)) {
    if (node.kind === 'kind-expr' || node.kind === 'named-type') {
      const { library, name } = node as unknown as { library: Ident | null; name: Ident };
      if (library !== null) namespaces.add(library.text);
      else if (library === null && !BUILT_IN_TYPE_WORDS.has(name.text)) names.add(name.text);
      continue;
    }
    for (const field of ['verb', 'message'] as const) {
      const one = (node as unknown as Record<string, unknown>)[field] as Ident | null | undefined;
      if (one === null || one === undefined || typeof one !== 'object') continue;
      if (field === 'message' && engineMessage(one.text) !== null) continue;
      names.add(field === 'message' ? `:${one.text}` : one.text);
    }
  }
  return { names, namespaces };
}

/**
 * The import lines each `.sprout` file among `files` needs to name what it
 * writes, by file name; a file that needs none is left out.
 */
export function neededImports(
  files: readonly SourceFile[],
  libraries: readonly LibrarySource[],
): Map<string, string[]> {
  const libraryNames = new Map<string, string>();
  for (const library of libraries) {
    for (const file of library.files) {
      for (const name of namesOf(parseDeclarations(file, new Diagnostics()))) {
        if (!libraryNames.has(name)) libraryNames.set(name, library.name);
      }
    }
  }
  const parsed = files
    .filter((file) => file.name.endsWith('.sprout'))
    .map((file) => ({ file, declared: parseDeclarations(file, new Diagnostics()) }));
  const where = new Map<string, string>();
  for (const { file, declared } of parsed) {
    for (const name of namesOf(declared)) {
      if (!where.has(name)) where.set(name, file.name.replace(/\.sprout$/, ''));
    }
  }
  const needed = new Map<string, string[]>();
  for (const { file, declared } of parsed) {
    const own = new Set(namesOf(declared));
    const imported = new Set(
      declared.flatMap((one) =>
        one.kind === 'import'
          ? [
              ...(one.names ?? []).map((item) => (item.alias ?? item.name).text),
              ...(one.namespace === null ? [] : [one.namespace.text]),
            ]
          : [],
      ),
    );
    const { names, namespaces } = written(declared);
    const lines: string[] = [];
    for (const library of namespaces) {
      if (!imported.has(library) && libraries.some((one) => one.name === library)) {
        lines.push(`import * as ${library} from ${Q}${library}${Q}`);
      }
    }
    const bySpecifier = new Map<string, string[]>();
    for (const name of names) {
      if (own.has(name) || imported.has(name.replace(/^:/, ''))) continue;
      const from = where.get(name) ?? libraryNames.get(name) ?? null;
      if (from === null) continue;
      bySpecifier.set(from, [...(bySpecifier.get(from) ?? []), name]);
    }
    for (const [from, names_] of bySpecifier) {
      lines.push(`import {${names_.join(', ')}} from ${Q}${from}${Q}`);
    }
    if (lines.length > 0) needed.set(file.name, lines);
  }
  return needed;
}
