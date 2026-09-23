// The libraries a world vendored (the spec's Kinds › Libraries and
// namespaces; The world model › The manifest). A bundle is closed:
// everything the world says it uses travels with it, because nothing is
// resolved or fetched at run time. A library that did not travel, or
// whose source does not hash to what the manifest recorded, is a gap:
// refused at publish, and at load not used at all, since running against
// a library the world did not mean to vendor is worse than running
// without one.

import type { MicroworldSource, VendoredLibrary } from '../bundle.js';
import { bytesOf, libraryHash, type LibrarySource } from '../bundle.js';
import { atKey, atValue, NAMESPACE, SEMVER, SEMVER_REMEDY } from './manifest-fields.js';
import { refuseRepeats, type Report } from './report.js';

/** What a world runs without when a library is not there. */
const LIBRARY_GONE = 'every kind, enum, verb and message it holds reads as absent';

/** Vendor the libraries: hash each one, and ask the host's blessed set about the hash. */
function vendor(
  libraries: readonly LibrarySource[],
  blessed: ReadonlySet<string>,
): VendoredLibrary[] {
  return libraries.map((library) => {
    const hash = libraryHash(library);
    return {
      ...library,
      hash,
      blessed: blessed.has(hash),
      bytes: library.files.reduce((bytes, file) => bytes + bytesOf(file.text), 0),
    };
  });
}

/**
 * Check every library the manifest pins against what travelled, and
 * give back the ones the world may use, hashed and with the host's
 * blessing asked of each.
 */
export function checkLibraries(
  source: MicroworldSource,
  blessed: ReadonlySet<string>,
  report: Report,
): VendoredLibrary[] {
  const { manifest, manifestFile } = source;
  const vendored = vendor(source.libraries, blessed);
  const byName = new Map(vendored.map((library) => [library.name, library]));
  const librariesKey = atKey(manifestFile, 'libraries');
  refuseRepeats(
    report,
    vendored.map((library) => ({
      name: library.name,
      at: library.files[0]?.span(0, 0) ?? librariesKey,
    })),
    'libraries vendored',
  );
  refuseRepeats(
    report,
    manifest.libraries.map((pin) => ({
      name: pin.name,
      at: atValue(manifestFile, pin.name, librariesKey),
    })),
    'libraries used',
  );

  const unusable = new Set<string>();
  for (const pin of manifest.libraries) {
    const at = atValue(manifestFile, pin.name, librariesKey);
    if (!NAMESPACE.test(pin.name)) {
      report.refuse(
        at,
        `"${pin.name}" cannot be a library's name.`,
        'A name starts with a lower-case letter and holds letters, digits and _.',
      );
    }
    if (!SEMVER.test(pin.version)) {
      report.refuse(
        atValue(manifestFile, pin.version, at, at.start),
        `"${pin.version}" is not a version of the library "${pin.name}".`,
        SEMVER_REMEDY,
      );
    }
    const library = byName.get(pin.name);
    if (library === undefined) {
      unusable.add(pin.name);
      report.libraryRefused(pin.name);
      report.gap(
        { what: pin.name, kind: 'library', reason: 'missing', at, consequence: LIBRARY_GONE },
        `This world uses the library "${pin.name}", and its source did not travel with it.`,
        'A published world carries the full source of every library it uses: vendor it, or stop using it.',
      );
      continue;
    }
    if (library.hash !== pin.sha) {
      unusable.add(pin.name);
      report.libraryRefused(pin.name);
      report.gap(
        { what: pin.name, kind: 'library', reason: 'mismatched', at, consequence: LIBRARY_GONE },
        `The library "${pin.name}" that travelled is not the source the manifest recorded.`,
        'Vendor the library again, so that what travels and what the manifest records are one thing.',
      );
      continue;
    }
    // A version that is not one is said on its own, and not compared.
    const comparable = SEMVER.test(pin.version) && SEMVER.test(library.version);
    if (comparable && library.version !== pin.version) {
      report.strict(
        at,
        `The manifest records "${pin.name}" at version ${pin.version}, and the source that travelled says ${library.version}.`,
        'The source is what runs; correct the version the manifest records.',
      );
    }
  }
  // The version a vendored library says of itself is read as its pin's
  // is. Where the pin wrote the same text, that has been said once already.
  for (const library of vendored) {
    if (SEMVER.test(library.version)) continue;
    const pin = manifest.libraries.find((p) => p.name === library.name);
    if (pin?.version === library.version) continue;
    report.refuse(
      pin === undefined
        ? (library.files[0]?.span(0, 0) ?? librariesKey)
        : atValue(manifestFile, pin.name, librariesKey),
      `The library "${library.name}" that travelled says its version is "${library.version}", which is not a version.`,
      `${SEMVER_REMEDY} Vendor a copy that says one.`,
    );
  }
  const used = new Set(manifest.libraries.map((pin) => pin.name));
  for (const library of vendored) {
    if (used.has(library.name)) continue;
    report.warn(
      library.files[0]?.span(0, 0) ?? librariesKey,
      `The library "${library.name}" travels with this world and the world does not use it.`,
      'Remove it from the world, or name it among the libraries the world uses.',
    );
  }
  for (const library of vendored) {
    refuseRepeats(
      report,
      library.files.map((file) => ({ name: file.name, at: file.span(0, 0) })),
      `files in the library "${library.name}"`,
    );
  }

  // A library whose source is not the recorded source is not used at
  // all. Running a world against a library it did not mean to vendor
  // would be worse than running it without one.
  return vendored.filter((library) => !unusable.has(library.name));
}
