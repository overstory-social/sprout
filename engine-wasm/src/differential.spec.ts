import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { compiledWorld, playBoth, scriptsOf } from './fixtures/differential.js';
import { engineBuilt, NOT_BUILT } from './wasm.js';

// The corpus through both engines: every script of every `corpus/good`
// world played step by step through core over the TypeScript engine and
// the WebAssembly engine alike, and after each step every turn's given,
// the log at debug depth, the stored world and every poll and question
// compared (fixtures/differential.ts). Every world plays alike; one that
// does not fails, naming the first step where the two differ.

const CORPUS = fileURLToPath(new URL('../../corpus/good', import.meta.url));

const worlds = readdirSync(CORPUS)
  .sort()
  .filter((name) => scriptsOf(join(CORPUS, name)).length > 0);

describe.skipIf(!engineBuilt())('the corpus through both engines', () => {
  for (const name of worlds) {
    it(name, async () => {
      const dir = join(CORPUS, name);
      const world = compiledWorld(dir);
      expect(world, `${name} compiles`).not.toBeNull();
      const problems: string[] = [];
      for (const file of scriptsOf(dir)) {
        for (const problem of await playBoth(world!, file)) problems.push(`${file}: ${problem}`);
      }
      expect(problems).toEqual([]);
    });
  }
});

describe.runIf(!engineBuilt())('the corpus through both engines, without engine.wasm', () => {
  it.skip(NOT_BUILT, () => {});
});
