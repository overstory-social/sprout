// The caps a load compiles against (the spec's Limits; The compiler ›
// Strict and lenient). A bundle records the static caps it was checked
// against at publish, and a host loading one checked against larger caps
// than its own refuses to run it, cap by cap, unless the host has made an
// exception for that world; then the world runs under the larger of the
// two. Publishing is checked against the host's own caps and nothing
// else, so what was recorded is read only at load. Which libraries are
// blessed is not recorded: every compile asks the host (the spec's Host ›
// Two decisions).

import type { SourceFile } from '../../source/source.js';
import {
  capsExceeding,
  capsGranted,
  LIMIT_TABLE,
  type CapExceeded,
  type StaticCaps,
} from '../limits.js';
import { atKey } from './manifest-fields.js';
import type { Report } from './report.js';

/** What a host kept of a world's publish, and what it decided about it. */
export interface RecordedCaps {
  /** The static caps the world's bundle was checked against when it was published. */
  readonly caps: StaticCaps;
  /** Whether the host has made an exception for this world, to run it under those caps. */
  readonly excepted: boolean;
}

/**
 * The caps this compile checks against: the host's own, or under an
 * exception the larger of the host's and the recorded ones. A load of a
 * world recorded against a cap larger than the host's, with no exception,
 * is refused once for each such cap.
 */
export function capsToCheck(
  host: StaticCaps,
  recorded: RecordedCaps | undefined,
  manifestFile: SourceFile,
  report: Report,
): StaticCaps {
  if (report.mode !== 'load' || recorded === undefined) return host;
  if (recorded.excepted) return capsGranted(recorded.caps, host);
  for (const over of capsExceeding(recorded.caps, host)) {
    report.refuse(
      atKey(manifestFile, 'name'),
      sayExceeded(over),
      'Publish it again under this host’s limits, or ask the host to make an exception for this world.',
    );
  }
  return host;
}

/** One cap over the host's, which cap and by how much, in the words the limit table gives it. */
function sayExceeded({ name, recorded, allowed }: CapExceeded): string {
  const bounds = LIMIT_TABLE.find((row) => row.name === name)!.bounds;
  return recorded === null
    ? `This world was published with no limit on ${bounds}. This host allows ${allowed}.`
    : `This world was published allowing ${recorded} ${bounds}. This host allows ${allowed}, ${recorded - allowed} fewer.`;
}
