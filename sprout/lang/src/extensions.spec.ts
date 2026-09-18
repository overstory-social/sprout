import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ExtensionSet,
  NO_EXTENSIONS,
  SPROUT_BUILTIN_TYPES,
  checkExtension,
  type SproutExtension,
} from './extensions.js';
import { MEDIA, media } from './fixtures/media.js';

// The extension registry and the conformance check (the split proposal
// §3.5): what a host may add, what the set refuses at construction, and
// what `checkExtension` catches in an extension that lies about itself.

const Ping = z.object({ extension: z.literal('bell'), kind: z.literal('ring') });
const bell: SproutExtension<z.infer<typeof Ping>> = {
  name: 'bell',
  statements: {
    ring: { args: [], inDescribe: false, run: () => ({ extension: 'bell', kind: 'ring' }) },
  },
  effect: Ping,
};

describe('ExtensionSet', () => {
  it('indexes value types by tag and by literal keyword, statements by keyword, and the words each reserves', () => {
    expect(MEDIA.names).toEqual(['media']);
    expect(MEDIA.has('media')).toBe(true);
    expect(MEDIA.valueType('media')?.type.name).toBe('media');
    expect(MEDIA.literal('media')?.ext.name).toBe('media');
    expect(MEDIA.statement('show')?.spec.inDescribe).toBe(true);
    expect(MEDIA.keywordsOf('media').sort()).toEqual(['media', 'show']);
    expect(MEDIA.keywordsOf('nothing')).toEqual([]);
    expect(NO_EXTENSIONS.names).toEqual([]);
    expect(NO_EXTENSIONS.statement('show')).toBeUndefined();
  });

  it('adds well-known properties where they apply, and renders a transcript line for a valid effect only', () => {
    expect(MEDIA.wellKnownFor('room').map((w) => w.name)).toEqual(['image']);
    expect(MEDIA.wellKnownFor('item').map((w) => w.name)).toEqual(['image']);
    const shown = { extension: 'media', kind: 'show', mediaId: 'm-1' };
    expect(MEDIA.transcript(shown)).toBe('[a picture opens]');
    expect(MEDIA.validEffect(shown)).toBe(true);
    expect(MEDIA.validEffect({ extension: 'media', kind: 'show' })).toBe(false);
    expect(MEDIA.validEffect({ extension: 'bell', kind: 'ring' })).toBe(false);
    expect(MEDIA.transcript({ extension: 'bell', kind: 'ring' })).toBeNull();
    expect(new ExtensionSet([bell]).transcript({ extension: 'bell', kind: 'ring' })).toBeNull();
  });

  it('refuses two extensions with one name, a redefined built-in type, a reused literal keyword, an unknown well-known type', () => {
    expect(() => new ExtensionSet([media, media])).toThrow('Two extensions are called "media"');
    expect(() => new ExtensionSet([{ ...bell, name: 'Bell' }])).toThrow('lower-case name');
    const integer: SproutExtension = {
      ...bell,
      name: 'ints',
      valueTypes: [{ ...media.valueTypes![0]!, name: 'integer' }],
    };
    expect(() => new ExtensionSet([integer])).toThrow('redefines the value type "integer"');
    const again: SproutExtension = {
      ...bell,
      name: 'pictures',
      valueTypes: [{ ...media.valueTypes![0]!, name: 'picture' }],
    };
    expect(() => new ExtensionSet([media, again])).toThrow('reuses the literal keyword "media"');
    const stray: SproutExtension = {
      ...bell,
      name: 'stray',
      wellKnown: [{ name: 'x', type: 'colour', default: null, on: ['item'] }],
    };
    expect(() => new ExtensionSet([stray])).toThrow('unknown type "colour"');
    expect(() => new ExtensionSet([media, bell])).not.toThrow();
    expect([...SPROUT_BUILTIN_TYPES].sort()).toEqual(['boolean', 'enum', 'integer', 'string']);
  });
});

describe('checkExtension', () => {
  it('passes the media fixture and a plain extension', () => {
    expect(checkExtension(media)).toEqual([]);
    expect(checkExtension(bell)).toEqual([]);
  });

  it('reports a run that throws, an effect for another extension, an effect off its own shape, a type that does not fit its default', () => {
    const throws: SproutExtension = {
      ...bell,
      statements: {
        ring: {
          args: [],
          inDescribe: true,
          run: () => {
            throw new Error('boom');
          },
        },
      },
    };
    expect(checkExtension(throws)).toEqual(['"ring" throws on a plain call: boom.']);
    const wrongOwner: SproutExtension = {
      ...bell,
      statements: {
        ring: { args: [], inDescribe: true, run: () => ({ extension: 'media', kind: 'ring' }) },
      },
    };
    expect(checkExtension(wrongOwner)).toEqual([
      '"ring" records an effect for "media", not "bell".',
    ]);
    const offShape: SproutExtension = {
      ...bell,
      statements: {
        ring: { args: [], inDescribe: true, run: () => ({ extension: 'bell', kind: 'clang' }) },
      },
    };
    expect(checkExtension(offShape)).toEqual([
      '"ring" records an effect that is not in the extension\'s own shape.',
    ]);
    const unfit: SproutExtension = {
      ...bell,
      valueTypes: [
        {
          name: 'odd',
          literal: { keyword: 'odd', takes: 'none' },
          fit: () => undefined,
          default: 1,
          print: () => 'odd',
          storage: z.string(),
        },
      ],
    };
    expect(checkExtension(unfit)).toEqual([
      '"odd" does not fit its own default.',
      '"odd"\'s default is not in its storage shape.',
    ]);
  });

  it('hands `run` a frozen frame: a statement that writes to it throws, and is reported', () => {
    const mutates: SproutExtension = {
      ...bell,
      statements: {
        ring: {
          args: [{ name: 'target', kind: 'target' }],
          inDescribe: true,
          run: (frame) => {
            (frame.self as { name: string }).name = 'changed';
            return undefined;
          },
        },
      },
    };
    expect(checkExtension(mutates)[0]).toContain('"ring" throws on a plain call');
  });
});
