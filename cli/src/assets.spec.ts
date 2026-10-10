import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { captured } from '@overstory/sprout-repl/fixtures';

import { assetsFolder, packAssets } from './assets.js';
import { checkWorld } from './check.js';
import { main } from './cli.js';

const MEDIA_ROOM = fileURLToPath(new URL('../../corpus/good/media-room', import.meta.url));
const MISSING_FILE = fileURLToPath(new URL('../../corpus/bad/media-missing-file', import.meta.url));

const scratch = () => mkdtempSync(join(tmpdir(), 'sprout-assets-'));

describe('the assets folder', () => {
  it('sits beside the cartridge, named after it', () => {
    expect(assetsFolder('shop.sproutworld')).toBe('shop.sproutworld.assets');
    expect(assetsFolder('/out/shop.sproutworld')).toBe('/out/shop.sproutworld.assets');
  });
});

describe('packAssets', () => {
  it('copies each file the world names into the folder, under the path the world names it by', () => {
    const into = join(scratch(), 'room.sproutworld');
    const { bundle } = checkWorld(MEDIA_ROOM);
    expect(packAssets(MEDIA_ROOM, bundle!, into)).toBe(3);
    const folder = assetsFolder(into);
    expect(readdirSync(folder).sort()).toEqual(['cellar.png', 'pictures']);
    expect(readdirSync(join(folder, 'pictures')).sort()).toEqual([
      'cabinet-open.png',
      'cabinet.png',
    ]);
    for (const path of ['cellar.png', 'pictures/cabinet.png', 'pictures/cabinet-open.png']) {
      expect(readFileSync(join(folder, path)).equals(readFileSync(join(MEDIA_ROOM, path)))).toBe(
        true,
      );
    }
  });

  it('copies nothing, and makes no folder, for a world that names no file', () => {
    const into = join(scratch(), 'none.sproutworld');
    const { bundle } = checkWorld(MEDIA_ROOM);
    expect(packAssets(MEDIA_ROOM, { ...bundle!, assets: [] }, into)).toBe(0);
    expect(existsSync(assetsFolder(into))).toBe(false);
  });

  it('refuses a file that changed after the compile read it, which the cartridge hashes', () => {
    const dir = join(scratch(), 'room');
    cpSync(MEDIA_ROOM, dir, { recursive: true });
    const { bundle } = checkWorld(dir);
    writeFileSync(join(dir, 'cellar.png'), 'changed');
    expect(() => packAssets(dir, bundle!, join(scratch(), 'room.sproutworld'))).toThrow(
      'cellar.png changed while the world was being packed; pack again.',
    );
  });
});

describe('sprout pack of a world that names files', () => {
  it('writes the cartridge, then copies its files and says how many', () => {
    const file = join(scratch(), 'room.sproutworld');
    const io = captured();
    expect(main(['pack', MEDIA_ROOM, '-o', file], io)).toBe(0);
    expect(io.out()).toMatch(
      new RegExp(
        `^packed media_room into ${file}: \\d+ bytes\\ncopied 3 asset files into ${file}.assets\\n$`,
      ),
    );
    expect(existsSync(join(assetsFolder(file), 'pictures', 'cabinet.png'))).toBe(true);
  });

  it('refuses at compile, naming the line, when a file it names is missing, and writes nothing', () => {
    const file = join(scratch(), 'gone.sproutworld');
    const io = captured();
    expect(main(['pack', MISSING_FILE, '-o', file], io)).toBe(1);
    expect(io.out()).toContain(
      'cellar.sprout:8:16  The file "nowhere.png" is not in this world’s folder.',
    );
    expect(existsSync(file)).toBe(false);
    expect(existsSync(assetsFolder(file))).toBe(false);
  });
});
