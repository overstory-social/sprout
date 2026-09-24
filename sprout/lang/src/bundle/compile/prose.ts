// Which `.prose` file each kind points at, and the passages it gives the
// kind (the spec's Prose › Passages; The world model › Files; The
// compiler › What absent means, What it warns about).
//
// `prose "mirror.prose"` names a file beside the one the kind is written
// in, and the passages in it become the kind's own, exactly as if they
// were written in its braces, so a name in both is written twice. A file
// belongs to one kind, and a body names one file. A file the manifest
// names that did not arrive, or that the host withholds or that does not
// read, is a gap already said: the kind runs without those passages, and
// what says one renders nothing. A file no kind points at is warned about.

import type {
  Declaration,
  KindMember,
  ObjectDeclaration,
  PassageDeclaration,
  ProseFileDeclaration,
  WorldMember,
} from '../../syntax/ast.js';
import { qualifiedName } from '../../declare/enums.js';
import { absenceRule } from '../absent.js';
import type { ProseRead } from './first-tier.js';
import type { Report } from './report.js';

/** The declarations with each kind's `.prose` passages among its members, and the kinds whose file is gone. */
export interface WithProse {
  readonly declarations: readonly Declaration[];
  readonly byLibrary: ReadonlyMap<string, readonly Declaration[]>;
  /** Every kind, object and world, by qualified name, whose `.prose` file did not arrive. */
  readonly gone: ReadonlySet<string>;
}

/** What attaching reads: the passages of every `.prose` file that read, and the files the world is meant to hold. */
export interface ProseFiles {
  readonly prose: ReadonlyMap<string, ProseRead>;
  /** The manifest's `files`: a `.prose` file named here and not read is a gap already said. */
  readonly named: ReadonlySet<string>;
}

/** Give each declaration that points at a `.prose` file the passages in it. */
export function attachProse(
  byLibrary: ReadonlyMap<string, readonly Declaration[]>,
  files: ProseFiles,
  report: Report,
): WithProse {
  const state: Attaching = { files, report, owners: new Map(), gone: new Set() };
  const attached = new Map<string, readonly Declaration[]>();
  for (const [library, declared] of byLibrary) {
    attached.set(
      library,
      declared.map((one) => attachTo(one, library, state)),
    );
  }
  for (const [name, { file }] of files.prose) {
    if (state.owners.has(name)) continue;
    report.warn(
      file.span(0, 0),
      `No kind points at "${name}", so nothing says its passages.`,
      `Write \`prose "${baseName(name)}"\` in the kind whose words these are, or take the file out.`,
    );
  }
  return { declarations: [...attached.values()].flat(), byLibrary: attached, gone: state.gone };
}

interface Attaching {
  readonly files: ProseFiles;
  readonly report: Report;
  /** Each file pointed at, and who it belongs to, by the name a refusal shows. */
  readonly owners: Map<string, string>;
  readonly gone: Set<string>;
}

function attachTo(declared: Declaration, library: string, state: Attaching): Declaration {
  switch (declared.kind) {
    case 'world':
    case 'kind':
      return {
        ...declared,
        members: withProse<WorldMember>(declared.members, declared, library, state),
        objects: declared.objects.map((object) => attachObject(object, library, state)),
      } as Declaration;
    default:
      return declared;
  }
}

function attachObject(
  object: ObjectDeclaration,
  library: string,
  state: Attaching,
): ObjectDeclaration {
  return {
    ...object,
    members: withProse<KindMember>(object.members, object, library, state),
    objects: object.objects.map((inner) => attachObject(inner, library, state)),
  };
}

/** A body's members, with the passages of the file its `prose` line names after them. */
function withProse<M extends KindMember | WorldMember>(
  members: readonly M[],
  owner: { readonly name: { readonly text: string }; readonly at: ProseFileDeclaration['at'] },
  library: string,
  state: Attaching,
): M[] {
  const pointers = members.filter((member): member is M & ProseFileDeclaration => {
    return member.kind === 'prose-file';
  });
  const [pointer, ...more] = pointers;
  if (pointer === undefined) return [...members];
  const name = owner.name.text;
  for (const extra of more) {
    state.report.refuse(
      extra.at,
      `\`${name}\` points at a \`.prose\` file twice.`,
      `A kind's longer passages live in one file: keep one \`prose\` line in \`${name}\`.`,
    );
  }

  const file = besideOf(owner.at.source.name, pointer.file.value);
  const found = state.files.prose.get(file);
  if (found === undefined) {
    state.gone.add(qualifiedName(library, name));
    // A file the manifest names that did not read has been said, as the gap it is.
    if (!state.files.named.has(file)) {
      state.report.gap(
        {
          what: file,
          kind: 'passage',
          reason: 'missing',
          at: pointer.file.at,
          consequence: absenceRule('passage').consequence,
        },
        `\`${name}\` points at "${pointer.file.value}", and no such file is in this world.`,
        `Add "${file}" and name it among the world’s files, or take the \`prose\` line out.`,
      );
    }
    return [...members];
  }
  const owned = state.owners.get(file);
  if (owned !== undefined) {
    state.report.refuse(
      pointer.file.at,
      `"${pointer.file.value}" holds \`${owned}\`'s passages, and a file's passages belong to one kind.`,
      `Give \`${name}\` a \`.prose\` file of its own, or write its passages in its braces.`,
    );
    return [...members];
  }
  state.owners.set(file, name);
  return [...members, ...(found.passages as readonly PassageDeclaration[] as readonly M[])];
}

/** The file `named` is, beside the file `from` that names it. */
function besideOf(from: string, named: string): string {
  const slash = from.lastIndexOf('/');
  return slash === -1 ? named : `${from.slice(0, slash + 1)}${named}`;
}

/** The last part of a file's path, as a `prose` line beside it names it. */
function baseName(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1);
}
