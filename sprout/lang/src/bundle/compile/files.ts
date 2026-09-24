// The files a world is made of, against the ones its manifest names
// (the spec's The world model › Files, The manifest; The compiler › What
// absent means). `files` is what makes a file that did not arrive missing
// rather than merely absent. At publish what travelled must be exactly
// what the manifest names; at load a file named and not delivered, or
// one the host withholds, is a gap the world runs around, and one that
// travelled unnamed is only said.

import type { MicroworldSource } from '../bundle.js';
import type { SourceFile } from '../../source/source.js';
import { atKey, atValue } from './manifest-fields.js';
import { refuseRepeats, type Report } from './report.js';

/** What a world runs without when one of its own files is not there. */
export const FILE_GONE = 'everything it declared reads as absent, and its objects keep their state';

/** Whether a file is code, read for its declarations. */
export function isCode(file: SourceFile): boolean {
  return file.name.endsWith('.sprout');
}

/** Whether a file is prose, read for its passages (the spec's Prose › Passages). */
export function isProse(file: SourceFile): boolean {
  return file.name.endsWith('.prose');
}

/** A world's own files are its `.sprout` files and the `.prose` files they point at. */
function isWorldFile(name: string): boolean {
  return name.endsWith('.sprout') || name.endsWith('.prose');
}

/**
 * Check the files that travelled against the ones the manifest names,
 * and give back the names of those the host is withholding.
 */
export function checkFiles(source: MicroworldSource, report: Report): ReadonlySet<string> {
  const { manifest, manifestFile } = source;
  const withheld = new Set(source.withheld ?? []);
  const filesKey = atKey(manifestFile, 'files');
  refuseRepeats(
    report,
    manifest.files.map((name) => ({ name, at: atValue(manifestFile, name, filesKey) })),
    'files named',
  );
  for (const name of manifest.files) {
    if (!isWorldFile(name)) {
      report.refuse(
        atValue(manifestFile, name, filesKey),
        `"${name}" is not a file this world can be made of.`,
        'A world is written in `.sprout` files and the `.prose` files they point at.',
      );
    }
  }

  const arrivedByName = new Map(source.files.map((file) => [file.name, file]));
  refuseRepeats(
    report,
    source.files.map((file) => ({ name: file.name, at: file.span(0, 0) })),
    'files',
  );

  // A file the host is withholding did not travel. At publish that
  // refuses: a world is not published with a piece held back. At load it
  // is a gap, and a reversible one — restoring the file brings its
  // objects back as they were, because their state was never touched.
  for (const name of withheld) {
    report.gap(
      {
        what: name,
        kind: 'file',
        reason: 'withheld',
        at: atValue(manifestFile, name, filesKey),
        consequence: FILE_GONE,
      },
      `The file "${name}" is being withheld.`,
      'Restore it, or publish the world without what it held.',
    );
  }

  // The manifest enumerates the world's own files, so what travelled is
  // checked against what was meant to rather than inferred from it.
  for (const name of manifest.files) {
    if (arrivedByName.has(name) || withheld.has(name)) continue;
    report.gap(
      {
        what: name,
        kind: 'file',
        reason: 'missing',
        at: atValue(manifestFile, name, filesKey),
        consequence: FILE_GONE,
      },
      `The manifest names the file "${name}", and it did not travel with the world.`,
      'Add the file, or take its name out of the manifest.',
    );
  }
  const named = new Set(manifest.files);
  for (const file of source.files) {
    if (named.has(file.name)) continue;
    report.strict(
      file.span(0, 0),
      `The file "${file.name}" travelled with this world and the manifest does not name it.`,
      'Name it among the world’s files, or leave it out of the world.',
    );
  }
  return withheld;
}
