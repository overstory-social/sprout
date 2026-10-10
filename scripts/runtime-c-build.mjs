// Where scripts/check-runtime-c.mjs builds runtime-c/: outside the
// repository, one folder per checkout, so lint and prettier never see it.
// The fuzzer finds `sproutc` there too.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sanitizedLauncher } from '@overstory/sprout-player';

/** The runtime-c source folder of this checkout. */
export const runtimeCRoot = join(fileURLToPath(import.meta.url), '../../runtime-c');

/** The folder `check-runtime-c.mjs` configures and builds in. */
export const runtimeCBuild = join(
  tmpdir(),
  `sprout-runtime-c-${createHash('sha256').update(runtimeCRoot).digest('hex').slice(0, 12)}`,
);

/**
 * How to launch a sanitized command on this machine (player/src/aslr.ts): the words to put before
 * it, and the one line to print about it.
 */
export function sanitizedHere() {
  return sanitizedLauncher({
    platform: process.platform,
    machine: spawnSync('uname', ['-m'], { encoding: 'utf8' }).stdout?.trim() ?? '',
    hasSetarch: spawnSync('setarch', ['--version'], { stdio: 'ignore' }).status === 0,
  });
}
