import {
  catalogueOf,
  compileBundle,
  parseCommand,
  renderDiagnostics,
  renderEffects,
  type Bundle,
  type CommandHost,
  type HostSeconds,
} from '@overstory/sprout/lang';
import { publishWorld, type SproutStore } from '@overstory/sprout/core';
import { readWorld } from '@overstory/sprout-player';

import type { ServerConfig } from './config.js';

// A world the server serves (docs/design/sprout-server.md, Commands,
// Reloading): its folder read and compiled strictly, as publishing does,
// under the host's limits and blessings, then published into the store,
// which logs the publish with the bundle's hash. A world that is refused
// is not served, and the words of its refusal are the host's to log.

/** A world compiled and published, with the host its turns run under. */
export interface ServedWorld {
  /** Its name, which clients admit themselves to it by and the store keys it by. */
  readonly id: string;
  readonly dir: string;
  readonly bundle: Bundle;
  readonly host: CommandHost;
  /** The files it was compiled from, which its published record keeps. */
  readonly files: readonly { readonly name: string; readonly source: string }[];
}

/** A world's folder compiled, or the words of its refusal. */
export type Compiled = { readonly world: ServedWorld } | { readonly refused: string };

/** The world in `dir`, compiled strictly under `config`'s limits and blessings. */
export function compileWorld(dir: string, config: ServerConfig): Compiled {
  const read = readWorld(dir);
  if (read.source === null) return { refused: renderDiagnostics(read.diagnostics) };
  const { bundle, diagnostics } = compileBundle(read.source, {
    mode: 'publish',
    limits: config.limits,
    blessed: config.blessed,
  });
  if (bundle === null) return { refused: renderDiagnostics([...read.diagnostics, ...diagnostics]) };
  const catalogue = catalogueOf(bundle, config.limits.caps);
  return {
    world: {
      id: catalogue.world,
      dir,
      bundle,
      host: {
        catalogue,
        budgets: config.limits.budgets,
        render: renderEffects,
        parse: parseCommand,
      },
      files: [read.source.manifestFile, ...read.source.files].map((file) => ({
        name: file.name,
        source: file.text,
      })),
    },
  };
}

/** Publish `world` into `store` at `now`: its record put and the publish logged, which redeploys it. */
export async function publish(
  store: SproutStore,
  world: ServedWorld,
  config: ServerConfig,
  now: HostSeconds,
  loadedAt: Date,
): Promise<void> {
  const { bundle } = world;
  await publishWorld(
    store,
    {
      id: world.id,
      archive: {
        files: [...world.files],
        manifest: null,
      },
      stamp: bundle.hash,
      level: bundle.level,
      extensions: bundle.extensions.map((one) => one.name),
      caps: config.limits.caps,
      excepted: false,
      loadedAt,
    },
    bundle,
    now,
  );
}
