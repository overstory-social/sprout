// A file's names as its imports mean them (the spec's The world model ›
// Imports). A name brought in under `as`, one brought in from a library,
// and a member of a namespace are rewritten to the declaration each names,
// keeping where it was written, so whatever reads the file afterwards
// reads what the import means. Reading a file applies its imports
// from libraries before it checks the file; the bundle applies the rest.

import type { Declaration, Ident, ObjectDeclaration } from '../../syntax/ast.js';
import type { ImportDeclaration } from '../../syntax/ast-imports.js';

/** What one imported name reaches, and what it is called there. */
export interface Target {
  readonly library: string;
  readonly name: string;
  /** Whether it is a library's, and so written with its library wherever it is named. */
  readonly fromLibrary: boolean;
  /** The object it is, where it is one written at a file's top level. */
  readonly object: ObjectDeclaration | null;
}

/** What one file may name through its imports. */
export interface FileScope {
  /** By the name it goes by here. */
  readonly names: Map<string, Target>;
  /** Each namespace, by its name here, and the library its members are read in. */
  readonly namespaces: Map<string, string>;
}

/**
 * What `declared`, one file, may name through its imports of `libraries`,
 * read as written and unchecked: the bundle checks every import.
 */
export function libraryScope(
  declared: readonly Declaration[],
  libraries: ReadonlySet<string>,
): FileScope {
  const scope: FileScope = { names: new Map(), namespaces: new Map() };
  for (const one of declared) {
    if (one.kind !== 'import' || !libraries.has(one.from.text)) continue;
    const imported: ImportDeclaration = one;
    if (imported.namespace !== null) {
      scope.namespaces.set(imported.namespace.text, imported.from.text);
      continue;
    }
    for (const item of imported.names ?? []) {
      scope.names.set((item.alias ?? item.name).text, {
        library: imported.from.text,
        name: item.name.text,
        fromLibrary: true,
        object: null,
      });
    }
  }
  return scope;
}

/** A plain object or an array: what an AST is made of, and all a rewrite walks into. */
function isTree(value: unknown): value is Record<string, unknown> | unknown[] {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return true;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * `declared` with each name it writes that `scope` renames rewritten to
 * the one it means, keeping where it was written. A node that changes
 * nothing is kept as it is.
 */
export function rewrite<T>(declared: T, scope: FileScope): T {
  if (scope.names.size === 0 && scope.namespaces.size === 0) return declared;
  const walk = (value: unknown): unknown => {
    if (!isTree(value)) return value;
    if (Array.isArray(value)) {
      const mapped = value.map(walk);
      return mapped.every((one, i) => one === value[i]) ? value : mapped;
    }
    const node = renamed(value, scope);
    let changed = node !== value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node)) {
      const next = key === 'at' ? child : walk(child);
      if (next !== child) changed = true;
      out[key] = next;
    }
    return changed ? out : value;
  };
  return walk(declared) as T;
}

/** One node with the name it writes rewritten, where `scope` renames it. */
function renamed(node: Record<string, unknown>, scope: FileScope): Record<string, unknown> {
  const kind = node['kind'];
  if (kind === 'kind-expr' || kind === 'named-type') {
    const library = node['library'] as Ident | null;
    const name = node['name'] as Ident;
    if (library !== null) {
      const read = scope.namespaces.get(library.text);
      return read === undefined || read === library.text
        ? node
        : { ...node, library: { ...library, text: read } };
    }
    const target = scope.names.get(name.text);
    if (target === undefined) return node;
    if (target.fromLibrary) {
      return {
        ...node,
        library: { kind: 'ident', at: name.at, text: target.library },
        name: { ...name, text: target.name },
      };
    }
    return target.name === name.text ? node : { ...node, name: { ...name, text: target.name } };
  }
  for (const field of ['verb', 'message'] as const) {
    const written = node[field] as Ident | null | undefined;
    if (written === null || written === undefined || typeof written !== 'object') continue;
    const target = scope.names.get(written.text);
    if (target !== undefined && target.name !== written.text) {
      return { ...node, [field]: { ...written, text: target.name } };
    }
  }
  return node;
}
