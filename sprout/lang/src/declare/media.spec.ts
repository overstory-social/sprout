import { describe, expect, it } from 'vitest';

import { frozenPlain, readLiteral, type ExtensionStatementDefinition } from './extensions.js';
import { IMAGE, MEDIA, MEDIA_MAJOR } from './media.js';
import { chunk, png } from '../fixtures/png.js';

const show = MEDIA.statements.find((one) => one.name === 'show') as ExtensionStatementDefinition;
const frame = (...args: (string | undefined)[]) => ({
  arguments: args.filter((one): one is string => one !== undefined),
  self: 'cellar',
  actor: null,
});

const asset = (content: Uint8Array) =>
  IMAGE.asset!.pack({ bytes: content.length, sha: '', content });

/** A picture three wide and two high, its corners set. */
const CORNERS = [
  [true, false, true],
  [false, true, false],
];

describe('the media extension', () => {
  it('is installed at major 1 with one type and one statement', () => {
    expect(MEDIA.name).toBe('media');
    expect(MEDIA.major).toBe(MEDIA_MAJOR);
    expect(MEDIA_MAJOR).toBe(1);
    expect(MEDIA.types.map((type) => type.name)).toEqual(['Image']);
    expect(MEDIA.statements.map((statement) => statement.name)).toEqual(['show']);
  });
});

describe('an Image', () => {
  it('is written as the name of a .png file inside the world’s folder', () => {
    expect(readLiteral('media', IMAGE, 'cellar.png')).toEqual({ value: 'cellar.png' });
    expect(readLiteral('media', IMAGE, 'pictures/a/b.png')).toEqual({ value: 'pictures/a/b.png' });
  });

  it('is refused where the name is not a .png', () => {
    expect(readLiteral('media', IMAGE, 'cellar.jpg')).toMatchObject({
      problem: '"cellar.jpg" is not the name of an image: an image’s name ends in .png.',
    });
    expect(readLiteral('media', IMAGE, '.png')).toHaveProperty('problem');
    expect(readLiteral('media', IMAGE, '')).toHaveProperty('problem');
  });

  it('is refused where the name leaves the world’s folder', () => {
    for (const name of [
      '../a.png',
      'a/../b.png',
      '/etc/a.png',
      'a\\b.png',
      'a//b.png',
      'a/./b.png',
    ]) {
      expect(readLiteral('media', IMAGE, name), name).toMatchObject({
        remedy:
          'Write the file’s path from the world’s folder with / between folders, as in "pictures/cellar.png".',
      });
    }
  });

  it('persists as its name and is restored only from one that is still an image’s', () => {
    expect(IMAGE.persist('cellar.png')).toBe('cellar.png');
    expect(IMAGE.restore('cellar.png')).toBe('cellar.png');
    expect(IMAGE.restore('../cellar.png')).toBeNull();
    expect(IMAGE.print('cellar.png')).toBe('cellar.png');
  });

  it('compares by name, and renders in no slot', () => {
    expect(IMAGE.compares && IMAGE.compares('a.png', 'a.png')).toBe(true);
    expect(IMAGE.compares && IMAGE.compares('a.png', 'b.png')).toBe(false);
    expect(IMAGE.renders).toBe(false);
  });

  it('names its file by its value', () => {
    expect(IMAGE.asset!.file('pictures/a.png')).toBe('pictures/a.png');
  });

  it('is a file of one bit a pixel, grey scale or indexed, packed as its size and its rows', () => {
    // Three by two, then a row of one byte each: the leftmost pixel in the highest bit, white set.
    const packed = Uint8Array.from([3, 0, 2, 0, 0b10100000, 0b01000000]);
    expect(asset(png(CORNERS))).toEqual({ packed });
    const palette = chunk('PLTE', Uint8Array.from([0, 0, 0, 255, 255, 255]));
    expect(asset(png(CORNERS, { colour: 3, extra: [palette] }))).toEqual({ packed });
    expect(asset(png(CORNERS, { interlace: true }))).toEqual({ packed });
  });

  it('is not a picture of more than one bit a pixel', () => {
    expect(asset(png(CORNERS, { depth: 8 }))).toEqual({
      problem:
        'This image is not black and white: it has 8 bits to a pixel, and an image here has one.',
      remedy: 'Save the picture again as a 1-bit PNG, black and white without grey.',
    });
    expect(asset(png(CORNERS, { colour: 2 }))).toHaveProperty('problem');
    expect(asset(png(CORNERS, { colour: 6 }))).toHaveProperty('problem');
  });

  it('is not a file that is not a PNG, whatever it holds', () => {
    const text = new TextEncoder().encode('GIF89a and some more bytes to be long enough, ok?');
    expect(asset(text)).toMatchObject({ problem: 'This file is not a PNG image.' });
    expect(asset(new Uint8Array(0))).toHaveProperty('problem');
  });

  it('is not a PNG that is damaged, which is said with what is wrong', () => {
    const damaged = png(CORNERS);
    damaged[damaged.length - 20]! ^= 0xff;
    expect(asset(damaged)).toEqual({
      problem:
        'This PNG image cannot be read: its IDAT part does not match its checksum, so the file is damaged.',
      remedy: 'Open the picture in an image editor and save it again as a 1-bit PNG.',
    });
  });

  it('is at most 65535 pixels a side, which its packed size can say', () => {
    const wide = [Array.from({ length: 65536 }, () => false)];
    expect(asset(png(wide))).toEqual({
      problem: 'This image is 65536 by 1 pixels, and an image here is at most 65535 pixels a side.',
      remedy: 'Make the picture smaller; the Playdate’s screen is 400 by 240.',
    });
    expect(asset(png([Array.from({ length: 65535 }, () => true)]))).toHaveProperty('packed');
  });
});

describe('media.show', () => {
  it('may stand in a `describe`, and takes an image and, after it, an optional caption', () => {
    expect(show.describe).toBe(true);
    expect(show.parameters).toEqual([
      { name: 'image', type: { type: 'Image' } },
      { name: 'caption', type: 'string', optional: true },
    ]);
  });

  it('records the image alone, or the image and its caption', () => {
    expect(show.run(frame('cellar.png'))).toEqual({ image: 'cellar.png' });
    expect(show.run(frame('cellar.png', 'a damp cellar'))).toEqual({
      image: 'cellar.png',
      caption: 'a damp cellar',
    });
  });

  it('records no caption where the one it was given is empty', () => {
    const payload = show.run(frame('cellar.png', ''));
    expect(payload).toEqual({ image: 'cellar.png' });
    expect(Object.keys(payload as object)).toEqual(['image']);
  });

  it('records its image before its caption, as every host writes them', () => {
    expect(JSON.stringify(show.run(frame('a.png', 'words')))).toBe(
      '{"image":"a.png","caption":"words"}',
    );
  });

  it('is plain data, which an extension’s payload must be', () => {
    expect(frozenPlain(show.run(frame('a.png', 'words')))).toEqual({
      image: 'a.png',
      caption: 'words',
    });
  });

  it('reads, to a client that cannot draw, as its caption or its image’s name in brackets', () => {
    expect(show.transcript({ image: 'cellar.png', caption: 'a damp cellar' })).toBe(
      'a damp cellar',
    );
    expect(show.transcript({ image: 'cellar.png' })).toBe('[cellar.png]');
  });

  it('holds a payload to its shape', () => {
    const accepts = (payload: unknown) => show.effect.safeParse(payload).success;
    expect(accepts({ image: 'a.png' })).toBe(true);
    expect(accepts({ image: 'a.png', caption: 'x' })).toBe(true);
    expect(accepts({ image: '' })).toBe(false);
    expect(accepts({ caption: 'x' })).toBe(false);
    expect(accepts({ image: 'a.png', caption: 3 })).toBe(false);
    expect(accepts({ image: 'a.png', other: 1 })).toBe(false);
    expect(accepts(['a.png'])).toBe(false);
    expect(accepts(null)).toBe(false);
    expect(accepts('a.png')).toBe(false);
  });

  it('takes an image the world supplies, as a property’s, and refuses a caption with no words', () => {
    expect(show.check!([undefined, undefined])).toBeNull();
    expect(show.check!([undefined, ''])).toMatchObject({ problem: 'A caption needs words.' });
    expect(show.check!(['a.png', ''])).toMatchObject({ problem: 'A caption needs words.' });
    expect(show.check!(['a.png', undefined])).toBeNull();
    expect(show.check!(['a.png', 'x'])).toBeNull();
    expect(show.check!(['a.png'])).toBeNull();
  });
});
