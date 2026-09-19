import { describe, expect, it } from 'vitest';

import { checkExtension, type SproutExtension } from '@overstory/sprout/lang';

import { media as fixture } from '../../lang/src/fixtures/media.js';
import { media } from './media.js';

// The language's specs use a FIXTURE of this extension (it cannot depend
// on this package); this spec is what keeps the two identical in every
// observable way, so the fixture never drifts from what a host installs.

function observe(ext: SproutExtension): unknown {
  const type = ext.valueTypes![0]!;
  const show = ext.statements!['show']!;
  const frame = {
    self: { id: 'self', kind: 'item' as const, name: 'Lamp' },
    room: { id: 'room', kind: 'room' as const, name: 'Hall' },
    container: null,
    actor: { id: 'a', kind: 'actor' as const, name: 'you' },
    resolve: () => null,
    get: (_r: unknown, property: string) =>
      property === 'image' ? 'm-1' : property === 'plan' ? 'm-2' : null,
    is: () => false,
  };
  return {
    name: ext.name,
    type: {
      name: type.name,
      literal: type.literal,
      default: type.default,
      fits: ['m-1', null, 3, true].map((v) => type.fit(v)),
      prints: ['m-1', null, 'a"b'].map((v) => type.print(v)),
      storage: ['m-1', null, 3].map((v) => type.storage.safeParse(v).success),
    },
    wellKnown: ext.wellKnown,
    show: {
      args: show.args,
      inDescribe: show.inDescribe,
      inConsent: show.inConsent ?? false,
      runs: [
        show.run(frame, {}),
        show.run(frame, { target: frame.room, property: 'plan' }),
        show.run(frame, { property: 'nope' }),
      ],
      checks: [
        show.check?.(
          { property: { kind: 'symbol', name: 'plan' } },
          {
            properties: new Map([['plan', { type: 'media' }]]),
            wellKnown: new Map(),
            inherits: false,
          },
        ),
        show.check?.(
          { property: { kind: 'symbol', name: 'n' } },
          {
            properties: new Map([['n', { type: 'integer' }]]),
            wellKnown: new Map(),
            inherits: false,
          },
        ),
        show.check?.(
          { property: { kind: 'symbol', name: 'gone' } },
          { properties: new Map(), wellKnown: new Map(), inherits: false },
        ),
      ],
    },
    effects: [
      { extension: 'media', kind: 'show', mediaId: 'm-1' },
      { extension: 'media', kind: 'show', mediaId: '' },
    ].map((e) => ext.effect.safeParse(e).success),
    transcript: ext.transcript?.({ extension: 'media', kind: 'show', mediaId: 'm-1' }),
    skill: ext.skill,
  };
}

describe('the language’s media fixture and the real extension', () => {
  it('behave identically in every observable way', () => {
    expect(observe(fixture as SproutExtension)).toEqual(observe(media as SproutExtension));
    expect(checkExtension(fixture as SproutExtension)).toEqual([]);
  });
});
