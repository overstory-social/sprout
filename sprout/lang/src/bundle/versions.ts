// What a world's `version` says about its saves (the spec's The runtime ›
// State › Across versions): semver's precedence, and whether a later
// version keeps a save of an earlier one, which is semver's caret read
// strictly. A pre-release is compatible only with itself, and build
// metadata is never read.

import { SEMVER } from './compile/manifest-fields.js';

/** A semantic version, its build metadata dropped. */
export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** The pre-release identifiers, empty for a release. */
  readonly prerelease: readonly string[];
}

/** `text` as a version, or null where it is not one. */
export function readVersion(text: string): Version | null {
  const match = SEMVER.exec(text);
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

function compareIdentifiers(a: string, b: string): number {
  const numeric = /^\d+$/;
  if (numeric.test(a) && numeric.test(b)) return Math.sign(Number(a) - Number(b));
  if (numeric.test(a)) return -1;
  if (numeric.test(b)) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Semver precedence: negative where `a` comes before `b`, zero where they are the same version. */
export function compareVersions(a: Version, b: Version): number {
  const core =
    Math.sign(a.major - b.major) || Math.sign(a.minor - b.minor) || Math.sign(a.patch - b.patch);
  if (core !== 0) return core;
  // A release comes after every pre-release of its numbers.
  if (a.prerelease.length === 0 || b.prerelease.length === 0)
    return Math.sign(b.prerelease.length) - Math.sign(a.prerelease.length);
  for (let i = 0; i < Math.min(a.prerelease.length, b.prerelease.length); i++) {
    const order = compareIdentifiers(a.prerelease[i]!, b.prerelease[i]!);
    if (order !== 0) return order;
  }
  return Math.sign(a.prerelease.length - b.prerelease.length);
}

/**
 * Whether a save of `earlier` survives `later`: `later` is not before it and
 * is not a breaking version of it. The same version is compatible with itself.
 */
export function keepsSaves(earlier: Version, later: Version): boolean {
  if (earlier.prerelease.length > 0 || later.prerelease.length > 0)
    return compareVersions(earlier, later) === 0;
  if (compareVersions(earlier, later) > 0) return false;
  if (earlier.major !== later.major) return false;
  if (earlier.major > 0) return true;
  if (earlier.minor !== later.minor) return false;
  if (earlier.minor > 0) return true;
  return earlier.patch === later.patch;
}

/** The first breaking version after `version`: 1.4.2 → 2.0.0, 0.3.1 → 0.4.0, 0.0.3 → 0.0.4. */
export function nextBreaking(version: Version): string {
  if (version.major > 0) return `${version.major + 1}.0.0`;
  if (version.minor > 0) return `0.${version.minor + 1}.0`;
  return `0.0.${version.patch + 1}`;
}
