// The extensions a world pins, against the ones the host installed, and
// the `extension` lines at the top of each file against the manifest
// (the spec's Extensions › Activation and absence; The compiler › What it
// refuses, What absent means). A pin the host cannot supply at its major
// refuses at publish; at load it is a gap, and the world runs with its
// statements recording nothing and its types holding their defaults. A
// file names only what the manifest pins, at the major it pins.

import type { Declaration } from '../../syntax/ast.js';
import type { SourceFile } from '../../source/source.js';
import {
  pinExtensions,
  type Extension,
  type PinnedExtension,
  type PinnedExtensions,
} from '../../declare/extensions.js';
import { SPROUT } from '../../declare/enums.js';
import { absenceRule } from '../absent.js';
import type { MicroworldSource } from '../bundle.js';
import { atKey, atValue, NAMESPACE } from './manifest-fields.js';
import type { Report } from './report.js';

/**
 * Pin the manifest's extensions against `installed`, and read which
 * each parsed file names at its top. What is wrong with either is said
 * to `report`; what comes back holds only what a file may use.
 */
export function pinnedExtensions(
  source: MicroworldSource,
  installed: readonly Extension[],
  declarations: ReadonlyMap<string, readonly Declaration[]>,
  report: Report,
): PinnedExtensions {
  const { manifest, manifestFile } = source;
  const key = atKey(manifestFile, 'extensions');
  const pinned = pinExtensions(manifest.extensions, installed);
  const libraries = new Set([SPROUT, manifest.namespace, ...manifest.libraries.map((l) => l.name)]);
  for (const pin of pinned.values()) {
    const at = atValue(manifestFile, pin.name, key);
    if (!NAMESPACE.test(pin.name)) {
      report.refuse(
        at,
        `"${pin.name}" cannot name an extension.`,
        'An extension is named as a file writes it: lower-case, with letters, digits and _.',
      );
      continue;
    }
    if (libraries.has(pin.name)) {
      report.refuse(
        at,
        `\`${pin.name}\` names both an extension and a library or namespace of this world, so \`${pin.name}.\` could mean either.`,
        'Pin only extensions whose names no library or namespace of this world takes.',
      );
      continue;
    }
    if (pin.absence === null) continue;
    report.gap(
      {
        what: pin.name,
        kind: 'extension',
        reason: 'missing',
        at,
        consequence: absenceRule('extension').consequence,
      },
      pin.absence === 'not-installed'
        ? `This host does not provide the extension \`${pin.name}\`.`
        : `This host provides the extension \`${pin.name}\`, and not at major version ${pin.major}.`,
      pin.absence === 'not-installed'
        ? `Ask whoever runs this host to install \`${pin.name}\`, or take it out of the manifest and every file that names it.`
        : `Pin the major version this host provides, if the world reads the same with it.`,
    );
  }
  return { pinned, named: namedByFile(pinned, declarations, report) };
}

/** Each file's `extension` lines, checked against what the manifest pins. */
function namedByFile(
  pinned: ReadonlyMap<string, PinnedExtension>,
  declarations: ReadonlyMap<string, readonly Declaration[]>,
  report: Report,
): Map<SourceFile, Set<string>> {
  const named = new Map<SourceFile, Set<string>>();
  for (const declared of declarations.values()) {
    for (const used of declared) {
      if (used.kind !== 'extension-use') continue;
      const name = used.name.text;
      const file = used.at.source;
      const names = named.get(file) ?? new Set<string>();
      named.set(file, names);
      const pin = pinned.get(name);
      if (names.has(name)) {
        report.refuse(
          used.name.at,
          `This file names the extension \`${name}\` twice.`,
          'Keep one `extension` line for it.',
        );
      } else if (pin === undefined) {
        report.refuse(
          used.name.at,
          `The manifest does not pin the extension \`${name}\`.`,
          `Pin it in the manifest, as in \`"extensions": [{ "name": "${name}", "major": ${used.major.value} }]\`.`,
        );
      } else {
        // Named at another major, it is still the one the file means, so
        // what the file writes of it is not refused a second time.
        names.add(name);
        if (pin.major === used.major.value) continue;
        report.refuse(
          used.major.at,
          `The manifest pins \`${name}\` at major version ${pin.major}, and this file names ${used.major.value}.`,
          `Write \`extension ${name} ${pin.major}\`, the major version the manifest pins.`,
        );
      }
    }
  }
  return named;
}
