import { neededImports, SourceFile, STANDARD_LIBRARY } from '@overstory/sprout/lang';

// What these specs' worlds import, worked out for them: a case writes a
// world's files without the imports each needs, and `withImports` adds
// what the language's `neededImports` finds at the end of each file, so
// nothing written moves.

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
