// What each file imports, and where each object written in a file of its
// own sits (the spec's The world model › Imports, Objects). Every import
// is checked against what its specifier reaches: a file of the same part
// of the bundle, by its path from that part's root without `.sprout`, or
// a library, whole, by its name. A name brought in under `as`, and a
// member of a namespace, is rewritten to the declaration it names, so
// every later stage reads what the import means; a name written without
// an import still resolves across the bundle, until imports are required.
// A top-level object is placed once, by its `in` clause or by a stub,
// and stands in the world's body where it sits, as if written there.

import type { Declaration, Ident, ObjectDeclaration, WorldDeclaration } from '../../syntax/ast.js';
import type { ImportDeclaration } from '../../syntax/ast-imports.js';
import type { Report } from './report.js';
import { rewrite, type FileScope } from './renames.js';
import { nodesOf } from '../../source/nodes.js';
import { BUILT_IN_TYPE_WORDS } from '../../syntax/parse/types.js';
import { engineMessage } from '../../declare/engine-messages.js';

/** A single quote, as a specifier is written between them. */
const Q = "'";

/** What a part of the bundle is: the world's own files, or a library's. */
interface Part {
  readonly library: string;
  /** Each file's declarations, by its specifier: its path from the part's root, without `.sprout`. */
  readonly files: ReadonlyMap<string, readonly Declaration[]>;
}

/** What the manifest names: its own files, and the libraries it pins, each of which an import may name though it did not arrive. */
export interface Named {
  readonly files: ReadonlySet<string>;
  readonly libraries: ReadonlySet<string>;
  /** The extensions it pins, whose types a file names by its `extension` line and never imports. */
  readonly extensions: ReadonlySet<string>;
}

/** What placing and rewriting leave: every declaration each library holds, imports and placed objects taken out. */
export interface Imported {
  readonly byLibrary: ReadonlyMap<string, readonly Declaration[]>;
  readonly declarations: readonly Declaration[];
  /** The objects each file imports, by the file, each as `objectKey` names it. */
  readonly objects: ReadonlyMap<string, ReadonlySet<string>>;
}

/** An object written at a file's top level, as what imports it names it: its file and its name. */
export function objectKey(file: string, name: string): string {
  return `${file}:${name}`;
}

/** The specifier a file of `library` is reached by: its path from the part's root, without `.sprout`. */
export function specifierOf(fileName: string, library: string, world: string): string {
  const inside =
    library !== world && fileName.startsWith(`${library}/`)
      ? fileName.slice(library.length + 1)
      : fileName;
  return inside.replace(/\.sprout$/, '');
}

/** The top-level name a declaration goes by, and whether it is a message, or null for one that has none. */
function declaredName(declared: Declaration): { name: string; message: boolean } | null {
  switch (declared.kind) {
    case 'kind':
    case 'enum':
    case 'verb':
    case 'object':
    case 'world':
      return { name: declared.name.text, message: false };
    case 'message':
      return { name: declared.name.text, message: true };
    default:
      return null;
  }
}

/**
 * Check every import, rewrite what it renames, and place every object
 * written in a file of its own. `named` is every file the manifest names,
 * so an import of one that did not arrive reads as absent, not unknown.
 */
export function resolveImports(
  byLibrary: ReadonlyMap<string, readonly Declaration[]>,
  world: string,
  named: Named,
  report: Report,
): Imported {
  // A world namespaced as a library it uses is refused at its manifest;
  // nothing it or that library imports can be told apart, so nothing
  // more is said of either.
  if (named.libraries.has(world)) {
    const kept = new Map(
      [...byLibrary].map(([library, declared]) => [
        library,
        declared.filter((one) => one.kind !== 'import'),
      ]),
    );
    return { byLibrary: kept, declarations: [...kept.values()].flat(), objects: new Map() };
  }
  const parts = new Map<string, Part>();
  for (const [library, declared] of byLibrary) {
    const files = new Map<string, Declaration[]>();
    for (const one of declared) {
      const specifier = specifierOf(one.at.source.name, library, world);
      files.set(specifier, [...(files.get(specifier) ?? []), one]);
    }
    parts.set(library, { library, files });
  }
  const libraries = [...parts.keys()].filter((library) => library !== world);
  const own = parts.get(world);
  for (const library of libraries) {
    const clash = own?.files.get(library);
    if (clash !== undefined && clash.length > 0) {
      report.diagnostics.refuse(
        clash[0]!.at.source.span(0, 0),
        `This file cannot be called \`${library}.sprout\`: \`'${library}'\` names the library.`,
        'Give the file another name.',
      );
    }
  }

  const scopes = new Map<string, FileScope>();
  const rewritten = new Map<string, Declaration[]>();
  const index = declaredWhere(parts);
  // A kind two of the world's files name alike is known by its file: the
  // names written are aliases, and each import reaches the one it names.
  const alike = new Map<string, string[]>();
  for (const [specifier, declared] of own?.files ?? []) {
    for (const one of declared) {
      if (one.kind === 'kind') {
        alike.set(one.name.text, [...(alike.get(one.name.text) ?? []), specifier]);
      }
    }
  }
  const byFile = (name: string, specifier: string): string | null =>
    (alike.get(name)?.length ?? 0) > 1 ? `${world}/${specifier}` : null;
  for (const [library, part] of parts) {
    rewritten.set(library, rewritten.get(library) ?? []);
    for (const [specifier, declared] of part.files) {
      const scope = scopeOf(part, specifier, declared, parts, world, named, byFile, report);
      scopes.set(declared[0]!.at.source.name, scope);
      checkImported(declared, scope, part, index, named, report);
      for (const one of declared) {
        if (one.kind === 'import') continue;
        // Each kind known by its file is declared under that name.
        const known =
          library === world && one.kind === 'kind' ? byFile(one.name.text, specifier) : null;
        const into = known ?? library;
        rewritten.set(into, [...(rewritten.get(into) ?? []), rewrite(one, scope)]);
      }
    }
  }

  const placed = placeObjects(rewritten, world, scopes, report);
  const objects = new Map<string, Set<string>>();
  for (const [file, scope] of scopes) {
    for (const target of scope.names.values()) {
      if (target.object === null) continue;
      const set = objects.get(file) ?? new Set<string>();
      set.add(objectKey(target.object.at.source.name, target.object.name.text));
      objects.set(file, set);
    }
  }
  return {
    byLibrary: placed,
    declarations: [...placed.values()].flat(),
    objects,
  };
}

/** What `declared`, one file's declarations, may name through its imports; each import checked as it is read. */
function scopeOf(
  part: Part,
  specifier: string,
  declared: readonly Declaration[],
  parts: ReadonlyMap<string, Part>,
  world: string,
  named: Named,
  byFile: (name: string, specifier: string) => string | null,
  report: Report,
): FileScope {
  const scope: FileScope = { names: new Map(), namespaces: new Map() };
  const own = new Set(
    declared.flatMap((one) => {
      const name = declaredName(one);
      return name === null ? [] : [name.name];
    }),
  );
  const imports = declared.filter((one): one is ImportDeclaration => one.kind === 'import');
  for (const imported of imports) {
    const target = reach(imported.from, part, parts, world, named, report);
    if (target === null) continue;
    if (imported.namespace !== null) {
      if (!claim(imported.namespace, scope, own, report)) continue;
      scope.namespaces.set(imported.namespace.text, target.library);
      continue;
    }
    for (const item of imported.names ?? []) {
      const found = target.declared.find((one) => {
        const name = declaredName(one);
        return name !== null && name.name === item.name.text && name.message === item.message;
      });
      const written = item.message ? `:${item.name.text}` : item.name.text;
      if (found?.kind === 'world') {
        report.diagnostics.refuse(
          item.name.at,
          `\`${written}\` is the world, which every path may start from, so it is never imported.`,
          'Take it out of the import, and name what is in the world by its path.',
        );
        continue;
      }
      if (found === undefined) {
        if (target.declared.length === 0) continue;
        report.diagnostics.refuse(
          item.name.at,
          `${target.where} declares no \`${written}\`${target.library === world ? ' at its top level' : ''}.`,
          'Import a name it declares, or declare this one there.',
        );
        continue;
      }
      const here = item.alias ?? item.name;
      if (!claim(here, scope, own, report)) continue;
      const known =
        found.kind === 'kind' && target.library === world
          ? byFile(item.name.text, target.specifier)
          : null;
      scope.names.set(here.text, {
        library: known ?? target.library,
        name: item.name.text,
        fromLibrary: known !== null || target.library !== world,
        object: found.kind === 'object' ? found : null,
      });
    }
  }
  // The file's own kinds that another file names alike are its own by
  // their file, wherever the file writes them.
  if (part.library === world) {
    for (const one of declared) {
      if (one.kind !== 'kind') continue;
      const known = byFile(one.name.text, specifier);
      if (known === null) continue;
      scope.names.set(one.name.text, {
        library: known,
        name: one.name.text,
        fromLibrary: true,
        object: null,
      });
    }
  }
  return scope;
}

/** Where each name is declared at a file's top level: by part, the specifiers of the files that do. */
type Index = ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;

/** For each part, each top-level name, a message by its colon, and the files that declare it. */
function declaredWhere(parts: ReadonlyMap<string, Part>): Index {
  const index = new Map<string, Map<string, string[]>>();
  for (const [library, part] of parts) {
    const names = new Map<string, string[]>();
    for (const [specifier, declared] of part.files) {
      for (const one of declared) {
        const name = declaredName(one);
        if (name === null || one.kind === 'world') continue;
        const key = name.message ? `:${name.name}` : name.name;
        names.set(key, [...(names.get(key) ?? []), specifier]);
      }
    }
    index.set(library, names);
  }
  return index;
}

/**
 * Refuse each name `declared`, one file as written, uses that another
 * file or a library declares and the file does not import, once per name;
 * a name nothing declares is left to whoever reads it to refuse.
 */
function checkImported(
  declared: readonly Declaration[],
  scope: FileScope,
  part: Part,
  index: Index,
  named: Named,
  report: Report,
): void {
  const own = new Set(
    declared.flatMap((one) => {
      const name = declaredName(one);
      return name === null ? [] : [name.message ? `:${name.name}` : name.name];
    }),
  );
  const said = new Set<string>();
  // An extension's type, `media.Sound`, is named by the file's own
  // `extension` line, and is never imported.
  const extensions = new Set(
    declared.flatMap((one) => (one.kind === 'extension-use' ? [one.name.text] : [])),
  );
  /** Where `key` is declared, as a refusal names it and an import reaches it; null where nothing declares it. */
  const elsewhere = (key: string): { where: string; specifier: string } | null => {
    const inPart = index.get(part.library)?.get(key)?.[0];
    if (inPart !== undefined) return { where: `\`${inPart}.sprout\``, specifier: inPart };
    for (const [library, names] of index) {
      if (library !== part.library && names.has(key)) {
        return { where: `the library \`${library}\``, specifier: library };
      }
    }
    return null;
  };
  const refuse = (ident: Ident, key: string, written: string): void => {
    if (said.has(key)) return;
    const from = elsewhere(key);
    if (from === null) return;
    said.add(key);
    report.diagnostics.refuse(
      ident.at,
      `\`${written}\` is declared in ${from.where}, and this file does not import it.`,
      `Import it at the top of this file: \`import {${written}} from ${Q}${from.specifier}${Q}\`.`,
    );
  };
  for (const node of nodesOf(declared)) {
    if (node.kind === 'kind-expr' || node.kind === 'named-type') {
      const { library, name } = node as unknown as { library: Ident | null; name: Ident };
      if (library !== null) {
        if (scope.namespaces.has(library.text) || extensions.has(library.text)) continue;
        // A qualifier that names no library and no file, or an extension
        // the file does not name, is left to whoever reads the name.
        const known =
          index.has(library.text) ||
          named.libraries.has(library.text) ||
          part.files.has(library.text);
        if (!known || named.extensions.has(library.text)) continue;
        const key = `.${library.text}`;
        if (said.has(key)) continue;
        said.add(key);
        report.diagnostics.refuse(
          library.at,
          `\`${library.text}.${name.text}\` names \`${library.text}\`, which this file does not import as a namespace.`,
          `Import it at the top of this file, as in \`import * as ${library.text} from ${Q}${library.text}${Q}\`, or import \`${name.text}\` itself.`,
        );
        continue;
      }
      if (BUILT_IN_TYPE_WORDS.has(name.text) || own.has(name.text) || scope.names.has(name.text))
        continue;
      refuse(name, name.text, name.text);
      continue;
    }
    for (const field of ['verb', 'message'] as const) {
      const written = (node as unknown as Record<string, unknown>)[field] as
        Ident | null | undefined;
      if (written === null || written === undefined || typeof written !== 'object') continue;
      const message = field === 'message';
      if (message && engineMessage(written.text) !== null) continue;
      const key = message ? `:${written.text}` : written.text;
      if (own.has(key) || scope.names.has(written.text)) continue;
      refuse(written, key, message ? `:${written.text}` : written.text);
    }
  }
}

/** The declarations a specifier reaches, and how to name them in a refusal; null having said why there are none. */
function reach(
  from: Ident,
  part: Part,
  parts: ReadonlyMap<string, Part>,
  world: string,
  named: Named,
  report: Report,
): { library: string; specifier: string; declared: readonly Declaration[]; where: string } | null {
  const specifier = from.text;
  const library = parts.get(specifier);
  if (library !== undefined && specifier !== world && !specifier.includes('/')) {
    return {
      library: specifier,
      specifier,
      declared: [...library.files.values()].flat(),
      where: `The library \`${specifier}\``,
    };
  }
  const file = part.files.get(specifier);
  if (file !== undefined) {
    return { library: part.library, specifier, declared: file, where: `\`${specifier}.sprout\`` };
  }
  // A file the manifest names that did not arrive, or did not compile,
  // is absent: what it would have brought in reads as absent where used.
  if (named.libraries.has(specifier)) {
    return { library: specifier, specifier, declared: [], where: `The library \`${specifier}\`` };
  }
  if (part.library === world && named.files.has(`${specifier}.sprout`)) {
    return { library: part.library, specifier, declared: [], where: `\`${specifier}.sprout\`` };
  }
  report.diagnostics.refuse(
    from.at,
    specifier.includes('/') || part.library !== world
      ? `\`'${specifier}'\` reaches no file of this world.`
      : `\`'${specifier}'\` reaches no file of this world, and no library its manifest pins.`,
    part.library === world
      ? "A specifier is a file's path from the world's folder, without `.sprout`, as `'rooms/cellar'` is `rooms/cellar.sprout`, or a library's name, as `'sprout'`."
      : "A specifier in a library is a file's path from the library's own root, without `.sprout`.",
  );
  return null;
}

/** Take `name` for this file, or refuse it where it is taken already. */
function claim(name: Ident, scope: FileScope, own: ReadonlySet<string>, report: Report): boolean {
  if (scope.names.has(name.text) || scope.namespaces.has(name.text)) {
    report.diagnostics.refuse(
      name.at,
      `\`${name.text}\` is imported twice into this file.`,
      `Give one of them another name with \`as\`, as in \`import {${name.text} as Other${name.text}} from ${Q}…${Q}\`.`,
    );
    return false;
  }
  if (own.has(name.text)) {
    report.diagnostics.refuse(
      name.at,
      `\`${name.text}\` is imported, and this file declares a \`${name.text}\` of its own.`,
      'Import it under another name with `as`, or rename the one declared here.',
    );
    return false;
  }
  return true;
}

/**
 * Every object written at a file's top level, placed in the world's body
 * where its `in` clause or its stub says, and taken out of the file's
 * declarations; each refused where it is placed twice, or nowhere.
 */
function placeObjects(
  byLibrary: ReadonlyMap<string, readonly Declaration[]>,
  world: string,
  scopes: ReadonlyMap<string, FileScope>,
  report: Report,
): Map<string, Declaration[]> {
  const loose = [...byLibrary.values()]
    .flat()
    .filter((one): one is ObjectDeclaration => one.kind === 'object');
  const out = new Map<string, Declaration[]>();
  for (const [library, declared] of byLibrary) {
    out.set(
      library,
      declared.filter((one) => one.kind !== 'object'),
    );
  }
  const own = out.get(world) ?? [];
  const at = own.findIndex((one) => one.kind === 'world');
  if (at < 0) {
    for (const object of loose) unplaced(object, report);
    return out;
  }
  let body = own[at] as WorldDeclaration;

  // A stub is replaced by the object its file imports by that name; one
  // that places nothing is refused and left out, so nothing is said of it
  // twice.
  /** Each object a stub placed, by its file and name. */
  const stubbed = new Set<string>();
  const keyOf = (object: ObjectDeclaration) => `${object.at.source.name}:${object.name.text}`;
  const within = (objects: readonly ObjectDeclaration[]): readonly ObjectDeclaration[] => {
    const replaced = objects.flatMap((one) => {
      const kept = replaceStub(one);
      return kept === null ? [] : [kept];
    });
    return replaced.length === objects.length && replaced.every((one, i) => one === objects[i])
      ? objects
      : replaced;
  };
  const replace = (object: ObjectDeclaration): ObjectDeclaration => {
    const objects = within(object.objects);
    return objects === object.objects ? object : { ...object, objects };
  };
  const replaceStub = (object: ObjectDeclaration): ObjectDeclaration | null => {
    if (object.stub !== true) return replace(object);
    const target = scopes.get(object.at.source.name)?.names.get(object.name.text)?.object ?? null;
    if (target === null) {
      report.diagnostics.refuse(
        object.name.at,
        `\`object ${object.name.text}\` names no object this file imports, and says nothing of its own.`,
        `Import it, as in \`import {${object.name.text}} from ${Q}rooms/${object.name.text}${Q}\`, or give it its kinds: \`object ${object.name.text} is <Kind> { … }\`.`,
      );
      return null;
    }
    if (stubbed.has(keyOf(target)) || target.placedIn !== undefined) {
      report.diagnostics.refuse(
        object.name.at,
        `\`${target.name.text}\` is placed twice: ${target.placedIn !== undefined ? 'by its own `in` clause and by this stub' : 'by two stubs'}.`,
        'Keep one of them, so it sits in one place.',
      );
      return null;
    }
    stubbed.add(keyOf(target));
    return replace(loose.find((one) => keyOf(one) === keyOf(target)) ?? target);
  };
  body = { ...body, objects: within(body.objects) };

  // An `in` clause places its object once what it names is in the tree,
  // so a path may run through an object another file places.
  let waiting = loose.filter((object) => object.placedIn !== undefined);
  for (let progress = true; progress && waiting.length > 0;) {
    progress = false;
    const still: ObjectDeclaration[] = [];
    for (const object of waiting) {
      const inserted = insert(body, object, body.name.text);
      if (inserted === null) still.push(object);
      else {
        body = inserted;
        progress = true;
      }
    }
    waiting = still;
  }
  // An object is in a circle where following what each waiting object's
  // path runs through, one waiting object to the next, comes back to it.
  const through = (object: ObjectDeclaration): ObjectDeclaration | undefined => {
    const path = object.placedIn!.parts.map((part) => part.text);
    return waiting.find((other) => other !== object && path.includes(other.name.text));
  };
  const inCircle = (object: ObjectDeclaration): boolean => {
    const seen = new Set<ObjectDeclaration>();
    for (let next = through(object); next !== undefined; next = through(next)) {
      if (next === object) return true;
      if (seen.has(next)) return false;
      seen.add(next);
    }
    return false;
  };
  for (const object of waiting) {
    const path = object.placedIn!.parts.map((part) => part.text);
    const circle = inCircle(object);
    report.diagnostics.refuse(
      object.placedIn!.at,
      circle
        ? `\`${object.name.text}\` is placed inside something that is placed inside it.`
        : `\`in ${path.join('.')}\` names nothing in the world for \`${object.name.text}\` to sit in.`,
      circle
        ? 'Place one of them somewhere else, so neither holds the other.'
        : "Write the path of what holds it from the world's body, as in `in composing_room.paper_store`.",
    );
  }
  for (const object of loose) {
    if (object.placedIn === undefined && !stubbed.has(keyOf(object))) unplaced(object, report);
  }
  out.set(
    world,
    own.map((one, i) => (i === at ? body : one)),
  );
  return out;
}

/** `body` with `object` in the body its `in` path names, or null where the path names nothing yet. */
function insert(
  body: WorldDeclaration,
  object: ObjectDeclaration,
  worldName: string,
): WorldDeclaration | null {
  const written = object.placedIn!.parts.map((part) => part.text);
  const path = written[0] === worldName ? written.slice(1) : written;
  const { placedIn: _placed, ...placed } = object;
  if (path.length === 0) return { ...body, objects: [...body.objects, placed] };
  const into = (
    objects: readonly ObjectDeclaration[],
    rest: readonly string[],
  ): ObjectDeclaration[] | null => {
    const at = objects.findIndex((one) => one.name.text === rest[0]);
    if (at < 0) return null;
    const holder = objects[at]!;
    const inner =
      rest.length === 1 ? [...holder.objects, placed] : into(holder.objects, rest.slice(1));
    if (inner === null) return null;
    return objects.map((one, i) => (i === at ? { ...holder, objects: inner } : one));
  };
  const objects = into(body.objects, path);
  return objects === null ? null : { ...body, objects };
}

/** Refuse an object written in a file of its own that nothing places. */
function unplaced(object: ObjectDeclaration, report: Report): void {
  report.diagnostics.refuse(
    object.name.at,
    `\`${object.name.text}\` is written in a file of its own, and nothing places it in the world.`,
    `Name what holds it with \`in\`, as in \`object ${object.name.text} is <Kind> in <place> { … }\`, or write \`object ${object.name.text}\` in the body it sits in and import it there.`,
  );
}
