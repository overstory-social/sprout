import { describe, expect, it } from 'vitest';

import {
  compareVersions,
  keepsSaves,
  nextBreaking,
  readVersion,
  type Version,
} from './versions.js';

const v = (text: string): Version => {
  const read = readVersion(text);
  if (read === null) throw new Error(`${text} is not a version`);
  return read;
};

describe('versions', () => {
  it('reads a version, dropping its build metadata, and refuses what is not one', () => {
    expect(readVersion('1.2.3-beta.4+build.7')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ['beta', '4'],
    });
    expect(readVersion('1.2')).toBeNull();
    expect(readVersion('01.2.3')).toBeNull();
  });

  it('orders versions by semver precedence', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.1.0',
      '2.0.0',
    ];
    for (let i = 0; i + 1 < ordered.length; i++) {
      expect(compareVersions(v(ordered[i]!), v(ordered[i + 1]!))).toBe(-1);
      expect(compareVersions(v(ordered[i + 1]!), v(ordered[i]!))).toBe(1);
    }
    expect(compareVersions(v('1.0.0+a'), v('1.0.0+b'))).toBe(0);
  });

  it('keeps a save across a later version the caret takes, and no other', () => {
    const keeps = (a: string, b: string) => keepsSaves(v(a), v(b));
    expect(keeps('0.1.0', '0.1.1')).toBe(true);
    expect(keeps('1.0.0', '1.1.0')).toBe(true);
    expect(keeps('1.0.0', '1.0.0')).toBe(true);
    expect(keeps('0.1.0', '0.2.0')).toBe(false);
    expect(keeps('1.4.0', '2.0.0')).toBe(false);
    expect(keeps('0.0.3', '0.0.4')).toBe(false);
    expect(keeps('0.0.3', '0.0.3+rebuilt')).toBe(true);
    // An earlier version never opens a later one's save.
    expect(keeps('1.1.0', '1.0.0')).toBe(false);
    expect(keeps('0.1.2', '0.1.1')).toBe(false);
    // A pre-release on either side matches only itself.
    expect(keeps('1.0.0-beta.1', '1.0.0-beta.1')).toBe(true);
    expect(keeps('1.0.0-beta.1', '1.0.0-beta.2')).toBe(false);
    expect(keeps('1.0.0-beta.1', '1.0.0')).toBe(false);
    expect(keeps('1.0.0', '1.1.0-beta.1')).toBe(false);
  });

  it('names the first breaking version after one', () => {
    expect(nextBreaking(v('1.4.2'))).toBe('2.0.0');
    expect(nextBreaking(v('0.3.1'))).toBe('0.4.0');
    expect(nextBreaking(v('0.0.3'))).toBe('0.0.4');
    for (const text of ['1.4.2', '0.3.1', '0.0.3']) {
      expect(keepsSaves(v(text), v(nextBreaking(v(text))))).toBe(false);
    }
  });
});
