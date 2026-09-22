import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The CLI imports the Sprout packages and node:* — nothing of any host.

const SRC = dirname(fileURLToPath(import.meta.url));
const ALLOWED = ['@overstory/sprout/lang', '@overstory/sprout/core'];
const ALLOWED_IN_SPECS = ['vitest'];

describe('@overstory/sprout-cli imports the Sprout packages and node:* only', () => {
  const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));
  it('has files to check', () => expect(files.length).toBeGreaterThan(5));
  for (const file of files) {
    it(file, () => {
      const text = readFileSync(join(SRC, file), 'utf8');
      const specifiers = [...text.matchAll(/(?:from|import)\s+'([^']+)'/g)].map((m) => m[1]!);
      const allowed = file.endsWith('.spec.ts') ? [...ALLOWED, ...ALLOWED_IN_SPECS] : ALLOWED;
      const foreign = specifiers.filter(
        (s) => !s.startsWith('./') && !s.startsWith('node:') && !allowed.includes(s),
      );
      expect(foreign).toEqual([]);
    });
  }
});
