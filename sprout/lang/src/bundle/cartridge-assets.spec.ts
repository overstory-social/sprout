import { describe, expect, it } from 'vitest';

import { chooser } from '../fixtures/parse.js';
import { gunzip } from '../source/gzip.js';
import { assetDirectory, AssetsUnreadable, readAssets, writeAssets } from './cartridge-assets.js';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

const ASSETS = [
  { path: 'cellar.png', packed: bytes(1, 0, 1, 0, 0x80) },
  { path: 'pictures/a hall.png', packed: bytes(2, 0, 1, 0, 0x40) },
  { path: 'pictures/ü.png', packed: new Uint8Array(3000).fill(0xaa) },
];

const refusal = (run: () => unknown): string => {
  try {
    run();
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(AssetsUnreadable);
    return (thrown as Error).message;
  }
  throw new Error('was not refused');
};

describe('the assets section', () => {
  it('reads back every file it was written with, in order, by path', () => {
    expect(readAssets(writeAssets(ASSETS))).toEqual(ASSETS);
  });

  it('is empty for a world that names no file', () => {
    expect(writeAssets([])).toEqual(new Uint8Array(0));
    expect(readAssets(new Uint8Array(0))).toEqual([]);
  });

  it('begins with the count and the directory, each file compressed on its own after it', () => {
    const section = writeAssets(ASSETS);
    const view = new DataView(section.buffer);
    expect(view.getUint32(0, true)).toBe(3);
    const end = 8 + view.getUint32(4, true);
    expect(end).toBe(
      8 + ASSETS.reduce((n, a) => n + 10 + new TextEncoder().encode(a.path).length, 0),
    );
    // The first file starts where the directory ends, and inflates alone.
    expect(view.getUint32(8, true)).toBe(end);
    const first = section.subarray(end, end + view.getUint32(12, true));
    expect(gunzip(first)).toEqual(ASSETS[0]!.packed);
    expect(view.getUint16(16, true)).toBe('cellar.png'.length);
    expect([...assetDirectory(section).keys()]).toEqual(ASSETS.map((a) => a.path));
  });

  it('refuses a directory that does not fit, a file outside it, and a path given twice', () => {
    const section = writeAssets(ASSETS);
    expect(refusal(() => assetDirectory(section.subarray(0, 5)))).toBe(
      'it is shorter than its directory',
    );
    expect(refusal(() => assetDirectory(section.subarray(0, 20)))).toBe(
      'it is shorter than its directory',
    );
    const outside = Uint8Array.from(section);
    new DataView(outside.buffer).setUint32(12, 1 << 30, true);
    expect(refusal(() => assetDirectory(outside))).toBe('cellar.png lies outside it');
    const counted = Uint8Array.from(section);
    new DataView(counted.buffer).setUint32(0, 4, true);
    expect(refusal(() => assetDirectory(counted))).toBe(
      'its directory ends partway through a file',
    );
    const fewer = Uint8Array.from(section);
    new DataView(fewer.buffer).setUint32(0, 2, true);
    expect(refusal(() => assetDirectory(fewer))).toBe('its directory is longer than its files');
    const twice = writeAssets([ASSETS[0]!, ASSETS[0]!]);
    expect(refusal(() => assetDirectory(twice))).toBe('it holds cellar.png twice');
    const damaged = Uint8Array.from(section);
    damaged[damaged.length - 10]! ^= 0xff;
    expect(refusal(() => readAssets(damaged))).toMatch(/^pictures\/ü\.png is damaged: /);
  });

  it('reads whole or refuses in words, whatever bytes of it are changed or cut', () => {
    const section = writeAssets(ASSETS);
    const choose = chooser(756).below;
    for (let n = 0; n < 400; n++) {
      const changed = Uint8Array.from(section.subarray(0, choose(section.length) + 1));
      for (let k = choose(3); k > 0; k--) changed[choose(changed.length)] = choose(256);
      try {
        readAssets(changed);
      } catch (thrown) {
        expect(thrown).toBeInstanceOf(AssetsUnreadable);
      }
    }
  });
});
