// The files an extension's values name (the spec's Extensions › What an
// extension may add; The compiler › What it refuses). A literal of a type
// that names files, written as an argument of an extension's statement,
// must name a file in the world's folder that the extension accepts as one
// of its kind; the files a world names travel beside its cartridge, and
// their total size is held to the host's cap. A world that did not come
// from a folder has none to look in, so no file is checked for.

import type { Declaration } from '../../syntax/ast.js';
import type { ExtensionStatement } from '../../syntax/ast-extensions.js';
import type { Span } from '../../source/source.js';
import {
  readLiteral,
  type ExtensionAsset,
  type PinnedExtensions,
  type Plain,
} from '../../declare/extensions.js';
import { parameterType } from '../../declare/types.js';
import type { BundleAsset, MicroworldSource } from '../bundle.js';
import type { StaticCaps } from '../limits.js';
import { atKey } from './manifest-fields.js';
import type { Report } from './report.js';

/** A file an extension's value names, and where the world wrote it. */
interface Named {
  readonly extension: string;
  readonly path: string;
  readonly asset: ExtensionAsset;
  readonly at: Span;
}

/** What the world names of its folder, checked: each file once, by path, and what they weigh together. */
export interface NamedAssets {
  readonly assets: readonly BundleAsset[];
  readonly assetBytes: number;
}

/** Every extension statement under `node`, in the order written. */
function statementsIn(node: unknown, found: ExtensionStatement[], seen: Set<unknown>): void {
  if (node === null || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const element of node) statementsIn(element, found, seen);
    return;
  }
  const fields = node as Record<string, unknown>;
  if (fields['kind'] === 'extension-statement') found.push(fields as unknown as ExtensionStatement);
  for (const [key, value] of Object.entries(fields)) {
    if (key !== 'at') statementsIn(value, found, seen);
  }
}

/** The files `statement` names as arguments, where its extension is installed and its type names files. */
function namedBy(statement: ExtensionStatement, extensions: PinnedExtensions): Named[] {
  const pinned = extensions.pinned.get(statement.extension.text);
  const installed = pinned?.installed;
  const declared = installed?.statements.find((one) => one.name === statement.name.text);
  if (installed === null || installed === undefined || declared === undefined) return [];
  const named: Named[] = [];
  statement.arguments.forEach((argument, index) => {
    const parameter = declared.parameters[index];
    const type = parameter === undefined ? null : parameterType(installed, parameter);
    if (type?.type !== 'extension' || type.definition?.asset === undefined) return;
    if (argument.kind !== 'string') return;
    const read = readLiteral(type.extension, type.definition, argument.value);
    if (!('value' in read)) return;
    const value: Plain = read.value;
    named.push({
      extension: installed.name,
      path: type.definition.asset.file(value),
      asset: type.definition.asset,
      at: argument.at,
    });
  });
  return named;
}

/**
 * The files the world's statements name, each looked for in the world's
 * folder and held to what its extension accepts of one, and their total
 * size held to `caps`. What is wrong is a refusal at publish and a
 * warning at load.
 */
export function nameAssets(
  source: MicroworldSource,
  declarations: readonly Declaration[],
  extensions: PinnedExtensions,
  caps: StaticCaps,
  report: Report,
): NamedAssets {
  const statements: ExtensionStatement[] = [];
  statementsIn(declarations, statements, new Set());
  const first = new Map<string, Named>();
  for (const named of statements.flatMap((statement) => namedBy(statement, extensions))) {
    if (!first.has(named.path)) first.set(named.path, named);
  }
  const assets: BundleAsset[] = [];
  const lookup = source.assets;
  if (lookup === undefined) return { assets, assetBytes: 0 };
  for (const named of [...first.values()].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const file = lookup(named.path);
    if (file === null) {
      report.strict(
        named.at,
        `The file "${named.path}" is not in this world’s folder.`,
        'Put the file there, with the path from the world’s folder written exactly, or name another.',
      );
      continue;
    }
    const problem = named.asset.check(file);
    if (problem !== null) {
      report.strict(named.at, `${named.path}: ${problem.problem}`, problem.remedy);
      continue;
    }
    assets.push({ extension: named.extension, path: named.path, bytes: file.bytes, sha: file.sha });
  }
  const assetBytes = assets.reduce((bytes, asset) => bytes + asset.bytes, 0);
  if (caps.assetBytes !== null && assetBytes > caps.assetBytes) {
    report.refuse(
      atKey(source.manifestFile, 'name'),
      `This world’s files for ${[...new Set(assets.map((asset) => asset.extension))].join(' and ')} are ${assetBytes} bytes, and ${caps.assetBytes} is as much as they may be.`,
      'Use fewer or smaller files.',
    );
  }
  return { assets, assetBytes };
}
