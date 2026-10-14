// Builds the engine's module for this package: runtime-c/wasm/build.sh,
// whose engine.wasm is copied beside dist/. Without clang's wasm32 target
// and wasm-ld it says so in one line and builds nothing, as the Playdate
// build does without its SDK, and the package then has no engine.wasm
// (src/wasm.ts says so to a host that names the engine).

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const has = (command, args) => spawnSync(command, args, { encoding: 'utf8' });

const targets = has('clang', ['--print-targets']);
if (
  targets.status !== 0 ||
  !/\bwasm32\b/.test(targets.stdout) ||
  has('wasm-ld', ['--version']).status !== 0
) {
  rmSync(join(here, 'engine.wasm'), { force: true });
  console.log(
    'engine-wasm: SKIPPED, clang with the wasm32 target and wasm-ld are needed to build engine.wasm; this build has no WebAssembly engine',
  );
  process.exit(0);
}

const out = mkdtempSync(join(tmpdir(), 'sprout-engine-wasm-'));
try {
  const built = spawnSync('sh', [join(here, '..', 'runtime-c', 'wasm', 'build.sh')], {
    encoding: 'utf8',
    env: { ...process.env, OUT: out },
  });
  if (built.status !== 0) {
    process.stdout.write(built.stdout ?? '');
    process.stderr.write(built.stderr ?? '');
    console.log('engine-wasm: FAILED to build engine.wasm');
    process.exit(1);
  }
  copyFileSync(join(out, 'engine.wasm'), join(here, 'engine.wasm'));
  console.log('engine-wasm: built engine.wasm');
} finally {
  rmSync(out, { recursive: true, force: true });
}
