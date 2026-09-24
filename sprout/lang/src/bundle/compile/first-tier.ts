// The first tier (the spec's The compiler › Two tiers): a single file
// checked alone for its shape, which is what an editor runs on each
// keystroke, and that check over every file in the closed bundle, the
// world's own and every usable library's, since they compile together;
// a `.prose` file is read for its passages, whose kind is the bundle's
// to say.
// A file that does not compile refuses at publish; at load it reads as
// absent, what it declared is not in the world, and what referred to it
// keeps compiling. A kind in the wrong file is not a file that does not
// compile: it refuses at publish and is warned about at load, and what
// the file declares stands either way.

import type { Declaration, PassageDeclaration } from '../../syntax/ast.js';
import type { VendoredLibrary } from '../bundle.js';
import { Diagnostics, type Diagnostic } from '../../source/diagnostics.js';
import { checkEnumDeclaration } from '../../declare/enums.js';
import { checkGrammar } from '../../declare/grammar.js';
import { checkKindFiles } from '../../declare/kind-files.js';
import { checkKindDeclaration } from '../../declare/kinds.js';
import { objectsIn } from '../../declare/objects.js';
import { checkVerbDeclaration } from '../../declare/verbs.js';
import { checkWorldDeclaration } from '../../declare/world.js';
import { parseDeclarations, parseProseFile } from '../../syntax/parse.js';
import { DEFAULT_LIMITS, type StaticCaps } from '../limits.js';
import type { SourceFile } from '../../source/source.js';
import { FILE_GONE, isCode, isProse } from './files.js';
import type { Report } from './report.js';

/** What the first tier makes of one file: a `.sprout` file's declarations, a `.prose` file's passages. */
export interface ShapeResult {
  readonly declarations: readonly Declaration[];
  readonly passages: readonly PassageDeclaration[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * The first tier: one file, checked alone for its shape. Today that is
 * its syntax, the options cap, a verb's roles and phrases and its caps,
 * `sprout.World` written on the world and nowhere else, an object
 * naming a kind, a body's grammar lines and their caps, and each kind in
 * the file named for it; the rest of the caps that apply to a definition
 * on its own, its declarations agreeing with themselves and every write
 * going to `self` join it as the syntax that expresses them lands. The
 * caps are the host's, as every limit is.
 */
export function checkShape(file: SourceFile, caps?: StaticCaps): ShapeResult {
  const { declarations, passages, diagnostics, layout } = readShape(file, caps);
  return { declarations, passages, diagnostics: [...diagnostics, ...layout] };
}

/** One file's shape, with what is said of where its kinds are written kept apart. */
function readShape(
  file: SourceFile,
  caps?: StaticCaps,
): ShapeResult & { readonly layout: readonly Diagnostic[] } {
  const diagnostics = new Diagnostics();
  const using = caps ?? DEFAULT_LIMITS.caps;
  if (isProse(file)) {
    const passages = parseProseFile(file, diagnostics, using);
    return { declarations: [], passages, diagnostics: diagnostics.all, layout: [] };
  }
  if (!isCode(file)) return { declarations: [], passages: [], diagnostics: [], layout: [] };
  const declarations = parseDeclarations(file, diagnostics, using);
  for (const declared of declarations) {
    if (declared.kind === 'enum') {
      checkEnumDeclaration(declared, using.optionsPerEnum, diagnostics);
    }
    // A verb's roles and phrases agree with each other or not on their
    // own, and its caps are the host's; so do a grammar block's lines.
    if (declared.kind === 'verb') {
      checkVerbDeclaration(declared, using, diagnostics);
    }
    // One declaration answers on its own whether it wrote
    // `sprout.World`, so the first tier is where a world that did not
    // is refused.
    if (declared.kind === 'world') {
      checkWorldDeclaration(declared, diagnostics);
      for (const { declaration } of objectsIn(declared)) {
        checkKindDeclaration(declaration, diagnostics);
        checkGrammar(declaration, using, diagnostics);
      }
    }
    // As it does whether a kind or an object wrote it, which anything
    // but a world may not, and whether an object named a kind at all.
    if (declared.kind === 'kind') {
      checkKindDeclaration(declared, diagnostics);
      checkGrammar(declared, using, diagnostics);
      for (const { declaration } of objectsIn(declared)) {
        checkKindDeclaration(declaration, diagnostics);
        checkGrammar(declaration, using, diagnostics);
      }
    }
  }
  const layout = new Diagnostics();
  checkKindFiles(file.name, declarations, layout);
  return { declarations, passages: [], diagnostics: diagnostics.all, layout: layout.all };
}

/** What the first tier makes of a whole bundle. */
export interface FirstTier {
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
export function readFirstTier(
  arrived: readonly SourceFile[],
  usable: readonly VendoredLibrary[],
  namespace: string,
  caps: StaticCaps,
  report: Report,
): FirstTier {
  const readable: { library: string; file: SourceFile }[] = [
    ...arrived.map((file) => ({ library: namespace, file })),
    ...usable.flatMap((library) => library.files.map((file) => ({ library: library.name, file }))),
  ];
  const declarations: Declaration[] = [];
  const byLibrary = new Map<string, Declaration[]>();
  const prose = new Map<string, ProseRead>();
  /** Whether one of the world's own files was refused by the first tier. */
  let ownFileRefused = false;
  for (const { library, file } of readable) {
    const shape = readShape(file, caps);
    for (const { at, message, remedy } of shape.layout) report.strict(at, message, remedy);
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
