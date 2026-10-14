// @overstory/sprout-engine-wasm — the runtime's C engine, built for
// WebAssembly, as one world's `Engine` for a host that runs on core
// (the spec's The runtime; The host contract). The package ships the
// engine's module, `engine.wasm`, and a host whose installed package has
// none is refused in `NOT_BUILT`'s words. `WasmInstance` drives one
// instance of the module directly, as runtime-c's own checks do.

export * from './engine.js';
export * from './instance.js';
export * from './shapes.js';
export * from './wasm.js';
