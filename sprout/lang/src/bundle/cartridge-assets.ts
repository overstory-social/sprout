// A cartridge's assets section: the files its extensions name, after the
// compressed body, each as its extension packs it (the Playdate design's
// The cartridge). A directory comes first and the files after it, each one
// gzip-compressed on its own, so a host reads one file, when it shows it,
// without inflating the body or any other file.
//
// Little-endian throughout: the count of files and the bytes of the
// directory as 32-bit numbers, then for each file where it begins (from the
// section's start) and how many bytes it is compressed, as 32-bit numbers,
// its path's length as a 16-bit number and the path in UTF-8. A world that
// names no file has no section.

import { gunzip, gzip } from '../source/gzip.js';
import type { BundleAsset } from './bundle.js';

/** A file the section holds: its path, and its bytes as its extension packed them. */
export interface CartridgeAsset {
  readonly path: string;
  readonly packed: Uint8Array;
}

/** A section that cannot be read, said as what is wrong with it. */
export class AssetsUnreadable extends Error {
  override readonly name = 'AssetsUnreadable';
}

/** The bytes before the directory's entries: the count of files and the directory's size. */
const PREFIX = 8;

/** The section holding `assets`, in the order given; empty for none. */
export function writeAssets(assets: readonly Pick<BundleAsset, 'path' | 'packed'>[]): Uint8Array {
  if (assets.length === 0) return new Uint8Array(0);
  const paths = assets.map((asset) => new TextEncoder().encode(asset.path));
  const blobs = assets.map((asset) => gzip(asset.packed));
  const directory = paths.reduce((bytes, path) => bytes + 10 + path.length, 0);
  const total = blobs.reduce((bytes, blob) => bytes + blob.length, PREFIX + directory);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, assets.length, true);
  view.setUint32(4, directory, true);
  let entry = PREFIX;
  let at = PREFIX + directory;
  assets.forEach((_, i) => {
    const path = paths[i]!;
    const blob = blobs[i]!;
    view.setUint32(entry, at, true);
    view.setUint32(entry + 4, blob.length, true);
    view.setUint16(entry + 8, path.length, true);
    out.set(path, entry + 10);
    out.set(blob, at);
    entry += 10 + path.length;
    at += blob.length;
  });
  return out;
}

/** Where each file lies in `section`, by path, with the directory's bounds checked. */
export function assetDirectory(section: Uint8Array): Map<string, Uint8Array> {
  const found = new Map<string, Uint8Array>();
  if (section.length === 0) return found;
  if (section.length < PREFIX) throw new AssetsUnreadable('it is shorter than its directory');
  const view = new DataView(section.buffer, section.byteOffset, section.byteLength);
  const count = view.getUint32(0, true);
  const end = PREFIX + view.getUint32(4, true);
  if (end > section.length) throw new AssetsUnreadable('it is shorter than its directory');
  let entry = PREFIX;
  for (let i = 0; i < count; i++) {
    if (entry + 10 > end) throw new AssetsUnreadable('its directory ends partway through a file');
    const at = view.getUint32(entry, true);
    const bytes = view.getUint32(entry + 4, true);
    const length = view.getUint16(entry + 8, true);
    if (entry + 10 + length > end) {
      throw new AssetsUnreadable('its directory ends partway through a file');
    }
    let path: string;
    try {
      path = new TextDecoder('utf-8', { fatal: true }).decode(
        section.subarray(entry + 10, entry + 10 + length),
      );
    } catch {
      throw new AssetsUnreadable('a path in its directory is not UTF-8');
    }
    if (at < end || at + bytes > section.length) {
      throw new AssetsUnreadable(`${path} lies outside it`);
    }
    if (found.has(path)) throw new AssetsUnreadable(`it holds ${path} twice`);
    found.set(path, section.subarray(at, at + bytes));
    entry += 10 + length;
  }
  if (entry !== end) throw new AssetsUnreadable('its directory is longer than its files');
  return found;
}

/** Every file `section` holds, inflated, in the directory's order. */
export function readAssets(section: Uint8Array): CartridgeAsset[] {
  return [...assetDirectory(section)].map(([path, blob]) => {
    try {
      return { path, packed: gunzip(blob) };
    } catch (thrown) {
      throw new AssetsUnreadable(`${path} is damaged: ${(thrown as Error).message}`);
    }
  });
}
