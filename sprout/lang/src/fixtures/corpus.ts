// A corpus world compiled as publishing compiles it, from the files of its folder, which a spec
// reads: its manifest, and the text of every `.sprout` and `.prose` file beside it, by path,
// with the standard library where the manifest pins it, on a host that installs `media`. Spec support: the package build leaves it
// out.

import { DEFAULT_BLESSED } from '../bundle/blessed.js';
import { type Bundle } from '../bundle/bundle.js';
import { compileBundle } from '../bundle/compile/compile.js';
import { MANIFEST_FILE, parseManifest } from '../bundle/manifest.js';
import { STANDARD_LIBRARY } from '../bundle/standard-library.js';
import { MEDIA } from '../declare/media.js';
import { Diagnostics } from '../source/diagnostics.js';
import { SourceFile } from '../source/source.js';

/** The files of a world's folder: its manifest, and its source and prose by path. */
export interface WorldFiles {
  readonly manifest: string;
  readonly files: Readonly<Record<string, string>>;
}

/** The world `folder` holds, compiled as publishing compiles it. */
export function compiledCorpus({ manifest: text, files }: WorldFiles): Bundle {
  const diagnostics = new Diagnostics();
  const manifestFile = new SourceFile(MANIFEST_FILE, text);
  const manifest = parseManifest(manifestFile, diagnostics)!;
  const usesStandard = manifest.libraries.some((pin) => pin.name === STANDARD_LIBRARY.name);
  const { bundle } = compileBundle(
    {
      manifestFile,
      manifest,
      files: Object.entries(files).map(([path, source]) => new SourceFile(path, source)),
      libraries: usesStandard ? [STANDARD_LIBRARY] : [],
    },
    { mode: 'publish', blessed: DEFAULT_BLESSED, extensions: [MEDIA] },
  );
  return bundle!;
}
