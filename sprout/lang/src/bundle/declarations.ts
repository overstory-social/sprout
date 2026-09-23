// The second tier's tables: every declaration in the closed bundle, the
// world's and its libraries' alike, resolved against the rest (the
// spec's The compiler › Two tiers). Each table is built for every
// library before the next, in the order they depend on one another:
// enums, then messages, which may carry an option; kinds, whose
// properties may hold one; then the world's objects, made of kinds, and
// the tree they are placed in (`declare/tree.ts`).
//
// Two references here may name nothing, and each is a row of the absent
// table: refused at publish, a gap at load. A kind in a composition
// (`kind-in-composition`) leaves its object absent; a step of an
// object's `in` (`container`) leaves the object absent, and what it
// holds with it.

import {
  writtenPath,
  type Declaration,
  type EnumDeclaration,
  type KindDeclaration,
  type MessageDeclaration,
  type ObjectDeclaration,
} from '../syntax/ast.js';
import type { Diagnostics } from '../source/diagnostics.js';
import { EnumTable, SPROUT } from '../declare/enums.js';
import { MessageTable } from '../declare/messages.js';
import { KindTable } from '../declare/kinds.js';
import {
  placedObjects,
  resolveObjects,
  type ComposedObject,
  type ResolvedObject,
} from '../declare/objects.js';
import type { OnUnknown } from '../declare/compose.js';
import { placeObjects, type ObjectTree, type OnUnknownContainer } from '../declare/tree.js';
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
  /** The world's own objects that could be composed and placed, in the order declared. */
  readonly objects: readonly ResolvedObject[];
  /** Every object of the world's that has a place, absent kinds included. */
  readonly tree: ObjectTree;
  /** Every one of the world's objects, in the order declared, with its kind where it composed. */
  readonly composed: readonly ComposedObject[];
}

/** Whose declarations the tables are built for. */
export interface WorldNames {
  /** The namespace the world's own declarations are in: only its files declare objects. */
  readonly namespace: string;
  /** The world's name, which is the root of the tree. */
  readonly name: string;
}

/**
 * Build every table over what parsed, by library. Only the world's own
 * files declare objects; one in a library is refused where the libraries
 * are read.
 */
export function resolveDeclarations(
  byLibrary: ReadonlyMap<string, readonly Declaration[]>,
  world: WorldNames,
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

  warnShadows(
    world.namespace,
    byLibrary.get(world.namespace) ?? [],
    enums,
    messages,
    kinds,
    diagnostics,
  );

  const composed = resolveObjects(
    world.namespace,
    (byLibrary.get(world.namespace) ?? []).filter(
      (d): d is ObjectDeclaration => d.kind === 'object',
    ),
    { enums, kinds, diagnostics, onUnknown },
  );

  const container = absenceRule('container').consequence;
  const onUnknownContainer: OnUnknownContainer = (path, step, message, remedy) =>
    report.gap(
      {
        what: writtenPath(path),
        kind: 'container',
        reason: 'missing',
        at: step.at,
        consequence: container,
      },
      message,
      remedy,
    );
  const tree = placeObjects(composed, {
    world: world.name,
    diagnostics,
    onUnknown: onUnknownContainer,
  });

  return {
    enums,
    messages,
    kinds,
    objects: placedObjects(world.namespace, composed, tree),
    tree,
    composed,
  };
}

/**
 * Warn, once per name, where the world's own declarations take a name the
 * standard library also declares (the spec's Kinds, composition and
 * libraries › Libraries and namespaces: "A world's own declaration taking
 * a standard library name shadows the unqualified form, with a
 * warning."). Only `sprout` counts: a name shared with another pinned
 * library is reachable only qualified and shadows nothing. A world
 * namespaced `sprout` is refused at the manifest before this runs; here
 * it would only mean the standard library's own declarations of
 * themselves, so it warns of nothing.
 */
function warnShadows(
  namespace: string,
  own: readonly Declaration[],
  enums: EnumTable,
  messages: MessageTable,
  kinds: KindTable,
  diagnostics: Diagnostics,
): void {
  if (namespace === SPROUT) return;
  const warned = new Set<string>();
  const shadow = (
    category: 'enum' | 'message' | 'kind',
    declared: EnumDeclaration | MessageDeclaration | KindDeclaration,
    declaresInStandard: boolean,
  ): void => {
    const name = declared.name.text;
    const key = `${category}:${name}`;
    if (warned.has(key) || !declaresInStandard) return;
    warned.add(key);
    diagnostics.warn(
      declared.name.at,
      `\`${name}\` hides \`${SPROUT}.${name}\`: a bare \`${name}\` in this world is now yours.`,
      `Write \`${SPROUT}.${name}\` where the library's is meant, or give yours another name.`,
    );
  };
  for (const declared of own) {
    switch (declared.kind) {
      case 'enum':
        shadow('enum', declared, enums.qualified(SPROUT, declared.name.text) !== null);
        break;
      case 'message':
        shadow('message', declared, messages.qualified(SPROUT, declared.name.text) !== null);
        break;
      case 'kind':
        shadow('kind', declared, kinds.qualified(SPROUT, declared.name.text) !== null);
        break;
    }
  }
}
