import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// The plane this package sits on: the language knows nothing of the
// product that hosts it. Every import in src/ is relative, `zod`, or (in
// a spec) vitest and node's own modules. A reference to @overstory/schema,
// pg, firebase or a profile would be the host leaking in, and the day it
// is published on its own that reference is a broken install.

const SRC = dirname(fileURLToPath(import.meta.url));
const ALLOWED = ['zod'];
// `node:crypto` is here for one reason: sha256.spec.ts checks the
// language's own SHA-256 against the platform's for a thousand random
// inputs. The hash is a trust boundary (a blessed library is a hash the
// host knows), so it is worth proving against something that did not
// come from the same head. No src/ file may import it.
const ALLOWED_IN_SPECS = ['vitest', 'node:fs', 'node:path', 'node:url', 'node:crypto'];

describe('@overstory/sprout/lang imports nothing but zod and itself', () => {
  // Every .ts under src, subdirectories included (src/fixtures holds spec support).
  const files = readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => relative(SRC, join(e.parentPath, e.name)));
  it('has files to check', () => expect(files.length).toBeGreaterThan(5));
  it('walks into subdirectories', () => expect(files).toContain('fixtures/media.ts'));
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
});
