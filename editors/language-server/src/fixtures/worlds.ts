import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readWorld } from '@overstory/sprout-player';

import { declarationsOf, type DeclarationIndex } from '../declarations.js';

// What the language server's specs share: a corpus world's folder, a copy
// of one a spec may change, and the declarations of one. Spec support: the
// package build leaves it out.

/** The corpus world `good/<name>`'s folder. */
export const corpusWorld = (name: string): string =>
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'corpus', 'good', name);

/** A copy of the corpus world `good/<name>` in a folder of its own. */
export function copiedWorld(name: string): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'sprout-ls-')), name);
  cpSync(corpusWorld(name), dir, { recursive: true });
  return dir;
}

/** The declarations of the corpus world `good/<name>` and its libraries. */
export function indexOf(name: string): DeclarationIndex {
  const { source } = readWorld(corpusWorld(name));
  return declarationsOf(source!.files, source!.libraries);
}
