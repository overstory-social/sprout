import { describe, expect, it } from 'vitest';

import { tsEngine } from '../engine.js';
import { engineCases, runEngineConformance } from './index.js';

// The TypeScript runtime's engine passes the engine conformance suite,
// each case as a vitest case so a failing one names itself.

describe('the TypeScript runtime’s engine passes the engine conformance suite', () => {
  for (const one of engineCases) {
    it(`${one.name} — ${one.proves}`, async () => {
      await one.run(({ host }) => tsEngine(host));
    });
  }

  it('runEngineConformance runs them all', async () => {
    await expect(runEngineConformance(({ host }) => tsEngine(host))).resolves.toBeUndefined();
  });

  it('names each case once', () => {
    const names = engineCases.map((one) => one.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
