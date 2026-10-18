import {
  compileBundle,
  emitCartridge,
  loadCartridge,
  renderDiagnostics,
  worldTitle,
  type Bundle,
  type HostSeconds,
} from '@overstory/sprout/lang';
import {
  deployWorld,
  publishWorld,
  type LogHost,
  type MicroworldRecord,
  type SproutStore,
} from '@overstory/sprout/core';
import { wasmEngine } from '@overstory/sprout-engine-wasm';
import { INSTALLED_EXTENSIONS, readWorld } from '@overstory/sprout-player';

import type { ServerConfig } from './config.js';

// A world the server serves (docs/design/sprout-server.md, Commands,
// Reloading): its folder read and compiled strictly, as publishing does,
// under the host's limits and blessings, then published into the store,
// which logs the publish with the bundle's hash. A world that is refused
// is not served, and the words of its refusal are the host's to log.
// What it serves is the catalogue its cartridge reads back, as any host
// that loads a published world does, run on the WebAssembly engine;
// of the bundle it keeps only what the published record and the log name.

/** What the server keeps of a world's bundle once it has made its cartridge. */
export type BundleStamp = Pick<Bundle, 'hash' | 'level' | 'extensions' | 'assets'>;

/** A world compiled and published, with the host its turns run under. */
export interface ServedWorld {
  /** Its name, which clients admit themselves to it by and the store keys it by. */
  readonly id: string;
  /** What a person is shown it as (`worldTitle`). */
  readonly title: string;
  readonly dir: string;
  readonly bundle: BundleStamp;
  readonly host: LogHost;
  /** The files it was compiled from, which its published record keeps. */
  readonly files: readonly { readonly name: string; readonly source: string }[];
}

/** A world's folder compiled, or the words of its refusal. */
export type Compiled = { readonly world: ServedWorld } | { readonly refused: string };

/** The world in `dir`, compiled strictly under `config`'s limits and blessings. */
export function compileWorld(dir: string, config: ServerConfig): Compiled {
  let read: ReturnType<typeof readWorld>;
  try {
    read = readWorld(dir);
  } catch (error) {
    // A folder that is not there, or cannot be read, is refused as a world that does not compile is.
    return { refused: error instanceof Error ? error.message : String(error) };
  }
  if (read.source === null) return { refused: renderDiagnostics(read.diagnostics) };
  const { bundle, diagnostics } = compileBundle(read.source, {
    mode: 'publish',
    limits: config.limits,
    blessed: config.blessed,
    extensions: INSTALLED_EXTENSIONS,
  });
  if (bundle === null) return { refused: renderDiagnostics([...read.diagnostics, ...diagnostics]) };
  const cartridge = emitCartridge(bundle);
  const catalogue = loadCartridge(cartridge, {
    caps: config.limits.caps,
    installed: INSTALLED_EXTENSIONS,
  });
  const { hash, level, extensions, assets } = bundle;
  const budgets = config.limits.budgets;
  return {
    world: {
      id: catalogue.world,
      title: worldTitle(bundle.manifest),
      dir,
      bundle: { hash, level, extensions, assets },
      host: {
        catalogue,
        budgets,
        logDepth: config.logDepth,
        engine: wasmEngine({ cartridge, catalogue, budgets }),
      },
      files: [read.source.manifestFile, ...read.source.files].map((file) => ({
        name: file.name,
        source: file.text,
      })),
    },
  };
}

/** `world`'s record, as its published record keeps it: its files, and its bundle's hash as its stamp. */
function recordOf(world: ServedWorld, config: ServerConfig, loadedAt: Date): MicroworldRecord {
  const { bundle } = world;
  return {
    id: world.id,
    archive: { files: [...world.files], manifest: null },
    stamp: bundle.hash,
    level: bundle.level,
    extensions: bundle.extensions.map((one) => one.name),
    caps: config.limits.caps,
    excepted: false,
    loadedAt,
  };
}

/** Publish `world` into `store` at `now`, which redeploys it from its initial state (the spec's State › Redeploying). */
export async function publish(
  store: SproutStore,
  world: ServedWorld,
  config: ServerConfig,
  now: HostSeconds,
  loadedAt: Date,
): Promise<void> {
  await publishWorld(store, recordOf(world, config, loadedAt), world.bundle, now);
}

/**
 * Start `world` as the server starts: what it stored is kept where it last
 * ran these same files, and it is published, from its initial state,
 * otherwise.
 */
export function deploy(
  store: SproutStore,
  world: ServedWorld,
  config: ServerConfig,
  now: HostSeconds,
  loadedAt: Date,
): Promise<'kept' | 'redeployed'> {
  return deployWorld(store, recordOf(world, config, loadedAt), world.bundle, now);
}
