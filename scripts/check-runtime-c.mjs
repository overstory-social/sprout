// Configures, builds and tests runtime-c/ (CMake, C11, ctest), and prints one
// line of the result. With no C compiler, cmake or ctest it prints one line
// saying what is missing and skips, unless `--required` is given (the e2e
// does), which makes the missing tool a failure. It never skips silently.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const required = process.argv.includes('--required');
const root = join(fileURLToPath(import.meta.url), '../../runtime-c');
// Built outside the repository, one folder per checkout, so lint and prettier never see it.
const build = join(
  tmpdir(),
  `sprout-runtime-c-${createHash('sha256').update(root).digest('hex').slice(0, 12)}`,
);

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

run('cmake', ['-S', root, '-B', build, '-DCMAKE_BUILD_TYPE=Debug'], { CC: compiler });
run('cmake', ['--build', build]);
const out = run('ctest', ['--test-dir', build, '--output-on-failure']);
const summary = out.split('\n').find((line) => /tests passed/.test(line)) ?? 'ctest ran';
console.log(`runtime-c: ${compiler}, ${summary.trim()}`);
