import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkShape, SourceFile } from '@overstory/sprout/lang';
import { describe, expect, it } from 'vitest';

import { initWorld } from './init.js';

describe('initWorld', () => {
  it('writes a manifest, a world and a README, named for the folder', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sprout-init-')), 'Paper Store');
    expect(initWorld(dir, 'marta')).toEqual(['sprout.json', 'world.sprout', 'README.md']);
    const manifest = JSON.parse(readFileSync(join(dir, 'sprout.json'), 'utf8'));
    expect(manifest).toEqual({
      name: 'paper_store',
      version: '0.1.0',
      author: 'marta',
      license: 'MIT',
      level: 1,
      extensions: [],
      libraries: [],
      files: ['world.sprout'],
    });
    expect(readFileSync(join(dir, 'world.sprout'), 'utf8')).toContain(
      'world paper_store: sprout.World {',
    );
  });

  it('writes a world that composes `sprout.World`, as every world does', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sprout-init-')), 'Kiln Yard');
    initWorld(dir, 'marta');
    const written = readFileSync(join(dir, 'world.sprout'), 'utf8');
    expect(written).toContain('world kiln_yard: sprout.World {');
    // What a beginner is handed is what the compiler takes.
    expect(checkShape(new SourceFile('world.sprout', written)).diagnostics).toEqual([]);
  });

  it('refuses a folder that already has something in it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprout-init-'));
    writeFileSync(join(dir, 'notes.txt'), 'x');
    expect(() => initWorld(dir, 'marta')).toThrow('not empty');
  });
});
