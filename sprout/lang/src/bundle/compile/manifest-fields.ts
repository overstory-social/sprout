// What a world says about itself before any of it is read (the spec's
// The world model › The manifest): its name and namespace, its version,
// who made it and on what terms, the level it was written for, and the
// extensions it pins. None of it needs a parser. The manifest arrives
// already read, so where a problem with it was written is found in its
// text (`atKey`, `atValue`), which the files and libraries read too.

import type { MicroworldSource } from '../bundle.js';
import type { Span, SourceFile } from '../../source/source.js';
import { refuseRepeats, type Report } from './report.js';

/**
 * Where a manifest key was written, so a problem with the manifest names
 * a line and column like everything else. The manifest arrives already
 * read, so this looks for the key in the text it was read from and falls
 * back to the head of the file.
 */
export function atKey(manifest: SourceFile, key: string): Span {
  const at = manifest.text.indexOf(`"${key}"`);
  return at < 0 ? manifest.span(0, 0) : manifest.span(at, at + key.length + 2);
}

/**
 * Where a value was written inside the manifest, for a problem about one
 * entry of a list. It finds the first place the value is written at or
 * after `from`, which is the right one for a name that appears once —
 * scaffolding until the manifest is read with spans of its own rather
 * than arriving parsed.
 */
export function atValue(manifest: SourceFile, value: string, fallback: Span, from = 0): Span {
  const at = manifest.text.indexOf(`"${value}"`, from);
  return at < 0 ? fallback : manifest.span(at, at + value.length + 2);
}

/** A world or library name: the namespace its declarations are unqualified in. */
export const NAMESPACE = /^[a-z][a-z0-9_]*$/;

// The manifest's `version` row: "which version of this world this is, as
// semver" (the spec's The world model › The manifest). A library's
// version, as the manifest pins it and as its vendored source says it, is
// read the same way. The expression is the one semver.org publishes for
// recognizing a semantic version.
export const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** What to write instead of a version that is not one, the world's or a library's. */
export const SEMVER_REMEDY =
  'A version is three numbers with dots, as in 0.1.0; a pre-release or build tag may follow, as in 1.2.0-beta.1.';

/** Refuse what the manifest's own fields get wrong, in either mode. */
export function checkManifest(source: MicroworldSource, report: Report): void {
  const { manifest, manifestFile } = source;
  if (!NAMESPACE.test(manifest.name)) {
    report.refuse(
      atKey(manifestFile, 'name'),
      `"${manifest.name}" cannot be a world's name.`,
      'A name starts with a lower-case letter and holds letters, digits and _.',
    );
  }
  if (manifest.namespace !== manifest.name && !NAMESPACE.test(manifest.namespace)) {
    report.refuse(
      atKey(manifestFile, 'namespace'),
      `"${manifest.namespace}" cannot be a world's namespace.`,
      'A namespace starts with a lower-case letter and holds letters, digits and _.',
    );
  }
  // A world's own declarations are unqualified in its namespace, so a
  // namespace equal to a pinned library's name would make every one of
  // the world's own declarations indistinguishable from that library's.
  if (manifest.libraries.some((pin) => pin.name === manifest.namespace)) {
    report.refuse(
      atKey(manifestFile, 'namespace'),
      `This world's namespace, \`${manifest.namespace}\`, is also the name of a library it uses.`,
      'Give the manifest a `namespace` that names no library.',
    );
  }
  for (const [key, value] of [
    ['version', manifest.version],
    ['author', manifest.author],
    ['license', manifest.license],
  ] as const) {
    if (value.trim() === '') {
      report.refuse(
        atKey(manifestFile, key),
        `This world's ${key} is empty.`,
        key === 'license'
          ? 'Write the terms it is offered under, such as MIT.'
          : `Write the ${key} in the manifest.`,
      );
    }
  }
  if (manifest.version.trim() !== '' && !SEMVER.test(manifest.version)) {
    report.refuse(
      atKey(manifestFile, 'version'),
      `"${manifest.version}" is not a version.`,
      SEMVER_REMEDY,
    );
  }
  if (!Number.isInteger(manifest.level) || manifest.level < 1) {
    report.refuse(
      atKey(manifestFile, 'level'),
      `A language level is a whole number from 1 up, not ${manifest.level}.`,
      'Write 1 if you are not sure which level this world needs.',
    );
  }

  const extensionsKey = atKey(manifestFile, 'extensions');
  for (const pin of manifest.extensions) {
    if (!Number.isInteger(pin.major) || pin.major < 0) {
      report.refuse(
        atValue(manifestFile, pin.name, extensionsKey),
        `The extension "${pin.name}" is pinned to major version ${pin.major}.`,
        'A major version is a whole number from 0 up.',
      );
    }
  }
  refuseRepeats(
    report,
    manifest.extensions.map((pin) => ({
      name: pin.name,
      at: atValue(manifestFile, pin.name, extensionsKey),
    })),
    'extensions pinned',
  );
}
