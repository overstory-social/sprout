// Builds sprout-player/ (the Playdate app) and checks it.
//
//   node scripts/playdate-player.mjs [--no-device] [--no-windows] [--out <folder>]
//
// writes one pdx, <folder>/sprout-player.pdx (default sprout-player/build), that carries every
// binary this machine can build: the Simulator library of this platform (pdex.so or pdex.dylib),
// pdex.dll for the Windows Simulator where x86_64-w64-mingw32-gcc is on the path (llvm-mingw
// cross-compiles it from Linux or macOS), and pdex.bin for a console where arm-none-eabi-gcc is.
// pdc packages whatever pdex.* lies beside the Lua, so the one pdx runs wherever a binary was
// built for. Before that it packs the graduated worlds (sprout-player/worlds.json) into the pdx's
// worlds/ folder with their assets, and writes Source/publickey.lua: the public key the download
// screen trusts, read from the file named by SPROUT_INDEX_PUBLIC_KEY (default
// sprout-player/test/index-test.pub, which anyone can sign for, so a build to publish sets it).
// `npm run playdate` is this.
//
// scripts/check-runtime-c.mjs imports `checkPlayer`, the gate's part: it runs the specs of the
// shipping scripts, builds the Simulator target, runs the C glue's tests and the Lua tests, checks
// that the app shelves every graduated world, plays the save the glue wrote through `sproutc`, and
// plays each graduated world's listed plays (`"plays"` in worlds.json, scripts under the world's
// folder) through `sproutc` with the view polled first under the app's poll budget, so every
// reading a play makes is one the sentence builder could build. It needs the Playdate SDK
// (scripts/playdate-sdk.sh fetches it) and prints which parts ran.

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

import { playAndCompare } from './replay-runtime-c.mjs';
import { readingsPath, resolveFile } from './resolve-script.mjs';
import { runtimeCBuild, sanitizedHere } from './runtime-c-build.mjs';

const root = join(fileURLToPath(import.meta.url), '../..');
const player = join(root, 'sprout-player');
const pdxSource = join(player, 'Source');

/** The graduated worlds the pdx carries: `{ "graduated": [ { "world", "title" } ] }`. */
export const WORLDS_FILE = join(player, 'worlds.json');

/** The public key whose signatures the download screen accepts, unless SPROUT_INDEX_PUBLIC_KEY names another. */
export const TEST_PUBLIC_KEY = join(player, 'test/index-test.pub');

const has = (command) => spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0;

/** Runs `command`, behind the words in `prefix` (the sanitized launcher's) where there are any. */
function run(command, args, env, prefix = []) {
  if (prefix.length > 0) return run(prefix[0], [...prefix.slice(1), command, ...args], env);
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
 * a path from the repository root or absolute, which may reach into a sibling checkout such as
 * sprout-studio), the title it is listed under, and `plays`, scripts under the world's folder the
 * app must be able to play (none where left out). The cartridge is named for the world's own name,
 * the manifest's, since a folder may be called anything. Throws, saying what to write, for a list
 * that is not that shape, or that names a world twice, one that is not there, one with no
 * manifest, or a play that is not there.
 */
export function readGraduated(file = WORLDS_FILE) {
  let list;
  try {
    list = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file} cannot be read as JSON: ${err.message}`);
  }
  if (list === null || typeof list !== 'object' || !Array.isArray(list.graduated)) {
    throw new Error(
      `${file} should be { "graduated": [ { "world": "<name or path>", "title": "<title>" } ] }.`,
    );
  }
  const seen = new Set();
  return list.graduated.map((entry, i) => {
    if (
      typeof entry?.world !== 'string' ||
      entry.world === '' ||
      typeof entry.title !== 'string' ||
      entry.title === ''
    ) {
      throw new Error(
        `${file}: entry ${i + 1} of "graduated" needs a "world" and a "title", both text.`,
      );
    }
    const dir = entry.world.includes('/')
      ? resolve(root, entry.world)
      : join(root, 'corpus/good', entry.world);
    if (!existsSync(dir)) {
      const beside = entry.world.startsWith('../')
        ? ` (a sibling checkout: clone it beside this repository)`
        : '';
      throw new Error(`${file}: the world "${entry.world}" is not at ${dir}${beside}.`);
    }
    const name = manifestName(join(dir, 'sprout.json'), file, entry.world);
    if (seen.has(name)) throw new Error(`${file}: the world "${name}" is listed twice.`);
    seen.add(name);
    const plays = entry.plays ?? [];
    if (!Array.isArray(plays) || plays.some((play) => typeof play !== 'string' || play === '')) {
      throw new Error(
        `${file}: "plays" of the world "${entry.world}" should be a list of script paths under its folder.`,
      );
    }
    for (const play of plays) {
      if (!existsSync(join(dir, play)))
        throw new Error(
          `${file}: the play "${play}" of the world "${entry.world}" is not at ${join(dir, play)}.`,
        );
    }
    return { world: entry.world, title: entry.title, dir, file: `${name}.sproutworld`, plays };
  });
}

/** The poll budget the app ships, read from src/budgets.h, the one place it is written. */
export function appPollSteps() {
  const header = readFileSync(join(player, 'src/budgets.h'), 'utf8');
  const match = /^#define PLAYER_POLL_STEPS (\d+)$/m.exec(header);
  if (match === null)
    throw new Error('sprout-player/src/budgets.h no longer defines PLAYER_POLL_STEPS.');
  return Number(match[1]);
}

/**
 * Plays each graduated world's listed plays through `sproutc` over the cartridge the build packed, the
 * view polled before each command under the app's poll budget: every reading must be offered and every
 * line must be the TypeScript runtime's. Returns one line of what ran; throws naming the first play that
 * did not.
 */
export function checkPlays(staged, cartridges, sproutcDir, scratch, prefix = []) {
  const steps = appPollSteps();
  let count = 0;
  let widest = 0;
  for (const { dir, file, plays, title } of staged) {
    for (const play of plays) {
      const script = join(scratch, `${basename(dir)}-${basename(play)}`);
      copyFileSync(join(dir, play), script);
      const result = playAndCompare(
        join(sproutcDir, 'sproutc'),
        join(cartridges, file),
        script,
        false,
        {},
        { offered: true, pollSteps: steps, prefix },
      );
      if (result.how !== 'passed') {
        throw new Error(
          `${title}: ${play} ${result.how} through the app's view and sproutc:\n${result.why}`,
        );
      }
      count++;
      widest = Math.max(widest, result.widest);
    }
  }
  return count === 0
    ? 'no plays listed for the graduated worlds'
    : `${count} listed play${count === 1 ? '' : 's'} built from the view under the app's ${steps}-step poll budget (the widest poll ${widest} steps)`;
}

/** The world's name as its manifest records it; throws where the manifest is missing or has none. */
function manifestName(manifest, list, world) {
  let name;
  try {
    name = JSON.parse(readFileSync(manifest, 'utf8')).name;
  } catch {
    throw new Error(`${list}: the world "${world}" has no readable sprout.json at ${manifest}.`);
  }
  if (typeof name !== 'string' || name === '') {
    throw new Error(`${list}: the world "${world}" has no "name" in its sprout.json.`);
  }
  return name;
}

/**
 * Packs the graduated worlds into `out` with the built CLI, each as `<name>.sproutworld` beside its
 * `.assets` folder, replacing what was there. Returns the list it packed.
 */
export async function stageWorlds({
  list = readGraduated(),
  out = join(pdxSource, 'worlds'),
} = {}) {
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
    throw new Error(
      `${keyFile} should hold the public key as 64 lowercase hexadecimal digits and nothing else.`,
    );
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

/** The MinGW cross compiler that makes pdex.dll from here, where it is on the path. */
const MINGW = 'x86_64-w64-mingw32-gcc';

/**
 * Writes the CMake toolchain file for the Windows library into `dir`: clang or gcc with the MinGW
 * target, as llvm-mingw and mingw-w64 both name it.
 */
function windowsToolchain(dir) {
  const gcc = spawnSync('which', [MINGW], { encoding: 'utf8' }).stdout.trim();
  const bin = join(gcc, '..');
  const file = join(dir, 'toolchain.cmake');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    file,
    [
      'set(CMAKE_SYSTEM_NAME Windows)',
      'set(CMAKE_SYSTEM_PROCESSOR x86_64)',
      `set(CMAKE_C_COMPILER ${gcc})`,
      `set(CMAKE_CXX_COMPILER ${join(bin, 'x86_64-w64-mingw32-g++')})`,
      `set(CMAKE_RC_COMPILER ${join(bin, 'x86_64-w64-mingw32-windres')})`,
      'set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)',
      'set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)',
      'set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)',
      '',
    ].join('\n'),
  );
  return file;
}

/**
 * Configures and builds one target in `dir`; returns the folder the pdx is in. `device` builds
 * the console's ELF with the SDK's ARM toolchain, `windows` the DLL the Windows Simulator loads,
 * through the MinGW cross compiler, and only that library, since the tests are native programs.
 */
function build(dir, { device, windows, cartridges, sanitize }) {
  const sdk = sdkPath();
  const args = ['-S', player, '-B', dir, '-DCMAKE_BUILD_TYPE=Release'];
  if (device) {
    args.push(
      `-DCMAKE_TOOLCHAIN_FILE=${join(sdk, 'C_API/buildsupport/arm.cmake')}`,
      '-DTOOLCHAIN=armgcc',
    );
  } else if (windows) {
    args.push(`-DCMAKE_TOOLCHAIN_FILE=${windowsToolchain(dir)}`);
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
  const target = windows ? ['--target', 'sprout-player'] : [];
  run('cmake', ['--build', dir, '--parallel', ...target], { PLAYDATE_SDK_PATH: sdk });
  return dir;
}

/** The Simulator library this platform's build writes, and the name pdc packages it under. */
function hostLibrary() {
  if (process.platform === 'darwin') return { built: 'libsprout-player.dylib', pdex: 'pdex.dylib' };
  if (process.platform === 'win32') return { built: 'sprout-player.dll', pdex: 'pdex.dll' };
  return { built: 'libsprout-player.so', pdex: 'pdex.so' };
}

/**
 * Puts the binary a build tree wrote beside the Lua as `pdex`, where pdc packages it. The
 * SDK's CMake copies it there too, but only as a step of a target that was rebuilt, and an
 * unchanged target after clearBinaries() leaves nothing; the copy here does not depend on that.
 */
function placeBinary(dir, built, pdex) {
  const from = join(dir, built);
  if (!existsSync(from)) throw new Error(`the build in ${dir} left no ${built}`);
  copyFileSync(from, join(pdxSource, pdex));
  return pdex;
}

/**
 * What `npm run playdate` does: one pdx with every binary this machine can build, the host's
 * Simulator library always, pdex.dll where the MinGW cross compiler is installed and this is not
 * Windows, pdex.bin where arm-none-eabi-gcc is. Returns the pdx and the binaries it carries.
 */
export async function buildPlayer({
  out = join(player, 'build'),
  device = true,
  windows = true,
} = {}) {
  const sdk = sdkPath();
  if (sdk === null) {
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
  const binaries = [];
  const host = hostLibrary();
  binaries.push(
    placeBinary(build(join(out, 'simulator'), { device: false }), host.built, host.pdex),
  );
  const skipped = [];
  if (windows && process.platform !== 'win32') {
    if (has(MINGW)) {
      binaries.push(
        placeBinary(
          build(join(out, 'windows'), { windows: true }),
          'libsprout-player.dll',
          'pdex.dll',
        ),
      );
    } else {
      skipped.push(`pdex.dll (no ${MINGW})`);
    }
  }
  if (device) {
    if (has('arm-none-eabi-gcc')) {
      placeBinary(
        build(join(out, 'device'), { device: true }),
        'sprout-player_DEVICE.elf',
        'pdex.elf',
      );
      binaries.push('pdex.bin');
    } else {
      skipped.push('pdex.bin (no arm-none-eabi-gcc)');
    }
  }
  const pdx = join(out, 'sprout-player.pdx');
  rmSync(pdx, { recursive: true, force: true });
  run(join(sdk, 'bin/pdc'), ['-sdkpath', sdk, pdxSource, pdx]);
  for (const name of binaries) {
    if (!existsSync(join(pdx, name))) throw new Error(`pdc did not package ${name} into ${pdx}`);
  }
  return { pdx, binaries, skipped };
}

/**
 * The gate's part. Returns one line saying which parts ran; throws with the failing command's words.
 * With `sanitize` the Simulator target and its tests are built under AddressSanitizer and
 * UndefinedBehaviorSanitizer, from the cartridges the sanitized runtime build packed, and any report
 * fails; the device target is not built then. The sanitized tests and `sproutc` run behind the
 * address-space launcher of player/src/aslr.ts, whose line check-runtime-c.mjs has printed.
 */
export async function checkPlayer({ sanitize = false } = {}) {
  const ran = [];
  const prefix = sanitize ? sanitizedHere().prefix : [];
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
    const tests = run(
      'ctest',
      ['--test-dir', dir, '--output-on-failure'],
      {
        PLAYER_KEEP_DIR: keep,
        PLAYER_SHIPPED_DIR: join(pdxSource, 'worlds'),
        ...(sanitize
          ? {
              ASAN_OPTIONS: 'halt_on_error=1:detect_leaks=1:abort_on_error=0',
              UBSAN_OPTIONS: 'halt_on_error=1:print_stacktrace=1',
            }
          : {}),
      },
      prefix,
    );
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
    ran.push(roundTrip(keep, cartridges, sproutcDir, prefix));
    ran.push(builtMatchesTyped(keep, cartridges, sproutcDir, prefix));
    ran.push(checkPlays(staged, join(pdxSource, 'worlds'), sproutcDir, scratch, prefix));

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
  const specs = ['publish-index.spec.mjs', 'playdate-player.spec.mjs'].map((name) =>
    join(root, 'scripts', name),
  );
  run(process.execPath, ['--test', ...specs]);
  return 'shipping script specs passed';
}

/** The save the glue wrote is read and written back by `sproutc` byte for byte. */
function roundTrip(keep, cartridges, buildDir, prefix) {
  const sproutc = join(buildDir, 'sproutc');
  const save = join(keep, 'chip-tree.save.json');
  if (!existsSync(save)) throw new Error('the glue tests left no save to play through sproutc');
  const copy = join(keep, 'roundtrip.json');
  copyFileSync(save, copy);
  const before = readFileSync(copy);
  run(sproutc, ['play', join(cartridges, 'chip-tree.sproutworld'), '--state', copy], {}, prefix);
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

export function builtMatchesTyped(keep, cartridges, buildDir, prefix = []) {
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
    run(
      join(buildDir, 'sproutc'),
      ['play', cartridge, '--script', script, '--state', typed],
      {},
      prefix,
    );
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
    const built = await buildPlayer({
      out,
      device: !args.includes('--no-device'),
      windows: !args.includes('--no-windows'),
    });
    console.log(`pdx: ${built.pdx}`);
    console.log(`carries: ${built.binaries.join(', ')}`);
    if (built.skipped.length > 0) console.log(`not built: ${built.skipped.join(', ')}`);
    console.log(`Open it:  "$PLAYDATE_SDK_PATH/bin/PlaydateSimulator" "${built.pdx}"`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
