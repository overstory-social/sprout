// Where visitors arrive, as a compile records it (the spec's The world
// model › Places; The compiler › What absent means). `resolveArrival`
// reads the world's `visitors arrive at` from the world's body, where it
// is written; a place nothing answers to is the absent table's
// `place-of-arrival` row, refused at publish, and at load the world
// admits no one. A place another file declares is named from the world,
// or imported, as any name is (the spec's Identifiers and scope).

import { writtenPath, type WorldDeclaration } from '../../syntax/ast.js';
import { resolveArrival } from '../../declare/world.js';
import type { Placement, TreePath } from '../../declare/tree.js';
import { absenceRule } from '../absent.js';
import type { DeclarationTables } from '../declarations.js';
import type { Report } from './report.js';

/**
 * The path of the place inside the world visitors arrive at, or null
 * having said why there is none. At publish what left it absent is not
 * told twice; at load the gap is recorded either way.
 */
export function arrivalPlace(
  declared: WorldDeclaration,
  tables: DeclarationTables,
  namespace: string,
  nameable: (file: string, placement: Placement) => boolean,
  report: Report,
): TreePath | null {
  const found = resolveArrival(declared, {
    tree: tables.tree,
    objects: tables.composed,
    kinds: tables.kinds,
    from: namespace,
    diagnostics: report.diagnostics,
  });
  if (found.found === 'place') {
    const written = declared.members.find((member) => member.kind === 'visitors-arrive-at');
    const first = written?.kind === 'visitors-arrive-at' ? written.place.parts[0] : undefined;
    const placement = first === undefined ? undefined : tables.tree.placed.get(first.text);
    if (
      first !== undefined &&
      placement !== undefined &&
      !nameable(first.at.source.name, placement)
    ) {
      report.diagnostics.refuse(
        first.at,
        `\`${first.text}\` is written in \`${placement.declaration.at.source.name}\`, and this file does not import it.`,
        `Name it from the world, as \`${[tables.tree.world, ...written!.place.parts.map((part) => part.text)].join('.')}\`.`,
      );
    }
    return found.path;
  }
  if (found.found === 'absent' && !(report.mode === 'publish' && found.said)) {
    report.gap(
      {
        what: writtenPath(found.path),
        kind: 'place-of-arrival',
        reason: 'missing',
        at: found.at,
        consequence: absenceRule('place-of-arrival').consequence,
      },
      found.message,
      found.remedy,
    );
  }
  return null;
}
