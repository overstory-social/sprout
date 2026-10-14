import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ENGINE_WASM, engineBuilt, NOT_BUILT, shippedModule } from './wasm.js';

describe('the engine this package ships', () => {
  it('is engine.wasm in the package’s folder, built or not', () => {
    expect(ENGINE_WASM).toMatch(/engine-wasm[/\\]engine\.wasm$/);
    expect(engineBuilt()).toBe(existsSync(ENGINE_WASM));
  });

  it('says in words, naming the package and the toolchain, that it is not built', () => {
    expect(NOT_BUILT).toMatch(/@overstory\/sprout-engine-wasm/);
    expect(NOT_BUILT).toMatch(/clang with the wasm32 target and wasm-ld/);
  });

  it.runIf(engineBuilt())('is compiled once for the process', () => {
    expect(shippedModule()).toBe(shippedModule());
  });

  it.runIf(!engineBuilt())('is refused in those words where it is not built', () => {
    expect(() => shippedModule()).toThrow(NOT_BUILT);
  });
});
