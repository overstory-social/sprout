import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { memoryStore, readLog } from '@overstory/sprout/core';
import { compileBundle, emitCartridge, loadCartridge } from '@overstory/sprout/lang';
import { readWorld } from '@overstory/sprout-player';

import { configFor, corpusWorld } from './fixtures/server.js';
import { compileWorld, publish } from './worlds.js';

describe('a world the server serves', () => {
  it('is its folder compiled strictly, named by its world, with the host its turns run under', () => {
    const compiled = compileWorld(corpusWorld('sequences'), configFor());
    if ('refused' in compiled) throw new Error(compiled.refused);
    expect(compiled.world.id).toBe('sequences');
    expect(compiled.world.files.map((file) => file.name)).toEqual([
      'sprout.json',
      'person.sprout',
      'sequences.sprout',
    ]);
    expect(compiled.world.host.budgets).toBe(configFor().limits.budgets);
  });

  it('runs from the catalogue its cartridge reads back, keeping only the stamp of its bundle', () => {
    const compiled = compileWorld(corpusWorld('sequences'), configFor());
    if ('refused' in compiled) throw new Error(compiled.refused);
    const read = readWorld(corpusWorld('sequences'));
    const { bundle } = compileBundle(read.source!, { mode: 'publish' });
    const fromCartridge = loadCartridge(emitCartridge(bundle!), { caps: configFor().limits.caps });
    expect(Object.keys(compiled.world.bundle).sort()).toEqual([
      'assets',
      'extensions',
      'hash',
      'level',
    ]);
    const { catalogue } = compiled.world.host;
    expect(catalogue.world).toBe(fromCartridge.world);
    expect([...catalogue.kinds.keys()]).toEqual([...fromCartridge.kinds.keys()]);
    // A cartridge keeps no source text: a place reads back as a line and column in a blank file.
    const verb = catalogue.verbs.all()[0]!;
    expect(verb.declaration.at.source.text.trim()).toBe('');
  });

  it('runs its turns at the log depth its config says, play where it says none', async () => {
    const played = compileWorld(corpusWorld('sequences'), configFor());
    const debugged = compileWorld(corpusWorld('sequences'), { ...configFor(), logDepth: 'debug' });
    if ('refused' in played || 'refused' in debugged) throw new Error('refused');
    expect(played.world.host.logDepth).toBe('play');
    expect(debugged.world.host.logDepth).toBe('debug');
  });

  it('runs on the WebAssembly engine', () => {
    const compiled = compileWorld(corpusWorld('sequences'), configFor());
    if ('refused' in compiled) throw new Error(compiled.refused);
    expect(compiled.world.host.engine?.landed).toBeTypeOf('function');
  });

  it('is refused, in the compiler’s words, where the folder does not compile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprout-server-'));
    writeFileSync(join(dir, 'sprout.json'), '{ "name": "broken" }');
    const compiled = compileWorld(dir, configFor());
    expect('refused' in compiled && compiled.refused.length).toBeGreaterThan(0);
    expect(compileWorld('/nowhere', configFor())).toEqual({ refused: '/nowhere: no such folder' });
  });

  it('is published into the store, which logs the publish with the bundle’s hash', async () => {
    const compiled = compileWorld(corpusWorld('sequences'), configFor());
    if ('refused' in compiled) throw new Error(compiled.refused);
    const store = memoryStore();
    await publish(store, compiled.world, configFor(), 100, new Date(0));
    const [logged] = await readLog(store, 'sequences', { limit: 1 });
    expect(logged!.entry).toMatchObject({
      kind: 'publish',
      now: 100,
      bundle: compiled.world.bundle.hash,
    });
  });
});

describe('a world that shows pictures', () => {
  it('compiles on a server, which installs `media` at major 1, and lists the files it names', () => {
    const compiled = compileWorld(corpusWorld('media-room'), configFor());
    if ('refused' in compiled) throw new Error(compiled.refused);
    const [media] = compiled.world.bundle.extensions;
    expect(media).toMatchObject({ name: 'media', major: 1, absence: null });
    expect(media!.installed).not.toBeNull();
    expect(compiled.world.bundle.assets.map((asset) => asset.path)).toEqual([
      'cellar.png',
      'pictures/cabinet-open.png',
      'pictures/cabinet.png',
    ]);
  });

  it('is refused, naming the line, where a file it shows is not in its folder', () => {
    const compiled = compileWorld(corpusWorld('../bad/media-missing-file'), configFor());
    expect('refused' in compiled && compiled.refused).toContain(
      'cellar.sprout:8:16  The file "nowhere.png" is not in this world’s folder.',
    );
  });
});
