import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Core imports the language, zod and itself — never a host, a database
// driver, a clock library or a test framework. The store is a port; an
// adapter fills it from outside. A runtime package never carries a test
// runner (CLAUDE.md records the 2026-09-03 peer-graph outage), so
// `conformance.ts` and `testing.ts` may not import vitest either.

const SRC = dirname(fileURLToPath(import.meta.url));
const ALLOWED = ['zod', '@overstory/sprout'];
const ALLOWED_IN_SPECS = [
  'vitest',
  'node:fs',
  'node:path',
  'node:url',
  '@overstory/sprout-ext-media',
];

describe('@overstory/sprout-core imports nothing but the language, zod and itself', () => {
  const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));
  it('has files to check', () => expect(files.length).toBeGreaterThan(6));
  for (const file of files) {
    it(file, () => {
      const text = readFileSync(join(SRC, file), 'utf8');
      const specifiers = [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      const allowed = file.endsWith('.spec.ts') ? [...ALLOWED, ...ALLOWED_IN_SPECS] : ALLOWED;
      const foreign = specifiers.filter((s) => !s.startsWith('./') && !allowed.includes(s));
      expect(foreign).toEqual([]);
    });
  }

  it('the record types carry nothing of an identity: an actor is an id and a name', () => {
    const text = readFileSync(join(SRC, 'records.ts'), 'utf8');
    const actor = text.slice(
      text.indexOf('export const ActorRecord'),
      text.indexOf('export type ActorRecord'),
    );
    const fields = [...actor.matchAll(/^\s{2}([a-zA-Z]+):/gm)].map((m) => m[1]);
    expect(fields).toEqual([
      'microworldId',
      'id',
      'name',
      'roomId',
      'lastSeen',
      'narration',
      'lastNoun',
      'pending',
    ]);
    for (const word of ['email', 'avatar', 'profile', 'handle', 'user'])
      expect(actor.toLowerCase()).not.toContain(word);
  });
});
