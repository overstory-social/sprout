import { createHash, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { hashOfNamed, sha256 } from './sha256.js';

describe('sha256 is SHA-256, against the published vectors', () => {
  const vectors: [string, string][] = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    [
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
    ],
  ];
  for (const [input, want] of vectors) {
    it(`hashes ${input.length} characters`, () => expect(sha256(input)).toBe(want));
  }

  it('hashes a million characters, where the block loop has somewhere to go wrong', () => {
    expect(sha256('a'.repeat(1_000_000))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });
});

describe('sha256 agrees with the platform’s, which did not come from the same head', () => {
  const platform = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

  it('agrees on a thousand random inputs of every length around a block', () => {
    for (let length = 0; length < 200; length++) {
      const bytes = new Uint8Array(randomBytes(length));
      expect(sha256(bytes), `length ${length}`).toBe(platform(bytes));
    }
    for (let i = 0; i < 800; i++) {
      const bytes = new Uint8Array(randomBytes(Math.floor(Math.random() * 4096)));
      expect(sha256(bytes)).toBe(platform(bytes));
    }
  });

  it('agrees on text that is not ASCII, so the UTF-8 is the same UTF-8', () => {
    for (const text of ['é', '日本語', '🌱 sprout', 'a\u0000b', '�']) {
      expect(sha256(text), text).toBe(platform(new TextEncoder().encode(text)));
    }
  });

  it('agrees on the lengths where the padding gains a block', () => {
    for (const length of [54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128]) {
      const bytes = new Uint8Array(randomBytes(length));
      expect(sha256(bytes), `length ${length}`).toBe(platform(bytes));
    }
  });
});

describe('sha256 is a hash, and behaves like one', () => {
  it('is sixty-four lower-case hex digits', () => {
    expect(sha256('anything')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives the same answer twice', () => expect(sha256('x')).toBe(sha256('x')));

  it('gives a different answer for one different bit', () => {
    expect(sha256('composing_room')).not.toBe(sha256('composing_rooM'));
  });

  it('takes bytes and text alike', () => {
    expect(sha256(new TextEncoder().encode('abc'))).toBe(sha256('abc'));
  });
});

describe('hashOfNamed hashes a library however its files were handed over', () => {
  const files: [string, string][] = [
    ['actor.sprout', 'kind Actor { }'],
    ['place.sprout', 'kind Place { contains }'],
    ['world.sprout', 'kind World { }'],
  ];

  it('does not care what order they came in', () => {
    expect(hashOfNamed(files)).toBe(hashOfNamed([...files].reverse()));
  });

  it('changes when a file’s text changes', () => {
    const changed: [string, string][] = [...files.slice(1), ['actor.sprout', 'kind Actor { x }']];
    expect(hashOfNamed(changed)).not.toBe(hashOfNamed(files));
  });

  it('changes when a file is renamed, since a library is its files by name', () => {
    const renamed: [string, string][] = [...files.slice(1), ['creature.sprout', 'kind Actor { }']];
    expect(hashOfNamed(renamed)).not.toBe(hashOfNamed(files));
  });

  it('changes when a file is added or taken away', () => {
    expect(hashOfNamed(files.slice(0, 2))).not.toBe(hashOfNamed(files));
  });

  it('cannot be fooled by moving text across the seam between name and content', () => {
    expect(hashOfNamed([['a', 'bc']])).not.toBe(hashOfNamed([['ab', 'c']]));
    expect(hashOfNamed([['a\nb', '']])).not.toBe(hashOfNamed([['a', 'b']]));
  });

  it('hashes nothing to something', () => expect(hashOfNamed([])).toMatch(/^[0-9a-f]{64}$/));

  it('leaves the list it was given alone', () => {
    const given: [string, string][] = [
      ['z.sprout', 'z'],
      ['a.sprout', 'a'],
    ];
    hashOfNamed(given);
    expect(given.map(([name]) => name)).toEqual(['z.sprout', 'a.sprout']);
  });
});
