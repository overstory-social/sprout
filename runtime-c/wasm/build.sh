#!/bin/sh
# Builds the runtime for WebAssembly with clang and wasm-ld (LLVM 18 or later), into `out/`:
#   engine.wasm   the runtime alone, freestanding: no WASI, libc.c for libc, one import (the clock)
#   libc.test.wasm  libc.c with its checks (libc.test.c), which engine.test.mjs runs
#   sproutc.wasm  the desktop host `sproutc`, for wasm32-wasip1, when WASI_SYSROOT names a wasi-sysroot
#                 (and WASI_BUILTINS its libclang_rt.builtins-wasm32.a), run by sproutc-wasi.mjs
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")
out=${OUT:-$here/out}
mkdir -p "$out"
cd "$root"
sources=$(ls src/*.c src/*/*.c)
warn="-std=c11 -O2 -mbulk-memory -Wall -Wextra -Werror -pedantic -Iinclude -Isrc"

# shellcheck disable=SC2086
clang --target=wasm32 $warn -ffreestanding -nostdlib -nostdlibinc -isystem wasm/libc \
  -isystem "$(clang -print-resource-dir)/include" $sources wasm/libc.c wasm/engine.c \
  -Wl,--no-entry -Wl,--stack-first -Wl,-z,stack-size=1048576 -o "$out/engine.wasm"
echo "built $out/engine.wasm"

# shellcheck disable=SC2086
clang --target=wasm32 $warn -ffreestanding -nostdlib -nostdlibinc -isystem wasm/libc \
  -isystem "$(clang -print-resource-dir)/include" wasm/libc.c wasm/libc.test.c \
  -Wl,--no-entry -Wl,--stack-first -o "$out/libc.test.wasm"
echo "built $out/libc.test.wasm"

if [ -n "${WASI_SYSROOT:-}" ]; then
  # shellcheck disable=SC2086
  clang --target=wasm32-wasip1 --sysroot="$WASI_SYSROOT" $warn $sources host/*.c -nodefaultlibs -lc \
    "$WASI_BUILTINS" -Wl,--stack-first -Wl,-z,stack-size=8388608 -o "$out/sproutc.wasm"
  echo "built $out/sproutc.wasm"
fi
