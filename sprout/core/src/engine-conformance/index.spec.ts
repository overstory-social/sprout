import { describe, expect, it } from 'vitest';

import { engineCases } from './index.js';

// The suite's own shape. Each engine runs the cases themselves:
// engine-wasm's spec runs them on the WebAssembly engine.

describe('the engine conformance suite', () => {
  it('names each case once', () => {
    const names = engineCases.map((one) => one.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
