import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { sproutSkill } from '@overstory/sprout';

import { MEDIA } from './media.js';

// Overstory's checked-in skill (skills/sprout/SKILL.md) is the language
// AS OVERSTORY CONFIGURES IT — with pictures — so its pin lives here,
// beside the extension, rather than in the language package, which
// knows no extension. Regenerate with `npm run sprout:skill`.

describe('skills/sprout/SKILL.md', () => {
  it('matches sproutSkill(MEDIA) (regenerate with `npm run sprout:skill`)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const checkedIn = readFileSync(
      join(here, '..', '..', '..', 'skills', 'sprout', 'SKILL.md'),
      'utf8',
    );
    expect(checkedIn).toBe(sproutSkill(MEDIA));
  });
});
