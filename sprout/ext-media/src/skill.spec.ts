import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { sproutSkill } from '@overstory/sprout/lang';

import { MEDIA } from './media.js';

// The repo's checked-in SKILL.md is the language WITH PICTURES — what
// `sprout skill` prints — so its pin lives here, beside the extension,
// rather than in the language, which knows no extension. Regenerate
// with `npm run skill`.

describe('SKILL.md', () => {
  it('matches sproutSkill(MEDIA) (regenerate with `npm run skill`)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const checkedIn = readFileSync(join(here, '..', '..', '..', 'SKILL.md'), 'utf8');
    expect(checkedIn).toBe(sproutSkill(MEDIA));
  });
});
