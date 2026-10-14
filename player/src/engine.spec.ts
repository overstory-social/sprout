import { emitCartridge, loadCartridge, DEFAULT_LIMITS, visitKey } from '@overstory/sprout/lang';
import { emptyState } from '@overstory/sprout/core';
import { NOT_BUILT } from '@overstory/sprout-engine-wasm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { catalogueFor, chooseEngine, engineFor, hostFor } from './engine.js';
import { ENGINES_BUILT } from './fixtures/play.js';
import { bundleOf, KILN_YARD } from './fixtures/worlds.js';

/** Whether this spec's WebAssembly engine counts as built: as it is, where null. */
const counts = vi.hoisted(() => ({ built: null as boolean | null }));
vi.mock(import('@overstory/sprout-engine-wasm'), async (actual) => {
  const real = await actual();
  return { ...real, engineBuilt: () => counts.built ?? real.engineBuilt() };
});

const bundle = bundleOf('kiln_yard', KILN_YARD);

describe('chooseEngine', () => {
  beforeEach(() => {
    counts.built = true;
  });
  afterEach(() => {
    counts.built = null;
  });

  it('runs the engine asked for, saying nothing', () => {
    expect(chooseEngine('ts')).toEqual({ name: 'ts', note: null });
    expect(chooseEngine('wasm')).toEqual({ name: 'wasm', note: null });
  });

  it('runs the WebAssembly engine where none is asked for and it is built', () => {
    expect(chooseEngine()).toEqual({ name: 'wasm', note: null });
  });

  it('runs the TypeScript engine where none is asked for and the other is not built, and says why', () => {
    counts.built = false;
    expect(chooseEngine()).toEqual({
      name: 'ts',
      note: `running on the TypeScript engine: ${NOT_BUILT}`,
    });
  });

  it('refuses the WebAssembly engine asked for where it is not built, and an engine there is not', () => {
    counts.built = false;
    expect(() => chooseEngine('wasm')).toThrow(NOT_BUILT);
    expect(() => chooseEngine('rust')).toThrow('--engine wants ts or wasm: --engine ts');
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
