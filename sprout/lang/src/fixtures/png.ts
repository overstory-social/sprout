// PNG files written as the PNG specification says, for the specs that read
// pictures: chunks with their CRCs, the image data as a zlib stream over the
// language's own deflate, any filter a row at a time, and Adam7. Spec
// support: the package build leaves it out.

import { crc32, gzip } from '../source/gzip.js';

/** A chunk as the file holds it: length, type, data, CRC. */
export function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** `bytes` as a zlib stream, the deflate taken from the language's gzip. */
function zlib(bytes: Uint8Array): Uint8Array {
  const gz = gzip(bytes);
  const raw = gz.subarray(10, gz.length - 8);
  const out = new Uint8Array(2 + raw.length + 4);
  out.set([0x78, 0x01]);
  out.set(raw, 2);
  new DataView(out.buffer).setUint32(2 + raw.length, adler32(bytes));
  return out;
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
  return out;
};

/** A row of bytes filtered with `filter`, one byte a pixel to the left, against the row above. */
function filtered(row: Uint8Array, above: Uint8Array | null, filter: number): Uint8Array {
  const out = new Uint8Array(row.length + 1);
  out[0] = filter;
  for (let x = 0; x < row.length; x++) {
    const a = x > 0 ? row[x - 1]! : 0;
    const b = above === null ? 0 : above[x]!;
    const c = x > 0 && above !== null ? above[x - 1]! : 0;
    const p = a + b - c;
    const predictor = [
      0,
      a,
      b,
      (a + b) >> 1,
      Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)
        ? a
        : Math.abs(p - b) <= Math.abs(p - c)
          ? b
          : c,
    ][filter]!;
    out[x + 1] = (row[x]! - predictor) & 0xff;
  }
  return out;
}

/** Pixels (true for a set bit) packed into rows, the leftmost in the highest bit. */
export function packed(pixels: boolean[][], width: number): Uint8Array {
  const stride = Math.ceil(width / 8);
  const out = new Uint8Array(stride * pixels.length);
  pixels.forEach((row, y) =>
    row.forEach((on, x) => {
      if (on) out[y * stride + (x >> 3)]! |= 0x80 >> (x & 7);
    }),
  );
  return out;
}

const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

export interface Written {
  colour?: number;
  depth?: number;
  interlace?: boolean;
  filter?: (y: number) => number;
  extra?: Uint8Array[];
}

/** A PNG of `bits` (set or not, a row at a time), written as the specification says. */
export function png(bits: boolean[][], options: Written = {}): Uint8Array {
  const height = bits.length;
  const width = bits[0]!.length;
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([options.depth ?? 1, options.colour ?? 0, 0, 0, options.interlace ? 1 : 0], 8);
  const passes = options.interlace ? ADAM7 : [[0, 0, 1, 1]];
  const scanlines: Uint8Array[] = [];
  for (const [x0, y0, dx, dy] of passes) {
    const pass: boolean[][] = [];
    for (let y = y0!; y < height; y += dy!) {
      const row: boolean[] = [];
      for (let x = x0!; x < width; x += dx!) row.push(bits[y]![x]!);
      if (row.length > 0) pass.push(row);
    }
    if (pass.length === 0) continue;
    const rows = packed(pass, pass[0]!.length);
    const stride = Math.ceil(pass[0]!.length / 8);
    pass.forEach((_, y) => {
      const row = rows.subarray(y * stride, (y + 1) * stride);
      const above = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : null;
      scanlines.push(filtered(row, above, options.filter?.(y) ?? 0));
    });
  }
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const data = zlib(concat(...scanlines));
  // The image data split across two chunks, as an encoder may.
  const half = data.length >> 1;
  return concat(
    signature,
    chunk('IHDR', header),
    ...(options.extra ?? []),
    chunk('IDAT', data.subarray(0, half)),
    chunk('IDAT', data.subarray(half)),
    chunk('IEND', new Uint8Array(0)),
  );
}
