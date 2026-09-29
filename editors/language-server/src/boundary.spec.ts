import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The language server imports the language, the player's folder reading,
// the protocol's server library and its text documents, and node:*, and
// nothing of any host or client.

const SRC = dirname(fileURLToPath(import.meta.url));
const ALLOWED = [
  '@overstory/sprout/lang',
  '@overstory/sprout-player',
  'vscode-languageserver/node.js',
  'vscode-languageserver-textdocument',
];
const ALLOWED_IN_SPECS = ['vitest'];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(dir, entry.name)]
        : [],
  );
}

describe('@overstory/sprout-language-server imports only what it names', () => {
  const files = sources(SRC);
  it('has files to check', () => expect(files.length).toBeGreaterThan(5));
  for (const file of files) {
    it(relative(SRC, file), () => {
      const text = readFileSync(file, 'utf8');
      const specifiers = [...text.matchAll(/(?:from|import)\s+'([^']+)'/g)].map((m) => m[1]!);
      const allowed = file.endsWith('.spec.ts') ? [...ALLOWED, ...ALLOWED_IN_SPECS] : ALLOWED;
      const foreign = specifiers.filter(
        (s) =>
          !s.startsWith('./') &&
          !s.startsWith('../') &&
          !s.startsWith('node:') &&
          !allowed.includes(s),
      );
      expect(foreign).toEqual([]);
    });
  }
});
