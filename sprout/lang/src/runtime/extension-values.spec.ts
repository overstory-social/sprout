import { describe, expect, it } from 'vitest';

import type { ExtensionType } from '../declare/types.js';
import { IMAGE, SOUND } from '../fixtures/extensions.js';
import { DEFAULT_LIMITS } from '../bundle/limits.js';
import { ExtensionFault } from './extension-fault.js';
import {
  ExtensionValue,
  extensionLiteral,
  extensionWords,
  restoredExtension,
  sameExtension,
} from './extension-values.js';
import { sameValue } from './lists.js';
import { decodeValue, encodeValue } from './stored.js';
import { fits } from './values.js';

const PICTURE: ExtensionType = {
  type: 'extension',
  extension: 'media',
  name: 'Image',
  definition: IMAGE,
};
const NOISE: ExtensionType = {
  type: 'extension',
  extension: 'media',
  name: 'Sound',
  definition: SOUND,
};
const ABSENT: ExtensionType = { ...PICTURE, definition: null };
const CAPS = DEFAULT_LIMITS.caps;

describe('a value of an extension’s type', () => {
  it('is what its literal reads as, with the text it persists as', () => {
    const cat = extensionLiteral(PICTURE, 'cat.png');
    expect(cat).toBeInstanceOf(ExtensionValue);
    expect(cat.value).toEqual({ src: 'cat.png' });
    expect(cat.stored).toBe('cat.png');
    expect(String(cat)).toBe('cat.png');
  });

  it('fits its own type and no other', () => {
    const cat = extensionLiteral(PICTURE, 'cat.png');
    expect(fits(PICTURE, cat, CAPS)).toBe(true);
    expect(fits(NOISE, cat, CAPS)).toBe(false);
    expect(fits({ type: 'string' }, cat, CAPS)).toBe(false);
    expect(fits(PICTURE, 'cat.png', CAPS)).toBe(false);
  });

  it('is stored as its text under its type, and read back whole or falls to the default', () => {
    const cat = extensionLiteral(PICTURE, 'cat.png');
    const stored = encodeValue(PICTURE, cat);
    expect(stored).toEqual({ type: 'media.Image', value: 'cat.png' });
    const back = decodeValue(PICTURE, stored, CAPS);
    expect(back.fits && sameValue(back.value, cat)).toBe(true);
    expect(decodeValue(PICTURE, { type: 'media.Image', value: 'cat.gif' }, CAPS)).toEqual({
      fits: false,
      why: 'no-longer-fits',
    });
    expect(decodeValue(PICTURE, { type: 'media.Sound', value: 'cat.png' }, CAPS)).toEqual({
      fits: false,
      why: 'retyped',
    });
    expect(decodeValue(PICTURE, { type: 'media.Image', value: 3 }, CAPS)).toEqual({
      fits: false,
      why: 'no-longer-fits',
    });
  });

  it('is compared as its extension compares, and the same as another stored the same', () => {
    const a = extensionLiteral(PICTURE, 'cat.png');
    const b = restoredExtension(PICTURE, 'cat.png')!;
    const c = extensionLiteral(PICTURE, 'dog.png');
    expect(sameExtension(a, b)).toBe(true);
    expect(sameExtension(a, c)).toBe(false);
    expect(sameValue(a, b)).toBe(true);
    expect(sameValue(a, c)).toBe(false);
    expect(sameValue(a, 'cat.png')).toBe(false);
  });

  it('renders as its extension renders it', () => {
    expect(extensionWords(extensionLiteral(PICTURE, 'cat.png'))).toBe('the picture cat.png');
  });

  it('faults naming the extension where its code misbehaves', () => {
    const broken: ExtensionType = {
      ...PICTURE,
      definition: {
        ...IMAGE,
        persist: () => 3 as unknown as string,
        compares: () => 'yes' as unknown as boolean,
        renders: () => {
          throw new Error('no words');
        },
      },
    };
    expect(() => extensionLiteral(broken, 'cat.png')).toThrow(ExtensionFault);
    const held = new ExtensionValue(broken, { src: 'cat.png' }, 'cat.png');
    expect(() => sameExtension(held, held)).toThrow('answered a comparison');
    expect(() => extensionWords(held)).toThrow('threw rendering a value: no words');
  });
});

describe('a value of an absent extension’s type', () => {
  it('holds the text written or stored, unread, and renders nothing', () => {
    const held = extensionLiteral(ABSENT, 'cat.png');
    expect(held.value).toBeNull();
    expect(held.stored).toBe('cat.png');
    expect(extensionWords(held)).toBe('');
  });

  it('keeps what was stored for the extension’s return, and compares by it', () => {
    const back = decodeValue(ABSENT, { type: 'media.Image', value: 'dog.png' }, CAPS);
    expect(back.fits).toBe(true);
    const value = (back as { value: ExtensionValue }).value;
    expect(encodeValue(ABSENT, value)).toEqual({ type: 'media.Image', value: 'dog.png' });
    expect(sameExtension(value, extensionLiteral(ABSENT, 'dog.png'))).toBe(true);
    expect(sameExtension(value, extensionLiteral(ABSENT, 'cat.png'))).toBe(false);
  });
});
