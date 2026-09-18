import { z } from 'zod';

import { ExtensionSet, type Effect, type SproutExtension } from '@overstory/sprout';

// Pictures, as a Sprout extension (sprout.md §2.9; the split proposal
// §3.5): a `media` value type holding an id the host's uploader minted
// (or none), `:image` well-known on rooms, items and kinds, and `show`,
// which reads a media property and RECORDS that a picture should open —
// the host opens it, after the action, against its own audience rule.
// Nothing here knows what an id means or where the bytes are.

/** What `show` records: open this picture. */
export const Shown = z.object({
  extension: z.literal('media'),
  kind: z.literal('show'),
  mediaId: z.string().min(1),
});
export type Shown = z.infer<typeof Shown>;

export const media: SproutExtension<Shown> = {
  name: 'media',
  valueTypes: [
    {
      name: 'media',
      /** `:image media "m-…"` or `:image media` (none yet). */
      literal: { keyword: 'media', takes: 'optional-string' },
      fit: (raw) => (raw === null || typeof raw === 'string' ? raw : undefined),
      default: null,
      print: (v) => (v === null ? 'media' : `media "${String(v).replace(/"/g, '\\"')}"`),
      storage: z.string().nullable(),
    },
  ],
  wellKnown: [{ name: 'image', type: 'media', default: null, on: ['room', 'item'] }],
  statements: {
    /** `show` (self's `:image`), `show self :blueprint` (a named media property), `show room`. */
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

/** The set a host installs when media is its only extension. */
export const MEDIA = new ExtensionSet([media]);

/**
 * The pictures an action opened, in order, each once — what a host
 * renders from an outcome's effects (a lightbox beside the text, a
 * thumbnail under a chip, a line in a terminal).
 */
export function shownMedia(effects: readonly Effect[]): string[] {
  const out: string[] = [];
  for (const e of effects) {
    const parsed = Shown.safeParse(e);
    if (parsed.success && !out.includes(parsed.data.mediaId)) out.push(parsed.data.mediaId);
  }
  return out;
}
