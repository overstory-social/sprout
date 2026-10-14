import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The player imports the language, core and the WebAssembly engine, and
// node:* — nothing of any host or client. It runs every turn, poll and
// question through an engine (core's `Engine`); the language has no
// turns, polls or state to import.

const SRC = dirname(fileURLToPath(import.meta.url));
const ALLOWED = [
  '@overstory/sprout/lang',
  '@overstory/sprout/core',
  '@overstory/sprout-engine-wasm',
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

describe('@overstory/sprout-player imports the language, core, the WebAssembly engine and node:* only', () => {
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
