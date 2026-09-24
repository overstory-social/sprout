import { describe, expect, it } from 'vitest';

import type { PinnedExtension } from '@overstory/sprout/lang';

import { negotiate, rendersPayload, TEXT_ONLY, type Negotiation } from './capabilities.js';
import { SLIDES } from './fixtures/showroom.js';

// A world pinning `slides` at 1, which the host supplies, and `media` at
// 2, which it does not.
const PINNED: ReadonlyMap<string, PinnedExtension> = new Map([
  ['slides', { name: 'slides', major: 1, installed: SLIDES, absence: null }],
  ['media', { name: 'media', major: 2, installed: null, absence: 'not-installed' }],
]);

function accepted(negotiation: Negotiation) {
  if (!negotiation.accepted) throw new Error(negotiation.words);
  return negotiation;
}

describe('negotiating with a client', () => {
  it('grants a statement the world pins at the major the host supplies', () => {
    const { capabilities, granted, declined } = accepted(
      negotiate({ renders: [{ extension: 'slides', major: 1, statements: ['show'] }] }, PINNED),
    );
    expect(granted).toEqual([{ extension: 'slides', major: 1, statement: 'show' }]);
    expect(declined).toEqual([]);
    expect(rendersPayload(capabilities, 'slides', 'show')).toBe(true);
  });

  it('grants nothing to a client that declares nothing, which is sent every effect as words', () => {
    const { capabilities, granted } = accepted(negotiate({ renders: [] }, PINNED));
    expect(granted).toEqual([]);
    expect(rendersPayload(capabilities, 'slides', 'show')).toBe(false);
    expect(rendersPayload(TEXT_ONLY, 'slides', 'show')).toBe(false);
  });

  it('declines each statement it cannot send, saying why, and grants the rest', () => {
    const { capabilities, granted, declined } = accepted(
      negotiate(
        {
          renders: [
            { extension: 'slides', major: 1, statements: ['show', 'fade'] },
            { extension: 'slides', major: 2, statements: ['show'] },
            { extension: 'media', major: 2, statements: ['show'] },
            { extension: 'video', major: 1, statements: ['play'] },
          ],
        },
        PINNED,
      ),
    );
    expect(granted).toEqual([{ extension: 'slides', major: 1, statement: 'show' }]);
    expect(declined.map(({ statement, reason, words }) => [statement, reason, words])).toEqual([
      ['fade', 'no-such-statement', 'The extension `slides` has no statement `fade`.'],
      [
        'show',
        'other-major',
        'This world uses `slides` at major 1, not 2, so `slides.show` is sent as its transcript line.',
      ],
      [
        'show',
        'absent',
        'This host does not provide `media`, so this world records nothing of `media.show`.',
      ],
      [
        'play',
        'not-pinned',
        'This world does not use the extension `video`, so `video.play` is never recorded here.',
      ],
    ]);
    expect(rendersPayload(capabilities, 'slides', 'fade')).toBe(false);
    expect(rendersPayload(capabilities, 'media', 'show')).toBe(false);
  });

  it('grants a statement declared twice once', () => {
    const { granted } = accepted(
      negotiate(
        { renders: [{ extension: 'slides', major: 1, statements: ['show', 'show'] }] },
        PINNED,
      ),
    );
    expect(granted).toHaveLength(1);
  });

  it('refuses, in words, a declaration that is not one', () => {
    for (const declared of [
      undefined,
      'slides',
      { renders: 'slides' },
      { renders: [{ extension: 'slides', major: 1.5, statements: ['show'] }] },
      { renders: [{ extension: '', major: 1, statements: ['show'] }] },
      { renders: [], theme: 'dark' },
    ]) {
      const negotiation = negotiate(declared, PINNED);
      expect(negotiation).toEqual({
        accepted: false,
        words:
          'A client declares what it renders as { renders: [{ extension, major, statements }] }, and this is not that: it is sent every effect as words.',
      });
    }
  });
});
