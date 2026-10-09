// Gzip (RFC 1952) over deflate (RFC 1951), written out for the same reason
// the hash is: the language imports zod and nothing else, and runs in a
// browser as readily as on a server, where `node:zlib` is not and the
// platform's streams are asynchronous. A cartridge is gzip-compressed JSON
// (the spec's The compiler › What compiling produces), so a device reads it
// with any inflater.
//
// `gzip` writes one fixed-Huffman block over a hash-chained LZ77 search;
// `gunzip` reads any stream gzip allows (stored, fixed and dynamic blocks)
// and refuses a damaged one, naming what was wrong. Both are synchronous.

const WINDOW = 32768;
const MIN_MATCH = 3;
const MAX_MATCH = 258;
const MAX_CHAIN = 48;
const HASH_BITS = 15;

/** Base lengths and extra bits of length symbols 257 to 285. */
// prettier-ignore
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
// prettier-ignore
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
/** Base distances and extra bits of distance symbols 0 to 29. */
// prettier-ignore
const DISTANCE_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
// prettier-ignore
const DISTANCE_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
/** The order a dynamic block lists its code-length code lengths in. */
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 of `bytes`, as gzip's trailer holds it. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// --- writing -----------------------------------------------------------------

/** Bits packed least-significant first, as deflate packs them. */
class BitWriter {
  private bytes = new Uint8Array(1024);
  private length = 0;
  private bits = 0;
  private held = 0;

  private push(byte: number): void {
    if (this.length === this.bytes.length) {
      const grown = new Uint8Array(this.bytes.length * 2);
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.bytes[this.length++] = byte;
  }

  /** `count` bits of `value`, lowest first. */
  write(value: number, count: number): void {
    this.bits |= value << this.held;
    this.held += count;
    while (this.held >= 8) {
      this.push(this.bits & 0xff);
      this.bits >>>= 8;
      this.held -= 8;
    }
  }

  /** A Huffman code of `count` bits, which deflate packs most-significant first. */
  code(value: number, count: number): void {
    let reversed = 0;
    for (let i = 0; i < count; i++) reversed |= ((value >>> i) & 1) << (count - 1 - i);
    this.write(reversed, count);
  }

  finish(): Uint8Array {
    if (this.held > 0) this.push(this.bits & 0xff);
    return this.bytes.subarray(0, this.length);
  }
}

/** Write literal/length symbol `symbol` in the fixed code. */
function fixedSymbol(out: BitWriter, symbol: number): void {
  if (symbol < 144) out.code(0x30 + symbol, 8);
  else if (symbol < 256) out.code(0x190 + (symbol - 144), 9);
  else if (symbol < 280) out.code(symbol - 256, 7);
  else out.code(0xc0 + (symbol - 280), 8);
}

/** The index in `base` of the last entry not above `value`. */
function indexIn(base: readonly number[], value: number): number {
  let low = 0;
  let high = base.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (base[mid]! <= value) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** `input` as one fixed-Huffman deflate block. */
function deflate(input: Uint8Array): Uint8Array {
  const out = new BitWriter();
  out.write(1, 1);
  out.write(1, 2);
  const size = input.length;
  const head = new Int32Array(1 << HASH_BITS).fill(-1);
  const previous = new Int32Array(size).fill(-1);
  const hashAt = (at: number): number =>
    ((input[at]! << 10) ^ (input[at + 1]! << 5) ^ input[at + 2]!) & ((1 << HASH_BITS) - 1);
  const insert = (at: number): void => {
    if (at + MIN_MATCH > size) return;
    const hash = hashAt(at);
    previous[at] = head[hash]!;
    head[hash] = at;
  };
  let at = 0;
  while (at < size) {
    let bestLength = 0;
    let bestDistance = 0;
    if (at + MIN_MATCH <= size) {
      const limit = Math.min(MAX_MATCH, size - at);
      let candidate = head[hashAt(at)]!;
      for (let chain = 0; candidate >= 0 && chain < MAX_CHAIN; chain++) {
        const distance = at - candidate;
        if (distance > WINDOW) break;
        let length = 0;
        while (length < limit && input[candidate + length] === input[at + length]) length++;
        if (length > bestLength) {
          bestLength = length;
          bestDistance = distance;
          if (length === limit) break;
        }
        candidate = previous[candidate]!;
      }
    }
    if (bestLength >= MIN_MATCH) {
      const lengthIndex = indexIn(LENGTH_BASE, bestLength);
      fixedSymbol(out, 257 + lengthIndex);
      out.write(bestLength - LENGTH_BASE[lengthIndex]!, LENGTH_EXTRA[lengthIndex]!);
      const distanceIndex = indexIn(DISTANCE_BASE, bestDistance);
      out.code(distanceIndex, 5);
      out.write(bestDistance - DISTANCE_BASE[distanceIndex]!, DISTANCE_EXTRA[distanceIndex]!);
      for (let i = 0; i < bestLength; i++) insert(at + i);
      at += bestLength;
    } else {
      fixedSymbol(out, input[at]!);
      insert(at);
      at += 1;
    }
  }
  fixedSymbol(out, 256);
  return out.finish();
}

/** `bytes` as a gzip stream: the ten-byte header, deflate, the CRC-32 and the length. */
export function gzip(bytes: Uint8Array): Uint8Array {
  const body = deflate(bytes);
  const out = new Uint8Array(10 + body.length + 8);
  out.set([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0xff]);
  out.set(body, 10);
  const view = new DataView(out.buffer);
  view.setUint32(10 + body.length, crc32(bytes), true);
  view.setUint32(14 + body.length, bytes.length >>> 0, true);
  return out;
}

// --- reading -----------------------------------------------------------------

/** A canonical Huffman code: how many codes there are of each length, and the symbols in code order. */
interface Huffman {
  readonly counts: Uint16Array;
  readonly symbols: Uint16Array;
}

function huffmanOf(lengths: ArrayLike<number>, count: number): Huffman {
  const counts = new Uint16Array(16);
  for (let i = 0; i < count; i++) counts[lengths[i]!]!++;
  const offsets = new Uint16Array(16);
  for (let length = 1; length < 15; length++) {
    offsets[length + 1] = offsets[length]! + counts[length]!;
  }
  const symbols = new Uint16Array(count);
  for (let i = 0; i < count; i++) {
    if (lengths[i] !== 0) symbols[offsets[lengths[i]!]!++] = i;
  }
  return { counts, symbols };
}

const FIXED_LITERALS = (() => {
  const lengths = new Uint8Array(288);
  lengths.fill(8, 0, 144);
  lengths.fill(9, 144, 256);
  lengths.fill(7, 256, 280);
  lengths.fill(8, 280, 288);
  return huffmanOf(lengths, 288);
})();
const FIXED_DISTANCES = huffmanOf(new Uint8Array(30).fill(5), 30);

class Reader {
  private at = 0;
  private bits = 0;
  private held = 0;
  constructor(private readonly bytes: Uint8Array) {}

  /** `count` bits, lowest first. */
  take(count: number): number {
    while (this.held < count) {
      if (this.at >= this.bytes.length) throw new Error('the compressed data ends too soon');
      this.bits |= this.bytes[this.at++]! << this.held;
      this.held += 8;
    }
    const value = this.bits & ((1 << count) - 1);
    this.bits >>>= count;
    this.held -= count;
    return value;
  }

  /** The next symbol of `code`. */
  symbol(code: Huffman): number {
    let first = 0;
    let index = 0;
    let candidate = 0;
    for (let length = 1; length < 16; length++) {
      candidate |= this.take(1);
      const count = code.counts[length]!;
      if (candidate - count < first) return code.symbols[index + (candidate - first)]!;
      index += count;
      first = (first + count) << 1;
      candidate <<= 1;
    }
    throw new Error('the compressed data holds a code that is none');
  }

  /** Skip to a byte boundary, and give the next `count` bytes. */
  aligned(count: number): Uint8Array {
    this.bits = 0;
    this.held = 0;
    if (this.at + count > this.bytes.length) throw new Error('the compressed data ends too soon');
    const slice = this.bytes.subarray(this.at, this.at + count);
    this.at += count;
    return slice;
  }

  get position(): number {
    return this.at;
  }
}

/** A growing output, which a back-reference reads from. */
class Output {
  bytes = new Uint8Array(4096);
  length = 0;
  push(byte: number): void {
    if (this.length === this.bytes.length) this.grow(this.length + 1);
    this.bytes[this.length++] = byte;
  }
  append(more: Uint8Array): void {
    if (this.length + more.length > this.bytes.length) this.grow(this.length + more.length);
    this.bytes.set(more, this.length);
    this.length += more.length;
  }
  private grow(needed: number): void {
    const grown = new Uint8Array(Math.max(needed, this.bytes.length * 2));
    grown.set(this.bytes.subarray(0, this.length));
    this.bytes = grown;
  }
}

function inflateBlock(reader: Reader, out: Output, literals: Huffman, distances: Huffman): void {
  for (;;) {
    const symbol = reader.symbol(literals);
    if (symbol < 256) {
      out.push(symbol);
      continue;
    }
    if (symbol === 256) return;
    const lengthIndex = symbol - 257;
    if (lengthIndex >= LENGTH_BASE.length)
      throw new Error('the compressed data holds a bad length');
    const length = LENGTH_BASE[lengthIndex]! + reader.take(LENGTH_EXTRA[lengthIndex]!);
    const distanceIndex = reader.symbol(distances);
    if (distanceIndex >= DISTANCE_BASE.length) {
      throw new Error('the compressed data holds a bad distance');
    }
    const distance = DISTANCE_BASE[distanceIndex]! + reader.take(DISTANCE_EXTRA[distanceIndex]!);
    if (distance > out.length) throw new Error('the compressed data reaches before its start');
    for (let i = 0; i < length; i++) out.push(out.bytes[out.length - distance]!);
  }
}

function dynamicCodes(reader: Reader): [Huffman, Huffman] {
  const literalCount = reader.take(5) + 257;
  const distanceCount = reader.take(5) + 1;
  const codeLengthCount = reader.take(4) + 4;
  if (literalCount > 286 || distanceCount > 30) {
    throw new Error('the compressed data holds too many codes');
  }
  const codeLengths = new Uint8Array(19);
  for (let i = 0; i < codeLengthCount; i++) codeLengths[CODE_LENGTH_ORDER[i]!] = reader.take(3);
  const lengthCode = huffmanOf(codeLengths, 19);
  const lengths = new Uint8Array(literalCount + distanceCount);
  for (let i = 0; i < lengths.length;) {
    const symbol = reader.symbol(lengthCode);
    if (symbol < 16) {
      lengths[i++] = symbol;
      continue;
    }
    let repeat: number;
    let value = 0;
    if (symbol === 16) {
      if (i === 0) throw new Error('the compressed data repeats a length it never gave');
      value = lengths[i - 1]!;
      repeat = 3 + reader.take(2);
    } else if (symbol === 17) repeat = 3 + reader.take(3);
    else repeat = 11 + reader.take(7);
    if (i + repeat > lengths.length) throw new Error('the compressed data repeats too far');
    lengths.fill(value, i, i + repeat);
    i += repeat;
  }
  return [
    huffmanOf(lengths.subarray(0, literalCount), literalCount),
    huffmanOf(lengths.subarray(literalCount), distanceCount),
  ];
}

/** Raw deflate `bytes`, inflated; the bytes and where in `bytes` the data ended. */
function inflate(bytes: Uint8Array): { data: Uint8Array; end: number } {
  const reader = new Reader(bytes);
  const out = new Output();
  for (let last = 0; last === 0;) {
    last = reader.take(1);
    const type = reader.take(2);
    if (type === 0) {
      const header = reader.aligned(4);
      const length = header[0]! | (header[1]! << 8);
      const check = header[2]! | (header[3]! << 8);
      if (length !== (~check & 0xffff)) throw new Error('the compressed data holds a bad block');
      out.append(reader.aligned(length));
    } else if (type === 1) inflateBlock(reader, out, FIXED_LITERALS, FIXED_DISTANCES);
    else if (type === 2) {
      const [literals, distances] = dynamicCodes(reader);
      inflateBlock(reader, out, literals, distances);
    } else throw new Error('the compressed data holds a block of a kind that is none');
  }
  return { data: out.bytes.subarray(0, out.length), end: reader.position };
}

/**
 * The bytes a gzip stream holds. Refuses, naming what is wrong, a stream
 * that is not gzip, is cut short, is damaged, or is not deflated.
 */
export function gunzip(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    throw new Error('this is not gzip-compressed data');
  }
  if (bytes[2] !== 8) throw new Error('this gzip data is not deflated');
  const flags = bytes[3]!;
  let at = 10;
  if (flags & 4) at += 2 + (bytes[at]! | (bytes[at + 1]! << 8));
  for (const flag of [8, 16]) {
    if (flags & flag) {
      while (at < bytes.length && bytes[at] !== 0) at++;
      at++;
    }
  }
  if (flags & 2) at += 2;
  if (at >= bytes.length) throw new Error('the compressed data ends too soon');
  const { data, end } = inflate(bytes.subarray(at));
  const trailer = at + end;
  if (trailer + 8 > bytes.length) throw new Error('the compressed data ends too soon');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(trailer, true) !== crc32(data)) {
    throw new Error('the compressed data is damaged: its checksum does not match');
  }
  if (view.getUint32(trailer + 4, true) !== data.length >>> 0) {
    throw new Error('the compressed data is damaged: its length does not match');
  }
  return data;
}
