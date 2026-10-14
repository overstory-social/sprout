// Specs for build-wasm.mjs: without clang's wasm32 target or wasm-ld the build
// fails with one error naming what is missing, what it is for and how to
// install it. Each case runs a copy of the script in a folder of its own, with
// a PATH holding only the fake tools the case gives it.

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./build-wasm.mjs', import.meta.url));

const X86_TARGETS = `
  Registered Targets:
    x86    - 32-bit X86: Pentium-Pro and above
    x86-64 - 64-bit X86: EM_X86_64
`;
const WASM_TARGETS = `
  Registered Targets:
    wasm32 - WebAssembly 32-bit
    wasm64 - WebAssembly 64-bit
`;

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** Runs the script with a PATH of only `tools` (name → shell body), beside a stale engine.wasm. */
function build(tools: Record<string, string>) {
  const folder = mkdtempSync(join(tmpdir(), 'sprout-build-wasm-spec-'));
  folders.push(folder);
  const bin = join(folder, 'bin');
  mkdirSync(bin);
  for (const [name, body] of Object.entries(tools)) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const script = join(folder, 'build-wasm.mjs');
  copyFileSync(SCRIPT, script);
  writeFileSync(join(folder, 'engine.wasm'), 'stale');
  const done = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { PATH: bin } });
  return {
    status: done.status,
    stderr: done.stderr,
    stdout: done.stdout,
    stale: existsSync(join(folder, 'engine.wasm')),
  };
}

/** A shell body that prints `text` with builtins alone, since the PATH holds nothing else. */
const printing = (text: string) => `printf '%s\\n' '${text}'`;

describe('the engine build without its toolchain', () => {
  it('fails, naming both tools, what the engine is for, and wasi-sdk with its download page', () => {
    const done = build({});
    expect(done.status).toBe(1);
    expect(done.stderr).toContain('engine-wasm: FAILED, cannot build engine.wasm');
    expect(done.stderr).toContain(
      'the sprout command, sprout-mcp and sprout-server run every world on',
    );
    expect(done.stderr).toContain(
      'Missing: clang (not found on PATH); wasm-ld (not found on PATH).',
    );
    expect(done.stderr).toContain(
      'install wasi-sdk 25 or later (https://github.com/WebAssembly/wasi-sdk/releases)',
    );
    expect(done.stderr).toContain('put its bin/ folder first on PATH');
    expect(done.stderr).toContain('LLVM 18 or later with the wasm32 target and lld');
    expect(done.stdout).toBe('');
  });

  it('leaves no engine.wasm behind', () => {
    expect(build({}).stale).toBe(false);
  });

  it('names a clang without the wasm32 target by the targets it lists, and wasm-ld alone when only it is missing', () => {
    const noTarget = build({ clang: printing(X86_TARGETS), 'wasm-ld': 'echo LLD 19' });
    expect(noTarget.status).toBe(1);
    expect(noTarget.stderr).toContain(
      'Missing: clang with the wasm32 target (the clang on PATH lists only x86, x86-64).',
    );
    expect(noTarget.stderr).not.toContain('wasm-ld (');

    const noLinker = build({ clang: printing(WASM_TARGETS) });
    expect(noLinker.status).toBe(1);
    expect(noLinker.stderr).toContain('Missing: wasm-ld (not found on PATH).');
    expect(noLinker.stderr).not.toContain('clang with the wasm32 target (');
  });

  it("quotes clang's own words when it cannot list its targets", () => {
    const done = build({
      clang: "echo 'clang: error: unknown argument' >&2; exit 1",
      'wasm-ld': 'echo LLD 19',
    });
    expect(done.status).toBe(1);
    expect(done.stderr).toContain(
      'Missing: clang with the wasm32 target (`clang --print-targets` failed: clang: error: unknown argument).',
    );
  });
});
