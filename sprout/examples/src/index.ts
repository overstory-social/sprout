import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SproutManifest, type Archive, type ArchiveFile } from '@overstory/sprout/lang';

// The example microworlds that ship with the package — the two studios
// the README walks and the CLI's first line plays — as archives a host
// reads from disk: `sprout.json` beside `*.sprout` files, the
// directories for people. `examplesDir()` is where they sit on disk;
// `readExample(slug)` is one of them as an `Archive`.

/** The examples, by folder name. */
export const EXAMPLES = ['pottery-studio', 'wanderers-shed'] as const;
export type ExampleSlug = (typeof EXAMPLES)[number];

/** The folder the example archives sit in, on disk, wherever this package was installed. */
export function examplesDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

/** One example's folder. */
export function examplePath(slug: ExampleSlug): string {
  return join(examplesDir(), slug);
}

export interface ExampleArchive extends Archive {
  slug: ExampleSlug;
  manifest: SproutManifest;
  files: ArchiveFile[];
}

function sproutFilesUnder(root: string, dir = root): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sproutFilesUnder(root, path));
    else if (entry.endsWith('.sprout')) out.push(path);
  }
  return out;
}

/** An example archive from disk, files only — nothing is compiled. */
export function readExample(slug: ExampleSlug): ExampleArchive {
  const root = examplePath(slug);
  const manifest = SproutManifest.parse(
    JSON.parse(readFileSync(join(root, 'sprout.json'), 'utf8')),
  );
  const files = sproutFilesUnder(root).map((path) => ({
    name: relative(root, path).split('\\').join('/'),
    source: readFileSync(path, 'utf8'),
  }));
  return { slug, manifest, files };
}
