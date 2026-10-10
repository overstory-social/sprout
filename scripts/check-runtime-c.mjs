// Configures, builds and tests runtime-c/ (CMake, C11, ctest), and prints one
// line of the result. With no C compiler, cmake or ctest it prints one line
// saying what is missing and skips, unless `--required` is given (the e2e
// does), which makes the missing tool a failure. It never skips silently.
//
// With `--sanitize` it configures a second build directory with
// -DSPROUT_SANITIZE=ON (AddressSanitizer and UndefinedBehaviorSanitizer) and
// runs only ctest there, with halt_on_error and leak detection on, so any
// report fails the script. The gate keeps the plain build to stay fast; the
// e2e runs the sanitized one.
//
// Run `npm run build` first: the C tests pack every corpus world into a
// cartridge through the built CLI (`cli/dist`), and the replay uses the built
// player. Without it the packing setup fails and the tests that need it do not run.
//
// After the unit tests it runs the replay (scripts/replay-runtime-c.mjs):
// every corpus world with transcripts is packed, its scripts resolved by the
// TypeScript parser, played through `sproutc`, and diffed with the transcript
// the TypeScript runtime wrote. It prints one line per world and the list of
// worlds that pass, and fails when that list is not EXPECTED_PASSING. Each
// later runtime item adds the worlds its change brings in here.

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { runtimeCBuild as build, runtimeCRoot as root } from './runtime-c-build.mjs';

const required = process.argv.includes('--required');
const sanitize = process.argv.includes('--sanitize');

// The corpus worlds whose transcripts the C runtime replays to the byte, sorted.
// Today none does: the runtime's load and turn are declared and not built.
const EXPECTED_PASSING = [];

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

if (sanitize) {
  const dir = `${build}-sanitize`;
  run('cmake', ['-S', root, '-B', dir, '-DCMAKE_BUILD_TYPE=Debug', '-DSPROUT_SANITIZE=ON'], { CC: compiler });
  run('cmake', ['--build', dir]);
  const sanitized = run('ctest', ['--test-dir', dir, '--output-on-failure'], {
    ASAN_OPTIONS: 'halt_on_error=1:detect_leaks=1:abort_on_error=0',
    UBSAN_OPTIONS: 'halt_on_error=1:print_stacktrace=1',
  });
  const line = sanitized.split('\n').find((l) => /tests passed/.test(l)) ?? 'ctest ran';
  console.log(`runtime-c (sanitized): ${compiler}, ${line.trim()}`);
  process.exit(0);
}

run('cmake', ['-S', root, '-B', build, '-DCMAKE_BUILD_TYPE=Debug'], { CC: compiler });
run('cmake', ['--build', build]);
const out = run('ctest', ['--test-dir', build, '--output-on-failure']);
const summary = out.split('\n').find((line) => /tests passed/.test(line)) ?? 'ctest ran';
console.log(`runtime-c: ${compiler}, ${summary.trim()}`);

// `sproutc play` on a packed corpus world prints the cartridge's header and manifest.
const sproutc = join(build, 'sproutc');
const scratch = join(build, 'replay');
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });

let tools;
try {
  tools = await import('./replay-runtime-c.mjs');
} catch (err) {
  console.log(`runtime-c: FAILED to load the replay (run \`npm run build\` first): ${err.message}`);
  process.exit(1);
}

const headerWorld = 'arrival-order';
tools.packWorld(join('corpus/good', headerWorld), join(scratch, 'header.sproutworld'));
const header = spawnSync(sproutc, ['play', join(scratch, 'header.sproutworld')], {
  encoding: 'utf8',
});
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

const results = tools.replayWorlds(sproutc, scratch);
for (const result of results) {
  const words = result.words.replace(/\s*\n\s*/g, ' / ');
  console.log(`runtime-c replay: ${result.name}: ${result.passed ? 'passes' : 'fails'}, ${words}`);
}
const views = tools.replayViews(sproutc, scratch);
const unlike = views.filter((r) => !r.passed);
console.log(
  `runtime-c view: ${views.length - unlike.length} of ${views.length} worlds print the page \`sprout view\` prints`,
);
for (const r of unlike)
  console.log(`runtime-c view: ${r.name}: ${r.words.replace(/\s*\n\s*/g, ' / ')}`);
if (unlike.length > 0) {
  console.log(
    'runtime-c: FAILED, `sproutc view` prints another page than `sprout view` for the worlds above',
  );
  process.exit(1);
}
const passing = results.filter((r) => r.passed).map((r) => r.name);
console.log(
  `runtime-c replay: ${passing.length} of ${results.length} worlds pass${passing.length > 0 ? `: ${passing.join(', ')}` : ''}`,
);
if (passing.join(',') !== EXPECTED_PASSING.join(',')) {
  console.log(
    `runtime-c: FAILED, the worlds that pass are not the expected ones (expected: ${EXPECTED_PASSING.join(', ') || 'none'}); update EXPECTED_PASSING in scripts/check-runtime-c.mjs if the change is meant`,
  );
  process.exit(1);
}
