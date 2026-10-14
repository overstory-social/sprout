// Builds the engine's module for this package: runtime-c/wasm/build.sh,
// whose engine.wasm is copied beside dist/. Every tool, sprout-mcp and
// sprout-server run worlds on that module, so a machine without clang's
// wasm32 target or wasm-ld fails this build with one error that names what
// is missing and how to install it (`missingToolchain`), and leaves no
// engine.wasm behind.

import { spawnSync } from 'node:child_process';
import { accessSync, constants, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const run = (command, args) => spawnSync(command, args, { encoding: 'utf8' });

/** Where `name` is on PATH, or null. A spawn error alone cannot say: an unreadable PATH folder gives EACCES for a tool that is nowhere. */
function onPath(name) {
  for (const folder of (process.env.PATH ?? '').split(delimiter)) {
    try {
      accessSync(join(folder, name), constants.X_OK);
      return join(folder, name);
    } catch {
      // not here
    }
  }
  return null;
}

/** Why `name` did not run, in words: not on PATH, or on it and refused. */
function notRun(name, error) {
  const found = onPath(name);
  return found === null
    ? `${name} (not found on PATH)`
    : `${name} (${found} could not be run: ${error.code})`;
}

/** What clang said of its targets, in a few words, when it has no wasm32 one; null when it has. */
function clangLacksWasm32() {
  const targets = run('clang', ['--print-targets']);
  if (targets.error) return notRun('clang', targets.error);
  if (targets.status !== 0) {
    const said =
      `${targets.stderr ?? ''}${targets.stdout ?? ''}`.trim().split('\n')[0] ||
      `exit ${targets.status}`;
    return `clang with the wasm32 target (\`clang --print-targets\` failed: ${said})`;
  }
  if (/^\s*wasm32\b/m.test(targets.stdout)) return null;
  const names = [...targets.stdout.matchAll(/^\s+(\S+)\s+-\s/gm)].map((m) => m[1]);
  const listed = names.length > 0 ? `lists only ${names.join(', ')}` : 'lists no targets';
  return `clang with the wasm32 target (the clang on PATH ${listed})`;
}

/** Whether wasm-ld runs, in words when it does not; null when it does. */
function wasmLdMissing() {
  const ld = run('wasm-ld', ['--version']);
  if (ld.error) return notRun('wasm-ld', ld.error);
  if (ld.status !== 0) return `wasm-ld (\`wasm-ld --version\` failed, exit ${ld.status})`;
  return null;
}

/** The one error a machine without the toolchain is told, or null when it has it. */
function missingToolchain() {
  const missing = [clangLacksWasm32(), wasmLdMissing()].filter((one) => one !== null);
  if (missing.length === 0) return null;
  return [
    `engine-wasm: FAILED, cannot build engine.wasm, the WebAssembly engine that the sprout command, sprout-mcp and sprout-server run every world on.`,
    `  Missing: ${missing.join('; ')}.`,
    `  To fix: install wasi-sdk 25 or later (https://github.com/WebAssembly/wasi-sdk/releases) and put its bin/ folder first on PATH,`,
    `  or install LLVM 18 or later with the wasm32 target and lld (which provides wasm-ld); then run \`npm run build\` again.`,
  ].join('\n');
}

const missing = missingToolchain();
if (missing !== null) {
  rmSync(join(here, 'engine.wasm'), { force: true });
  console.error(missing);
  process.exit(1);
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
