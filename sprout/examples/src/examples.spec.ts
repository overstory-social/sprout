import { describe, expect, it } from 'vitest';

import { compileMicroworld } from '@overstory/sprout/lang';
import { MEDIA } from '@overstory/sprout/ext-media';

import { EXAMPLES, examplePath, readExample } from './index.js';

// The two studios compile strictly from their archives, with a door —
// the proof CI's `sprout check` also makes, here as the package's own.

describe('the example archives', () => {
  for (const slug of EXAMPLES) {
    it(`${slug} compiles strictly and has a door`, () => {
      const archive = readExample(slug);
      expect(archive.files.length).toBeGreaterThan(3);
      expect(examplePath(slug)).toMatch(new RegExp(`${slug}$`));
      const { program, problems } = compileMicroworld(archive, { strict: true, ext: MEDIA });
      expect(problems).toEqual([]);
      expect(program.entry).toBe(archive.manifest.entry);
    });
  }
});
