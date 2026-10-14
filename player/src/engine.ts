import {
  catalogueOf,
  DEFAULT_LIMITS,
  emitCartridge,
  type Bundle,
  type Catalogue,
  type RuntimeBudgets,
} from '@overstory/sprout/lang';
import type { Engine, WorldHost } from '@overstory/sprout/core';
import { wasmEngine } from '@overstory/sprout-engine-wasm';

// The engine the player and the inspectors run a world on, through core's
// `Engine` (the spec's The runtime; The host contract): the C runtime built
// for WebAssembly, refused in `NOT_BUILT`'s words where its module is not
// built.

/** A world loaded from its cartridge: the catalogue a host reads, and the bytes an engine opens. */
export interface Cartridge {
  readonly catalogue: Catalogue;
  readonly cartridge: Uint8Array;
}

/** A world to play: compiled from source, or loaded from a cartridge. */
export type PlayableWorld = Bundle | Cartridge;

/** What `world` says about instances: a bundle's, read under the host's default caps; a cartridge's, as it was loaded. */
export function catalogueFor(world: PlayableWorld): Catalogue {
  return 'cartridge' in world ? world.catalogue : catalogueOf(world, DEFAULT_LIMITS.caps);
}

/** A host for `world` under the host's default budgets less any `budgets` given. */
export function hostFor(world: PlayableWorld, budgets: Partial<RuntimeBudgets> = {}): WorldHost {
  return {
    catalogue: catalogueFor(world),
    budgets: { ...DEFAULT_LIMITS.budgets, ...budgets },
  };
}

/** The engine running `world` for `host`. */
export function engineFor(world: PlayableWorld, host: WorldHost): Engine {
  const cartridge = 'cartridge' in world ? world.cartridge : emitCartridge(world);
  return wasmEngine({ cartridge, catalogue: host.catalogue, budgets: host.budgets });
}
