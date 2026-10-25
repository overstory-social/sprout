import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { emitCartridge, readCartridge } from '@overstory/sprout/lang';

import { checkWorld } from './check.js';
import { publishedName, publishedStem, writeIndex, type WorldIndex } from './publish.js';
import { privateKeyOf, readKeyFile, worldsAreSigned } from './signing.js';

const root = join(fileURLToPath(import.meta.url), '../../..');
const player = join(root, 'sprout-player');
const TEST_KEY = privateKeyOf(readKeyFile(join(player, 'test/index-test.key')));
const TEST_PUBLIC = readFileSync(join(player, 'test/index-test.pub'), 'utf8').trim();

/**
 * A new folder holding chip-tree (no pictures), media-room (three, inside its cartridge) and titled
 * (a manifest title), packed under the names given.
 */
function packed(names: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'sprout-index-'));
  for (const world of ['chip-tree', 'media-room', 'titled']) {
    const bundle = checkWorld(join(root, 'corpus/good', world)).bundle!;
    writeFileSync(join(dir, names[world] ?? `${world}.sproutworld`), emitCartridge(bundle));
  }
  return dir;
}

const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as WorldIndex;
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

describe('publishedStem', () => {
  it('names a file as the app names a download (test/fixtures/stems.json, which the C tests hold the app to)', () => {
    const pairs = JSON.parse(readFileSync(join(player, 'test/fixtures/stems.json'), 'utf8')) as [
      string,
      string,
    ][];
    expect(pairs.length).toBeGreaterThan(5);
    for (const [title, stem] of pairs) expect([title, publishedStem(title)]).toEqual([title, stem]);
  });

  it('is at most 24 long, and only lower-case letters, digits and single hyphens between them', () => {
    const titles = [
      '',
      '-',
      'a b',
      'Ä_b__C',
      '9 lives',
      `${'x'.repeat(30)}`,
      'a'.repeat(23) + ' b',
    ];
    for (let n = 0; n < 200; n++) {
      titles.push(
        Array.from({ length: n % 40 }, (_, i) => ' _-aZ9é!'.charAt((n * 7 + i * 13) % 8)).join(''),
      );
    }
    for (const title of titles) {
      const stem = publishedStem(title);
      expect(stem.length).toBeLessThanOrEqual(24);
      expect(stem).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('a published name is the stem and the first eight digits of the bundle hash', () => {
    expect(publishedName('Café "Moss"\tTea', 'aaaabbbbccccdddd')).toBe(
      'caf-moss-tea-aaaabbbb.sproutworld',
    );
  });
});

describe('writeIndex', () => {
  it('lists each cartridge with its header, size, SHA-256 and address, signed, and writes it beside the index under its published name', () => {
    const dir = packed({ 'media-room': 'renamed.sproutworld' });
    const out = join(mkdtempSync(join(tmpdir(), 'sprout-site-')), 'worlds', 'index.json');
    const written = writeIndex({
      folder: dir,
      baseUrl: 'https://worlds.example/sprout',
      privateKey: TEST_KEY,
      out,
    });
    const index = read(out);
    expect(index).toEqual(written.index);
    expect(worldsAreSigned(index.worlds, index.signed, TEST_PUBLIC)).toBe(true);
    // A world with no title is listed by its name as words.
    expect(index.worlds.map((w) => w.title)).toEqual([
      'Chip Tree',
      'Media Room',
      'Titled: A World Shown by Its Title',
    ]);
    expect(index.worlds[2]!.url).toMatch(/\/titled-a-world-shown-by-[0-9a-f]{8}\.sproutworld$/);
    const site = join(out, '..');
    for (const world of index.worlds) {
      const name = publishedName(world.title, world.hash);
      expect(world.url).toBe(`https://worlds.example/sprout/${name}`);
      expect(world.bytes).toBe(statSync(join(site, name)).size);
      expect(world.sha256).toBe(sha256(join(site, name)));
      expect(world.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(world.author).toBe('corpus');
      expect(world.version).toBe('0.1.0');
    }
    expect(readdirSync(site).sort()).toEqual(
      ['index.json', ...index.worlds.map((w) => publishedName(w.title, w.hash))].sort(),
    );
    expect(written.placed.every((one) => one.written)).toBe(true);
    // A world is one file: the media room's pictures are in its size and its checksum.
    expect(index.worlds[1]!.bytes).toBe(statSync(join(dir, 'renamed.sproutworld')).size);
  });

  it('has exactly the members index.schema.json requires and allows', () => {
    const schema = JSON.parse(readFileSync(join(player, 'index.schema.json'), 'utf8')) as {
      required: string[];
      properties: { signed: { pattern: string } };
      $defs: { world: { required: string[]; properties: Record<string, unknown> } };
    };
    const out = join(mkdtempSync(join(tmpdir(), 'sprout-site-')), 'index.json');
    const { index } = writeIndex({
      folder: packed(),
      baseUrl: 'https://worlds.example/',
      privateKey: TEST_KEY,
      out,
    });
    expect(Object.keys(index).sort()).toEqual([...schema.required].sort());
    for (const world of index.worlds) {
      expect(Object.keys(world).sort()).toEqual(Object.keys(schema.$defs.world.properties).sort());
      expect(Object.keys(world).sort()).toEqual([...schema.$defs.world.required].sort());
    }
    expect(index.signed).toMatch(new RegExp(schema.properties.signed.pattern));
  });

  it('made again over what it published, it keeps the files and signs the same list', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'sprout-site-')), 'index.json');
    const first = writeIndex({
      folder: packed(),
      baseUrl: 'https://w.example/',
      privateKey: TEST_KEY,
      out,
    });
    const site = join(out, '..');
    const again = writeIndex({
      folder: site,
      baseUrl: 'https://w.example/',
      privateKey: TEST_KEY,
      out,
    });
    expect(again.index).toEqual(first.index);
    expect(again.placed.every((one) => !one.written)).toBe(true);
  });

  it('a folder holding a cartridge twice lists it once', () => {
    const dir = packed();
    copyFileSync(join(dir, 'chip-tree.sproutworld'), join(dir, 'chip-copy.sproutworld'));
    const out = join(dir, 'index.json');
    const { index } = writeIndex({
      folder: dir,
      baseUrl: 'https://w.example/',
      privateKey: TEST_KEY,
      out,
    });
    expect(index.worlds.map((w) => w.title)).toEqual([
      'Chip Tree',
      'Media Room',
      'Titled: A World Shown by Its Title',
    ]);
  });

  it('refuses, writing nothing, where a published cartridge would be replaced by other bytes', () => {
    const dir = packed();
    const site = mkdtempSync(join(tmpdir(), 'sprout-site-'));
    const out = join(site, 'index.json');
    const { index } = writeIndex({
      folder: dir,
      baseUrl: 'https://w.example/',
      privateKey: TEST_KEY,
      out,
    });
    const chip = index.worlds[0]!;
    const media = index.worlds[1]!;
    const fresh = mkdtempSync(join(tmpdir(), 'sprout-site-'));
    writeFileSync(join(fresh, publishedName(media.title, media.hash)), 'other bytes');
    expect(() =>
      writeIndex({
        folder: dir,
        baseUrl: 'https://w.example/',
        privateKey: TEST_KEY,
        out: join(fresh, 'index.json'),
      }),
    ).toThrow(/is already there with other bytes, and a published cartridge is never replaced/);
    expect(existsSync(join(fresh, 'index.json'))).toBe(false);
    expect(existsSync(join(fresh, publishedName(chip.title, chip.hash)))).toBe(false);
  });

  it('refuses in words a base address, a folder or an output it cannot use', () => {
    const dir = packed();
    const empty = mkdtempSync(join(tmpdir(), 'sprout-empty-'));
    const at = (folder: string, baseUrl: string, out: string) => () =>
      writeIndex({ folder, baseUrl, privateKey: TEST_KEY, out });
    expect(at(dir, 'ftp://x.example/', join(empty, 'i.json'))).toThrow(
      /should be an address beginning http/,
    );
    expect(at(dir, 'worlds/', join(empty, 'i.json'))).toThrow(
      /should be an address beginning http/,
    );
    expect(at(empty, 'https://x.example/', join(empty, 'i.json'))).toThrow(
      /holds no \.sproutworld cartridge: pack each world with `sprout pack` first/,
    );
    expect(at(join(empty, 'absent'), 'https://x.example/', join(empty, 'i.json'))).toThrow(
      /is not a folder that can be read/,
    );
    expect(at(dir, 'https://x.example/', empty)).toThrow(/-o names the index file to write/);
    const broken = mkdtempSync(join(tmpdir(), 'sprout-broken-'));
    mkdirSync(join(broken, 'in'));
    writeFileSync(join(broken, 'in', 'bad.sproutworld'), 'not a cartridge');
    expect(at(join(broken, 'in'), 'https://x.example/', join(broken, 'i.json'))).toThrow(
      /bad\.sproutworld: This is not a Sprout cartridge/,
    );
  });

  it('signs two builds of one world where the later keeps what it says it keeps, and refuses them where it does not, writing nothing', () => {
    const builds = (pair: string): string => {
      const dir = mkdtempSync(join(tmpdir(), 'sprout-builds-'));
      for (const which of ['old', 'new']) {
        const bundle = checkWorld(join(root, 'corpus/compat', pair, which)).bundle!;
        writeFileSync(join(dir, `lamplight-${which}.sproutworld`), emitCartridge(bundle));
      }
      return dir;
    };
    const kept = builds('accepted/added-room');
    const { index } = writeIndex({
      folder: kept,
      baseUrl: 'https://w.example/',
      privateKey: TEST_KEY,
      out: join(kept, 'index.json'),
    });
    expect(index.worlds.map((world) => world.version).sort()).toEqual(['0.1.0', '0.1.1']);

    const broken = builds('refused/enum-option-removed');
    expect(() =>
      writeIndex({
        folder: broken,
        baseUrl: 'https://w.example/',
        privateKey: TEST_KEY,
        out: join(broken, 'index.json'),
      }),
    ).toThrow(
      /lamplight-old\.sproutworld and then .*lamplight-new\.sproutworld cannot both be published:\nlamplight 0\.1\.0 → 0\.1\.1: 0\.1\.1 keeps saves of 0\.1\.0, and 1 change would break one:[^]*`roaring` is no longer one of its options/,
    );
    expect(existsSync(join(broken, 'index.json'))).toBe(false);
    expect(readdirSync(broken).sort()).toEqual([
      'lamplight-new.sproutworld',
      'lamplight-old.sproutworld',
    ]);
  });

  describe('with --previous, the index being replaced', () => {
    /** A cartridge of the compat corpus's world `pair/which`, its manifest's version set to `version`. */
    const lamplight = (pair: string, which: string, version: string): Uint8Array => {
      const world = join(mkdtempSync(join(tmpdir(), 'sprout-lamplight-')), 'world');
      cpSync(join(root, 'corpus/compat', pair, which), world, { recursive: true });
      const manifest = join(world, 'sprout.json');
      const fields = JSON.parse(readFileSync(manifest, 'utf8')) as { version: string };
      writeFileSync(manifest, JSON.stringify({ ...fields, version }));
      return emitCartridge(checkWorld(world).bundle!);
    };
    const folderOf = (builds: Record<string, Uint8Array>): string => {
      const dir = mkdtempSync(join(tmpdir(), 'sprout-builds-'));
      for (const [file, bytes] of Object.entries(builds)) writeFileSync(join(dir, file), bytes);
      return dir;
    };
    const indexAt = (folder: string, previous?: string) => () =>
      writeIndex({
        folder,
        baseUrl: 'https://w.example/',
        privateKey: TEST_KEY,
        out: join(mkdtempSync(join(tmpdir(), 'sprout-site-')), 'index.json'),
        previous,
      });
    // Three builds at 0.1.0 that each break a save of another, as the studio's three Caverns builds do.
    const published = {
      'a.sproutworld': lamplight('refused/renamed-room', 'old', '0.1.0'),
      'b.sproutworld': lamplight('refused/renamed-room', 'new', '0.1.0'),
      'c.sproutworld': lamplight('refused/enum-option-removed', 'new', '0.1.0'),
    };
    const live = (): string => {
      const out = join(mkdtempSync(join(tmpdir(), 'sprout-live-')), 'index.json');
      // Listed before the version rule held them to each other: signed here without it.
      writeFileSync(
        out,
        JSON.stringify({
          worlds: Object.values(published).map((bytes) => {
            const header = readCartridge(bytes).header;
            return { hash: header.hash, sha256: createHash('sha256').update(bytes).digest('hex') };
          }),
          signed: '',
        }),
      );
      return out;
    };

    it('does not hold builds it lists to each other, and holds a new one to the newest it lists', () => {
      const folder = folderOf({
        ...published,
        'd.sproutworld': lamplight('accepted/added-room', 'new', '0.4.1'),
      });
      expect(indexAt(folder)).toThrow(/cannot both be published:\nlamplight 0\.1\.0 → 0\.1\.0:/);
      const { index } = indexAt(folder, live())();
      expect(index.worlds.map((world) => world.version).sort()).toEqual([
        '0.1.0',
        '0.1.0',
        '0.1.0',
        '0.4.1',
      ]);
      expect(worldsAreSigned(index.worlds, index.signed, TEST_PUBLIC)).toBe(true);
    });

    it('still refuses a new build that breaks a save of the newest it lists, or of a new one before it', () => {
      const old = lamplight('refused/enum-option-removed', 'old', '0.1.0');
      const breaking = lamplight('refused/enum-option-removed', 'new', '0.1.1');
      const listing = join(mkdtempSync(join(tmpdir(), 'sprout-live-')), 'index.json');
      const listOnly = (bytes: Uint8Array) =>
        writeFileSync(
          listing,
          JSON.stringify({
            worlds: [
              {
                hash: readCartridge(bytes).header.hash,
                sha256: createHash('sha256').update(bytes).digest('hex'),
              },
            ],
            signed: '',
          }),
        );
      listOnly(old);
      const broken =
        /old\.sproutworld and then .*new\.sproutworld cannot both be published:\nlamplight 0\.1\.0 → 0\.1\.1: 0\.1\.1 keeps saves of 0\.1\.0, and 1 change would break one:[^]*`roaring` is no longer one of its options/;
      expect(
        indexAt(folderOf({ 'old.sproutworld': old, 'new.sproutworld': breaking }), listing),
      ).toThrow(broken);
      // Both new: the later held to the earlier, as without --previous.
      listOnly(lamplight('accepted/added-room', 'old', '0.0.1'));
      expect(
        indexAt(folderOf({ 'old.sproutworld': old, 'new.sproutworld': breaking }), listing),
      ).toThrow(broken);
      // A new build under a version already published, with other files.
      listOnly(old);
      const same = lamplight('refused/renamed-room', 'new', '0.1.0');
      expect(
        indexAt(folderOf({ 'old.sproutworld': old, 'same.sproutworld': same }), listing),
      ).toThrow(
        /old\.sproutworld and then .*same\.sproutworld cannot both be published:\nlamplight 0\.1\.0 → 0\.1\.0: 0\.1\.0 keeps saves of 0\.1\.0/,
      );
    });

    it('refuses in words an index it cannot read', () => {
      const folder = packed();
      const dir = mkdtempSync(join(tmpdir(), 'sprout-live-'));
      expect(indexAt(folder, join(dir, 'absent.json'))).toThrow(
        /--previous .*absent\.json cannot be read: name the index being replaced/,
      );
      for (const text of ['not json', '{}', '{"worlds":[{"hash":"ab"}]}']) {
        writeFileSync(join(dir, 'bad.json'), text);
        expect(indexAt(folder, join(dir, 'bad.json'))).toThrow(
          /--previous .*bad\.json is not an index `sprout index` wrote/,
        );
      }
    });
  });

  it('refuses two different cartridges that would be published under one name', () => {
    const dir = packed();
    // The media room with a byte of one of its pictures changed: the same header, other bytes.
    const bytes = readFileSync(join(dir, 'media-room.sproutworld'));
    bytes[bytes.length - 10]! ^= 1;
    writeFileSync(join(dir, 'media-other.sproutworld'), bytes);
    expect(() =>
      writeIndex({
        folder: dir,
        baseUrl: 'https://w.example/',
        privateKey: TEST_KEY,
        out: join(dir, 'index.json'),
      }),
    ).toThrow(
      /media-other\.sproutworld and .*media-room\.sproutworld would both be published as media-room-[0-9a-f]{8}\.sproutworld, and their bytes differ/,
    );
    expect(existsSync(join(dir, 'index.json'))).toBe(false);
  });
});
