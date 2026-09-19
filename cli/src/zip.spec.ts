import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  packArchive,
  readArchive,
  readArchiveFolder,
  readArchiveZip,
  stateDirOf,
} from './archive.js';
import { readZip, writeZip } from './zip.js';

// The container, round-tripped; a folder read as an archive with its
// state and dotted entries left out; a zip read as the same archive.

describe('zip', () => {
  it('round-trips entries, deflated, in order; the same files pack to the same bytes', () => {
    const entries = [
      { name: 'sprout.json', data: Buffer.from('{}\n') },
      { name: 'rooms/hall.sprout', data: Buffer.from('room hall {}\n'.repeat(50)) },
      { name: 'kinds/Pot.sprout', data: Buffer.from('kind Pot { :name "Pöt" }\n') },
    ];
    const bytes = writeZip(entries);
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(readZip(bytes).map((e) => [e.name, e.data.toString('utf8')])).toEqual(
      entries.map((e) => [e.name, e.data.toString('utf8')]),
    );
    expect(writeZip(entries).equals(bytes)).toBe(true);
    // deflate earned its keep on the repetitive room
    expect(bytes.length).toBeLessThan(entries.reduce((n, e) => n + e.data.length, 0));
  });

  it('refuses what is not a zip, and a corrupt entry', () => {
    expect(() => readZip(Buffer.from('hello'))).toThrow('not a zip file');
    const bytes = writeZip([{ name: 'a', data: Buffer.from('aaaa') }]);
    const bad = Buffer.from(bytes);
    bad.writeUInt32LE(0xdeadbeef, 14); // the local header's crc… which the reader ignores; the central one:
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bad.writeUInt32LE(0xdeadbeef, central + 16);
    expect(() => readZip(bad)).toThrow('a: the entry is corrupt');
  });
});

describe('archives on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sprout-cli-'));
  mkdirSync(join(dir, 'world', 'rooms'), { recursive: true });
  mkdirSync(join(dir, 'world', '.sprout'), { recursive: true });
  writeFileSync(
    join(dir, 'world', 'sprout.json'),
    '{"format":1,"language":1,"entry":"hall","extensions":[]}',
  );
  writeFileSync(join(dir, 'world', 'rooms', 'hall.sprout'), 'room hall {}\n');
  writeFileSync(join(dir, 'world', 'rooms', 'notes.txt'), 'not a sprout file');
  writeFileSync(join(dir, 'world', '.sprout', 'stale.sprout'), 'room stale {}\n');
  writeFileSync(join(dir, 'world', 'yard.sprout'), 'room yard {}\n');

  it('a folder: every .sprout under it in name order, the manifest beside; .sprout/ and other dotted entries left out', () => {
    const a = readArchiveFolder(join(dir, 'world'));
    expect(a.files.map((f) => f.name)).toEqual(['rooms/hall.sprout', 'yard.sprout']);
    expect(a.manifest).toEqual({ format: 1, language: 1, entry: 'hall', extensions: [] });
    expect(a.kind).toBe('folder');
    expect(stateDirOf(a)).toBe(join(dir, 'world', '.sprout'));
    expect(readArchive(join(dir, 'world')).files).toHaveLength(2);
  });

  it('a zip: the same archive back, read by extension; state beside the zip under its own name', () => {
    const a = readArchiveFolder(join(dir, 'world'));
    writeFileSync(join(dir, 'world.zip'), packArchive(a));
    const z = readArchiveZip(join(dir, 'world.zip'));
    expect(z.files).toEqual(a.files);
    expect(z.manifest).toEqual(a.manifest);
    expect(z.kind).toBe('zip');
    expect(stateDirOf(z)).toBe(join(dir, '.sprout-world'));
    expect(readArchive(join(dir, 'world.zip')).files).toEqual(a.files);
  });

  it('no manifest is null, not an error; a bad one is; a missing path says so', () => {
    mkdirSync(join(dir, 'bare'));
    writeFileSync(join(dir, 'bare', 'a.sprout'), 'room a {}\n');
    expect(readArchiveFolder(join(dir, 'bare')).manifest).toBeNull();
    writeFileSync(join(dir, 'bare', 'sprout.json'), '{"format":1}');
    expect(() => readArchiveFolder(join(dir, 'bare'))).toThrow('sprout.json is not a manifest');
    expect(() => readArchive(join(dir, 'nope'))).toThrow('no such folder or zip');
    writeFileSync(join(dir, 'file.txt'), 'x');
    expect(() => readArchive(join(dir, 'file.txt'))).toThrow('not a folder and not a .zip');
  });
});
