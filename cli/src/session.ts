import { basename } from 'node:path';

import type { Archive } from '@overstory/sprout/lang';
import {
  archiveStamp,
  createRuntime,
  type Runtime,
  type SproutStore,
} from '@overstory/sprout/core';

import { EXTENSIONS } from './check.js';
import type { ReadArchive } from './archive.js';

// A microworld in play (the split proposal §6): the runtime over the
// store, the archive loaded — again if the files changed since the last
// load, which core tells by the archive's stamp; state that still fits
// is kept, and `fresh` puts every placed thing back at home — and the
// id the store files it under. `play` and `serve` share this.

export interface Session {
  runtime: Runtime;
  microworldId: string;
  /** What the load found it could not keep, if anything. */
  absent: string[];
  reloaded: boolean;
}

/** The microworld's id in the store: the folder's or the zip's name. */
export function microworldIdOf(archive: ReadArchive): string {
  return basename(archive.path, '.zip');
}

export async function openSession(
  archive: ReadArchive,
  store: SproutStore,
  opts: { fresh?: boolean; now: Date },
): Promise<Session> {
  const runtime = createRuntime({ store, ext: EXTENSIONS });
  const microworldId = microworldIdOf(archive);
  const current = await store.read(microworldId, (tx) => tx.microworld());
  const loaded: Archive = { files: archive.files, manifest: archive.manifest };
  let absent: string[] = [];
  let reloaded = false;
  if (!current || current.stamp !== archiveStamp(loaded)) {
    const report = await runtime.load(microworldId, loaded, opts.now);
    absent = report.absent.map((a) => `${a.definition}: ${a.reason}`);
    reloaded = true;
  }
  if (opts.fresh) await runtime.reset(microworldId, opts.now);
  return { runtime, microworldId, absent, reloaded };
}
