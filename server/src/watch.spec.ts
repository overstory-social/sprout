import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contextFor, corpusWorld, manualClock } from './fixtures/server.js';
import { FOLDER_WATCHER, watchWorlds, type Watcher } from './watch.js';
import { deploy } from './worlds.js';

/** A watcher a spec fires by hand, keeping each folder's callback. */
function handWatcher() {
  const called = new Map<string, () => void>();
  const stopped: string[] = [];
  const watch: Watcher = (dir, changed) => {
    called.set(dir, changed);
    return () => {
      stopped.push(dir);
    };
  };
  return { watch, stopped, fire: (dir: string) => called.get(dir)!() };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 60));

describe('watching the worlds a server serves', () => {
  it('redeploys a world once its changes settle, however many there were', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'sprout-watch-')), 'sequences');
    cpSync(corpusWorld('sequences'), dir, { recursive: true });
    const clock = manualClock();
    const context = contextFor(clock, dir);
    await deploy(
      context.store,
      context.worlds.get('sequences')!.served,
      context.config,
      0,
      new Date(0),
    );
    const watcher = handWatcher();
    const stop = watchWorlds(context, [dir], 20, watcher.watch);
    watcher.fire(dir);
    watcher.fire(dir);
    watcher.fire(dir);
    await settled();
    const lines = (context.log as unknown as { lines: string[] }).lines;
    expect(lines.filter((line) => line.includes('redeployed from'))).toHaveLength(1);
    stop();
    expect(watcher.stopped).toEqual([dir]);
  });

  it('hears a change anywhere in a folder, through the file system’s own watcher', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprout-watch-'));
    mkdirSync(join(dir, 'rooms'));
    let heard = 0;
    const stop = FOLDER_WATCHER(dir, () => (heard += 1));
    writeFileSync(join(dir, 'rooms', 'cellar.sprout'), '// a cellar\n');
    for (let waited = 0; heard === 0 && waited < 40; waited++) await settled();
    stop();
    expect(heard).toBeGreaterThan(0);
  });
});
