// The files an extension's values name (the spec's Extensions › What an
// extension may add, Activation and absence; The compiler › What it
// refuses). A literal of a type that names files, written where such a
// literal is written (a statement's argument or a property's default),
// must name a file in the world's folder that the extension accepts as one
// of its kind. Every value of the type a world can hold starts from one of
// those literals, so the files they name are every file the world can show;
// they travel in its cartridge as their extension packs them, and their total size is held to the
// host's cap. A world that did not come from a folder has none to look in,
// so no file is checked for.

import type { Declaration, PropertyDeclaration } from '../../syntax/ast.js';
import type { ExtensionStatement } from '../../syntax/ast-extensions.js';
import type { Span } from '../../source/source.js';
import {
  readLiteral,
  type ExtensionAsset,
  type PinnedExtensions,
  type Plain,
} from '../../declare/extensions.js';
import type { ResolvedProperty } from '../../declare/properties.js';
import { parameterType, type ValueType } from '../../declare/types.js';
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

/** What the world wrote that may hold a literal of an extension's type. */
interface Written {
  readonly statements: ExtensionStatement[];
  readonly properties: Set<PropertyDeclaration>;
}

/** Every extension statement and property declaration under `node`, statements in the order written. */
function writtenIn(node: unknown, found: Written, seen: Set<unknown>): void {
  if (node === null || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const element of node) writtenIn(element, found, seen);
    return;
  }
  const fields = node as Record<string, unknown>;
  if (fields['kind'] === 'extension-statement') {
    found.statements.push(fields as unknown as ExtensionStatement);
  }
  if (fields['kind'] === 'property') found.properties.add(fields as unknown as PropertyDeclaration);
  for (const [key, value] of Object.entries(fields)) {
    if (key !== 'at') writtenIn(value, found, seen);
  }
}

/** The file `text`, written at `at` as a literal of `type`, names; null where the type names none or does not read it. */
function namedAs(type: ValueType | null, text: string, at: Span): Named | null {
  if (type?.type !== 'extension' || type.definition?.asset === undefined) return null;
  const read = readLiteral(type.extension, type.definition, text);
  if (!('value' in read)) return null;
  const value: Plain = read.value;
  return {
    extension: type.extension,
    path: type.definition.asset.file(value),
    asset: type.definition.asset,
    at,
  };
}

/** The files `statement` names as arguments, where its extension is installed and its type names files. */
function namedBy(statement: ExtensionStatement, extensions: PinnedExtensions): Named[] {
  const pinned = extensions.pinned.get(statement.extension.text);
  const installed = pinned?.installed;
  const declared = installed?.statements.find((one) => one.name === statement.name.text);
  if (installed === null || installed === undefined || declared === undefined) return [];
  return statement.arguments.flatMap((argument, index) => {
    const parameter = declared.parameters[index];
    const type = parameter === undefined ? null : parameterType(installed, parameter);
    if (argument.kind !== 'string') return [];
    return namedAs(type, argument.value, argument.at) ?? [];
  });
}

/** The file a property's default names, where the world wrote the property and its type names files. */
function namedByDefault(property: ResolvedProperty, written: ReadonlySet<unknown>): Named[] {
  const { declaration } = property;
  const literal = declaration.default;
  if (!written.has(declaration) || literal?.kind !== 'string') return [];
  const named = namedAs(property.type, literal.value, literal.at);
  return named === null ? [] : [named];
}

/**
 * The files the world's statements and property defaults name, each
 * looked for in the world's folder and held to what its extension accepts
 * of one, and their total size held to `caps`. `properties` are every
 * kind's resolved properties, of which those the world's own
 * `declarations` write are read. What is wrong is a refusal at publish
 * and a warning at load.
 */
export function nameAssets(
  source: MicroworldSource,
  declarations: readonly Declaration[],
  properties: Iterable<ResolvedProperty>,
  extensions: PinnedExtensions,
  caps: StaticCaps,
  report: Report,
): NamedAssets {
  const written: Written = { statements: [], properties: new Set() };
  writtenIn(declarations, written, new Set());
  const named = [
    ...written.statements.flatMap((statement) => namedBy(statement, extensions)),
    ...[...properties].flatMap((property) => namedByDefault(property, written.properties)),
  ];
  const first = new Map<string, Named>();
  for (const one of named) if (!first.has(one.path)) first.set(one.path, one);
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
    const packed = named.asset.pack(file);
    if ('problem' in packed) {
      report.strict(named.at, `${named.path}: ${packed.problem}`, packed.remedy);
      continue;
    }
    assets.push({
      extension: named.extension,
      path: named.path,
      bytes: file.bytes,
      sha: file.sha,
      packed: packed.packed,
    });
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
