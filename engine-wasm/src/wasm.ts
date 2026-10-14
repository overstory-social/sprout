import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The engine's module this package ships: `engine.wasm`, built by
// runtime-c/wasm/build.sh into the package's folder when it is built
// where clang with the wasm32 target and wasm-ld are found, and absent
// where they are not. A host asks whether it is there before naming the
// WebAssembly engine, and is told in words where it is not.

/** Where the shipped `engine.wasm` is, beside `src/` and `dist/` alike. */
export const ENGINE_WASM = fileURLToPath(new URL('../engine.wasm', import.meta.url));

/** What a host is told when it names the WebAssembly engine and this package was built without it. */
export const NOT_BUILT =
  'The WebAssembly engine is not built: @overstory/sprout-engine-wasm has no engine.wasm, which its build makes only where clang with the wasm32 target and wasm-ld are found (`npm run build -w engine-wasm`).';

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
