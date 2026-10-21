// Builds sprout-player/ (the Playdate app, pure C over the engine) and checks it.
//
//   node scripts/playdate-player.mjs [--no-device] [--no-windows] [--out <folder>]
//
// writes one pdx, <folder>/sprout-player.pdx (default sprout-player/build), that carries every
// binary this machine can build: the Simulator library of this platform (pdex.so or pdex.dylib),
// pdex.dll for the Windows Simulator where x86_64-w64-mingw32-gcc is on the path (llvm-mingw
// cross-compiles it from Linux or macOS), and pdex.bin for a console where arm-none-eabi-gcc is.
// pdc packages Source/ (pdxinfo, the fonts) with whatever pdex.* lies there, so the one pdx runs
// wherever a binary was built for; the system runs the update callback main.c sets. The pdx carries
// no worlds: the build packs the graduated worlds (sprout-player/worlds.json's "graduated") into
// <folder>/worlds, beside the pdx, one cartridge a world, its pictures inside it, for a world is
// installed on its own (the design doc's Shipped worlds and downloads); the list's "testOnly" worlds
// are the gate's and never ship. The download screen trusts the publisher's public
// key, sprout-player/publisher.pub, whose private half signs the studio's index; SPROUT_INDEX_PUBLIC_KEY
// names another file instead. The build bakes the key in as generated/publickey.h
// (-DPLAYER_INDEX_PUBLIC_KEY_FILE). `npm run playdate` is this.
//
// scripts/check-runtime-c.mjs imports `checkPlayer`, the gate's part: it runs the specs of the
// shipping scripts, builds the Simulator target, runs the player's C tests (among them that the app
// accepts an index `sprout index` signed with a key `sprout keygen` made), checks that the app
// shelves and opens every graduated and test-only world, plays the save the session's end-to-end test
// wrote through `sproutc`, and plays each listed world's plays (`"plays"` in worlds.json, scripts under
// the world's folder) through `sproutc` with the view polled first under the app's poll budget, so
// every reading a play makes is one the sentence builder could build, each step saying what the
// play expects of it; it also builds the device binary. It needs the Playdate SDK (scripts/playdate-sdk.sh fetches it) and prints which parts ran.

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

import { readScript } from '@overstory/sprout-player';

import { runtimeCBuild, sanitizedHere } from './runtime-c-build.mjs';

const root = join(fileURLToPath(import.meta.url), '../..');
const player = join(root, 'sprout-player');
const pdxSource = join(player, 'Source');

/** The worlds the build ships apart from the pdx and those the gate only tests: `{ "graduated": [ { "world", "title" } ], "testOnly": [ … ] }`. */
export const WORLDS_FILE = join(player, 'worlds.json');

/** The publisher's public key, whose signatures the download screen accepts unless SPROUT_INDEX_PUBLIC_KEY names another. */
export const PUBLISHER_PUBLIC_KEY = join(player, 'publisher.pub');

/** The key the gate's builds trust, whose private half is in the repository so the tests can sign an index. */
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
 * Reads `worlds.json`: `graduated`, the worlds the build packs beside the pdx, and `testOnly`
 * (which may be left out), worlds the gate packs and checks as it does those but that never ship,
 * since a player gets them from the studio's index. Each entry names a world folder (a name under
 * corpus/good, or a path from the repository root or absolute; a studio world is its snapshot under
 * sprout-player/worlds), the title it is listed under, and `plays`, scripts under the world's folder
 * the app must be able to play (none where left out). The cartridge is named for the world's own
 * name, the manifest's, since a folder may be called anything. Throws, saying what to write, for a
 * file that is not that shape, or that names a world twice in either list, one that is not there,
 * one with no manifest, or a play that is not there.
 */
export function readWorldLists(file = WORLDS_FILE) {
  let lists;
  try {
    lists = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file} cannot be read as JSON: ${err.message}`);
  }
  if (
    lists === null ||
    typeof lists !== 'object' ||
    !Array.isArray(lists.graduated) ||
    !(lists.testOnly === undefined || Array.isArray(lists.testOnly))
  ) {
    throw new Error(
      `${file} should be { "graduated": [ { "world": "<name or path>", "title": "<title>" } ], "testOnly": [ … ] }, "testOnly" for worlds the gate tests and the build does not ship.`,
    );
  }
  const seen = new Set();
  const read = (key) => (lists[key] ?? []).map((entry, i) => readEntry(file, key, entry, i, seen));
  return { graduated: read('graduated'), testOnly: read('testOnly') };
}

/** The worlds the build ships beside the pdx: `worlds.json`'s `graduated`, read as `readWorldLists` reads it. */
export function readGraduated(file = WORLDS_FILE) {
  return readWorldLists(file).graduated;
}

/** One entry of the list `key`, its world's name added to `seen`; throws as `readWorldLists` says. */
function readEntry(file, key, entry, i, seen) {
  if (
    typeof entry?.world !== 'string' ||
    entry.world === '' ||
    typeof entry.title !== 'string' ||
    entry.title === ''
  ) {
    throw new Error(
      `${file}: entry ${i + 1} of "${key}" needs a "world" and a "title", both text.`,
    );
  }
  const dir = entry.world.includes('/')
    ? resolve(root, entry.world)
    : join(root, 'corpus/good', entry.world);
  if (!existsSync(dir)) throw new Error(`${file}: the world "${entry.world}" is not at ${dir}.`);
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
}

/** The poll budget the app ships, read from src/budgets.h, the one place it is written. */
export function appPollSteps() {
  const header = readFileSync(join(player, 'src/budgets.h'), 'utf8');
  const match = /^#define PLAYER_POLL_STEPS (\d+)$/m.exec(header);
  if (match === null)
    throw new Error('sprout-player/src/budgets.h no longer defines PLAYER_POLL_STEPS.');
  return Number(match[1]);
}

/** A line a reader read, as `sproutc`'s trace and a script's `expect` both write one. */
const shownLine = (one) =>
  'reader' in one ? `${one.reader} (${one.kind}): ${one.words}` : one.words;

/**
 * The first step of `script` whose `expect` the trace `traced` (`sproutc play --trace`, one line a step)
 * does not meet, in words; null where every one is met. As `sprout test` holds a test, each line a step
 * expects must be among the lines readers read, in the order written: a reader's line whole, or the words
 * alone, which any reader's line matches; `[]` expects silence. A host's line, at its level, is not a
 * reader's, and `sproutc` does not write one, so it is not looked for.
 */
export function unmetExpectation(script, traced) {
  const says = new Map(
    traced
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line))
      .map((one) => [one.step, one.says]),
  );
  for (const [index, step] of script.steps.entries()) {
    if (!('expect' in step) || step.expect === undefined) continue;
    const said = says.get(index);
    if (said === undefined) return `step ${index + 1} did not play`;
    const wanted = step.expect.filter((one) => !('level' in one));
    if (step.expect.length === 0 && said.length > 0) {
      return `step ${index + 1} expects silence and said\n${said.map(shownLine).join('\n')}`;
    }
    let at = 0;
    for (const one of wanted) {
      const found = said.findIndex(
        (line, i) =>
          i >= at &&
          line.words === one.words &&
          (!('reader' in one) || (line.reader === one.reader && line.kind === one.kind)),
      );
      if (found < 0) {
        return `step ${index + 1} expects ${shownLine(one)}, and said\n${said.map(shownLine).join('\n') || '(nothing)'}`;
      }
      at = found + 1;
    }
  }
  return null;
}

/**
 * Plays each staged world's listed plays through `sproutc` over the cartridge `stageWorlds` packed,
 * the view polled before each command under the app's poll budget: every reading the runtime reads
 * must be offered, no turn may fault, and each step must say what the play expects of it
 * (`unmetExpectation`). Returns one line of what ran; throws naming the first play that did not.
 */
export function checkPlays(staged, sproutcDir, scratch, prefix = []) {
  const steps = appPollSteps();
  let count = 0;
  let widest = 0;
  for (const { dir, cartridge, plays, title } of staged) {
    for (const play of plays) {
      const script = join(dir, play);
      const trace = join(scratch, `${basename(dir)}-${basename(play)}.trace`);
      const args = [
        'play',
        cartridge,
        '--script',
        script,
        '--trace',
        trace,
        '--offered',
        '--poll-steps',
        String(steps),
      ];
      const [command, ...before] = [...prefix, join(sproutcDir, 'sproutc')];
      const done = spawnSync(command, [...before, ...args], {
        encoding: 'utf8',
        maxBuffer: 1 << 28,
      });
      const failed =
        done.status !== 0
          ? (done.stderr || done.stdout || `exit ${done.status}`).trim()
          : (/^!! .*$/m.exec(done.stdout)?.[0] ??
            unmetExpectation(
              readScript(readFileSync(script, 'utf8'), play),
              readFileSync(trace, 'utf8'),
            ));
      if (failed !== null) {
        throw new Error(`${title}: ${play} through the app's view and sproutc:\n${failed}`);
      }
      count++;
      widest = Math.max(
        widest,
        Number(/^--- offered: .* the widest poll (\d+) steps$/m.exec(done.stdout)?.[1] ?? 0),
      );
    }
  }
  return count === 0
    ? 'no plays listed for the listed worlds'
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
 * An index of two corpus cartridges that the built CLI's `sprout index` signs, under a key its
 * `sprout keygen` makes, in `scratch`: the C tests check the app accepts it. `given`, the paths of
 * an index and its public key made elsewhere (the e2e's, by the installed CLI), is used in its place.
 */
async function signedIndex(scratch, cartridges, given) {
  if (given !== undefined) return given;
  const { main } = await import(pathToFileURL(join(root, 'cli/dist/cli.js')).href);
  const folder = join(scratch, 'to-publish');
  mkdirSync(folder);
  for (const name of ['chip-tree', 'media-room']) {
    copyFileSync(join(cartridges, `${name}.sproutworld`), join(folder, `${name}.sproutworld`));
  }
  let said = '';
  const io = {
    stdout: { write: (text) => ((said += text), true) },
    stderr: { write: (text) => ((said += text), true) },
    stdin: process.stdin,
  };
  const prefix = join(scratch, 'publisher');
  const index = join(scratch, 'published', 'index.json');
  const base = 'https://worlds.example/sprout/';
  if (
    main(['keygen', prefix], io) !== 0 ||
    main(['index', folder, '--base-url', base, '--key', `${prefix}.key`, '-o', index], io) !== 0
  ) {
    throw new Error(`sprout keygen and sprout index did not sign an index:\n${said}`);
  }
  return { index, key: `${prefix}.pub` };
}

/**
 * Packs the worlds of `list` (the graduated ones unless given) into the folder `out` with the built
 * CLI, each as one `<name>.sproutworld` that carries its pictures, replacing what was there. Returns
 * the list it packed, each entry with `cartridge`, the path of its packed file.
 */
export async function stageWorlds({ list = readGraduated(), out }) {
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
  return list.map((entry) => ({ ...entry, cartridge: join(out, entry.file) }));
}

/** The file holding the public key the download screen trusts: SPROUT_INDEX_PUBLIC_KEY's, else the publisher's. */
export function publicKeyFile(env = process.env) {
  return resolve(env.SPROUT_INDEX_PUBLIC_KEY || PUBLISHER_PUBLIC_KEY);
}

/**
 * Reads the key the download screen trusts from the file named by `keyFile` (64 hexadecimal
 * digits, as `sprout keygen` writes), for the build to bake in. Returns
 * the path of the file read and whether it is the test key; throws, saying what to write, for a
 * file that holds anything else.
 */
export function readPublicKey({ keyFile = publicKeyFile() } = {}) {
  const key = readFileSync(keyFile, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/.test(key)) {
    throw new Error(
      `${keyFile} should hold the public key as 64 lowercase hexadecimal digits and nothing else.`,
    );
  }
  return { keyFile, isTest: resolve(keyFile) === TEST_PUBLIC_KEY };
}

/**
 * Removes what an earlier build left in Source/: the binaries the pdx is made from. Throws where
 * Source/ holds a cartridge, since the pdx carries no worlds.
 */
function clearBinaries() {
  for (const name of readdirSync(pdxSource)) {
    if (name.startsWith('pdex.')) rmSync(join(pdxSource, name), { force: true });
  }
  noWorlds(pdxSource);
}

/** Throws where `folder` holds a cartridge at any depth: neither Source/ nor the pdx carries a world. */
export function noWorlds(folder) {
  const world = readdirSync(folder, { recursive: true }).find((name) =>
    String(name).endsWith('.sproutworld'),
  );
  if (world !== undefined) {
    throw new Error(
      `${join(folder, String(world))} is a cartridge, and the pdx carries no worlds: delete it. The build packs the graduated worlds beside the pdx.`,
    );
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
 * through the MinGW cross compiler. A Simulator build is given `cartridges` for its tests, and
 * without them builds only the library, as the Windows one always does, since the tests are native
 * programs. `keyFile` is the public key the download screen bakes in.
 */
function build(dir, { device, windows, cartridges, sanitize, keyFile = publicKeyFile() }) {
  const sdk = sdkPath();
  const args = [
    '-S',
    player,
    '-B',
    dir,
    '-DCMAKE_BUILD_TYPE=Release',
    `-DPLAYER_INDEX_PUBLIC_KEY_FILE=${resolve(keyFile)}`,
  ];
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
  const target = !device && cartridges === undefined ? ['--target', 'sprout-player'] : [];
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
 * Puts the binary a build tree wrote into Source/ as `pdex`, where pdc packages it. The
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
 * Windows, pdex.bin where arm-none-eabi-gcc is; and the graduated worlds' cartridges in
 * `<out>/worlds`, apart from it. Returns the pdx, the binaries it carries and the cartridges.
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
  const worlds = join(out, 'worlds');
  const staged = await stageWorlds({ out: worlds });
  const key = readPublicKey();
  if (key.isTest) {
    console.warn(
      'This pdx trusts the test public key (sprout-player/test/index-test.pub), whose private half is in the repository, so anyone can sign an index it accepts. Unset SPROUT_INDEX_PUBLIC_KEY to trust the publisher key (sprout-player/publisher.pub) in a build you give to anyone else.',
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
  packagePdx(sdk, pdxSource, pdx, binaries);
  return { pdx, binaries, skipped, worlds, cartridges: staged.map(({ file }) => file) };
}

/** Runs pdc over `source` into `pdx`; throws where a binary in `binaries` was not packaged or the pdx holds a world. */
function packagePdx(sdk, source, pdx, binaries) {
  rmSync(pdx, { recursive: true, force: true });
  run(join(sdk, 'bin/pdc'), ['-sdkpath', sdk, source, pdx]);
  for (const name of binaries) {
    if (!existsSync(join(pdx, name))) throw new Error(`pdc did not package ${name} into ${pdx}`);
  }
  pureC(pdx);
  noWorlds(pdx);
}

/**
 * Throws where the pdx holds compiled script (a `.pdz`): the app is C, and the system runs the
 * update callback main.c sets only where there is no script to run instead.
 */
function pureC(pdx) {
  const script = readdirSync(pdx, { recursive: true }).find((name) =>
    String(name).endsWith('.pdz'),
  );
  if (script !== undefined) throw new Error(`the pdx ${pdx} holds compiled script: ${script}`);
}

/**
 * The gate's part. Returns one line saying which parts ran; throws with the failing command's words.
 * The graduated worlds are packed into a scratch folder apart from the pdx, which the C tests read
 * as PLAYER_SHIPPED_DIR, and the test-only worlds into another, PLAYER_TEST_WORLDS_DIR; the listed
 * plays of both are played there.
 * With `sanitize` the Simulator target and its tests are built under AddressSanitizer and
 * UndefinedBehaviorSanitizer, from the cartridges the sanitized runtime build packed, and any report
 * fails; the device target is not built then. The sanitized tests and `sproutc` run behind the
 * address-space launcher of player/src/aslr.ts, whose line check-runtime-c.mjs has printed.
 * `signed`, `{ index, key }`, names an index and public key for the C tests to accept in place of
 * the one the built CLI signs.
 */
export async function checkPlayer({ sanitize = false, signed } = {}) {
  const ran = [];
  const prefix = sanitize ? sanitizedHere().prefix : [];
  const scratch = mkdtempSync(join(tmpdir(), 'sprout-player-'));
  try {
    ran.push(shippingSpecs());
    const lists = readWorldLists();
    const worlds = join(scratch, 'worlds');
    const staged = await stageWorlds({ list: lists.graduated, out: worlds });
    const testWorlds = join(scratch, 'test-worlds');
    const stagedTests = await stageWorlds({ list: lists.testOnly, out: testWorlds });
    clearBinaries();
    const cartridges = join(sanitize ? `${runtimeCBuild}-sanitize` : runtimeCBuild, 'cartridges');
    if (!existsSync(cartridges))
      throw new Error('runtime-c has not packed the corpus cartridges yet');
    const dir = build(join(scratch, 'simulator'), {
      device: false,
      cartridges,
      sanitize,
      keyFile: TEST_PUBLIC_KEY,
    });
    const pdx = join(dir, 'sprout-player.pdx');
    for (const file of ['pdxinfo', 'pdex.so']) {
      if (!existsSync(join(pdx, file))) throw new Error(`the pdx has no ${file}`);
    }
    pureC(pdx);
    noWorlds(pdx);
    ran.push(sanitize ? 'Simulator pdx built under the sanitizers' : 'Simulator pdx built');

    const keep = join(scratch, 'keep');
    mkdirSync(keep);
    const published = await signedIndex(scratch, cartridges, signed);
    const tests = run(
      'ctest',
      ['--test-dir', dir, '--output-on-failure'],
      {
        PLAYER_KEEP_DIR: keep,
        PLAYER_SHIPPED_DIR: worlds,
        PLAYER_TEST_WORLDS_DIR: stagedTests.length > 0 ? testWorlds : '',
        PLAYER_SIGNED_INDEX: published.index,
        PLAYER_SIGNED_INDEX_KEY: published.key,
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
      'stack',
      'pd_host',
      'budgets',
      'told',
      'savelog',
      'session',
      'turns',
      'seen',
      'played',
      'wrap',
      'transcript',
      'ui',
      'builder_disc',
      'builder_sentence',
      'builder_crank',
      'disc',
      'gallery',
      'pictures',
      'sound',
      'canonical',
      'signed_index',
      'shelf',
      'nickname',
      'clock',
      'net',
      'downloads',
      'text_size',
      'pen',
      'wheel',
    ];
    const missing = wanted.filter((name) => !new RegExp(`player-${name} .*Passed`).test(tests));
    if (missing.length > 0) {
      throw new Error(`ctest did not pass the player's tests ${missing.join(', ')}:\n${tests}`);
    }
    ran.push(`${wanted.length} C test programs passed`);
    ran.push(
      signed === undefined
        ? 'the app accepts an index the built CLI signed'
        : `the app accepts the index at ${signed.index}`,
    );
    ran.push(
      `the app shelves and opens the ${counted(staged.length, 'graduated world')} and the ${counted(stagedTests.length, 'test-only world')}`,
    );

    const sproutcDir = sanitize ? `${runtimeCBuild}-sanitize` : runtimeCBuild;
    ran.push(roundTrip(keep, cartridges, sproutcDir, prefix));
    ran.push(builtMatchesTyped(keep, cartridges, sproutcDir, prefix));
    ran.push(checkPlays([...staged, ...stagedTests], sproutcDir, scratch, prefix));

    if (sanitize) {
      ran.push('device target not built under the sanitizers');
    } else if (has('arm-none-eabi-gcc')) {
      build(join(scratch, 'device'), { device: true, keyFile: TEST_PUBLIC_KEY });
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

/** `n` and `thing`, plural where `n` is not one. */
const counted = (n, thing) => `${n} ${thing}${n === 1 ? '' : 's'}`;

/** Runs the specs of the shipping scripts (the graduated list, the world sync); one line of what ran. */
export function shippingSpecs() {
  const specs = ['playdate-player.spec.mjs', 'sync-world.spec.mjs'].map((name) =>
    join(root, 'scripts', name),
  );
  run(process.execPath, ['--test', ...specs]);
  return 'shipping script specs passed';
}

/** The save the session's end-to-end test wrote is read and written back by `sproutc` byte for byte. */
function roundTrip(keep, cartridges, buildDir, prefix) {
  const sproutc = join(buildDir, 'sproutc');
  const save = join(keep, 'chip-tree.save.json');
  if (!existsSync(save)) throw new Error('the played test left no save to play through sproutc');
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
 * The turns the session's end-to-end test built from readings, as the sentence builder hands them over, leave the stored
 * world the same lines typed leave: each save is compared with the save `sproutc` leaves when it
 * plays the lines typed. `tune` declares its value role first and a parser binds it last; `take`
 * leaves a role out.
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
    if (!existsSync(builtPath)) throw new Error(`the played test left no ${built} to compare`);
    const cartridge = join(cartridges, `${world}.sproutworld`);
    const script = join(keep, `${world}.typed.json`);
    writeFileSync(
      script,
      JSON.stringify({
        steps: [{ arrive: 'player' }, ...lines.map((type) => ({ as: 'player', type }))],
      }),
    );
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
    console.log(`pdx: ${built.pdx} (it carries no worlds)`);
    console.log(`carries: ${built.binaries.join(', ')}`);
    if (built.skipped.length > 0) console.log(`not built: ${built.skipped.join(', ')}`);
    console.log(`worlds: ${built.worlds}/ (${built.cartridges.join(', ')})`);
    console.log(
      "Install a world by copying its .sproutworld into Data/social.overstory.sprout-player/worlds/ on the console's data disk (the Simulator's Disk folder holds the same Data/).",
    );
    console.log(`Open it:  "$PLAYDATE_SDK_PATH/bin/PlaydateSimulator" "${built.pdx}"`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
