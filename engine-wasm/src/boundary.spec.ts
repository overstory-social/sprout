import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The WebAssembly engine imports the language, core, zod and node:* —
// never runtime-c's sources, which reach it only as the engine.wasm its
// build copies in, and never a host or a client. Its specs may also
// import the engine conformance suite, the player (to read the corpus)
// and vitest.

const SRC = dirname(fileURLToPath(import.meta.url));
const ALLOWED = ['@overstory/sprout/lang', '@overstory/sprout/core', 'zod'];
const ALLOWED_IN_SPECS = [
  'vitest',
  '@overstory/sprout/engine-conformance',
  '@overstory/sprout-player',
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(dir, entry.name)]
        : [],
  );
}

describe('@overstory/sprout-engine-wasm imports the language, core, zod and node:* only', () => {
  const files = sources(SRC);
  it('has files to check', () => expect(files.length).toBeGreaterThan(5));
  for (const file of files) {
    it(relative(SRC, file), () => {
      const text = readFileSync(file, 'utf8');
      const specifiers = [...text.matchAll(/(?:from|import)\s+'([^']+)'/g)].map((m) => m[1]!);
      const support = file.endsWith('.spec.ts') || relative(SRC, file).startsWith('fixtures');
      const allowed = support ? [...ALLOWED, ...ALLOWED_IN_SPECS] : ALLOWED;
      const foreign = specifiers.filter(
        (s) =>
          !(s.startsWith('./') || s.startsWith('../')) &&
          !s.startsWith('node:') &&
          !allowed.includes(s),
      );
      expect(foreign).toEqual([]);
      // A relative import stays inside src/: runtime-c is never reached around the package's own build.
      const outside = specifiers.filter(
        (s) =>
          (s.startsWith('./') || s.startsWith('../')) &&
          relative(SRC, join(dirname(file), s)).startsWith('..'),
      );
      expect(outside).toEqual([]);
    });
  }
});
