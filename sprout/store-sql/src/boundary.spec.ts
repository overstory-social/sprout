import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The adapter imports core and itself — never a database driver (it
// takes `query(text, params)` from the host), never a host, never a test
// framework in its runtime files. The conformance spec brings PGlite in
// as a dev dependency of its own.

const SRC = dirname(fileURLToPath(import.meta.url));
const ALLOWED = ['@overstory/sprout-core'];
const ALLOWED_IN_SPECS = [
  'vitest',
  'node:fs',
  'node:path',
  'node:url',
  '@electric-sql/pglite',
  '@overstory/sprout-core/conformance',
];

describe('@overstory/sprout-store-sql imports nothing but core and itself', () => {
  const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));
  it('has files to check', () => expect(files.length).toBeGreaterThan(3));
  for (const file of files) {
    it(file, () => {
      const text = readFileSync(join(SRC, file), 'utf8');
      const specifiers = [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      const allowed = file.endsWith('.spec.ts') ? [...ALLOWED, ...ALLOWED_IN_SPECS] : ALLOWED;
      const foreign = specifiers.filter((s) => !s.startsWith('./') && !allowed.includes(s));
      expect(foreign).toEqual([]);
    });
  }

  it('the schema has no foreign key to anything (the host is not a table here)', () => {
    const text = readFileSync(join(SRC, 'migrations.ts'), 'utf8');
    expect(text).not.toMatch(/REFERENCES/);
    expect(text).toMatch(/CREATE SCHEMA IF NOT EXISTS sprout/);
  });
});
