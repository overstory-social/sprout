// Reading a PNG of one bit a pixel (the PNG specification, ISO/IEC 15948),
// which is what the `media` extension's pictures are (the Playdate design's
// The cartridge). Grey scale or palette at bit depth 1, interlaced or not;
// every chunk's CRC and the image data's Adler-32 are checked, and a file
// that is not such a PNG, or is damaged, is refused naming what is wrong.
//
// The picture comes back as the Playdate holds a bitmap: rows of
// `ceil(width / 8)` bytes, the leftmost pixel in the highest bit, a set bit
// white. A palette entry is white where its luminance is at least half; a
// pixel `tRNS` makes transparent is white, the screen a picture is drawn on.

import { crc32, inflateRaw } from './gzip.js';

/** A picture of one bit a pixel, its rows packed. */
export interface OneBitPicture {
  readonly width: number;
  readonly height: number;
  /** `height` rows of `ceil(width / 8)` bytes, the leftmost pixel in the highest bit, a set bit white. */
  readonly rows: Uint8Array;
}

/** A file that cannot be read as a PNG of one bit a pixel, said in words for an author. */
export class PngUnreadable extends Error {
  override readonly name = 'PngUnreadable';
}

/** The eight bytes every PNG file begins with. */
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Adam7's seven passes: the first column and row of each, and the steps between. */
// prettier-ignore
const ADAM7 = [
  [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
] as const;

interface Chunk {
  readonly type: string;
  readonly data: Uint8Array;
}

/** The file's chunks in order, each one's CRC checked. */
function chunksOf(bytes: Uint8Array): Chunk[] {
  if (bytes.length < 8 || SIGNATURE.some((byte, at) => bytes[at] !== byte)) {
    throw new PngUnreadable('it is not a PNG file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: Chunk[] = [];
  for (let at = 8; at < bytes.length;) {
    if (at + 12 > bytes.length) throw new PngUnreadable('it ends partway through a chunk');
    const length = view.getUint32(at);
    if (at + 12 + length > bytes.length) throw new PngUnreadable('it ends partway through a chunk');
    const typed = bytes.subarray(at + 4, at + 8 + length);
    const type = String.fromCharCode(...typed.subarray(0, 4));
    if (crc32(typed) !== view.getUint32(at + 8 + length)) {
      throw new PngUnreadable(
        `its ${type} part does not match its checksum, so the file is damaged`,
      );
    }
    chunks.push({ type, data: typed.subarray(4) });
    at += 12 + length;
    if (type === 'IEND') return chunks;
  }
  throw new PngUnreadable('it has no end chunk');
}

/** The Adler-32 of `bytes`, as a zlib stream's trailer holds it. */
function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** The bytes a zlib stream holds. */
function unzlib(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 6 || (bytes[0]! & 0x0f) !== 8 || ((bytes[0]! << 8) | bytes[1]!) % 31 !== 0) {
    throw new PngUnreadable('its image data is not compressed as a PNG’s is');
  }
  if (bytes[1]! & 0x20)
    throw new PngUnreadable('its image data needs a dictionary it does not hold');
  let inflated: { data: Uint8Array; end: number };
  try {
    inflated = inflateRaw(bytes.subarray(2));
  } catch (thrown) {
    throw new PngUnreadable(`its image data is damaged: ${(thrown as Error).message}`);
  }
  const trailer = 2 + inflated.end;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (trailer + 4 > bytes.length || view.getUint32(trailer) !== adler32(inflated.data)) {
    throw new PngUnreadable('its image data is damaged: its checksum does not match');
  }
  return inflated.data;
}

/** The Paeth predictor of the PNG specification's filter type 4. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * `height` filtered rows of `stride` bytes from `data` at `at`, each after its
 * filter-type byte, unfiltered in place into a new array; one byte a pixel to
 * the left, as the specification rounds a bit depth below eight up to.
 */
function unfiltered(data: Uint8Array, at: number, stride: number, height: number): Uint8Array {
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = data[at + y * (stride + 1)]!;
    const from = at + y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const raw = data[from + x]!;
      const left = x > 0 ? out[row + x - 1]! : 0;
      const up = y > 0 ? out[row - stride + x]! : 0;
      const corner = x > 0 && y > 0 ? out[row - stride + x - 1]! : 0;
      let value: number;
      if (filter === 0) value = raw;
      else if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + ((left + up) >> 1);
      else if (filter === 4) value = raw + paeth(left, up, corner);
      else throw new PngUnreadable(`a row of its image data has filter ${filter}, which is none`);
      out[row + x] = value & 0xff;
    }
  }
  return out;
}

/** Which of the two values a pixel can hold is white: by grey level, or by palette entry and transparency. */
function whitesOf(colour: number, chunks: readonly Chunk[]): readonly [boolean, boolean] {
  const transparency = chunks.find((chunk) => chunk.type === 'tRNS')?.data;
  if (colour === 0) {
    const clear =
      transparency !== undefined && transparency.length >= 2
        ? ((transparency[0]! << 8) | transparency[1]!) & 1
        : -1;
    return [clear === 0, true];
  }
  const palette = chunks.find((chunk) => chunk.type === 'PLTE')?.data;
  if (palette === undefined || palette.length < 3 || palette.length % 3 !== 0) {
    throw new PngUnreadable('it is a palette image with no palette');
  }
  const white = (index: number): boolean => {
    if (index * 3 >= palette.length) return true;
    if (transparency !== undefined && index < transparency.length && transparency[index]! < 128) {
      return true;
    }
    const [r, g, b] = [palette[index * 3]!, palette[index * 3 + 1]!, palette[index * 3 + 2]!];
    return 299 * r + 587 * g + 114 * b >= 128 * 1000;
  };
  return [white(0), white(1)];
}

/**
 * The picture a PNG of one bit a pixel holds. Refuses, naming what is wrong,
 * a file that is not a PNG, is not grey scale or palette at one bit a pixel,
 * or is damaged.
 */
export function readOneBitPng(bytes: Uint8Array): OneBitPicture {
  const chunks = chunksOf(bytes);
  const header = chunks[0];
  if (header?.type !== 'IHDR' || header.data.length !== 13) {
    throw new PngUnreadable('it does not begin with its header chunk');
  }
  const view = new DataView(header.data.buffer, header.data.byteOffset, header.data.byteLength);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  const [depth, colour, compression, filtering, interlace] = header.data.subarray(8);
  if (width === 0 || height === 0) throw new PngUnreadable('it is a picture with no pixels');
  if (depth !== 1 || (colour !== 0 && colour !== 3)) {
    throw new PngUnreadable('it is not grey scale or palette at one bit a pixel');
  }
  if (compression !== 0 || filtering !== 0 || (interlace !== 0 && interlace !== 1)) {
    throw new PngUnreadable(
      'it is compressed, filtered or interlaced in a way PNG does not define',
    );
  }
  const whites = whitesOf(colour, chunks);
  const compressed = chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data);
  const joined = new Uint8Array(compressed.reduce((total, data) => total + data.length, 0));
  compressed.reduce((at, data) => (joined.set(data, at), at + data.length), 0);
  const data = unzlib(joined);

  const passes = interlace === 1 ? ADAM7 : ([[0, 0, 1, 1]] as const);
  // The image data is measured against the size the header claims before any room is made for
  // the rows, so a header claiming a vast picture is refused rather than allocated.
  const expected = passes.reduce((total, [x0, y0, dx, dy]) => {
    const passWidth = Math.ceil((width - x0) / dx);
    const passHeight = Math.ceil((height - y0) / dy);
    return passWidth <= 0 || passHeight <= 0
      ? total
      : total + (Math.ceil(passWidth / 8) + 1) * passHeight;
  }, 0);
  if (expected > data.length)
    throw new PngUnreadable('its image data is shorter than its size says');
  if (expected < data.length)
    throw new PngUnreadable('its image data is longer than its size says');
  const stride = Math.ceil(width / 8);
  const rows = new Uint8Array(stride * height);
  let at = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const passWidth = Math.ceil((width - x0) / dx);
    const passHeight = Math.ceil((height - y0) / dy);
    if (passWidth <= 0 || passHeight <= 0) continue;
    const passStride = Math.ceil(passWidth / 8);
    const pass = unfiltered(data, at, passStride, passHeight);
    at += (passStride + 1) * passHeight;
    for (let py = 0; py < passHeight; py++) {
      const y = y0 + py * dy;
      for (let px = 0; px < passWidth; px++) {
        const bit = (pass[py * passStride + (px >> 3)]! >> (7 - (px & 7))) & 1;
        if (!whites[bit]) continue;
        const x = x0 + px * dx;
        rows[y * stride + (x >> 3)]! |= 0x80 >> (x & 7);
      }
    }
  }
  return { width, height, rows };
}
