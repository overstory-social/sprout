import { MEDIA } from '@overstory/sprout/lang';
import { describe, expect, it } from 'vitest';

import { INSTALLED_EXTENSIONS } from './installed.js';

describe('the extensions a host built from the player installs', () => {
  it('are `media` at major 1, and nothing else', () => {
    expect(INSTALLED_EXTENSIONS).toEqual([MEDIA]);
    expect(INSTALLED_EXTENSIONS.map(({ name, major }) => `${name} ${major}`)).toEqual(['media 1']);
  });
});
