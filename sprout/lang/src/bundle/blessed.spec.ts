// The host's blessed set (the spec's Host › Two decisions): the standard
// library's hash is the one entry a host starts from, a host adds and
// removes hashes and a mistyped one is thrown at its boot.

import { describe, expect, it } from 'vitest';

import { blessedFrom, BlessedError, DEFAULT_BLESSED } from './blessed.js';
import { libraryHash } from './bundle.js';
import { compileBundle } from './compile/compile.js';
import { STANDARD_LIBRARY } from './standard-library.js';
import { world } from '../fixtures/compile.js';

const SPROUT = libraryHash(STANDARD_LIBRARY);
const OTHER = 'c'.repeat(64);

describe('the blessed set a host starts from', () => {
  it('holds the standard library’s hash and nothing else', () => {
    expect([...DEFAULT_BLESSED]).toEqual([SPROUT]);
  });

  it('is what a compile blesses when the host names no set', () => {
    const { bundle } = compileBundle(world());
    expect(bundle!.libraries.map((library) => library.hash)).toEqual([SPROUT]);
    expect(bundle!.size.exemptBytes).toBe(bundle!.libraries[0]!.bytes);
  });
});

describe('a host’s blessed set', () => {
  it('is the default when the host says nothing', () => {
    expect([...blessedFrom()]).toEqual([SPROUT]);
  });

  it('adds what the host blesses and takes out what it unblesses', () => {
    expect([...blessedFrom({ bless: [OTHER] })].sort()).toEqual([OTHER, SPROUT].sort());
    expect([...blessedFrom({ unbless: [SPROUT] })]).toEqual([]);
    expect([...blessedFrom({ bless: [OTHER], unbless: [SPROUT] })]).toEqual([OTHER]);
  });

  it('never changes the default it started from', () => {
    blessedFrom({ bless: [OTHER], unbless: [SPROUT] });
    expect([...DEFAULT_BLESSED]).toEqual([SPROUT]);
  });

  it('throws at boot for something that is not a library hash', () => {
    for (const hash of ['', 'abc', SPROUT.toUpperCase(), `${SPROUT}0`, 'g'.repeat(64)]) {
      expect(() => blessedFrom({ bless: [hash] })).toThrow(BlessedError);
    }
    expect(() => blessedFrom({ bless: ['abc'] })).toThrow(
      'abc: is not a library hash: 64 lower-case hexadecimal digits.',
    );
  });

  it('throws at boot for unblessing a hash it does not bless', () => {
    expect(() => blessedFrom({ unbless: [OTHER] })).toThrow(`${OTHER}: is not blessed.`);
  });
});
