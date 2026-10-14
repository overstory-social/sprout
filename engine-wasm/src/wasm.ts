import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The engine's module this package ships: `engine.wasm`, built by
// runtime-c/wasm/build.sh into the package's folder, whose build fails
// without it. A host whose installed package has none is told so in
// `NOT_BUILT`'s words.

/** Where the shipped `engine.wasm` is, beside `src/` and `dist/` alike. */
export const ENGINE_WASM = fileURLToPath(new URL('../engine.wasm', import.meta.url));

/** What a host is told when it names the WebAssembly engine and this package has no engine.wasm. */
export const NOT_BUILT =
  'The WebAssembly engine is not built: @overstory/sprout-engine-wasm has no engine.wasm. Its build (`npm run build -w engine-wasm`) makes it, and needs clang with the wasm32 target and wasm-ld (wasi-sdk has both).';

/** Whether this package has its `engine.wasm`. */
export function engineBuilt(): boolean {
  return existsSync(ENGINE_WASM);
}

let compiled: WebAssembly.Module | null = null;

/** The shipped engine, compiled once for the process; thrown, in `NOT_BUILT`'s words, where it is not built. */
export function shippedModule(): WebAssembly.Module {
  if (compiled !== null) return compiled;
  if (!engineBuilt()) throw new Error(NOT_BUILT);
  compiled = new WebAssembly.Module(readFileSync(ENGINE_WASM));
  return compiled;
}
