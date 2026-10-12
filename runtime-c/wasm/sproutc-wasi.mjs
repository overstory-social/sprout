#!/usr/bin/env node
// `sproutc`, built for wasm32-wasip1, run under Node's WASI: the same arguments, the same
// standard streams and exit code as the native build, with the host's file system seen from `/`.
//
//   node runtime-c/wasm/sproutc-wasi.mjs <sproutc.wasm> <sproutc arguments…>

import { readFileSync } from 'node:fs';
import { WASI } from 'node:wasi';

const [wasmFile, ...args] = process.argv.slice(2);
const wasi = new WASI({
  version: 'preview1',
  args: ['sproutc', ...args],
  env: {},
  preopens: { '/': '/' },
  returnOnExit: true,
});
const module = await WebAssembly.compile(readFileSync(wasmFile));
const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
process.exitCode = wasi.start(instance);
