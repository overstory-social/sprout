import { describe, expect, it } from 'vitest';

import { Diagnostics } from '../source/diagnostics.js';
import { locationOf, SourceFile } from '../source/source.js';
import {
  MANIFEST_FIELDS,
  MANIFEST_FILE,
  manifestKeySpan,
  parseManifest,
  worldTitle,
} from './manifest.js';

const GOOD = {
  name: 'shop',
  version: '0.1.0',
  author: 'marta',
  license: 'MIT',
  level: 1,
  files: ['shop.sprout'],
};

function read(text: string) {
  const diagnostics = new Diagnostics();
  const manifest = parseManifest(new SourceFile(MANIFEST_FILE, text), diagnostics);
  return {
    manifest,
    said: diagnostics.all.map((d) => `${locationOf(d.at)} ${d.message}`),
  };
}

describe('parseManifest', () => {
  it('reads what the spec lists, defaulting the lists and the namespace', () => {
    const { manifest, said } = read(JSON.stringify(GOOD));
    expect(said).toEqual([]);
    expect(manifest).toEqual({
      ...GOOD,
      namespace: 'shop',
      extensions: [],
      libraries: [],
    });
  });

  it('keeps a title that was written, and has none where none was', () => {
    const { manifest } = read(JSON.stringify({ ...GOOD, title: 'The Shop: Open Late' }));
    expect(manifest?.title).toBe('The Shop: Open Late');
    expect(read(JSON.stringify(GOOD)).manifest).not.toHaveProperty('title');
  });

  it('refuses a title that is not text, at its key', () => {
    const text =
      '{\n  "name": "shop",\n  "title": 3,\n  "version": "0.1.0",\n  "author": "marta",\n  "license": "MIT",\n  "level": 1\n}\n';
    expect(read(text).said).toEqual(["sprout.json:3:3 The manifest's title is not a string."]);
  });

  it('keeps a namespace that was written', () => {
    const { manifest } = read(JSON.stringify({ ...GOOD, namespace: 'printers' }));
    expect(manifest?.namespace).toBe('printers');
  });

  it('refuses text that is not JSON, at the head of the file', () => {
    const { manifest, said } = read('{ not json');
    expect(manifest).toBeNull();
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^sprout\.json:1:1 sprout\.json is not JSON/);
  });

  it('refuses a field of the wrong shape at the key it was written under', () => {
    const text =
      '{\n  "name": "shop",\n  "version": 3,\n  "author": "marta",\n  "license": "MIT",\n  "level": 1\n}\n';
    const { manifest, said } = read(text);
    expect(manifest).toBeNull();
    expect(said).toEqual(["sprout.json:3:3 The manifest's version is not a string."]);
  });

  it('names every missing field, each at the head when the key is not there', () => {
    const { manifest, said } = read('{ "name": "shop" }');
    expect(manifest).toBeNull();
    expect(said.map((s) => s.split(' ')[0])).toEqual(said.map(() => 'sprout.json:1:1'));
    expect(said).toContain('sprout.json:1:1 The manifest has no version.');
    expect(said).toContain('sprout.json:1:1 The manifest has no level.');
  });

  it("says what to write, in the manifest's own words", () => {
    const diagnostics = new Diagnostics();
    parseManifest(new SourceFile(MANIFEST_FILE, '{ "name": "shop", "level": "one" }'), diagnostics);
    const level = diagnostics.all.find((d) => d.message.includes('level'));
    expect(level?.message).toBe("The manifest's level is not a number.");
    expect(level?.remedy).toBe('Write "level": 1.');
  });

  it('says what to write for exactly the fields a manifest holds, each in its own words', () => {
    const { manifest } = read(JSON.stringify({ ...GOOD, title: 'The Shop' }));
    expect(Object.keys(MANIFEST_FIELDS).sort()).toEqual(Object.keys(manifest!).sort());
    for (const [field, write] of Object.entries(MANIFEST_FIELDS)) {
      expect(write, field).toMatch(new RegExp(`^"${field}": `));
    }
  });

  it('finds a key in the text, and falls back to the head', () => {
    const file = new SourceFile(MANIFEST_FILE, '{\n  "level": 1\n}');
    expect(locationOf(manifestKeySpan(file, 'level'))).toBe('sprout.json:2:3');
    expect(locationOf(manifestKeySpan(file, 'files'))).toBe('sprout.json:1:1');
  });
});

describe('worldTitle', () => {
  it('is the title where the manifest gives one, written as it is', () => {
    expect(
      worldTitle({ name: 'underground_caverns_2', title: 'Underground Caverns 2: The Revenge' }),
    ).toBe('Underground Caverns 2: The Revenge');
  });

  it('is the name as words where it gives none, as the Playdate shelf titles it', () => {
    expect(worldTitle({ name: 'printers_shop' })).toBe('Printers Shop');
    expect(worldTitle({ name: 'underground_caverns' })).toBe('Underground Caverns');
    expect(worldTitle({ name: 'room_3d' })).toBe('Room 3D');
    expect(worldTitle({ name: "old_3d_room's_door" })).toBe("Old 3D Room's Door");
  });
});
