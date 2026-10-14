import {
  catalogueOf,
  DEFAULT_LIMITS,
  emitCartridge,
  parseCommand,
  renderEffects,
  type Bundle,
  type Catalogue,
  type CommandHost,
  type RuntimeBudgets,
} from '@overstory/sprout/lang';
import { tsEngine, type Engine } from '@overstory/sprout/core';
import { engineBuilt, NOT_BUILT, wasmEngine } from '@overstory/sprout-engine-wasm';

// The engine the player and the inspectors run a world on, through core's
// `Engine` (the spec's The runtime; The host contract). A tool runs the C
// runtime built for WebAssembly (`toolEngine`), and refuses in words where
// its module is not built; the TypeScript runtime is named only by the
// specs that compare the two.

/** The engines a world may run on: the tools' own, and the TypeScript one the specs compare it with. */
export type EngineName = 'ts' | 'wasm';

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

/** The engine every tool runs a world on: the WebAssembly one, thrown in words where it is not built. */
export function toolEngine(): EngineName {
  if (!engineBuilt()) throw new Error(NOT_BUILT);
  return 'wasm';
}

/** A host for `world` under the host's default budgets less any `budgets` given. */
export function hostFor(world: PlayableWorld, budgets: Partial<RuntimeBudgets> = {}): CommandHost {
  return {
    catalogue: catalogueFor(world),
    budgets: { ...DEFAULT_LIMITS.budgets, ...budgets },
    render: renderEffects,
    parse: parseCommand,
  };
}

/** The engine `name` running `world` for `host`. */
export function engineFor(name: EngineName, world: PlayableWorld, host: CommandHost): Engine {
  if (name === 'ts') return tsEngine(host);
  const cartridge = 'cartridge' in world ? world.cartridge : emitCartridge(world);
  return wasmEngine({ cartridge, catalogue: host.catalogue, budgets: host.budgets });
}
