import { z } from 'zod';

import { ExtensionSet, type SproutExtension } from '../extensions.js';

// The media extension as the language's OWN specs (and README) need it:
// the shape `@overstory/sprout-ext-media` has — a `media` value type,
// `:image` well-known on rooms and items, a `show` statement allowed in
// describe — written here so the specs can prove the mechanism — `use`, literals, statements, effects, the
// describe rule — without the package depending on any extension. Not
// built into `dist` (tsconfig excludes `src/fixtures`).

const Shown = z.object({
  extension: z.literal('media'),
  kind: z.literal('show'),
  mediaId: z.string(),
});
type Shown = z.infer<typeof Shown>;

export const media: SproutExtension<Shown> = {
  name: 'media',
  valueTypes: [
    {
      name: 'media',
      literal: { keyword: 'media', takes: 'optional-string' },
      fit: (raw) => (raw === null || typeof raw === 'string' ? raw : undefined),
      default: null,
      print: (v) => (v === null ? 'media' : `media "${String(v)}"`),
      storage: z.string().nullable(),
    },
  ],
  wellKnown: [{ name: 'image', type: 'media', default: null, on: ['room', 'item'] }],
  statements: {
    show: {
      args: [
        { name: 'target', kind: 'target', optional: true },
        { name: 'property', kind: 'symbol', optional: true },
      ],
      inDescribe: true,
      check: (args, scope) => {
        const target = args['target'];
        const property = args['property'];
        const onSelf = !target || (target.kind === 'target' && target.target.kind === 'self');
        if (onSelf && property?.kind === 'symbol' && !scope.inherits) {
          const field = scope.properties.get(property.name) ?? scope.wellKnown.get(property.name);
          if (!field) return [`self has no property "${property.name}" to show.`];
          if (field.type !== 'media') return [`"${property.name}" is not a picture.`];
        }
        return [];
      },
      run: (frame, args) => {
        const target = args['target'];
        const ref = target && typeof target === 'object' ? target : frame.self;
        const property = typeof args['property'] === 'string' ? args['property'] : 'image';
        const id = frame.get(ref, property);
        if (typeof id !== 'string' || id === '') return;
        return { extension: 'media', kind: 'show', mediaId: id };
      },
    },
  },
  effect: Shown,
  transcript: () => '[a picture opens]',
  skill: 'Pictures: a `media` property holds an id the host minted; `show` opens it.',
};

export const MEDIA = new ExtensionSet([media]);
