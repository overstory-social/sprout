// Every file in the closed bundle read, the world's own and every usable
// library's, since they compile together, each checked for what it can
// be checked for on its own (the spec's The compiler › One tier); a
// `.prose` file is read for its passages, whose kind is the bundle's to
// say. A file that does not compile refuses at publish; at load it reads
// as absent, what it declared is not in the world, and what referred to
// it keeps compiling.

import type { Declaration, PassageDeclaration } from '../../syntax/ast.js';
import type { VendoredLibrary } from '../bundle.js';
import { Diagnostics, type Diagnostic } from '../../source/diagnostics.js';
import { checkEnumDeclaration, SPROUT } from '../../declare/enums.js';
import { checkGrammar } from '../../declare/grammar.js';
import { checkKindDeclaration } from '../../declare/kinds.js';
import { objectsIn } from '../../declare/objects.js';
import { checkVerbDeclaration } from '../../declare/verbs.js';
import { checkWorldDeclaration } from '../../declare/world.js';
import { parseDeclarations, parseProseFile } from '../../syntax/parse.js';
import { DEFAULT_LIMITS, type StaticCaps } from '../limits.js';
import type { SourceFile } from '../../source/source.js';
import { FILE_GONE, isCode, isProse } from './files.js';
import type { Report } from './report.js';
import { libraryScope, rewrite } from './renames.js';

/** What reading one file makes of it: a `.sprout` file's declarations, a `.prose` file's passages. */
export interface FileReading {
  readonly declarations: readonly Declaration[];
  readonly passages: readonly PassageDeclaration[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * One file, read and checked as far as it can be alone: its syntax, the
 * options cap, a verb's roles and phrases and their caps, the standard
 * library's `World` written on the world and nowhere else, an object
 * naming a kind, and a body's grammar lines and their caps. The caps are
 * the host's, as every limit is.
 */
export function readFile(
  file: SourceFile,
  caps?: StaticCaps,
  libraries: ReadonlySet<string> = new Set([SPROUT]),
): FileReading {
  const diagnostics = new Diagnostics();
  const using = caps ?? DEFAULT_LIMITS.caps;
  if (isProse(file)) {
    const passages = parseProseFile(file, diagnostics, using);
    return { declarations: [], passages, diagnostics: diagnostics.all };
  }
  if (!isCode(file)) return { declarations: [], passages: [], diagnostics: [] };
  // Each declaration is checked as the file's imports from libraries mean
  // it, so `import {World} from …` names the library's world; what is
  // handed on is what was written, which the bundle checks and rewrites.
  const declarations = parseDeclarations(file, diagnostics, using);
  const scope = libraryScope(declarations, libraries);
  for (const written of declarations) {
    const declared = rewrite(written, scope);
    if (declared.kind === 'enum') {
      checkEnumDeclaration(declared, using.optionsPerEnum, diagnostics);
    }
    // A verb's roles and phrases agree with each other or not on their
    // own, and its caps are the host's; so do a grammar block's lines.
    if (declared.kind === 'verb') {
      checkVerbDeclaration(declared, using, diagnostics);
    }
    // One declaration answers on its own whether it wrote
    // `sprout.World`, so reading its file is where a world that did not
    // is refused.
    if (declared.kind === 'world') {
      checkWorldDeclaration(declared, diagnostics);
      for (const { declaration } of objectsIn(declared)) {
        checkKindDeclaration(declaration, diagnostics);
        checkGrammar(declaration, using, diagnostics);
      }
    }
    // As it does whether a kind or an object wrote it, which anything
    // but a world may not, and whether an object named a kind at all; an
    // object in a file of its own is checked as one in the world is.
    if (declared.kind === 'kind' || declared.kind === 'object') {
      checkKindDeclaration(declared, diagnostics);
      checkGrammar(declared, using, diagnostics);
      for (const { declaration } of objectsIn(declared)) {
        checkKindDeclaration(declaration, diagnostics, declared.kind === 'kind');
        checkGrammar(declaration, using, diagnostics);
      }
    }
  }
  return { declarations, passages: [], diagnostics: diagnostics.all };
}

/** What reading every file of a bundle makes of them. */
export interface Reading {
  /** Every declaration in a file that compiled, in the order read. */
  readonly declarations: readonly Declaration[];
  /** The same, by the library they are declared in: the world's under its namespace. */
  readonly byLibrary: ReadonlyMap<string, readonly Declaration[]>;
  /** Whether one of the world's own files was refused, which may be where something is declared. */
  readonly ownFileRefused: boolean;
  /** Every `.prose` file that read, by its name, and the passages in it. */
  readonly prose: ReadonlyMap<string, ProseRead>;
}

/** A `.prose` file that read, and the passages in it. */
export interface ProseRead {
  readonly file: SourceFile;
  readonly passages: readonly PassageDeclaration[];
}

/**
 * Check every file alone: the world's own that `arrived`, read in
 * `namespace`, and every usable library's.
 */
export function readFiles(
  arrived: readonly SourceFile[],
  usable: readonly VendoredLibrary[],
  namespace: string,
  caps: StaticCaps,
  report: Report,
): Reading {
  const readable: { library: string; file: SourceFile }[] = [
    ...arrived.map((file) => ({ library: namespace, file })),
    ...usable.flatMap((library) => library.files.map((file) => ({ library: library.name, file }))),
  ];
  const libraries = new Set(usable.map((library) => library.name));
  const declarations: Declaration[] = [];
  const byLibrary = new Map<string, Declaration[]>();
  const prose = new Map<string, ProseRead>();
  /** Whether one of the world's own files was refused as it was read. */
  let ownFileRefused = false;
  for (const { library, file } of readable) {
    const shape = readFile(file, caps, libraries);
    const refused = shape.diagnostics.some((d) => d.severity === 'refusal');
    if (refused && library === namespace) ownFileRefused = true;
    if (!refused) {
      if (isProse(file)) prose.set(file.name, { file, passages: shape.passages });
      declarations.push(...shape.declarations);
      byLibrary.set(library, [...(byLibrary.get(library) ?? []), ...shape.declarations]);
      report.diagnostics.add(...shape.diagnostics);
      continue;
    }
    if (report.mode === 'publish') {
      report.diagnostics.add(...shape.diagnostics);
      continue;
    }
    // A file that does not compile reads as absent: what it declared is
    // not in the world, and what referred to it keeps compiling.
    report.absent.push({
      what: file.name,
      kind: 'file',
      reason: 'broken',
      at: shape.diagnostics[0]!.at,
      consequence: FILE_GONE,
    });
    for (const diagnostic of shape.diagnostics) {
      report.diagnostics.add(
        diagnostic.severity === 'refusal' ? { ...diagnostic, severity: 'warning' } : diagnostic,
      );
    }
  }
  return { declarations, byLibrary, ownFileRefused, prose };
}
