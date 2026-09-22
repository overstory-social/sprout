// The manifest, read from `sprout.json` (the spec's The world model › The
// manifest). It is the one file read before any of the language is, so
// it is read with zod and reported like everything else: a problem names
// the file and, where the key can be found in the text, its line and
// column.

import { z } from 'zod';

import type { Diagnostics } from '../source/diagnostics.js';
import type { SourceFile, Span } from '../source/source.js';
import type { Manifest } from './bundle.js';

export const MANIFEST_FILE = 'sprout.json';

const ManifestSchema = z.object({
  name: z.string(),
  namespace: z.string().optional(),
  version: z.string(),
  author: z.string(),
  license: z.string(),
  level: z.number(),
  extensions: z.array(z.object({ name: z.string(), major: z.number() })).default([]),
  libraries: z
    .array(z.object({ name: z.string(), version: z.string(), sha: z.string() }))
    .default([]),
  files: z.array(z.string()).default([]),
});

/** Where a key was written in the manifest's text, or the head of the file. */
export function manifestKeySpan(file: SourceFile, key: string): Span {
  const at = file.text.indexOf(`"${key}"`);
  return at < 0 ? file.span(0, 0) : file.span(at, at + key.length + 2);
}

/**
 * Read a manifest, or refuse it having said what is wrong. Everything
 * the manifest holds is checked for shape here and for meaning by
 * `compileBundle`.
 */
export function parseManifest(file: SourceFile, diagnostics: Diagnostics): Manifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.text);
  } catch (error) {
    diagnostics.refuse(
      file.span(0, 0),
      `${file.name} is not JSON: ${error instanceof Error ? error.message : String(error)}.`,
      'A manifest is a JSON object with a name, a version, an author, a license, a level and a list of files.',
    );
    return null;
  }
  const result = ManifestSchema.safeParse(parsed);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path.length > 0 ? String(issue.path[0]) : null;
      diagnostics.refuse(
        key === null ? file.span(0, 0) : manifestKeySpan(file, key),
        key === null
          ? `The manifest is ${issue.message}.`
          : `The manifest's ${key} is ${issue.message}.`,
        'A manifest is a JSON object with a name, a version, an author, a license, a level and a list of files.',
      );
    }
    return null;
  }
  const { namespace, ...rest } = result.data;
  return { ...rest, namespace: namespace ?? rest.name };
}
