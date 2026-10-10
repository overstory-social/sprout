// The corpus worlds the specs read, compiled as publishing compiles them: every folder under
// `corpus/good`, with the standard library where its manifest pins it. Spec support: the package
// build leaves it out.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_BLESSED } from '../bundle/blessed.js';
import { type Bundle } from '../bundle/bundle.js';
import { compileBundle } from '../bundle/compile/compile.js';
import { MANIFEST_FILE, parseManifest } from '../bundle/manifest.js';
import { STANDARD_LIBRARY } from '../bundle/standard-library.js';
import { Diagnostics } from '../source/diagnostics.js';
import { SourceFile } from '../source/source.js';

const CORPUS = join(dirname(fileURLToPath(import.meta.url)), '../../../../corpus/good');

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
export function compiledCorpus(name: string): Bundle {
  const root = join(CORPUS, name);
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

/** The name of every corpus world, in order. */
export const CORPUS_WORLDS: readonly string[] = readdirSync(CORPUS).sort();
