// Configures, builds and tests runtime-c/ (CMake, C11, ctest), and prints one
// line of the result. With no C compiler, cmake or ctest it prints one line
// saying what is missing and skips, unless `--required` is given (the e2e
// does), which makes the missing tool a failure. It never skips silently.
//
// With `--sanitize` it configures a second build directory with
// -DSPROUT_SANITIZE=ON (AddressSanitizer and UndefinedBehaviorSanitizer) and
// runs only ctest there, with halt_on_error and leak detection on, so any
// report fails the script. The gate keeps the plain build to stay fast; the
// e2e runs the sanitized one. On Linux the sanitized ctest runs under `setarch <machine> -R`
// when `setarch` is on the PATH, since AddressSanitizer's shadow memory clashes at random with
// high-entropy address-space randomisation; the script prints one line saying so, or the remedy
// (`setarch -R npm run e2e`) when `setarch` is missing (player/src/aslr.ts).
//
// Run `npm run build` first: the C tests pack every corpus world into a cartridge through the built CLI
// (`cli/dist`), and the WebAssembly step plays through the built player. Without it the packing setup fails
// and the tests that need it do not run.
//
// After the unit tests it checks that `sproutc play` prints a packed world's header and manifest. Then the
// WebAssembly step: runtime-c/wasm/build.sh builds the runtime for wasm32, and runtime-c/wasm/engine.test.mjs
// plays the corpus through it against the frozen goldens. Without clang's wasm32 target and wasm-ld the step
// is skipped, and its line says so.
//
// The last step, in both modes, is sprout-player/ (the Playdate app, scripts/playdate-player.mjs):
// the Simulator target built with the SDK, the player's C tests over a fake PlaydateAPI, the saves they
// wrote played through `sproutc`, and the graduated worlds' plays through `sproutc --offered`; with
// `--sanitize` the player's tests are built and run under the sanitizers too. The plain mode also builds
// the runtime optimised (-O2) under -Wall -Wextra -Werror, as the device and the shipped Simulator build
// do, and once more without the parser (-DSPROUT_PARSER=OFF), as the Playdate takes the runtime, running
// the one test that build has. The player step needs PLAYDATE_SDK_PATH (scripts/playdate-sdk.sh fetches
// the SDK); without it the step is skipped and the last line says so. Where the variable is set, a failing
// step fails this script, in the gate and in the e2e alike.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { runtimeCBuild as build, runtimeCRoot as root, sanitizedHere } from './runtime-c-build.mjs';

const required = process.argv.includes('--required');
const sanitize = process.argv.includes('--sanitize');

const has = (command) => spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0;

function skip(why) {
  const line = `runtime-c: ${required ? 'REQUIRED but' : 'skipped,'} ${why}`;
  console.log(line);
  process.exit(required ? 1 : 0);
}

const compiler = ['cc', 'gcc', 'clang'].find(has);
if (compiler === undefined) skip('no C compiler found (looked for cc, gcc, clang)');
if (!has('cmake')) skip('cmake not found');
if (!has('ctest')) skip('ctest not found');

function run(command, args, env) {
  const done = spawnSync(command, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  if (done.status !== 0) {
    process.stdout.write(done.stdout ?? '');
    process.stderr.write(done.stderr ?? '');
    console.log(`runtime-c: FAILED at \`${command} ${args.join(' ')}\``);
    process.exit(1);
  }
  return done.stdout;
}

/**
 * The runtime built for WebAssembly (runtime-c/wasm/build.sh) and checked against the frozen goldens
 * (runtime-c/wasm/engine.test.mjs). It needs clang with the wasm32 target and wasm-ld; without them it
 * is skipped, in words, as the Playdate step is without its SDK.
 */
async function wasmStep() {
  const targets = spawnSync('clang', ['--print-targets'], { encoding: 'utf8' });
  if (targets.status !== 0 || !/\bwasm32\b/.test(targets.stdout) || !has('wasm-ld')) {
    console.log(
      'runtime-c wasm: SKIPPED, clang with the wasm32 target and wasm-ld are needed to build the WebAssembly engine',
    );
    return;
  }
  const out = `${build}-wasm`;
  run('sh', [join(root, 'wasm', 'build.sh')], { OUT: out });
  const { testEngine } = await import('../runtime-c/wasm/engine.test.mjs');
  const checks = await testEngine(out);
  const failed = checks.filter((one) => !one.passed);
  for (const one of failed) console.log(`runtime-c wasm: ${one.name}: fails, ${one.words}`);
  console.log(
    `runtime-c wasm: ${checks.length - failed.length} of ${checks.length} checks pass against the frozen goldens`,
  );
  if (failed.length > 0) {
    console.log(
      'runtime-c: FAILED, the WebAssembly engine does not play the corpus as the goldens hold',
    );
    process.exit(1);
  }
}

/** The Playdate app, which is built on the runtime and plays the cartridges packed above. */
async function playerStep(sanitized) {
  const { checkPlayer, sdkPath } = await import('./playdate-player.mjs');
  if (sdkPath() === null) {
    console.log(
      'sprout-player: SKIPPED, PLAYDATE_SDK_PATH is not set to a Playdate SDK (`bash scripts/playdate-sdk.sh` fetches one): the Simulator build and the C tests of the player did not run',
    );
    return;
  }
  try {
    console.log(await checkPlayer({ sanitize: sanitized }));
  } catch (err) {
    console.log(`sprout-player: FAILED, ${err.message}`);
    process.exit(1);
  }
}

if (sanitize) {
  const dir = `${build}-sanitize`;
  run('cmake', ['-S', root, '-B', dir, '-DCMAKE_BUILD_TYPE=Debug', '-DSPROUT_SANITIZE=ON'], {
    CC: compiler,
  });
  run('cmake', ['--build', dir]);
  const launcher = sanitizedHere();
  if (launcher.line !== '') console.log(launcher.line);
  const [first, ...before] = [...launcher.prefix, 'ctest'];
  const sanitized = run(first, [...before, '--test-dir', dir, '--output-on-failure'], {
    ASAN_OPTIONS: 'halt_on_error=1:detect_leaks=1:abort_on_error=0',
    UBSAN_OPTIONS: 'halt_on_error=1:print_stacktrace=1',
  });
  const line = sanitized.split('\n').find((l) => /tests passed/.test(l)) ?? 'ctest ran';
  console.log(`runtime-c (sanitized): ${compiler}, ${line.trim()}`);
  await playerStep(true);
  process.exit(0);
}

run('cmake', ['-S', root, '-B', build, '-DCMAKE_BUILD_TYPE=Debug'], { CC: compiler });
run('cmake', ['--build', build]);
const out = run('ctest', ['--test-dir', build, '--output-on-failure']);
const summary = out.split('\n').find((line) => /tests passed/.test(line)) ?? 'ctest ran';
console.log(`runtime-c: ${compiler}, ${summary.trim()}`);

// The library alone, optimised, with every warning an error: what the device and the shipped
// Simulator build compile, which the debug build above does not catch.
const optimised = `${build}-optimised`;
run(
  'cmake',
  ['-S', root, '-B', optimised, '-DCMAKE_BUILD_TYPE=Release', '-DSPROUT_RUNTIME_TESTS=OFF'],
  { CC: compiler },
);
run('cmake', ['--build', optimised]);
console.log(`runtime-c (optimised): ${compiler}, -O2 under -Wall -Wextra -Werror builds clean`);

// The same without the parser, as the Playdate builds it: it builds clean, and a typed line is refused.
const unparsed = `${build}-no-parser`;
run('cmake', ['-S', root, '-B', unparsed, '-DCMAKE_BUILD_TYPE=Release', '-DSPROUT_PARSER=OFF'], {
  CC: compiler,
});
run('cmake', ['--build', unparsed, '--parallel', '--target', 'parse_command.test']);
run(join(unparsed, 'parse_command.test'), []);
console.log(
  `runtime-c (no parser): ${compiler}, -O2 builds clean without src/parse/, and every typed line is refused`,
);

// `sproutc play` on a packed corpus world prints the cartridge's header and manifest.
const headerWorld = 'arrival-order';
const header = spawnSync(
  join(build, 'sproutc'),
  ['play', join(build, 'cartridges', `${headerWorld}.sproutworld`)],
  { encoding: 'utf8' },
);
if (
  header.status !== 0 ||
  !/^name: arrival_order$/m.test(header.stdout) ||
  !/^files: 5$/m.test(header.stdout)
) {
  console.log(
    `runtime-c: FAILED, \`sproutc play\` did not print the header and manifest of ${headerWorld}`,
  );
  process.stdout.write(header.stdout + header.stderr);
  process.exit(1);
}

await wasmStep();
await playerStep(false);
