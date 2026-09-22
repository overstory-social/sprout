import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readWorld } from './world.js';

const MANIFEST = JSON.stringify({
  name: 'shop',
  version: '0.1.0',
  author: 'marta',
  license: 'MIT',
  level: 1,
  files: ['world.sprout', 'rooms/hall.prose'],
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
      'world.sprout': 'world shop {}',
      'rooms/hall.prose': 'passage p { x }',
      'rooms/notes.txt': 'not a world file',
      '.sprout/state.db': 'never read',
    });
    const world = readWorld(dir);
    expect(world.diagnostics).toEqual([]);
    expect(world.source!.manifest.name).toBe('shop');
    expect(world.source!.manifest.namespace).toBe('shop');
    expect(world.source!.files.map((f) => f.name)).toEqual(['rooms/hall.prose', 'world.sprout']);
    expect(world.source!.libraries).toEqual([]);
  });

  it('reports a manifest that does not parse, and reads no files', () => {
    const dir = folder({ 'sprout.json': '{ not json', 'world.sprout': 'world shop {}' });
    const world = readWorld(dir);
    expect(world.source).toBeNull();
    expect(world.diagnostics[0]!.message).toContain('is not JSON');
  });

  it('throws for a missing folder, a file, and a folder with no manifest', () => {
    expect(() => readWorld('/nowhere/at/all')).toThrow('no such folder');
    const dir = folder({ 'world.sprout': 'world shop {}' });
    expect(() => readWorld(join(dir, 'world.sprout'))).toThrow('not a folder');
    expect(() => readWorld(dir)).toThrow('no sprout.json here');
  });
});
