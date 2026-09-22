import { describe, expect, it } from 'vitest';

import { cannotProve, cases, runConformance } from './conformance.js';
import { memoryStore } from './memory-store.js';

// The memory store proves the conformance suite first — the
// three-line loop a host writes, here as vitest cases so a failing case
// names itself.

describe('memoryStore passes the conformance suite', () => {
  for (const c of cases) {
    it(`${c.name} — ${c.proves}`, async () => {
      await c.run(() => memoryStore());
    });
  }

  it('runConformance runs them all', async () => {
    await expect(runConformance(() => memoryStore())).resolves.toBeUndefined();
  });

  it('says what a single backend cannot prove', () => {
    expect(cannotProve).toEqual([
      'real contention: one connection blocking another until commit',
      'lock timeouts firing rather than hanging',
    ]);
  });
});
