import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The adapter imports core, zod and itself — never a database driver (a
// backend is five methods the host implements), never a host, never a
// test framework in its runtime files. IndexedDB is a platform global,
// not an import; the specs bring fake-indexeddb in as a dev dependency.

const SRC = dirname(fileURLToPath(import.meta.url));
const ALLOWED = ['@overstory/sprout/core', 'zod'];
const ALLOWED_IN_SPECS = [
  'vitest',
  'node:fs',
  'node:path',
  'node:url',
  'fake-indexeddb',
  'fake-indexeddb/auto',
  '@overstory/sprout/conformance',
];

describe('@overstory/sprout/store-document imports nothing but core, zod and itself', () => {
  const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));
  it('has files to check', () => expect(files.length).toBeGreaterThan(3));
  for (const file of files) {
    it(file, () => {
      const text = readFileSync(join(SRC, file), 'utf8');
      const specifiers = [...text.matchAll(/(?:from|import)\s+'([^']+)'/g)].map((m) => m[1]);
      const allowed = file.endsWith('.spec.ts') ? [...ALLOWED, ...ALLOWED_IN_SPECS] : ALLOWED;
      const foreign = specifiers.filter((s) => !s.startsWith('./') && !allowed.includes(s));
      expect(foreign).toEqual([]);
    });
  }

  it('names no profile, no Firebase and no Postgres client (the host is not here)', () => {
    for (const file of files.filter((f) => !f.endsWith('.spec.ts'))) {
      const text = readFileSync(join(SRC, file), 'utf8');
      expect(text).not.toMatch(/profile|firebase|firestore\(|node-postgres|pglite/i);
    }
  });
});
