// What the specs' worlds import, worked out for them: a case writes a
// world's files without the imports each needs, since what it tests is
// not what a file imports, and `withImports` adds what `neededImports`
// finds at the end of each file, so nothing written moves. Spec support:
// the package build leaves it out.

import { neededImports } from '../bundle/needed-imports.js';
import { STANDARD_LIBRARY } from '../bundle/standard-library.js';
import { SourceFile } from '../source/source.js';

/** `files`, each `.sprout` one with the imports it needs written after what it holds. */
export function withImports(files: readonly SourceFile[]): SourceFile[] {
  const needed = neededImports(files, [STANDARD_LIBRARY]);
  return files.map((file) => {
    const lines = needed.get(file.name);
    if (lines === undefined) return file;
    const text = file.text.endsWith('\n') || file.text === '' ? file.text : `${file.text}\n`;
    return new SourceFile(file.name, `${text}${lines.join('\n')}\n`);
  });
}
