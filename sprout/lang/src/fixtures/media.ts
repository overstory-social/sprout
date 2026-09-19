import { z } from 'zod';

import { ExtensionSet, type SproutExtension } from '../extensions.js';

// The media extension as the language's OWN specs (and README) need it:
// the shape `@overstory/sprout/ext-media` has — a `media` value type,
// `:image` well-known on rooms and items, a `show` statement allowed in
// describe — written here so the specs can prove the mechanism. It must
// behave EXACTLY as the real one: ext-media's `parity.spec.ts` imports
// this file and compares them, so a drift fails that package's gate.
// Written here so the specs can prove the mechanism — `use`, literals, statements, effects, the
// describe rule — without the package depending on any extension. Not
// built into `dist` (tsconfig excludes `src/fixtures`).

const Shown = z.object({
  extension: z.literal('media'),
  kind: z.literal('show'),
  mediaId: z.string().min(1),
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
      print: (v) => (v === null ? 'media' : `media "${String(v).replace(/"/g, '\\"')}"`),
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
  skill:
    'Pictures. A `media` property holds an id the host\'s uploader minted, or none (`:image media "m-…"`, `:image media`); it may be set at runtime (`self.set(:image, "m-…")`, or `none`). Nothing shows a picture on its own: `show` opens self\'s `:image`, `show self :blueprint` a named media property, `show room` the room\'s. Inside `describe`, `examine` and `look` open it; inside a handler, only that action does. What the id means, and who may see the bytes, is the host\'s.',
};

export const MEDIA = new ExtensionSet([media]);
