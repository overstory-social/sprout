import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { libraryHash, sha256, STANDARD_LIBRARY } from '@overstory/sprout/lang';
import { describe, expect, it } from 'vitest';

import { readWorld } from './world.js';

const MANIFEST = JSON.stringify({
  name: 'shop',
  version: '0.1.0',
  author: 'marta',
  license: 'MIT',
  level: 1,
  files: ['shop.sprout', 'rooms/hall.prose'],
});

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'sprout-world-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

describe('readWorld', () => {
  it('reads the manifest and every .sprout and .prose file, in name order, skipping dotted entries', () => {
    const dir = folder({
      'sprout.json': MANIFEST,
      'shop.sprout': 'world shop is sprout.World {}',
      'rooms/hall.prose': 'passage p { x }',
      'rooms/notes.txt': 'not a world file',
      '.sprout/state.db': 'never read',
    });
    const world = readWorld(dir);
    expect(world.diagnostics).toEqual([]);
    expect(world.source!.manifest.name).toBe('shop');
    expect(world.source!.manifest.namespace).toBe('shop');
    expect(world.source!.files.map((f) => f.name)).toEqual(['rooms/hall.prose', 'shop.sprout']);
    expect(world.source!.libraries).toEqual([]);
  });

  it('sends the standard library it carries when the manifest names `sprout`', () => {
    const pinned = (sha: string) =>
      JSON.stringify({
        ...JSON.parse(MANIFEST),
        libraries: [{ name: 'sprout', version: '0.1.0', sha }],
      });
    for (const sha of [libraryHash(STANDARD_LIBRARY), 'not-the-hash']) {
      const dir = folder({
        'sprout.json': pinned(sha),
        'shop.sprout': 'world shop is sprout.World {}',
      });
      // The copy sent is the one carried, whatever the pin says; the
      // compiler compares the two.
      expect(readWorld(dir).source!.libraries).toEqual([STANDARD_LIBRARY]);
    }
  });

  it('sends no library the manifest does not name, and reads none from the folder', () => {
    const dir = folder({
      'sprout.json': JSON.stringify({
        ...JSON.parse(MANIFEST),
        libraries: [{ name: 'ericworld', version: '0.1.0', sha: 'x' }],
      }),
      'shop.sprout': 'world shop is sprout.World {}',
    });
    expect(readWorld(dir).source!.libraries).toEqual([]);
  });

  it('reports a manifest that does not parse, and reads no files', () => {
    const dir = folder({
      'sprout.json': '{ not json',
      'shop.sprout': 'world shop is sprout.World {}',
    });
    const world = readWorld(dir);
    expect(world.source).toBeNull();
    expect(world.diagnostics[0]!.message).toContain('is not JSON');
  });

  it('reads an unsaved file’s text in place of what is on disk, and only for files on disk', () => {
    const dir = folder({
      'sprout.json': MANIFEST,
      'shop.sprout': 'world shop is sprout.World {}',
    });
    const unsaved = new Map([
      [join(dir, 'shop.sprout'), 'world shop is sprout.World { }'],
      [join(dir, 'sprout.json'), MANIFEST.replace('"shop"', '"store"')],
      [join(dir, 'never-saved.sprout'), 'kind Ghost {}'],
    ]);
    const world = readWorld(dir, unsaved);
    expect(world.source!.manifest.name).toBe('store');
    expect(world.source!.files.map((f) => [f.name, f.text])).toEqual([
      ['shop.sprout', 'world shop is sprout.World { }'],
    ]);
  });

  it('throws for a missing folder, a file, and a folder with no manifest', () => {
    expect(() => readWorld('/nowhere/at/all')).toThrow('no such folder');
    const dir = folder({ 'shop.sprout': 'world shop is sprout.World {}' });
    expect(() => readWorld(join(dir, 'shop.sprout'))).toThrow('not a folder');
    expect(() => readWorld(dir)).toThrow('no sprout.json here');
  });
});

describe('the files of a folder that an extension’s values name', () => {
  it('are looked up by their path from the folder, with their size, hash and first bytes', () => {
    const dir = folder({
      'sprout.json': MANIFEST,
      'pictures/a.png': 'a picture, more or less',
    });
    const { assets } = readWorld(dir).source!;
    const found = assets!('pictures/a.png');
    expect(found).toMatchObject({ bytes: 23, sha: sha256('a picture, more or less') });
    expect(new TextDecoder().decode(found!.head)).toBe('a picture, more or less');
    expect(assets!('pictures/a.png')).toBe(found);
  });

  it('are null for a file that is not there, a folder, and anything outside the folder', () => {
    const dir = folder({ 'sprout.json': MANIFEST, 'pictures/a.png': 'x', '../outside.png': 'y' });
    const { assets } = readWorld(dir).source!;
    expect(assets!('pictures/none.png')).toBeNull();
    expect(assets!('pictures')).toBeNull();
    expect(assets!('../outside.png')).toBeNull();
    expect(assets!('/etc/passwd')).toBeNull();
  });
});
