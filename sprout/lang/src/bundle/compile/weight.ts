// What a bundle weighs, before a line of it is read (the spec's Limits ›
// Static caps; The compiler › Language levels). Its level is the highest
// of any of its parts, library source included, and a compiler refuses
// text newer than itself in either mode, because it cannot read what it
// does not know. Its source bytes and files are counted against the
// host's caps; blessed library source costs the author nothing, and a
// modified copy is the author's own source and counts as it.

import type { MicroworldSource, VendoredLibrary } from '../bundle.js';
import { bytesOf } from '../bundle.js';
import type { StaticCaps } from '../limits.js';
import type { SourceFile } from '../../source/source.js';
import { atKey } from './manifest-fields.js';
import type { Report } from './report.js';

/** What a bundle weighs, and the parts that were weighed. */
export interface Weight {
  /** The highest level of any part, library source included. */
  readonly level: number;
  /** The world's own files that travelled and are not withheld. */
  readonly arrived: readonly SourceFile[];
  /** The usable libraries the host has not blessed, which count as the author's source. */
  readonly charged: readonly VendoredLibrary[];
  readonly files: number;
  readonly sourceBytes: number;
  readonly exemptBytes: number;
}

/**
 * Weigh a bundle's own files, less the withheld ones, and its usable
 * libraries, refusing a level newer than `compilerLevel` and a source or
 * file cap it is past.
 */
export function weighBundle(
  source: MicroworldSource,
  usable: readonly VendoredLibrary[],
  withheld: ReadonlySet<string>,
  caps: StaticCaps,
  compilerLevel: number,
  report: Report,
): Weight {
  const { manifest, manifestFile } = source;
  const level = usable.reduce(
    (highest, library) => Math.max(highest, library.level),
    manifest.level,
  );
  if (level > compilerLevel) {
    const newer = usable.filter((library) => library.level > compilerLevel);
    report.refuse(
      newer.length > 0 && manifest.level <= compilerLevel
        ? atKey(manifestFile, 'libraries')
        : atKey(manifestFile, 'level'),
      `This world needs Sprout level ${level}, and this one understands level ${compilerLevel}.`,
      newer.length > 0
        ? `The newer part is the library "${newer[0]!.name}". Update Sprout, or vendor a copy written for level ${compilerLevel}.`
        : 'Update Sprout, or rewrite the world for the level this one understands.',
    );
  }

  // Blessed library source costs the author nothing; a modified copy is
  // the author's own source and counts as it.
  const arrived = source.files.filter((file) => !withheld.has(file.name));
  const exemptBytes = usable
    .filter((library) => library.blessed)
    .reduce((bytes, library) => bytes + library.bytes, 0);
  const ownBytes = arrived.reduce((bytes, file) => bytes + bytesOf(file.text), 0);
  const charged = usable.filter((library) => !library.blessed);
  const sourceBytes = ownBytes + charged.reduce((bytes, library) => bytes + library.bytes, 0);
  const files =
    arrived.length + charged.reduce((count, library) => count + library.files.length, 0);

  // The spec's Limits says a host refuses a bundle checked against larger
  // static caps than its own, unless it has recorded an exception for that
  // world — and the host's way of recording one is B43's. Until B43 lands
  // no exception exists to grant, so a cap over the host's own refuses at
  // load exactly as it does at publish.
  if (caps.sourceBytes !== null && sourceBytes > caps.sourceBytes) {
    report.refuse(
      atKey(manifestFile, 'name'),
      `This world is ${sourceBytes} bytes of source, and ${caps.sourceBytes} is as much as it may be.`,
      'Take something out, or use a library the host has blessed, whose source costs nothing.',
    );
  }
  if (caps.files !== null && files > caps.files) {
    report.refuse(
      atKey(manifestFile, 'name'),
      `This world is ${files} files, and ${caps.files} is as many as it may have.`,
      'Put more in each file, or take something out.',
    );
  }
  return { level, arrived, charged, files, sourceBytes, exemptBytes };
}
