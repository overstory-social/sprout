// The world a bundle holds, and what it and its visitors are made of
// (the spec's The world model, Actors and visitors; The manifest; The
// compiler › What absent means). A bundle holds exactly one `world`
// declaration, named as the manifest; it composes as a kind does, and
// `visitors are` names the world's own kind composing `sprout.Visitor`.
// None, or two, is the absent table's `world` row, and so is a kind the
// world is made of that is not there; a visitor kind that is not there is
// its `visitor-kind` row. Each is refused at publish, and at load the
// world admits no one.

import type { Declaration, WorldDeclaration } from '../../syntax/ast.js';
import type { MicroworldSource } from '../bundle.js';
import type { KindRef } from '../../declare/kinds.js';
import { writtenKind } from '../../declare/compose.js';
import { composeWorld, resolveVisitors } from '../../declare/world.js';
import type { Span } from '../../source/source.js';
import { absenceRule } from '../absent.js';
import { unknownVerbGap, type DeclarationTables } from '../declarations.js';
import { atKey } from './manifest-fields.js';
import type { Report } from './report.js';

/**
 * The world's one `world` declaration, named as the manifest, or null
 * having said why there is not one. Only the world's own declarations
 * are read for it; a world in a library is refused, and what it holds with it.
 */
export function oneWorld(
  source: MicroworldSource,
  byLibrary: ReadonlyMap<string, readonly Declaration[]>,
  ownFileRefused: boolean,
  report: Report,
): WorldDeclaration | null {
  const { manifest, manifestFile } = source;
  // The world model › The manifest: "A bundle holds exactly one `world`
  // declaration, and its name is the manifest's `name`: none, more than
  // one, or one under another name is refused." Only the world's OWN
  // declarations are read for this, never a library's.
  const ownWorlds = (byLibrary.get(manifest.namespace) ?? []).filter(
    (d): d is WorldDeclaration => d.kind === 'world',
  );
  // At publish, a file the first tier refused may well be the one that
  // holds the world, and the bundle is refused for that defect already,
  // so "none" is not said until every file reads. At load that file is
  // absent instead, and "none" is answered over what is usable, the same
  // as every other gap.
  const noneToRead = report.mode === 'publish' && ownFileRefused;
  if (ownWorlds.length === 0 && !noneToRead) {
    report.gap(
      {
        what: manifest.name,
        kind: 'world',
        reason: 'missing',
        at: atKey(manifestFile, 'name'),
        consequence: 'the world admits no one until it has one',
      },
      'This world has no `world` declaration.',
      `Write one, in one of its files: \`world ${manifest.name} is sprout.World { … }\`.`,
    );
  } else if (ownWorlds.length > 1) {
    // There is no principled way to choose among several, so every one
    // after the first is the same gap: the world does not have the one
    // declaration the manifest needs.
    for (const extra of ownWorlds.slice(1)) {
      report.gap(
        {
          what: extra.name.text,
          kind: 'world',
          reason: 'missing',
          at: extra.name.at,
          consequence: 'the world admits no one until there is one',
        },
        'There are two `world` declarations, and a world has one.',
        'Remove one, or move what it holds into the other.',
      );
    }
  } else if (ownWorlds.length === 1 && ownWorlds[0]!.name.text !== manifest.name) {
    const named = ownWorlds[0]!;
    report.refuse(
      named.name.at,
      `\`${named.name.text}\` is not this world's name.`,
      `The manifest names it \`${manifest.name}\`; write \`world ${manifest.name} is sprout.World { … }\`, or change the manifest.`,
    );
  }

  // A library is vendored source, not the world: only the world's own
  // files may declare it, and with it everything in its tree.
  for (const [library, declared] of byLibrary) {
    if (library === manifest.namespace) continue;
    for (const stray of declared) {
      if (stray.kind !== 'world') continue;
      report.refuse(
        stray.name.at,
        'A library does not declare a world.',
        "The world's own files do; move it there, or remove it from the library.",
      );
    }
  }
  return ownWorlds.length === 1 && ownWorlds[0]!.name.text === manifest.name ? ownWorlds[0]! : null;
}

/** What the world and a visitor are made of; each null only in a loaded world that admits no one. */
export interface WorldKinds {
  readonly world: KindRef | null;
  readonly visitor: KindRef | null;
}

/**
 * Compose the world and read what its visitors are made of. At publish a
 * visitor kind is not said to be missing while one of the world's own
 * files was refused, since that file may be where it is declared, and
 * what left it absent, where that has been told, is not told twice.
 */
export function worldKinds(
  declared: WorldDeclaration,
  tables: DeclarationTables,
  namespace: string,
  ownFileRefused: boolean,
  report: Report,
): WorldKinds {
  const gap = (
    kind: 'world' | 'visitor-kind',
    what: string,
    at: Span,
    message: string,
    remedy: string,
  ): void =>
    report.gap(
      { what, kind, reason: 'missing', at, consequence: absenceRule(kind).consequence },
      message,
      remedy,
    );
  const context = {
    enums: tables.enums,
    kinds: tables.kinds,
    from: namespace,
    diagnostics: report.diagnostics,
  };
  let told = false;
  const world = composeWorld(declared, {
    ...context,
    verbs: tables.verbNames,
    onUnknownVerb: unknownVerbGap(report),
    onUnknown: (written, message, remedy) => {
      told = true;
      gap('world', writtenKind(written), written.at, message, remedy);
    },
  });
  // At publish what stopped it composing has refused already.
  if (world === null && !told && report.mode === 'load') {
    const name = declared.name.text;
    gap(
      'world',
      name,
      declared.name.at,
      `\`${name}\` is made of a kind that is absent.`,
      `Bring back what \`${name}\` composes.`,
    );
  }
  const found = resolveVisitors(declared, context);
  if (found.found === 'absent' && !(report.mode === 'publish' && (found.said || ownFileRefused))) {
    gap('visitor-kind', found.what, found.at, found.message, found.remedy);
  }
  return { world, visitor: found.found === 'kind' ? found.kind : null };
}
