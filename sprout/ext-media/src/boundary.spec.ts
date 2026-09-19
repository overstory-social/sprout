import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// An extension imports the language, zod and itself — never a host, a
// database, or a media store. What a media id means is the host's.

const SRC = dirname(fileURLToPath(import.meta.url));
const ALLOWED = ['zod', '@overstory/sprout/lang'];
const ALLOWED_IN_SPECS = ['vitest', 'node:fs', 'node:path', 'node:url'];

describe('@overstory/sprout/ext-media imports nothing but the language, zod and itself', () => {
  const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));
  it('has files to check', () => expect(files.length).toBeGreaterThan(2));
  for (const file of files) {
    it(file, () => {
      const text = readFileSync(join(SRC, file), 'utf8');
      const specifiers = [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      const allowed = file.endsWith('.spec.ts') ? [...ALLOWED, ...ALLOWED_IN_SPECS] : ALLOWED;
      // A spec may reach the language's own spec fixtures (parity.spec.ts); nothing shipped may.
      const foreign = specifiers.filter(
        (s) =>
          !s.startsWith('./') &&
          !(file.endsWith('.spec.ts') && s.startsWith('../../lang/src/fixtures/')) &&
          !allowed.includes(s),
      );
      expect(foreign).toEqual([]);
    });
  }
});
