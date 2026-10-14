// @overstory/sprout-engine-wasm — the runtime's C engine, built for
// WebAssembly, as one world's `Engine` for a host that runs on core
// (the spec's The runtime; The host contract). The package ships the
// engine's module, `engine.wasm`, where its build found the toolchain;
// a host asks `engineBuilt()` before naming it. `WasmInstance` drives one
// instance of the module directly, as runtime-c's own checks do.

export * from './engine.js';
export * from './instance.js';
export * from './shapes.js';
export * from './wasm.js';
