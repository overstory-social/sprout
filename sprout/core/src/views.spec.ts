import { describe, it } from 'vitest';

import { tsEngine } from './engine.js';
import { pollCases } from './engine-conformance/polls.js';

// A visitor's view against a store, and a host's cache of it: the engine
// conformance suite's poll cases, which every engine passes, run here
// under the TypeScript runtime.

describe('the engine conformance suite’s polls, under the TypeScript runtime', () => {
  for (const one of pollCases) {
    it(`${one.name} — ${one.proves}`, async () => {
      await one.run(({ host }) => tsEngine(host));
    });
  }
});
