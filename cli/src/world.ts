import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import {
  Diagnostics,
  MANIFEST_FILE,
  parseManifest,
  SourceFile,
  STANDARD_LIBRARY,
  type Diagnostic,
  type MicroworldSource,
} from '@overstory/sprout/lang';

// A microworld on disk: a folder holding `sprout.json`, its `.sprout` and
// `.prose` files, and nothing else the compiler reads. Dotted entries are
// skipped. A file's name is its path from the folder with `/` between.
//
// The CLI carries one copy of the standard library and sends it as the
// vendored `sprout` whenever the manifest names that library; the manifest's
// pin is checked against it like any vendored source. Where a vendored copy
// of a library lives in a world folder is unspecified (the working notes'
// Holes), so nothing else is read as one.

export interface ReadWorld {
  /** The resolved path it was read from. */
  readonly path: string;
  /** What the compiler compiles, or null when the manifest could not be read. */
  readonly source: MicroworldSource | null;
  /** Problems reading the manifest. */
  readonly diagnostics: readonly Diagnostic[];
}

function isWorldFile(name: string): boolean {
  return name.endsWith('.sprout') || name.endsWith('.prose');
}

function filesUnder(root: string, dir = root): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith('.')) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...filesUnder(root, path));
    else if (stat.isFile() && isWorldFile(entry)) out.push(path);
  }
  return out;
}

/** Read a folder as a microworld. Throws only when the folder itself is not there. */
export function readWorld(dir: string): ReadWorld {
  const root = resolve(dir);
  let stat;
  try {
    stat = statSync(root);
  } catch {
    throw new Error(`${dir}: no such folder`);
  }
  if (!stat.isDirectory()) throw new Error(`${dir}: not a folder`);

  const diagnostics = new Diagnostics();
  let manifestText: string;
  try {
    manifestText = readFileSync(join(root, MANIFEST_FILE), 'utf8');
  } catch {
    throw new Error(`${dir}: no ${MANIFEST_FILE} here`);
  }
  const manifestFile = new SourceFile(MANIFEST_FILE, manifestText);
  const manifest = parseManifest(manifestFile, diagnostics);
  if (manifest === null) return { path: root, source: null, diagnostics: diagnostics.all };

  const files = filesUnder(root).map(
    (path) =>
      new SourceFile(relative(root, path).split('\\').join('/'), readFileSync(path, 'utf8')),
  );
  const usesStandard = manifest.libraries.some((pin) => pin.name === STANDARD_LIBRARY.name);
  return {
    path: root,
    source: { manifestFile, manifest, files, libraries: usesStandard ? [STANDARD_LIBRARY] : [] },
    diagnostics: diagnostics.all,
  };
}
