import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  compileBundle,
  DEFAULT_BLESSED,
  MANIFEST_FILE,
  positionOf,
  type Diagnostic,
  type Span,
} from '@overstory/sprout/lang';
import { INSTALLED_EXTENSIONS, readWorld } from '@overstory/sprout-player';

import { declarationsOf, type DeclarationIndex } from './declarations.js';

// A world folder checked whole, as `sprout check` checks it and publishing
// would (the spec's The compiler › Diagnostics), with the editor's unsaved
// text in place of what is on disk. Each diagnostic is put on the file it
// names; one in a library's file, which is not in the folder, is put on
// the manifest, which is what names the library.

/** A place in a file, 0-based, as an editor counts it. */
export interface Place {
  readonly line: number;
  readonly character: number;
}

/** A diagnostic placed in a file of the folder. */
export interface Placed {
  /** The file's resolved path. */
  readonly path: string;
  readonly start: Place;
  readonly end: Place;
  readonly severity: Diagnostic['severity'];
  /** The message, then what to write instead where there is something. */
  readonly message: string;
}

/** A world folder, checked. */
export interface CheckedWorld {
  /** The folder's resolved path. */
  readonly root: string;
  readonly diagnostics: readonly Placed[];
  readonly index: DeclarationIndex;
}

/** The nearest folder holding `sprout.json` at or above the file `path`, or null. */
export function worldFolderOf(path: string): string | null {
  for (let dir = dirname(resolve(path)); ; dir = dirname(dir)) {
    if (existsSync(join(dir, MANIFEST_FILE))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

/**
 * Check the world in `root`, reading each file from `unsaved`, by resolved
 * path, where it is there. A folder that is no longer a world, its
 * manifest or a file gone between listing and reading, checks as nothing.
 */
export function checkWorld(root: string, unsaved: ReadonlyMap<string, string>): CheckedWorld {
  let read: ReturnType<typeof readWorld>;
  try {
    read = readWorld(root, unsaved);
  } catch {
    return { root: resolve(root), diagnostics: [], index: { declared: [], imports: [] } };
  }
  if (read.source === null)
    return {
      root: read.path,
      diagnostics: read.diagnostics.map((one) => placed(read.path, new Set(), one)),
      index: { declared: [], imports: [] },
    };
  const { diagnostics } = compileBundle(read.source, {
    mode: 'publish',
    blessed: DEFAULT_BLESSED,
    extensions: INSTALLED_EXTENSIONS,
  });
  const own = new Set(read.source.files.map((file) => file.name));
  return {
    root: read.path,
    diagnostics: [...read.diagnostics, ...diagnostics].map((one) => placed(read.path, own, one)),
    index: declarationsOf(read.source.files, read.source.libraries),
  };
}

/** `diagnostic` on the file it names, or on the manifest where that file is not one of `own`, the folder's. */
function placed(root: string, own: ReadonlySet<string>, diagnostic: Diagnostic): Placed {
  const words =
    diagnostic.remedy === undefined
      ? diagnostic.message
      : `${diagnostic.message}\n${diagnostic.remedy}`;
  const name = diagnostic.at.source.name;
  if (name === MANIFEST_FILE || own.has(name))
    return {
      path: join(root, name),
      ...rangeOf(diagnostic.at),
      severity: diagnostic.severity,
      message: words,
    };
  const { line, column } = positionOf(diagnostic.at);
  return {
    path: join(root, MANIFEST_FILE),
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
    severity: diagnostic.severity,
    message: `${name}:${line}:${column}: ${words}`,
  };
}

/** Where `at` starts and ends, 0-based. */
export function rangeOf(at: Span): { start: Place; end: Place } {
  const place = (offset: number): Place => {
    const { line, column } = at.source.positionAt(offset);
    return { line: line - 1, character: column - 1 };
  };
  return { start: place(at.start), end: place(at.end) };
}
