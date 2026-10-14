import { emitCartridge, loadCartridge, DEFAULT_LIMITS, visitKey } from '@overstory/sprout/lang';
import { emptyState } from '@overstory/sprout/core';
import { describe, expect, it } from 'vitest';

import { catalogueFor, engineFor, hostFor } from './engine.js';
import { bundleOf, KILN_YARD } from './fixtures/worlds.js';

const bundle = bundleOf('kiln_yard', KILN_YARD);

describe('hostFor', () => {
  it('runs under the host’s default budgets, less those given', () => {
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

describe('engineFor', () => {
  it('admits a visitor into the world as it loads, from the bundle or from its cartridge', () => {
    const cartridge = emitCartridge(bundle);
    const worlds = [
      bundle,
      { catalogue: loadCartridge(cartridge, { caps: DEFAULT_LIMITS.caps }), cartridge },
    ];
    const arrived = worlds.map((world) => {
      const host = hostFor(world);
      const step = engineFor(world, host).arrival(emptyState(), {
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
