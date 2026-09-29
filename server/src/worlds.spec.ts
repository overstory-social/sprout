import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { memoryStore, readLog } from '@overstory/sprout/core';

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

  it('is refused, in the compiler’s words, where the folder does not compile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprout-server-'));
    writeFileSync(join(dir, 'sprout.json'), '{ "name": "broken" }');
    const compiled = compileWorld(dir, configFor());
    expect('refused' in compiled && compiled.refused.length).toBeGreaterThan(0);
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
