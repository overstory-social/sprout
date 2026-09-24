// The second tier's tables: every declaration in the closed bundle, the
// world's and its libraries' alike, resolved against the rest (the
// spec's The compiler › Two tiers). Each table is built for every
// library before the next, in the order they depend on one another:
// enums, then messages, which may carry an option; the names of the
// verbs, which a kind's plays name; kinds, whose properties may hold an
// option; verbs, whose roles may name a kind; what each kind's body gives
// its instances; then the world's objects, made of kinds and holding what
// those give, and the tree the world's body nests them in
// (`declare/tree.ts`).
//
// Three references here may name nothing, and each is a row of the
// absent table: refused at publish, a gap at load. A kind in a
// composition (`kind-in-composition`) leaves its object absent, and what
// it holds unreachable; a kind in a role (`kind-in-role`) leaves the role
// with nothing to fill it; a verb a play names (`verb`) leaves the play
// out.

import type {
  Declaration,
  EnumDeclaration,
  KindDeclaration,
  MessageDeclaration,
  WorldDeclaration,
} from '../syntax/ast.js';
import type { VerbDeclaration } from '../syntax/ast-verbs.js';
import type { Diagnostics } from '../source/diagnostics.js';
import { EnumTable, SPROUT } from '../declare/enums.js';
import { MessageTable } from '../declare/messages.js';
import { composesKind, KindTable } from '../declare/kinds.js';
import { VerbTable } from '../declare/verbs.js';
import { resolveContents, type KindContents } from '../declare/contents.js';
import {
  placedObjects,
  resolveObjects,
  type ComposedObject,
  type ResolvedObject,
} from '../declare/objects.js';
import type { OnUnknown } from '../declare/compose.js';
import { VerbNames, type OnUnknownVerb } from '../declare/roles.js';
import type { OnUnknownMessage } from '../declare/handlers.js';
import { placeObjects, type ObjectTree } from '../declare/tree.js';
import { absenceRule, type Absent, type ReferenceKind } from './absent.js';
import { NO_EXTENSIONS, type PinnedExtensions } from '../declare/extensions.js';

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
  /** Which verbs are declared, by name, which is what composing a play reads. */
  readonly verbNames: VerbNames;
  readonly verbs: VerbTable;
  /** What each kind's body gives every instance of it. */
  readonly contents: KindContents;
  /** The objects written in the world's body that could be composed and placed, in the order declared. */
  readonly objects: readonly ResolvedObject[];
  /** Every object of the world's that has a place, absent kinds included. */
  readonly tree: ObjectTree;
  /**
   * Every one of the world's objects, what its kinds gave it included,
   * each after what holds it, with its kind where it composed.
   */
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
 * Build every table over what parsed, by library. The objects are the
 * ones written in the body of the first world the world's own files
 * declare; a second world is refused where the world is read, and a
 * world in a library where the libraries are.
 */
export function resolveDeclarations(
  byLibrary: ReadonlyMap<string, readonly Declaration[]>,
  world: WorldNames,
  report: DeclarationReport,
  extensions: PinnedExtensions = NO_EXTENSIONS,
): DeclarationTables {
  const { diagnostics } = report;

  // An enum's identity is its library and its name, so two of one name
  // in one library collide and two in different libraries do not. The
  // extensions the world pins sit beside them, for `media.Image`.
  const enums = new EnumTable(extensions);
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

  // Which verbs exist needs nothing but their names, and composing a
  // kind's plays needs to know it; what fills a role needs the kinds.
  const verbNames = new VerbNames();
  for (const [library, declared] of byLibrary) {
    verbNames.add(
      library,
      declared.filter((d): d is VerbDeclaration => d.kind === 'verb'),
    );
  }
  const names = {
    verbs: verbNames,
    onUnknownVerb: unknownVerbGap(report),
    messages,
    onUnknownMessage: unknownMessageGap(report),
  };

  const onUnknown = unknownKindGap('kind-in-composition', report);

  const kinds = new KindTable();
  for (const [library, declared] of byLibrary) {
    kinds.add(
      library,
      declared.filter((d): d is KindDeclaration => d.kind === 'kind'),
      diagnostics,
    );
  }
  kinds.resolve(world.namespace, enums, diagnostics, onUnknown, names);

  const verbs = new VerbTable();
  const onUnknownKind = unknownKindGap('kind-in-role', report);
  for (const [library, declared] of byLibrary) {
    verbs.add(
      library,
      declared.filter((d): d is VerbDeclaration => d.kind === 'verb'),
      { kinds, enums, diagnostics, onUnknownKind },
    );
  }

  warnShadows(world.namespace, byLibrary.get(world.namespace) ?? [], {
    enums,
    messages,
    kinds,
    verbs,
    diagnostics,
  });

  const contents = resolveContents(
    new Map(
      [...byLibrary].map(([library, declared]) => [
        library,
        declared.filter((d): d is KindDeclaration => d.kind === 'kind'),
      ]),
    ),
    { enums, kinds, world: world.namespace, diagnostics, onUnknown, ...names },
  );

  const declared = (byLibrary.get(world.namespace) ?? []).find(
    (d): d is WorldDeclaration => d.kind === 'world',
  );
  const composed = resolveObjects(
    world.namespace,
    declared,
    { enums, kinds, diagnostics, onUnknown, ...names },
    contents,
  );
  const tree = placeObjects(composed, { world: world.name, diagnostics });

  return {
    enums,
    messages,
    kinds,
    verbNames,
    verbs,
    contents,
    objects: placedObjects(world.namespace, composed, tree),
    tree,
    composed,
  };
}

/** A kind nothing declares, as the absent table's row for where it was named. */
function unknownKindGap(
  reference: Extract<ReferenceKind, 'kind-in-composition' | 'kind-in-role'>,
  report: DeclarationReport,
): OnUnknown {
  const { consequence } = absenceRule(reference);
  return (written, message, remedy) =>
    report.gap(
      {
        what:
          written.library === null
            ? written.name.text
            : `${written.library.text}.${written.name.text}`,
        kind: reference,
        reason: 'missing',
        at: written.at,
        consequence,
      },
      message,
      remedy,
    );
}

/** A verb a play names that nothing declares, as the absent table's `verb` row. */
export function unknownVerbGap(report: DeclarationReport): OnUnknownVerb {
  const { consequence } = absenceRule('verb');
  return (play, message, remedy) =>
    report.gap(
      {
        what: play.head.verb.text,
        kind: 'verb',
        reason: 'missing',
        at: play.head.verb.at,
        consequence,
      },
      message,
      remedy,
    );
}

/** A message a handler, a pass rule or a send names that nothing declares, as the absent table's `message` row. */
export function unknownMessageGap(report: DeclarationReport): OnUnknownMessage {
  const { consequence } = absenceRule('message');
  return (written, message, remedy) =>
    report.gap(
      { what: `:${written.text}`, kind: 'message', reason: 'missing', at: written.at, consequence },
      message,
      remedy,
    );
}

/** The tables a shadowing warning asks whether the standard library declares a name. */
interface ShadowTables {
  readonly enums: EnumTable;
  readonly messages: MessageTable;
  readonly kinds: KindTable;
  readonly verbs: VerbTable;
  readonly diagnostics: Diagnostics;
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
  { enums, messages, kinds, verbs, diagnostics }: ShadowTables,
): void {
  if (namespace === SPROUT) return;
  const warned = new Set<string>();
  const shadow = (
    category: 'enum' | 'message' | 'kind' | 'verb',
    declared: EnumDeclaration | MessageDeclaration | KindDeclaration | VerbDeclaration,
    declaresInStandard: boolean,
  ): void => {
    const name = declared.name.text;
    const key = `${category}:${name}`;
    if (warned.has(key) || !declaresInStandard) return;
    warned.add(key);
    diagnostics.warn(
      declared.name.at,
      `\`${name}\` hides \`${SPROUT}.${name}\`: a bare \`${name}\` in this world is now yours.`,
      // No syntax writes a verb with its library, so the library's is
      // reached only by leaving the name to it.
      category === 'verb'
        ? `Where the library's \`${name}\` is still meant, give yours another name.`
        : `Write \`${SPROUT}.${name}\` where the library's is meant, or give yours another name.`,
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
      case 'kind': {
        // A kind that composes the one it hides plainly means both.
        const hidden = kinds.qualified(SPROUT, declared.name.text);
        const mine = kinds.qualified(namespace, declared.name.text);
        shadow('kind', declared, hidden !== null && (mine === null || !composesKind(mine, hidden)));
        break;
      }
      case 'verb':
        // An engine verb's name was refused, and hides nothing.
        shadow(
          'verb',
          declared,
          verbs.qualified(namespace, declared.name.text) !== null &&
            verbs.qualified(SPROUT, declared.name.text) !== null,
        );
        break;
    }
  }
}
