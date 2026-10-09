import { describe, expect, it } from 'vitest';

import { chooser } from '../fixtures/parse.js';
import { crc32, gunzip, gzip } from './gzip.js';

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const hex = (s: string): Uint8Array => Uint8Array.from(s.match(/../g)!.map((h) => parseInt(h, 16)));

// Streams written by a reference deflater, so the reader is held against
// bytes it did not make: a dynamic-Huffman block and a stored one.
const DYNAMIC_TEXT =
  'room type stick brass ream composing key kiln oak type quoin composing forme oak composing brass press galley room kiln forme kiln lantern shelf ream shelf shelf brass brass press press kiln kiln printer ink press press kiln press forme printer brass type galley kiln shelf room lantern ink printer brass ink lantern printer type printer quoin ink kiln quoin quoin kiln key room brass type forme brass galley type forme brass ream key kiln press oak composing ream type stick type stick room ream oak type printer key galley lantern press ink stick type shelf ink room lantern printer ink printer kiln lantern shelf printer quoin kiln key lantern forme key composing type room ream galley shelf key key';
const DYNAMIC =
  '1f8b080000000000020365525b12c32008bc0a57b319d23a3eabe9476edfc862d4c90f43605d962525a540c79999ea613747af626aa5c226d096424ed5c637393ec9591f291907f0f7976c9c107b2a81a53d6aa0ca85aff836de5f24a54d13263c90d49b787089543fec778c468a089a990c51de4ac8c53606b2d13d114831ae0341268ba83081aa80a6b16b02e5fcaa557ab77784a97fc09a0613527c224272f76152017928a8a2475d8cb92f81b556c30531dd724a65a0f4ef1376bd8d52678ebd58379d89c49d565c1c5acd57cae75957776e233a487f87ab32d691a943b86a049df8c0e71f96bb16cebe020000';
const STORED = '1f8b0800000000000403010c00f3ff73746f72656420626c6f636b94a3243d0c000000';

describe('crc32', () => {
  it('is the checksum gzip records', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('gunzip reads what a reference deflater wrote', () => {
  it('a dynamic-Huffman block', () => {
    expect(new TextDecoder().decode(gunzip(hex(DYNAMIC)))).toBe(DYNAMIC_TEXT);
  });
  it('a stored block', () => {
    expect(new TextDecoder().decode(gunzip(hex(STORED)))).toBe('stored block');
  });
});

describe('gzip and gunzip are inverses', () => {
  it('round-trips empty, short and repetitive input, and shrinks the repetitive', () => {
    for (const input of [new Uint8Array(0), text('a'), text('abcabcabcabcabcabcabc')]) {
      expect(gunzip(gzip(input))).toEqual(input);
    }
    const long = text('{"kind":"prose-words","text":"a brass key"},'.repeat(400));
    const packed = gzip(long);
    expect(packed.length).toBeLessThan(long.length / 10);
    expect(gunzip(packed)).toEqual(long);
  });

  it('round-trips any bytes, runs and noise alike', () => {
    const c = chooser(91);
    for (let round = 0; round < 40; round++) {
      const length = c.below(6000);
      const bytes = new Uint8Array(length);
      const alphabet = 1 + c.below(255);
      for (let i = 0; i < length; i++) {
        bytes[i] = c.below(4) === 0 && i > 8 ? bytes[i - 1 - c.below(8)]! : c.below(alphabet);
      }
      expect(gunzip(gzip(bytes)), `round ${round}`).toEqual(bytes);
    }
  });

  it('writes a header any gzip reader accepts', () => {
    const packed = gzip(text('x'));
    expect([...packed.subarray(0, 4)]).toEqual([0x1f, 0x8b, 8, 0]);
  });
});

describe('gunzip refuses what is not whole', () => {
  const good = gzip(text('a brass key on a shelf, a brass key on a shelf'));
  it('data that is not gzip', () => {
    expect(() => gunzip(text('not gzip at all, no'))).toThrow(/not gzip/);
  });
  it('a stream cut short', () => {
    expect(() => gunzip(good.subarray(0, good.length - 12))).toThrow(/ends too soon|damaged/);
  });
  it('a stream whose checksum or length is wrong', () => {
    const bad = Uint8Array.from(good);
    bad[bad.length - 5] = bad[bad.length - 5]! ^ 0xff;
    expect(() => gunzip(bad)).toThrow(/checksum/);
    const short = Uint8Array.from(good);
    short[short.length - 1] = short[short.length - 1]! ^ 0x7f;
    expect(() => gunzip(short)).toThrow(/length/);
  });
});
