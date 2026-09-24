import { describe, expect, it } from 'vitest';

import {
  bundleHashOf,
  bytesOf,
  LANGUAGE_LEVEL,
  libraryHash,
  sourceBytesOf,
  type LibrarySource,
  type Manifest,
  type VendoredLibrary,
} from './bundle.js';
import { SourceFile } from '../source/source.js';

const file = (name: string, text: string): SourceFile => new SourceFile(name, text);

const sprout: LibrarySource = {
  name: 'sprout',
  version: '1.0.0',
  level: 1,
  files: [file('actor.sprout', 'kind Actor { }'), file('place.sprout', 'kind Place { contains }')],
};

const vendored = (library: LibrarySource): VendoredLibrary => ({
  ...library,
  hash: libraryHash(library),
  bytes: sourceBytesOf(library.files),
});

const manifest: Manifest = {
  name: 'printers_shop',
  namespace: 'printers_shop',
  version: '0.3.1',
  author: 'Eric Eslinger',
  license: 'MIT',
  level: 1,
  extensions: [{ name: 'media', major: 2 }],
  libraries: [{ name: 'sprout', version: '1.0.0', sha: libraryHash(sprout) }],
  files: ['printers_shop.sprout'],
};

const own = [file('printers_shop.sprout', 'world printers_shop is sprout.World { contains }')];

describe('the language level', () => {
  it('starts at 1, because nothing here is shaped by what came before it', () => {
    expect(LANGUAGE_LEVEL).toBe(1);
  });
});

describe('source is weighed in UTF-8 bytes, which is what a source cap counts', () => {
  it('counts a plain character as one byte', () => expect(bytesOf('abc')).toBe(3));

  it('counts a character that is not ASCII as the bytes it takes', () => {
    expect(bytesOf('é')).toBe(2);
    expect(bytesOf('日')).toBe(3);
    expect(bytesOf('🌱')).toBe(4);
  });

  it('adds a set of files up', () => {
    expect(sourceBytesOf(sprout.files)).toBe(
      bytesOf('kind Actor { }') + bytesOf('kind Place { contains }'),
    );
  });

  it('weighs nothing as nothing', () => expect(sourceBytesOf([])).toBe(0));
});

describe('a library’s hash is its source and nothing else', () => {
  it('is the same for two copies vendored under different names', () => {
    expect(libraryHash({ ...sprout, name: 'a_fork_of_sprout' })).toBe(libraryHash(sprout));
  });

  it('is the same whatever level or version the copy declares', () => {
    expect(libraryHash({ ...sprout, level: 9 })).toBe(libraryHash(sprout));
    expect(libraryHash({ ...sprout, version: '9.9.9' })).toBe(libraryHash(sprout));
  });

  it('is the same however the files were handed over', () => {
    expect(libraryHash({ ...sprout, files: [...sprout.files].reverse() })).toBe(
      libraryHash(sprout),
    );
  });

  it('changes for a modified copy, which is then the author’s own source', () => {
    const modified: LibrarySource = {
      ...sprout,
      files: [file('actor.sprout', 'kind Actor { :hungry false }'), sprout.files[1]!],
    };
    expect(libraryHash(modified)).not.toBe(libraryHash(sprout));
  });

  it('is sixty-four hex digits', () => expect(libraryHash(sprout)).toMatch(/^[0-9a-f]{64}$/));
});

describe('a bundle’s hash is what the log records beside a publish', () => {
  const hash = bundleHashOf(manifest, own, [vendored(sprout)]);

  it('is the same for the same closed bundle', () => {
    expect(bundleHashOf(manifest, own, [vendored(sprout)])).toBe(hash);
  });

  it('does not care what order the files or libraries came in', () => {
    const two = [...own, file('room.sprout', 'object room { }')];
    expect(bundleHashOf(manifest, [...two].reverse(), [vendored(sprout)])).toBe(
      bundleHashOf(manifest, two, [vendored(sprout)]),
    );
  });

  it('changes when the world’s own source changes', () => {
    expect(
      bundleHashOf(
        manifest,
        [file('printers_shop.sprout', 'world x is sprout.World { }')],
        [vendored(sprout)],
      ),
    ).not.toBe(hash);
  });

  it('changes when a library’s source changes', () => {
    const forked = vendored({ ...sprout, files: [file('actor.sprout', 'kind Actor { x }')] });
    expect(bundleHashOf(manifest, own, [forked])).not.toBe(hash);
  });

  it('changes when a library declares a different level', () => {
    expect(bundleHashOf(manifest, own, [vendored({ ...sprout, level: 2 })])).not.toBe(hash);
  });

  it('changes when anything the manifest says changes', () => {
    for (const changed of [
      { ...manifest, name: 'other_shop' },
      { ...manifest, version: '0.3.2' },
      { ...manifest, author: 'Somebody Else' },
      { ...manifest, license: 'Apache-2.0' },
      { ...manifest, level: 2 },
      { ...manifest, extensions: [] },
      { ...manifest, extensions: [{ name: 'media', major: 3 }] },
      { ...manifest, libraries: [] },
      { ...manifest, files: ['printers_shop.sprout', 'kiln.prose'] },
    ] satisfies Manifest[]) {
      expect(bundleHashOf(changed, own, [vendored(sprout)]), changed.version).not.toBe(hash);
    }
  });

  it('changes when a library is pinned at a different version or sha', () => {
    const version: Manifest = {
      ...manifest,
      libraries: [{ name: 'sprout', version: '2.0.0', sha: libraryHash(sprout) }],
    };
    const sha: Manifest = {
      ...manifest,
      libraries: [{ name: 'sprout', version: '1.0.0', sha: 'f'.repeat(64) }],
    };
    expect(bundleHashOf(version, own, [vendored(sprout)])).not.toBe(hash);
    expect(bundleHashOf(sha, own, [vendored(sprout)])).not.toBe(hash);
  });

  it('does not care what order the manifest listed its parts in', () => {
    const two: Manifest = {
      ...manifest,
      extensions: [
        { name: 'media', major: 2 },
        { name: 'audio', major: 1 },
      ],
      libraries: [
        { name: 'sprout', version: '1.0.0', sha: 'a'.repeat(64) },
        { name: 'ericworld', version: '0.1.0', sha: 'b'.repeat(64) },
      ],
      files: ['printers_shop.sprout', 'kiln.sprout'],
    };
    const reversed: Manifest = {
      ...two,
      extensions: [...two.extensions].reverse(),
      libraries: [...two.libraries].reverse(),
      files: [...two.files].reverse(),
    };
    expect(bundleHashOf(reversed, own, [])).toBe(bundleHashOf(two, own, []));
  });
});
