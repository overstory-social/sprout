import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { chunk, packed, png } from '../fixtures/png.js';
import { PngUnreadable, readOneBitPng } from './png.js';

const CORPUS = join(fileURLToPath(import.meta.url), '../../../../../corpus');

/** A pattern no filter or pass lines up with: 13 by 11, not a whole number of bytes a row. */
const PATTERN: boolean[][] = Array.from({ length: 11 }, (_, y) =>
  Array.from({ length: 13 }, (_, x) => (x * 7 + y * 3 + ((x * y) % 5)) % 3 === 0),
);

describe('readOneBitPng', () => {
  it('reads a grey picture under every filter, a set bit white, rows padded to whole bytes', () => {
    for (const filter of [0, 1, 2, 3, 4]) {
      const read = readOneBitPng(png(PATTERN, { filter: () => filter }));
      expect([read.width, read.height]).toEqual([13, 11]);
      expect(read.rows).toEqual(packed(PATTERN, 13));
    }
    const mixed = readOneBitPng(png(PATTERN, { filter: (y) => y % 5 }));
    expect(mixed.rows).toEqual(packed(PATTERN, 13));
  });

  it('reads an interlaced picture to the same rows as a plain one', () => {
    for (const filter of [0, 4]) {
      const read = readOneBitPng(png(PATTERN, { interlace: true, filter: () => filter }));
      expect(read.rows).toEqual(packed(PATTERN, 13));
    }
    const tiny = [[true], [false]];
    expect(readOneBitPng(png(tiny, { interlace: true })).rows).toEqual(Uint8Array.from([0x80, 0]));
  });

  it('reads a palette picture by its entries, light ones white and transparent ones white', () => {
    const inverted = chunk('PLTE', Uint8Array.from([250, 250, 250, 10, 20, 30]));
    const read = readOneBitPng(png(PATTERN, { colour: 3, extra: [inverted] }));
    const flipped = PATTERN.map((row) => row.map((on) => !on));
    expect(read.rows).toEqual(packed(flipped, 13));

    const black = chunk('PLTE', Uint8Array.from([0, 0, 0, 0, 0, 0]));
    const clear = chunk('tRNS', Uint8Array.from([255, 0]));
    const masked = readOneBitPng(png(PATTERN, { colour: 3, extra: [black, clear] }));
    expect(masked.rows).toEqual(packed(PATTERN, 13));
  });

  it('reads a grey picture whose black is transparent as white', () => {
    const clear = chunk('tRNS', Uint8Array.from([0, 0]));
    const read = readOneBitPng(png(PATTERN, { extra: [clear] }));
    expect(read.rows).toEqual(
      packed(
        PATTERN.map((row) => row.map(() => true)),
        13,
      ),
    );
  });

  it('reads the pictures real encoders wrote, as they were drawn', () => {
    const cellar = readOneBitPng(readFileSync(join(CORPUS, 'good/media-room/cellar.png')));
    expect([cellar.width, cellar.height, cellar.rows.length]).toEqual([64, 40, 320]);
    // A file written by another encoder, read, written by this spec's and read again, is the same picture.
    const pixels = Array.from({ length: cellar.height }, (_, y) =>
      Array.from(
        { length: cellar.width },
        (_, x) => ((cellar.rows[y * 8 + (x >> 3)]! >> (7 - (x & 7))) & 1) === 1,
      ),
    );
    expect(readOneBitPng(png(pixels, { filter: (y) => y % 5 })).rows).toEqual(cellar.rows);
  });

  it('refuses, in words, what is not a picture it reads', () => {
    const good = png(PATTERN);
    const refusal = (bytes: Uint8Array): string => {
      try {
        readOneBitPng(bytes);
      } catch (thrown) {
        expect(thrown).toBeInstanceOf(PngUnreadable);
        return (thrown as Error).message;
      }
      return 'read';
    };
    expect(refusal(new TextEncoder().encode('not a png'))).toBe('it is not a PNG file');
    expect(refusal(good.subarray(0, good.length - 6))).toBe('it ends partway through a chunk');
    const damaged = Uint8Array.from(good);
    damaged[45]! ^= 0xff; // a byte of the first IDAT chunk's data
    expect(refusal(damaged)).toBe(
      'its IDAT part does not match its checksum, so the file is damaged',
    );
    expect(refusal(png(PATTERN, { depth: 8 }))).toBe(
      'it is not grey scale or palette at one bit a pixel',
    );
    expect(refusal(png(PATTERN, { colour: 3 }))).toBe('it is a palette image with no palette');
    expect(refusal(png(PATTERN, { filter: () => 7 }))).toBe(
      'a row of its image data has filter 7, which is none',
    );
    const noEnd = good.subarray(0, good.length - 12);
    expect(refusal(noEnd)).toBe('it has no end chunk');
  });
});
