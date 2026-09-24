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

/**
 * What to write for each field, in the manifest's own words: what a
 * refusal of the field says to write, and what the generated skill lists.
 */
export const MANIFEST_FIELDS: Readonly<Record<string, string>> = {
  name: '"name": "printers_shop" — lower-case, with letters, digits and _',
  namespace: '"namespace": "printers_shop", or leave it out to use the name',
  version: '"version": "0.1.0"',
  author: '"author": "Marta"',
  license: '"license": "MIT"',
  level: '"level": 1',
  extensions: '"extensions": [{ "name": "media", "major": 1 }], or leave it out',
  libraries: '"libraries": [{ "name": "sprout", "version": "1.0.0", "sha": "…" }], or leave it out',
  files: '"files": ["printers_shop.sprout"]',
};

/** One sentence about what is wrong with a field, for someone who is not a programmer. */
function sentenceFor(key: string | null, issue: z.core.$ZodIssue): string {
  if (key === null) return 'The manifest is not a JSON object.';
  const where = issue.path.length > 1 ? issue.path.map(String).join('.') : key;
  if (issue.code === 'invalid_type') {
    if (issue.message.endsWith('received undefined')) return `The manifest has no ${where}.`;
    return `The manifest's ${where} is not ${withArticle(issue.expected)}.`;
  }
  return `The manifest's ${where} is not what a manifest holds there.`;
}

function withArticle(expected: string): string {
  if (expected === 'array') return 'a list';
  if (expected === 'object') return 'an object';
  return `a ${expected}`;
}

function remedyFor(key: string | null): string {
  const example = key === null ? null : MANIFEST_FIELDS[key];
  return example === undefined || example === null
    ? 'A manifest is a JSON object with a name, a version, an author, a license, a level and a list of files.'
    : `Write ${example}.`;
}

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
      const at = key === null ? file.span(0, 0) : manifestKeySpan(file, key);
      diagnostics.refuse(at, sentenceFor(key, issue), remedyFor(key));
    }
    return null;
  }
  const { namespace, ...rest } = result.data;
  return { ...rest, namespace: namespace ?? rest.name };
}
