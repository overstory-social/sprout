// `sprout compat <old> <new>`: whether a save of one build of a world
// opens in the next (the spec's The runtime › State › Across versions).
// Each build is a world folder, compiled as `check` compiles it, or a
// cartridge. The page names each change that breaks a save of the old
// build, by file, line and column, in the new world where it is there
// and in the old where it is gone; it is refused where the new version is
// earlier than the old, or is not a breaking one and something breaks.

import { readFileSync } from 'node:fs';

import {
  CARTRIDGE_EXTENSION,
  CartridgeUnreadable,
  catalogueOf,
  compareVersions,
  DEFAULT_LIMITS,
  keepsSaves,
  loadCartridge,
  nextBreaking,
  positionOf,
  readCartridge,
  readVersion,
  saveBreaks,
  type Catalogue,
  type SaveBreak,
} from '@overstory/sprout/lang';
import { INSTALLED_EXTENSIONS } from '@overstory/sprout-player';

import { checkWorld, formatCheck } from './check.js';

/** One build of a world, as the check reads it. */
export interface Build {
  /** The world's name, as its manifest gives it. */
  readonly name: string;
  readonly version: string;
  readonly catalogue: Catalogue;
}

/** What the check said, and whether the new build may stand as the version it says it is. */
export interface Compared {
  readonly ok: boolean;
  readonly page: string;
}

/** A cartridge's bytes as a build, or thrown in words where they are not one. */
export function cartridgeBuild(bytes: Uint8Array): Build {
  const { header } = readCartridge(bytes);
  const catalogue = loadCartridge(bytes, {
    caps: DEFAULT_LIMITS.caps,
    installed: INSTALLED_EXTENSIONS,
  });
  return { name: header.name, version: header.version, catalogue };
}

/**
 * The build `path` names: a cartridge where it ends in `.sproutworld`, a
 * folder compiled as `check` compiles it otherwise. Null, with the page or
 * the reason said, where it cannot be read.
 */
export function readBuild(path: string, say: (text: string) => void): Build | null {
  if (path.endsWith(CARTRIDGE_EXTENSION)) {
    try {
      return cartridgeBuild(readFileSync(path));
    } catch (err) {
      if (!(err instanceof CartridgeUnreadable)) throw err;
      say(`${path}: ${err.message}\n`);
      return null;
    }
  }
  const checked = checkWorld(path);
  if (checked.bundle === null) {
    say(formatCheck(checked));
    return null;
  }
  const { manifest } = checked.bundle;
  return {
    name: manifest.name,
    version: manifest.version,
    catalogue: catalogueOf(checked.bundle, DEFAULT_LIMITS.caps),
  };
}

/** One break as the page says it: where, what, and, where it is to be put right, on the next line what to write instead. */
function breakLine(one: SaveBreak, earlier: string, remedied: boolean): string {
  const where =
    one.at === null
      ? `in ${earlier}`
      : (() => {
          const { line, column } = positionOf(one.at);
          const place = `${one.at.source.name}:${line}:${column}`;
          return one.in === 'earlier' ? `${place} in ${earlier}` : place;
        })();
  return `${where}: ${one.message}\n${remedied ? `  ${one.remedy}\n` : ''}`;
}

const changes = (n: number) => `${n} change${n === 1 ? '' : 's'}`;

/** Whether a save of `old` opens in `next`, as a page, and whether `next`'s version may stand. */
export function compareBuilds(old: Build, next: Build): Compared {
  const earlier = readVersion(old.version);
  const later = readVersion(next.version);
  const named = old.name === next.name ? old.name : `${old.name} → ${next.name}`;
  const head = `${named} ${old.version} → ${next.version}`;
  if (earlier === null || later === null) {
    const bad = earlier === null ? old.version : next.version;
    return {
      ok: false,
      page: `${head}: "${bad}" is not a version. A version is three numbers with dots, as in 0.1.0.\n`,
    };
  }
  if (compareVersions(later, earlier) < 0) {
    return {
      ok: false,
      page: `${head}: ${next.version} is earlier than ${old.version}. Give the new build a version after the old one's.\n`,
    };
  }
  const breaks = saveBreaks(old.catalogue, next.catalogue);
  const breaking = nextBreaking(earlier);
  const kept = keepsSaves(earlier, later);
  const listed = breaks.map((one) => breakLine(one, old.version, kept)).join('');
  if (kept) {
    if (breaks.length === 0) {
      return {
        ok: true,
        page: `${head}: nothing breaks a save of ${old.version}, so it opens in ${next.version}.\n`,
      };
    }
    return {
      ok: false,
      page:
        `${head}: ${next.version} keeps saves of ${old.version}, and ${changes(breaks.length)} would break one:\n\n` +
        `${listed}\nrefused: put ${breaks.length === 1 ? 'it' : 'them'} right, or make this a breaking version, ${breaking}.\n`,
    };
  }
  if (breaks.length === 0) {
    return {
      ok: true,
      page: `${head}: ${next.version} is a breaking version, so a save of ${old.version} starts again, though nothing here breaks it.\n`,
    };
  }
  return {
    ok: true,
    page:
      `${head}: ${next.version} is a breaking version, so a save of ${old.version} starts again, as ${breaks.length === 1 ? 'the change here needs' : `the ${breaks.length} changes here need`}:\n\n` +
      listed,
  };
}
