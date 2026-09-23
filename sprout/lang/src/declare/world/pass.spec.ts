// The pass rule: a world refuses to pass by default (`pass any (false)`),
// which is why places cannot reach one another unless a world says
// otherwise. This is a default of the language, not a host's number.

import { describe, expect, it } from 'vitest';

import { WORLD_PASSES_ANYTHING } from '../world.js';

describe('the world refuses to pass, which is why places cannot reach one another', () => {
  it('passes nothing unless it says otherwise', () => {
    expect(WORLD_PASSES_ANYTHING).toBe(false);
  });

  it('is a default of the language, not a number a host sets', () => {
    // The spec states the value, so nothing configures it: `pass any
    // (false)` unless the world says otherwise; this is what it answers
    // where it writes none.
    expect(typeof WORLD_PASSES_ANYTHING).toBe('boolean');
  });
});
