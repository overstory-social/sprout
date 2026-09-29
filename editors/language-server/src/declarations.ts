import {
  Diagnostics,
  parseDeclarations,
  parseProseFile,
  type Declaration,
  type WorldMember,
  type LibrarySource,
  type ObjectDeclaration,
  type PassageDeclaration,
  type SourceFile,
  type Span,
} from '@overstory/sprout/lang';

// Every name a world and its libraries declare, read from each file's own
// parse, so hover, go-to-definition and completion keep working while the
// world as a whole is refused. A `.prose` file's passages belong to the
// kind, object or world whose `prose "…"` line names that file, which is
// found beside the file that line is written in (the spec's Prose ›
// Passages).

/** What a declared name is. */
export type DeclaredAs =
  | 'world'
  | 'kind'
  | 'object'
  | 'enum'
  | 'option'
  | 'verb'
  | 'intent'
  | 'message'
  | 'property'
  | 'memory'
  | 'passage';

/** One declared name. */
export interface Declared {
  readonly name: string;
  readonly as: DeclaredAs;
  /** The name as it is written, which go-to-definition lands on. */
  readonly at: Span;
  /** The declaration as its first line writes it, up to its body. */
  readonly head: string;
  /**
   * The world, kind, object or enum it is declared in, where it is a member
   * or an object written in a body; null for what a file declares at its
   * top level, which alone may be imported.
   */
  readonly owner: string | null;
  /** The library it comes from, or null for the world's own files. */
  readonly library: string | null;
}

/** One name an `import` line brings into a file. */
export interface Imported {
  /** The importing file's name. */
  readonly file: string;
  /** The name the file writes: the `as` name, or the namespace. */
  readonly local: string;
  /** The name imported, or null for a namespace. */
  readonly name: string | null;
  /** Whether it is a message, imported with its colon. */
  readonly message: boolean;
  /** The specifier: a world file's path without `.sprout`, or a library's name. */
  readonly from: string;
}

/** What a world and its libraries declare, and what each file imports. */
export interface DeclarationIndex {
  readonly declared: readonly Declared[];
  readonly imports: readonly Imported[];
}

/** Every name declared in `files`, then in each library's files, and every import. */
export function declarationsOf(
  files: readonly SourceFile[],
  libraries: readonly LibrarySource[],
): DeclarationIndex {
  const imports: Imported[] = [];
  const declared = [
    ...declaredIn(files, null, imports),
    ...libraries.flatMap((library) => declaredIn(library.files, library.name, imports)),
  ];
  return { declared, imports };
}

/** The specifier `one` is imported from: its library's name, or its file's path without `.sprout`. */
export function specifierOf(one: Declared): string {
  return one.library ?? one.at.source.name.replace(/\.sprout$/, '');
}

function declaredIn(
  files: readonly SourceFile[],
  library: string | null,
  imports: Imported[],
): Declared[] {
  const sprout = files.filter((file) => !file.name.endsWith('.prose'));
  const prose = files.filter((file) => file.name.endsWith('.prose'));
  const out: Declared[] = [];
  const proseOwners = new Map<string, string>();
  const one = (
    name: { text: string; at: Span },
    as: DeclaredAs,
    at: Span,
    owner: string | null,
  ): void => {
    out.push({ name: name.text, as, at: name.at, head: headOf(at), owner, library });
  };
  const members = (members: readonly WorldMember[], owner: string): void => {
    for (const member of members) {
      if (member.kind === 'property') one(member.name, 'property', member.at, owner);
      if (member.kind === 'remembers')
        for (const property of member.properties) one(property.name, 'memory', property.at, owner);
      if (member.kind === 'passage') one(member.name, 'passage', member.at, owner);
      if (member.kind === 'prose-file')
        proseOwners.set(besideOf(member.at.source.name, member.file.value), owner);
    }
  };
  const object = (declared: ObjectDeclaration, owner: string | null): void => {
    one(declared.name, 'object', declared.at, owner);
    members(declared.members, declared.name.text);
    for (const inside of declared.objects) object(inside, declared.name.text);
  };
  const declaration = (declared: Declaration): void => {
    switch (declared.kind) {
      case 'world':
      case 'kind':
        one(declared.name, declared.kind, declared.at, null);
        members(declared.members, declared.name.text);
        for (const inside of declared.objects) object(inside, declared.name.text);
        return;
      case 'object':
        return object(declared, null);
      case 'enum':
        one(declared.name, 'enum', declared.at, null);
        for (const option of declared.options)
          one(option.name, 'option', option.at, declared.name.text);
        return;
      case 'verb':
      case 'intent':
      case 'message':
        return one(declared.name, declared.kind, declared.at, null);
      case 'import': {
        const file = declared.at.source.name;
        const from = declared.from.text;
        if (declared.namespace !== null)
          imports.push({
            file,
            local: declared.namespace.text,
            name: null,
            message: false,
            from,
          });
        for (const name of declared.names ?? [])
          imports.push({
            file,
            local: (name.alias ?? name.name).text,
            name: name.name.text,
            message: name.message,
            from,
          });
        return;
      }
    }
  };
  for (const file of sprout) parseDeclarations(file, new Diagnostics()).forEach(declaration);
  for (const file of prose) {
    const passages: PassageDeclaration[] = parseProseFile(file, new Diagnostics());
    const owner = proseOwners.get(file.name) ?? null;
    for (const passage of passages) one(passage.name, 'passage', passage.at, owner);
  }
  return out;
}

/** The first line of what `at` covers, without its body's brace. */
function headOf(at: Span): string {
  const line = at.source.text.slice(at.start, at.end).split('\n')[0]!;
  return line.replace(/\s*\{.*$/, '').trim();
}

/** The file `named` beside the file `from`. */
function besideOf(from: string, named: string): string {
  const slash = from.lastIndexOf('/');
  return slash === -1 ? named : `${from.slice(0, slash + 1)}${named}`;
}
