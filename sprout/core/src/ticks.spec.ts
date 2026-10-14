import { describe, it } from 'vitest';

import { tsEngine } from './engine.js';
import { tickerCases } from './engine-conformance/ticker.js';

// Rounds of ticks: the engine conformance suite's ticker cases, which
// every engine passes, run here under the TypeScript runtime.

describe('the engine conformance suite’s rounds of ticks, under the TypeScript runtime', () => {
  for (const one of tickerCases) {
    it(`${one.name} — ${one.proves}`, async () => {
      await one.run(({ host }) => tsEngine(host));
    });
  }
});
