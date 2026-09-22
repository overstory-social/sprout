// The second tier's tables: every declaration in the closed bundle, the
// world's and its libraries' alike, resolved against the rest (the
// spec's The compiler › Two tiers). Each table is built for every
// library before the next, in the order they depend on one another:
// enums, then messages, which may carry an option; kinds, whose
// properties may hold one; then the world's objects, made of kinds.
//
// A kind nothing declares, named in a composition, is the absent table's
// `kind-in-composition` row: refused at publish, a gap at load, and the
// object made of it is absent.

import type { Declaration, KindDeclaration, ObjectDeclaration } from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import { EnumTable } from '../declare/enums.js';
import { MessageTable } from '../declare/messages.js';
import { KindTable } from '../declare/kinds.js';
import { resolveObjects, type ResolvedObject } from '../declare/objects.js';
import type { OnUnknown } from '../declare/compose.js';
import { absenceRule, type Absent } from './absent.js';

/** What the tables need from a compile: somewhere to say things, and the mode's answer to a gap. */
export interface DeclarationReport {
  readonly diagnostics: Diagnostics;
  gap(absent: Absent, message: string, remedy?: string): void;
}

/** Every declaration the bundle holds, resolved. */
export interface DeclarationTables {
  readonly enums: EnumTable;
  readonly messages: MessageTable;
  readonly kinds: KindTable;
  /** The world's own objects that could be composed. */
  readonly objects: readonly ResolvedObject[];
}

/**
 * Build every table over what parsed, by library. Only the world's own
 * files (`world`, its namespace) declare objects; one in a library is
 * refused where the libraries are read.
 */
export function resolveDeclarations(
  byLibrary: ReadonlyMap<string, readonly Declaration[]>,
  world: string,
  report: DeclarationReport,
): DeclarationTables {
  const { diagnostics } = report;

  // An enum's identity is its library and its name, so two of one name
  // in one library collide and two in different libraries do not.
  const enums = new EnumTable();
  for (const [library, declared] of byLibrary) {
    enums.add(
      library,
      declared.filter((d) => d.kind === 'enum'),
      diagnostics,
    );
  }

  const messages = new MessageTable();
  for (const [library, declared] of byLibrary) {
    messages.add(
      library,
      declared.filter((d) => d.kind === 'message'),
      enums,
      diagnostics,
    );
  }

  const { consequence } = absenceRule('kind-in-composition');
  const onUnknown: OnUnknown = (written, message, remedy) =>
    report.gap(
      {
        what:
          written.library === null
            ? written.name.text
            : `${written.library.text}.${written.name.text}`,
        kind: 'kind-in-composition',
        reason: 'missing',
        at: written.at,
        consequence,
      },
      message,
      remedy,
    );

  const kinds = new KindTable();
  for (const [library, declared] of byLibrary) {
    kinds.add(
      library,
      declared.filter((d): d is KindDeclaration => d.kind === 'kind'),
      diagnostics,
    );
  }
  kinds.resolve(enums, diagnostics, onUnknown);

  const objects = resolveObjects(
    world,
    (byLibrary.get(world) ?? []).filter((d): d is ObjectDeclaration => d.kind === 'object'),
    { enums, kinds, diagnostics, onUnknown },
  );

  return { enums, messages, kinds, objects };
}
