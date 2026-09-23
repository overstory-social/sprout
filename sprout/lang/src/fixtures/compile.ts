// What `compileBundle`'s own specs and `bundle/compile/compile/*.spec.ts`
// build a `MicroworldSource` out of: `printers_shop`, a world of one
// visitor kind, named as the manifest names it, with the standard library
// pinned and vendored. `world()` takes the overrides a case wants to move
// — the manifest, the files, the libraries, what is withheld — and hands
// back a source ready for `compileBundle`. Spec support: the package
// build leaves it out.

import { libraryHash, type LibrarySource, type Manifest } from '../bundle/bundle.js';
import { STANDARD_LIBRARY } from '../bundle/standard-library.js';
import { SourceFile } from '../source/source.js';
import type { Diagnostic } from '../source/diagnostics.js';

/** A source file by name and text, the shorthand every case in this family writes. */
export const file = (name: string, text: string): SourceFile => new SourceFile(name, text);

export const SPROUT_SHA = libraryHash(STANDARD_LIBRARY);

export const MANIFEST = [
  '{',
  '  "name": "printers_shop",',
  '  "version": "0.3.1",',
  '  "author": "Eric Eslinger",',
  '  "license": "MIT",',
  '  "level": 1,',
  '  "extensions": [{ "name": "media", "major": 2 }],',
  `  "libraries": [{ "name": "sprout", "version": "0.1.0", "sha": "${SPROUT_SHA}" }],`,
  '  "files": ["world.sprout"]',
  '}',
  '',
].join('\n');

/** What visitors are made of: the world's own kind, composing `sprout.Actor`. */
export const VISITOR = 'kind Visitor is sprout.Actor { }';
/** The place visitors arrive at, written in the world's body. */
export const HALL = 'object hall is sprout.Place';
/**
 * The world's own declaration, on one line: its visitors arrive at
 * `hall`, and `inside` is written in its body after the hall.
 */
export const worldLine = (inside = ''): string =>
  `world printers_shop is sprout.World { visitors are Visitor visitors arrive at hall ${HALL}${inside === '' ? '' : ` ${inside}`} }`;
/** The world's own declaration, holding the hall and nothing else. */
export const WORLD_LINE = worldLine();
/** The world holding `inside` beside the hall, and the kind its visitors are made of, on one line. */
export const rootWith = (inside: string): string => `${worldLine(inside)} ${VISITOR}`;
/** The world, the place visitors arrive at, and the kind they are made of, on one line. */
export const ROOT = rootWith('');
export const WORLD_TEXT = `${ROOT}\nenum Season { spring, summer, autumn, winter }`;
/** Exactly the world's own source: blessed fits, unblessed does not. */
export const OWN_BYTES = WORLD_TEXT.length;

/** A world as it arrives, with whatever a case wants to move about it. */
export function world(
  overrides: {
    manifest?: Partial<Manifest>;
    manifestText?: string;
    files?: SourceFile[];
    libraries?: LibrarySource[];
    withheld?: string[];
  } = {},
) {
  const manifest: Manifest = {
    name: 'printers_shop',
    namespace: 'printers_shop',
    version: '0.3.1',
    author: 'Eric Eslinger',
    license: 'MIT',
    level: 1,
    extensions: [{ name: 'media', major: 2 }],
    libraries: [{ name: 'sprout', version: '0.1.0', sha: SPROUT_SHA }],
    files: overrides.files?.map((f) => f.name) ?? ['world.sprout'],
    ...overrides.manifest,
  };
  return {
    manifestFile: file('sprout.json', overrides.manifestText ?? MANIFEST),
    manifest,
    files: overrides.files ?? [file('world.sprout', WORLD_TEXT)],
    libraries: overrides.libraries ?? [STANDARD_LIBRARY],
    ...(overrides.withheld === undefined ? {} : { withheld: overrides.withheld }),
  };
}

export const refusals = (diagnostics: readonly Diagnostic[]): Diagnostic[] =>
  diagnostics.filter((d) => d.severity === 'refusal');
export const warnings = (diagnostics: readonly Diagnostic[]): Diagnostic[] =>
  diagnostics.filter((d) => d.severity === 'warning');
