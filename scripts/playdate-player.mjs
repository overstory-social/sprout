// Builds sprout-player/ (the Playdate app) and checks it.
//
//   node scripts/playdate-player.mjs [--device] [--out <folder>]
//
// builds the Simulator pdx (and, with --device, the device pdx as well, which then holds both
// binaries and runs on the Simulator and on a console) under <folder> (default
// sprout-player/build), after packing the graduated worlds (sprout-player/worlds.json) into the
// pdx's worlds/ folder with their assets, and writing Source/publickey.lua: the public key the
// download screen trusts, read from the file named by SPROUT_INDEX_PUBLIC_KEY (default
// sprout-player/test/index-test.pub, which anyone can sign for, so a build to publish sets it).
// `npm run playdate` is this with --device when arm-none-eabi-gcc is on the path.
//
// scripts/check-runtime-c.mjs imports `checkPlayer`, the gate's part: it runs the specs of the
// shipping scripts, builds the Simulator target, runs the C glue's tests and the Lua tests, checks
// that the app shelves every graduated world, and plays the save the glue wrote through `sproutc`.
// It needs the Playdate SDK (scripts/playdate-sdk.sh fetches it) and prints which parts ran.

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readingsPath, resolveFile } from './resolve-script.mjs';
import { runtimeCBuild } from './runtime-c-build.mjs';

const root = join(fileURLToPath(import.meta.url), '../..');
const player = join(root, 'sprout-player');
const pdxSource = join(player, 'Source');

/** The graduated worlds the pdx carries: `{ "graduated": [ { "world", "title" } ] }`. */
export const WORLDS_FILE = join(player, 'worlds.json');

/** The public key whose signatures the download screen accepts, unless SPROUT_INDEX_PUBLIC_KEY names another. */
export const TEST_PUBLIC_KEY = join(player, 'test/index-test.pub');

const has = (command) => spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0;

function run(command, args, env) {
  const done = spawnSync(command, args, { encoding: 'utf8', env: { ...process.env, ...env } });
  if (done.status !== 0) {
    throw new Error(
      `\`${command} ${args.join(' ')}\` failed:\n${done.stdout ?? ''}${done.stderr ?? ''}`,
    );
  }
  return done.stdout;
}

/** The SDK folder from PLAYDATE_SDK_PATH, or null where it is unset or is not a folder. */
export function sdkPath() {
  const path = process.env.PLAYDATE_SDK_PATH;
  return path !== undefined && path !== '' && existsSync(join(path, 'C_API')) ? path : null;
}

/**
 * Reads the list of graduated worlds: each entry names a world folder (a name under corpus/good, or
 * a path from the repository root or absolute) and the title it is listed under. Throws, saying
 * what to write, for a list that is not that shape or that names a world twice or one that is not
 * there.
 */
export function readGraduated(file = WORLDS_FILE) {
  let list;
  try {
    list = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file} cannot be read as JSON: ${err.message}`);
  }
  if (list === null || typeof list !== 'object' || !Array.isArray(list.graduated)) {
    throw new Error(`${file} should be { "graduated": [ { "world": "<name or path>", "title": "<title>" } ] }.`);
  }
  const seen = new Set();
  return list.graduated.map((entry, i) => {
    if (typeof entry?.world !== 'string' || entry.world === '' || typeof entry.title !== 'string' || entry.title === '') {
      throw new Error(`${file}: entry ${i + 1} of "graduated" needs a "world" and a "title", both text.`);
    }
    const dir = entry.world.includes('/') ? resolve(root, entry.world) : join(root, 'corpus/good', entry.world);
    if (!existsSync(dir)) throw new Error(`${file}: the world "${entry.world}" is not at ${dir}.`);
    const name = basename(dir);
    if (seen.has(name)) throw new Error(`${file}: the world "${name}" is listed twice.`);
    seen.add(name);
    return { world: entry.world, title: entry.title, dir, file: `${name}.sproutworld` };
  });
}

/**
 * Packs the graduated worlds into `out` with the built CLI, each as `<name>.sproutworld` beside its
 * `.assets` folder, replacing what was there. Returns the list it packed.
 */
export async function stageWorlds({ list = readGraduated(), out = join(pdxSource, 'worlds') } = {}) {
  const { main } = await import(pathToFileURL(join(root, 'cli/dist/cli.js')).href);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  let said = '';
  const quiet = { write: (text) => ((said += text), true) };
  for (const { dir, file, title } of list) {
    said = '';
    const code = await main(['pack', dir, '-o', join(out, file)], {
      stdout: quiet,
      stderr: quiet,
      stdin: process.stdin,
    });
    if (code !== 0) throw new Error(`${title} (${dir}) did not pack:\n${said}`);
  }
  return list;
}

/**
 * Writes `Source/publickey.lua`, the key the download screen trusts, from the file named by
 * `keyFile` (64 hexadecimal digits, as scripts/publish-index.mjs --generate-key writes). Returns
 * the path of the file read and whether it is the test key.
 */
export function writePublicKey({
  keyFile = process.env.SPROUT_INDEX_PUBLIC_KEY || TEST_PUBLIC_KEY,
  into = pdxSource,
} = {}) {
  const key = readFileSync(keyFile, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/.test(key)) {
    throw new Error(`${keyFile} should hold the public key as 64 lowercase hexadecimal digits and nothing else.`);
  }
  writeFileSync(
    join(into, 'publickey.lua'),
    `-- Generated by scripts/playdate-player.mjs from ${basename(keyFile)}: the Ed25519 public key whose\n` +
      `-- signature the download screen requires on the index of worlds. Not committed.\nreturn "${key}"\n`,
  );
  return { keyFile, isTest: resolve(keyFile) === TEST_PUBLIC_KEY };
}

/** Removes what an earlier build left beside the Lua: the binaries the pdx is made from. */
function clearBinaries() {
  for (const name of readdirSync(pdxSource)) {
    if (name.startsWith('pdex.')) rmSync(join(pdxSource, name), { force: true });
  }
}

/** Configures and builds one target in `dir`; returns the folder the pdx is in. */
function build(dir, { device, cartridges, sanitize }) {
  const sdk = sdkPath();
  const args = ['-S', player, '-B', dir, '-DCMAKE_BUILD_TYPE=Release'];
  if (device) {
    args.push(
      `-DCMAKE_TOOLCHAIN_FILE=${join(sdk, 'C_API/buildsupport/arm.cmake')}`,
      '-DTOOLCHAIN=armgcc',
    );
  } else if (cartridges !== undefined) {
    args.push(`-DPLAYER_CARTRIDGES=${cartridges}`);
  }
  if (sanitize) {
    const flags = '-fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer';
    args.push(
      `-DCMAKE_C_FLAGS=${flags}`,
      '-DCMAKE_EXE_LINKER_FLAGS=-fsanitize=address,undefined',
      '-DCMAKE_SHARED_LINKER_FLAGS=-fsanitize=address,undefined',
    );
  }
  run('cmake', args, { PLAYDATE_SDK_PATH: sdk });
  run('cmake', ['--build', dir, '--parallel'], { PLAYDATE_SDK_PATH: sdk });
  return dir;
}

/** What `npm run playdate` does: the Simulator pdx, and the device's too where arm-none-eabi-gcc is installed. */
export async function buildPlayer({ out = join(player, 'build'), device = true } = {}) {
  if (sdkPath() === null) {
    throw new Error(
      'PLAYDATE_SDK_PATH is not set to a Playdate SDK. Run `export PLAYDATE_SDK_PATH="$(bash scripts/playdate-sdk.sh)"`.',
    );
  }
  await stageWorlds();
  const key = writePublicKey();
  if (key.isTest) {
    console.warn(
      'The download screen trusts the test public key (sprout-player/test/index-test.pub), whose private half is in the repository, so anyone can sign an index it accepts. Set SPROUT_INDEX_PUBLIC_KEY to the file holding your public key for a build you give to anyone else.',
    );
  }
  clearBinaries();
  mkdirSync(out, { recursive: true });
  const built = {
    simulator: join(build(join(out, 'simulator'), { device: false }), 'sprout-player.pdx'),
  };
  if (device && has('arm-none-eabi-gcc')) {
    built.device = join(build(join(out, 'device'), { device: true }), 'sprout-player_DEVICE.pdx');
  }
  return built;
}

/**
 * The gate's part. Returns one line saying which parts ran; throws with the failing command's words.
 * With `sanitize` the Simulator target and its tests are built under AddressSanitizer and
 * UndefinedBehaviorSanitizer, from the cartridges the sanitized runtime build packed, and any report
 * fails; the device target is not built then.
 */
export async function checkPlayer({ sanitize = false } = {}) {
  const ran = [];
  const scratch = mkdtempSync(join(tmpdir(), 'sprout-player-'));
  try {
    ran.push(shippingSpecs());
    const staged = await stageWorlds();
    writePublicKey({ keyFile: TEST_PUBLIC_KEY });
    clearBinaries();
    const cartridges = join(sanitize ? `${runtimeCBuild}-sanitize` : runtimeCBuild, 'cartridges');
    if (!existsSync(cartridges))
      throw new Error('runtime-c has not packed the corpus cartridges yet');
    const dir = build(join(scratch, 'simulator'), { device: false, cartridges, sanitize });
    const pdx = join(dir, 'sprout-player.pdx');
    for (const file of ['pdxinfo', 'main.pdz', 'pdex.so']) {
      if (!existsSync(join(pdx, file))) throw new Error(`the pdx has no ${file}`);
    }
    ran.push(sanitize ? 'Simulator pdx built under the sanitizers' : 'Simulator pdx built');

    const keep = join(scratch, 'keep');
    mkdirSync(keep);
    const tests = run('ctest', ['--test-dir', dir, '--output-on-failure'], {
      PLAYER_KEEP_DIR: keep,
      PLAYER_SHIPPED_DIR: join(pdxSource, 'worlds'),
      ...(sanitize
        ? {
            ASAN_OPTIONS: 'halt_on_error=1:detect_leaks=1:abort_on_error=0',
            UBSAN_OPTIONS: 'halt_on_error=1:print_stacktrace=1',
          }
        : {}),
    });
    const wanted = [
      'text',
      'ed25519',
      'shipping',
      'shipped',
      'files',
      'reading_json',
      'pd_host',
      'budgets',
      'reply',
      'savelog',
      'session',
      'turns',
      'seen',
      'bridge',
      'glue',
    ];
    const missing = wanted.filter((name) => !new RegExp(`player-${name} .*Passed`).test(tests));
    if (missing.length > 0) {
      throw new Error(`ctest did not pass the glue's tests ${missing.join(', ')}:\n${tests}`);
    }
    ran.push(`${wanted.length} C test programs passed`);
    ran.push(`the app shelves all ${staged.length} graduated worlds`);
    ran.push(/player-lua/.test(tests) ? 'Lua tests passed' : 'Lua tests skipped (no lua5.4)');

    const sproutcDir = sanitize ? `${runtimeCBuild}-sanitize` : runtimeCBuild;
    ran.push(roundTrip(keep, cartridges, sproutcDir));
    ran.push(builtMatchesTyped(keep, cartridges, sproutcDir));

    if (sanitize) {
      ran.push('device target not built under the sanitizers');
    } else if (has('arm-none-eabi-gcc')) {
      build(join(scratch, 'device'), { device: true });
      const bin = join(scratch, 'device', 'sprout-player_DEVICE.pdx', 'pdex.bin');
      if (!existsSync(bin)) throw new Error('the device pdx has no pdex.bin');
      ran.push(`device pdx built (pdex.bin ${statSync(bin).size} bytes)`);
    } else {
      ran.push('device target not built (no arm-none-eabi-gcc)');
    }
  } finally {
    clearBinaries();
    rmSync(scratch, { recursive: true, force: true });
  }
  return `sprout-player: ${ran.join('; ')}`;
}

/** Runs the specs of the shipping scripts (the signed index, the graduated list); one line of what ran. */
export function shippingSpecs() {
  const specs = ['publish-index.spec.mjs', 'playdate-player.spec.mjs'].map((name) => join(root, 'scripts', name));
  run(process.execPath, ['--test', ...specs]);
  return 'shipping script specs passed';
}

/** The save the glue wrote is read and written back by `sproutc` byte for byte. */
function roundTrip(keep, cartridges, buildDir) {
  const sproutc = join(buildDir, 'sproutc');
  const save = join(keep, 'chip-tree.save.json');
  if (!existsSync(save)) throw new Error('the glue tests left no save to play through sproutc');
  const copy = join(keep, 'roundtrip.json');
  copyFileSync(save, copy);
  const before = readFileSync(copy);
  run(sproutc, ['play', join(cartridges, 'chip-tree.sproutworld'), '--state', copy]);
  if (!before.equals(readFileSync(copy))) {
    throw new Error('sproutc wrote the save back differently from the bytes the player wrote');
  }
  return 'save round-trips through sproutc';
}

/**
 * The turns the glue built from readings, as the sentence builder hands them over, leave the stored
 * world the same lines typed leave: each save is compared with the save `sproutc` leaves when it
 * plays the lines the TypeScript parser read. `tune` declares its value role first and a parser
 * binds it last; `take` leaves a role out.
 */
const BUILT_AND_TYPED = [
  {
    world: 'chip-tree',
    built: 'chip-tree.built.json',
    lines: ['ask guard about weather', 'turn dial to 3', 'juggle shell', 'take pebble'],
  },
  { world: 'value-first', built: 'value-first.built.json', lines: ['tune 4 on dial'] },
];

export function builtMatchesTyped(keep, cartridges, buildDir) {
  for (const { world, built, lines } of BUILT_AND_TYPED) {
    const builtPath = join(keep, built);
    if (!existsSync(builtPath)) throw new Error(`the glue tests left no ${built} to compare`);
    const cartridge = join(cartridges, `${world}.sproutworld`);
    const script = join(keep, `${world}.typed.json`);
    writeFileSync(
      script,
      JSON.stringify({
        steps: [{ arrive: 'player' }, ...lines.map((type) => ({ as: 'player', type }))],
      }),
    );
    writeFileSync(readingsPath(script), resolveFile(cartridge, script, {}));
    const typed = join(keep, `${world}.typed.state.json`);
    run(join(buildDir, 'sproutc'), ['play', cartridge, '--script', script, '--state', typed]);
    if (!readFileSync(builtPath).equals(readFileSync(typed))) {
      throw new Error(
        `${world}: the stored world after the built turns is not the one after the same lines typed`,
      );
    }
  }
  return 'built turns leave the stored world the typed lines do';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const outAt = args.indexOf('--out');
  const out = outAt >= 0 ? args[outAt + 1] : undefined;
  try {
    const built = await buildPlayer({ out, device: !args.includes('--no-device') });
    console.log(`Simulator pdx: ${built.simulator}`);
    if (built.device === undefined) {
      console.log('Device pdx: not built (arm-none-eabi-gcc is not installed).');
    } else {
      console.log(`Device pdx (runs in the Simulator too): ${built.device}`);
    }
    const pdx = built.device ?? built.simulator;
    console.log(`Open it:  "$PLAYDATE_SDK_PATH/bin/PlaydateSimulator" "${pdx}"`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
