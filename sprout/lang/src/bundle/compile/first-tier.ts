// The first tier (the spec's The compiler › Two tiers): a single file
// checked alone for its shape, which is what an editor runs on each
// keystroke, and that check over every file in the closed bundle, the
// world's own and every usable library's, since they compile together.
// A file that does not compile refuses at publish; at load it reads as
// absent, what it declared is not in the world, and what referred to it
// keeps compiling.

import type { Declaration } from '../../syntax/ast.js';
import type { VendoredLibrary } from '../bundle.js';
import { Diagnostics, type Diagnostic } from '../../source/diagnostics.js';
import { checkEnumDeclaration } from '../../declare/enums.js';
import { checkKindDeclaration } from '../../declare/kinds.js';
import { objectsIn } from '../../declare/objects.js';
import { checkVerbDeclaration } from '../../declare/verbs.js';
import { checkWorldDeclaration } from '../../declare/world.js';
import { parseDeclarations } from '../../syntax/parse.js';
import { DEFAULT_LIMITS, type StaticCaps } from '../limits.js';
import type { SourceFile } from '../../source/source.js';
import { FILE_GONE, isCode } from './files.js';
import type { Report } from './report.js';

/** What the first tier makes of one file. */
export interface ShapeResult {
  readonly declarations: readonly Declaration[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * The first tier: one file, checked alone for its shape. Today that is
 * its syntax, the options cap, a verb's roles and phrases and its caps,
 * `sprout.World` written on the world and nowhere else, and an object
 * naming a kind; the rest of the caps that apply to a definition on its
 * own, its declarations agreeing with themselves and every write going
 * to `self` join it as the syntax that expresses them lands. The caps are the host's, as every limit is.
 */
export function checkShape(file: SourceFile, caps?: StaticCaps): ShapeResult {
  const diagnostics = new Diagnostics();
  if (!isCode(file)) return { declarations: [], diagnostics: [] };
  const using = caps ?? DEFAULT_LIMITS.caps;
  const declarations = parseDeclarations(file, diagnostics, using);
  for (const declared of declarations) {
    if (declared.kind === 'enum') {
      checkEnumDeclaration(declared, using.optionsPerEnum, diagnostics);
    }
    // A verb's roles and phrases agree with each other or not on their
    // own, and its caps are the host's.
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
      }
    }
    // As it does whether a kind or an object wrote it, which anything
    // but a world may not, and whether an object named a kind at all.
    if (declared.kind === 'kind') {
      checkKindDeclaration(declared, diagnostics);
      for (const { declaration } of objectsIn(declared)) {
        checkKindDeclaration(declaration, diagnostics);
      }
    }
  }
  return { declarations, diagnostics: diagnostics.all };
}

/** What the first tier makes of a whole bundle. */
export interface FirstTier {
  /** Every declaration in a file that compiled, in the order read. */
  readonly declarations: readonly Declaration[];
  /** The same, by the library they are declared in: the world's under its namespace. */
  readonly byLibrary: ReadonlyMap<string, readonly Declaration[]>;
  /** Whether one of the world's own files was refused, which may be where something is declared. */
  readonly ownFileRefused: boolean;
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
  /** Whether one of the world's own files was refused by the first tier. */
  let ownFileRefused = false;
  for (const { library, file } of readable) {
    const shape = checkShape(file, caps);
    const refused = shape.diagnostics.some((d) => d.severity === 'refusal');
    if (refused && library === namespace) ownFileRefused = true;
    if (!refused) {
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
  return { declarations, byLibrary, ownFileRefused };
}
