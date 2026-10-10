// The corpus worlds as specs use them: each `corpus/good` world compiled as
// publishing compiles it, and the folder that holds the goldens the C runtime
// is held to.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_BLESSED } from '../bundle/blessed.js';
import { compileBundle } from '../bundle/compile/compile.js';
import { type Bundle } from '../bundle/bundle.js';
import { MANIFEST_FILE, parseManifest } from '../bundle/manifest.js';
import { STANDARD_LIBRARY } from '../bundle/standard-library.js';
import { Diagnostics } from '../source/diagnostics.js';
import { SourceFile } from '../source/source.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../corpus');

/** The folder of the worlds every construct that lands has one of. */
export const CORPUS_GOOD = join(ROOT, 'good');

/** The folder of the golden files both runtimes are held to. */
export const CORPUS_GOLDENS = join(ROOT, 'goldens');

/** The name of every `corpus/good` world, in order. */
export const CORPUS_WORLDS: readonly string[] = readdirSync(CORPUS_GOOD).sort();

function filesUnder(root: string, dir = root): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(root, path));
    else if (entry.endsWith('.sprout') || entry.endsWith('.prose')) out.push(path);
  }
  return out;
}

/** A corpus world, compiled as publishing compiles it. */
export function compiledCorpusWorld(name: string): Bundle {
  const root = join(CORPUS_GOOD, name);
  const diagnostics = new Diagnostics();
  const manifestFile = new SourceFile(
    MANIFEST_FILE,
    readFileSync(join(root, MANIFEST_FILE), 'utf8'),
  );
  const manifest = parseManifest(manifestFile, diagnostics)!;
  const files = filesUnder(root).map(
    (path) =>
      new SourceFile(relative(root, path).split('\\').join('/'), readFileSync(path, 'utf8')),
  );
  const usesStandard = manifest.libraries.some((pin) => pin.name === STANDARD_LIBRARY.name);
  const { bundle } = compileBundle(
    { manifestFile, manifest, files, libraries: usesStandard ? [STANDARD_LIBRARY] : [] },
    { mode: 'publish', blessed: DEFAULT_BLESSED },
  );
  return bundle!;
}
