/* The math the runtime calls, for a freestanding WebAssembly build: each is one instruction. */
#ifndef SPROUT_WASM_MATH_H
#define SPROUT_WASM_MATH_H
#define isfinite(x) __builtin_isfinite(x)
#define floor(x) __builtin_floor(x)
#define fabs(x) __builtin_fabs(x)
#endif
