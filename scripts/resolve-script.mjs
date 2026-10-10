// Resolves a script for a runtime that has no parser: plays it over the
// world with the TypeScript runtime and writes, beside it, the reading the
// parser made of each typed line as `<script>.readings.json` (see
// player/src/readings.ts for the shape). A line the parser answered rather
// than read is marked `skip`.
//
//   node scripts/resolve-script.mjs <world folder or .sproutworld> <script.json> [-o out.json]
//
// Prints the file it wrote. Also imported by the replay and the fuzzer.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CARTRIDGE_EXTENSION, DEFAULT_LIMITS, loadCartridge } from '@overstory/sprout/lang';
import { readScript, resolveScript, writeReadings } from '@overstory/sprout-player';
import { checkWorld, formatCheck } from '@overstory/sprout-cli';

/** The readings file that sits beside `script`: `order.json` gives `order.readings.json`. */
export function readingsPath(script) {
  return script.replace(/\.json$/, '') + '.readings.json';
}

/** The world `path` names, to play: a cartridge loaded, or a folder compiled as `sprout check` does. */
export function playableWorld(path) {
  if (path.endsWith(CARTRIDGE_EXTENSION)) {
    return loadCartridge(readFileSync(path), { caps: DEFAULT_LIMITS.caps });
  }
  const checked = checkWorld(path);
  if (checked.bundle === null) throw new Error(formatCheck(checked));
  return checked.bundle;
}

/** The readings file text for `script` over `world`; thrown, in words, where either cannot be read or played. */
export function resolveFile(worldPath, scriptPath) {
  const script = readScript(readFileSync(scriptPath, 'utf8'), scriptPath);
  return writeReadings(resolveScript(playableWorld(worldPath), script, scriptPath));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const out = args.indexOf('-o');
  const target = out === -1 ? null : args.splice(out, 2)[1];
  const [world, script] = args;
  if (world === undefined || script === undefined) {
    console.error(
      'resolve-script: write `node scripts/resolve-script.mjs <world> <script.json> [-o file]`.',
    );
    process.exit(2);
  }
  try {
    const file = target ?? readingsPath(script);
    writeFileSync(file, resolveFile(world, script));
    console.log(file);
  } catch (err) {
    console.error(`resolve-script: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
