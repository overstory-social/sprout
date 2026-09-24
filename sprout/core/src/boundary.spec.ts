import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { StoredVisitorSchema } from '@overstory/sprout/lang';

import { VisitorExport, VisitorInWorld } from './records.js';

// Core imports the language, zod and itself — never a host, a database
// driver, a clock library or a test framework. The store is a port; an
// adapter fills it from outside. A runtime package never carries a test
// runner, so `conformance.ts` may not import vitest either.

const SRC = dirname(fileURLToPath(import.meta.url));
const ALLOWED = ['zod', '@overstory/sprout/lang'];
const ALLOWED_IN_SPECS = ['vitest', 'node:fs', 'node:path', 'node:url'];

describe('@overstory/sprout/core imports nothing but the language, zod and itself', () => {
  // Every .ts under src, subdirectories included (src/fixtures holds spec support).
  const files = readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => relative(SRC, join(e.parentPath, e.name)));
  it('has files to check', () => expect(files.length).toBeGreaterThan(4));
  it('walks into subdirectories', () => expect(files).toContain(join('log', 'entry.ts')));
  for (const file of files) {
    it(file, () => {
      const text = readFileSync(join(SRC, file), 'utf8');
      const specifiers = [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      const allowed = file.endsWith('.spec.ts') ? [...ALLOWED, ...ALLOWED_IN_SPECS] : ALLOWED;
      const foreign = specifiers.filter(
        (s) => !s.startsWith('./') && !s.startsWith('../') && !allowed.includes(s),
      );
      expect(foreign).toEqual([]);
    });
  }

  it('the records carry nothing of an identity: a visitor is a visit, a nickname, an instance and a place', () => {
    const shape = (schema: unknown) => Object.keys((schema as { shape: object }).shape);
    expect(shape(StoredVisitorSchema)).toEqual(['visit', 'nickname', 'instance', 'lastPlace']);
    expect(shape(VisitorExport)).toEqual(['visit', 'worlds']);
    expect(shape(VisitorInWorld)).toEqual(['microworldId', 'visitor', 'instance', 'memory']);
    const text = readFileSync(join(SRC, 'records.ts'), 'utf8').toLowerCase();
    for (const word of ['email', 'avatar', 'profile', 'handle', 'account', 'user'])
      expect(text).not.toContain(word);
  });
});
