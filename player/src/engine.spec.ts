import { emitCartridge, loadCartridge, DEFAULT_LIMITS, visitKey } from '@overstory/sprout/lang';
import { emptyState } from '@overstory/sprout/core';
import { NOT_BUILT } from '@overstory/sprout-engine-wasm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { catalogueFor, engineFor, hostFor, toolEngine } from './engine.js';
import { ENGINES_BUILT } from './fixtures/play.js';
import { bundleOf, KILN_YARD } from './fixtures/worlds.js';

/** Whether this spec's WebAssembly engine counts as built: as it is, where null. */
const counts = vi.hoisted(() => ({ built: null as boolean | null }));
vi.mock(import('@overstory/sprout-engine-wasm'), async (actual) => {
  const real = await actual();
  return { ...real, engineBuilt: () => counts.built ?? real.engineBuilt() };
});

const bundle = bundleOf('kiln_yard', KILN_YARD);

describe('toolEngine', () => {
  afterEach(() => {
    counts.built = null;
  });

  it('is the WebAssembly engine where it is built', () => {
    counts.built = true;
    expect(toolEngine()).toBe('wasm');
  });

  it('is refused in words where the WebAssembly engine is not built', () => {
    counts.built = false;
    expect(() => toolEngine()).toThrow(NOT_BUILT);
  });
});

describe('hostFor', () => {
  it('runs under the host’s default budgets, less those given, and the language’s parser', () => {
    const host = hostFor(bundle, { output: 12 });
    expect(host.budgets).toEqual({ ...DEFAULT_LIMITS.budgets, output: 12 });
    expect(host.catalogue.world).toBe('kiln_yard');
  });
});

describe('catalogueFor', () => {
  it('reads a cartridge’s catalogue as it was loaded, and a bundle’s under the default caps', () => {
    const cartridge = emitCartridge(bundle);
    const catalogue = loadCartridge(cartridge, { caps: DEFAULT_LIMITS.caps });
    expect(catalogueFor({ catalogue, cartridge })).toBe(catalogue);
    expect(catalogueFor(bundle).world).toBe('kiln_yard');
  });
});

describe.each(ENGINES_BUILT)('engineFor, on the %s engine', (engine) => {
  it('admits a visitor into the world as it loads, from the bundle or from its cartridge', () => {
    const cartridge = emitCartridge(bundle);
    const worlds = [
      bundle,
      { catalogue: loadCartridge(cartridge, { caps: DEFAULT_LIMITS.caps }), cartridge },
    ];
    const arrived = worlds.map((world) => {
      const host = hostFor(world);
      const step = engineFor(engine, world, host).arrival(emptyState(), {
        visit: visitKey('visit:Marta'),
        nickname: 'Marta',
        seed: 0,
        mayHold: null,
        now: 0,
      });
      return step.turn.committed ? step.turn.effects.flatMap((one) => one.paragraphs) : null;
    });
    expect(arrived).toEqual([['A kiln yard.'], ['A kiln yard.']]);
  });
});
