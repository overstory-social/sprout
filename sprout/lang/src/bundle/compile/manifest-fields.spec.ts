import { describe, expect, it } from 'vitest';

import type { Manifest, MicroworldSource } from '../bundle.js';
import { locationOf, SourceFile, textOf } from '../../source/source.js';
import { atKey, atValue, checkManifest, NAMESPACE, SEMVER } from './manifest-fields.js';
import { Report } from './report.js';

const TEXT = [
  '{',
  '  "name": "printers_shop",',
  '  "version": "0.3.1",',
  '  "extensions": [{ "name": "media", "major": 2 }]',
  '}',
  '',
].join('\n');
const FILE = new SourceFile('sprout.json', TEXT);

/** The manifest's own fields as `over` says, and what checking them refuses. */
function refused(over: Partial<Manifest>, text = TEXT): string[] {
  const manifest: Manifest = {
    name: 'printers_shop',
    namespace: 'printers_shop',
    version: '0.3.1',
    author: 'Eric Eslinger',
    license: 'MIT',
    level: 1,
    extensions: [{ name: 'media', major: 2 }],
    libraries: [],
    files: [],
    ...over,
  };
  const source: MicroworldSource = {
    manifestFile: new SourceFile('sprout.json', text),
    manifest,
    files: [],
    libraries: [],
  };
  const report = new Report('publish', source.manifestFile.span(0, 0));
  checkManifest(source, report);
  return report.diagnostics.all.map((d) => `${locationOf(d.at)} ${d.message}`);
}

describe('where a manifest problem was written', () => {
  it('is the key, found in the text the manifest was read from', () => {
    expect(textOf(atKey(FILE, 'version'))).toBe('"version"');
    expect(locationOf(atKey(FILE, 'version'))).toBe('sprout.json:3:3');
  });

  it('is the head of the file for a key that is not written', () => {
    expect(locationOf(atKey(FILE, 'license'))).toBe('sprout.json:1:1');
  });

  it('is a value written at or after a place, or the fallback', () => {
    expect(textOf(atValue(FILE, 'media', FILE.span(0, 0)))).toBe('"media"');
    const fallback = atKey(FILE, 'extensions');
    expect(atValue(FILE, 'nowhere', fallback)).toBe(fallback);
  });
});

describe('the manifest’s own fields', () => {
  it('say nothing when they are well formed', () => expect(refused({})).toEqual([]));

  it('refuse a name or a namespace that cannot be one, at its key', () => {
    expect(refused({ name: 'Printers Shop' })).toEqual([
      'sprout.json:2:3 "Printers Shop" cannot be a world\'s name.',
    ]);
    expect(refused({ namespace: '9ink' })).toEqual([
      'sprout.json:1:1 "9ink" cannot be a world\'s namespace.',
    ]);
  });

  it('refuse an empty author or licence, and a version that is not semver', () => {
    expect(refused({ author: ' ', license: '' })).toEqual([
      "sprout.json:1:1 This world's author is empty.",
      "sprout.json:1:1 This world's license is empty.",
    ]);
    expect(refused({ version: '1.0' })).toEqual(['sprout.json:3:3 "1.0" is not a version.']);
  });

  it('refuse a level below 1, and an extension pinned to a major that is not one', () => {
    expect(refused({ level: 0 })).toEqual([
      'sprout.json:1:1 A language level is a whole number from 1 up, not 0.',
    ]);
    expect(refused({ extensions: [{ name: 'media', major: -1 }] })).toEqual([
      'sprout.json:4:28 The extension "media" is pinned to major version -1.',
    ]);
  });

  it('refuse one extension pinned twice', () => {
    const twice = [
      { name: 'media', major: 2 },
      { name: 'media', major: 3 },
    ];
    expect(refused({ extensions: twice })).toEqual([
      'sprout.json:4:28 There are two extensions pinned called "media".',
    ]);
  });
});

describe('the shapes a name and a version take', () => {
  it('reads a name as the lexer does', () => {
    expect(['shop', 'printers_shop2'].every((n) => NAMESPACE.test(n))).toBe(true);
    expect(['Shop', '2shop', 'print-shop', ''].some((n) => NAMESPACE.test(n))).toBe(false);
  });

  it('reads a version as semver.org does', () => {
    expect(['0.1.0', '1.2.0-beta.1', '1.0.0+build.5'].every((v) => SEMVER.test(v))).toBe(true);
    expect(['1.0', '01.0.0', 'v1.0.0'].some((v) => SEMVER.test(v))).toBe(false);
  });
});
