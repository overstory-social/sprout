import { describe, expect, it } from 'vitest';

import { IMAGE, MEDIA, SHOW } from '../fixtures/extensions.js';
import { SourceFile } from '../source/source.js';
import {
  extensionStatement,
  frozenPlain,
  namesExtension,
  NO_EXTENSIONS,
  pinExtensions,
  readLiteral,
  type ExtensionValueType,
} from './extensions.js';

describe('pinning a world’s extensions against the host’s', () => {
  it('finds the one of each name at the major pinned', () => {
    const three = { ...MEDIA, major: 3 };
    const pinned = pinExtensions([{ name: 'media', major: 3 }], [MEDIA, three]);
    expect(pinned.get('media')).toEqual({
      name: 'media',
      major: 3,
      installed: three,
      absence: null,
    });
  });

  it('is absent where the host has none of that name, or none at that major', () => {
    const pinned = pinExtensions(
      [
        { name: 'media', major: 1 },
        { name: 'maps', major: 1 },
      ],
      [MEDIA],
    );
    expect(pinned.get('media')).toMatchObject({ installed: null, absence: 'other-major' });
    expect(pinned.get('maps')).toMatchObject({ installed: null, absence: 'not-installed' });
  });

  it('keeps the manifest’s order', () => {
    const pins = [
      { name: 'zeta', major: 0 },
      { name: 'alpha', major: 0 },
    ];
    expect([...pinExtensions(pins, []).keys()]).toEqual(['zeta', 'alpha']);
  });
});

describe('which extensions a file names', () => {
  it('is what its `extension` lines named, and nothing for a file that wrote none', () => {
    const file = new SourceFile('a.sprout', '');
    const other = new SourceFile('b.sprout', '');
    const extensions = { pinned: new Map(), named: new Map([[file, new Set(['media'])]]) };
    expect(namesExtension(extensions, file, 'media')).toBe(true);
    expect(namesExtension(extensions, file, 'maps')).toBe(false);
    expect(namesExtension(extensions, other, 'media')).toBe(false);
    expect(namesExtension(NO_EXTENSIONS, file, 'media')).toBe(false);
  });
});

describe('a statement an extension declares', () => {
  it('is found by name where the extension is installed, and not where it is absent', () => {
    const [pinned] = pinExtensions([{ name: 'media', major: 2 }], [MEDIA]).values();
    expect(extensionStatement(pinned!, 'show')).toBe(SHOW);
    expect(extensionStatement(pinned!, 'shout')).toBeNull();
    const [absent] = pinExtensions([{ name: 'media', major: 2 }], []).values();
    expect(extensionStatement(absent!, 'show')).toBeNull();
  });
});

describe('a plain value, frozen', () => {
  it('copies JSON’s shapes and freezes them all the way down', () => {
    const given = { a: [1, 'two', { three: true }], b: null };
    const copy = frozenPlain(given)!;
    expect(copy).toEqual(given);
    expect(copy).not.toBe(given);
    expect(Object.isFrozen(copy)).toBe(true);
    const inner = (copy as { a: readonly [number, string, object] }).a;
    expect(Object.isFrozen(inner)).toBe(true);
    expect(Object.isFrozen(inner[2])).toBe(true);
    expect(Object.isFrozen(given)).toBe(false);
  });

  it('is nothing where anything in it is not plain', () => {
    for (const odd of [
      Number.NaN,
      Infinity,
      undefined,
      () => 1,
      new Date(0),
      new Map(),
      [1, undefined],
      { deep: { at: Symbol('x') } },
    ]) {
      expect(frozenPlain(odd), String(odd)).toBeUndefined();
    }
  });
});

describe('reading a literal as a value of an extension’s type', () => {
  it('is the type’s reading, frozen, or its problem in its own words', () => {
    const read = readLiteral('media', IMAGE, 'cat.png');
    expect(read).toEqual({ value: { src: 'cat.png' } });
    expect(Object.isFrozen((read as { value: object }).value)).toBe(true);
    expect(readLiteral('media', IMAGE, 'cat.gif')).toEqual({
      problem: '"cat.gif" is not a picture: a picture\'s name ends in .png.',
      remedy: 'Write the name of a picture, as in "cat.png".',
    });
  });

  it('says the extension failed, for the host to mend, where it throws or reads what is not plain', () => {
    const throws: ExtensionValueType = {
      ...IMAGE,
      read: () => {
        throw new Error('no disk');
      },
    };
    expect(readLiteral('media', throws, 'cat.png')).toEqual({
      problem: 'The extension `media` failed reading this as `media.Image`: no disk.',
      remedy:
        'Tell whoever runs this host that `media` failed; the fault is theirs to fix, not yours.',
    });
    const odd: ExtensionValueType = { ...IMAGE, read: () => ({ value: new Date(0) as never }) };
    expect(readLiteral('media', odd, 'cat.png')).toMatchObject({
      problem: 'The extension `media` read this as something that is not a value.',
    });
  });
});
