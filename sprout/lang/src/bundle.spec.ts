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
import { SourceFile } from './source.js';

const file = (name: string, text: string): SourceFile => new SourceFile(name, text);

const sprout: LibrarySource = {
  name: 'sprout',
  level: 1,
  files: [file('actor.sprout', 'kind Actor { }'), file('place.sprout', 'kind Place { contains }')],
};

const vendored = (library: LibrarySource, blessed = false): VendoredLibrary => ({
  ...library,
  hash: libraryHash(library),
  blessed,
  bytes: sourceBytesOf(library.files),
});

const manifest: Manifest = {
  world: 'printers_shop',
  level: 1,
  extensions: [{ name: 'media', major: 2 }],
  libraries: ['sprout'],
};

const own = [file('world.sprout', 'world printers_shop { contains }')];

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

  it('is the same whatever level the copy declares', () => {
    expect(libraryHash({ ...sprout, level: 9 })).toBe(libraryHash(sprout));
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
      bundleHashOf(manifest, [file('world.sprout', 'world x { }')], [vendored(sprout)]),
    ).not.toBe(hash);
  });

  it('changes when a library’s source changes', () => {
    const forked = vendored({ ...sprout, files: [file('actor.sprout', 'kind Actor { x }')] });
    expect(bundleHashOf(manifest, own, [forked])).not.toBe(hash);
  });

  it('changes when a library declares a different level', () => {
    expect(bundleHashOf(manifest, own, [vendored({ ...sprout, level: 2 })])).not.toBe(hash);
  });

  it('changes when the manifest changes', () => {
    for (const changed of [
      { ...manifest, world: 'other_shop' },
      { ...manifest, level: 2 },
      { ...manifest, extensions: [] },
      { ...manifest, extensions: [{ name: 'media', major: 3 }] },
      { ...manifest, libraries: [] },
    ] satisfies Manifest[]) {
      expect(bundleHashOf(changed, own, [vendored(sprout)])).not.toBe(hash);
    }
  });

  it('does not change when the host blesses a library, since blessing is a quota decision', () => {
    expect(bundleHashOf(manifest, own, [vendored(sprout, true)])).toBe(hash);
  });

  it('does not care what order the manifest listed its extensions or libraries in', () => {
    const two: Manifest = {
      ...manifest,
      extensions: [
        { name: 'media', major: 2 },
        { name: 'audio', major: 1 },
      ],
      libraries: ['sprout', 'ericworld'],
    };
    const reversed: Manifest = {
      ...two,
      extensions: [...two.extensions].reverse(),
      libraries: [...two.libraries].reverse(),
    };
    expect(bundleHashOf(reversed, own, [])).toBe(bundleHashOf(two, own, []));
  });
});
