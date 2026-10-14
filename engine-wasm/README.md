# @overstory/sprout-engine-wasm

Sprout's C engine (`runtime-c/`) built for WebAssembly, as one world's
`Engine` for a host that runs on `@overstory/sprout/core`: every turn,
poll and question a host asks of the world runs in one instance of the
engine, which keeps the world's state live between turns.

```ts
import { emitCartridge, loadCartridge } from '@overstory/sprout/lang';
import { engineBuilt, NOT_BUILT, wasmEngine } from '@overstory/sprout-engine-wasm';

if (!engineBuilt()) throw new Error(NOT_BUILT);
const cartridge = emitCartridge(bundle);
const catalogue = loadCartridge(cartridge, { caps });
const host = { catalogue, budgets, render, parse, engine: wasmEngine({ cartridge, catalogue, budgets }) };
// runCommand(store, id, host, command), runView(…), new Ticker().round(…), … as with any engine.
```

`sprout-server` runs every world it serves on it, as the `sprout` command
does.

## The module

The package ships `engine.wasm`, which its build makes with
`runtime-c/wasm/build.sh` where clang with the wasm32 target and wasm-ld
are found (wasi-sdk has both). Where they are not, the build says so in
one line and the package has no `engine.wasm`: `engineBuilt()` is false,
`wasmEngine` refuses in `NOT_BUILT`'s words, and the package's specs that
need it are skipped under those words.

## Its live state

The instance keeps the world's state live, and notes which stored state
that is: the one it last opened, or the one core read back once a commit
landed (`Engine.landed`). A turn or a poll handed that stored state runs
on the live state as it is; any other — another value, or one whose
serial differs — is opened afresh from its records first, so nothing runs
on a live state the store has moved past. A store that hands back the
same value until it changes, as the memory store does, has every turn
after a commit run without opening; one that reads afresh each time has
every turn opened from its records, which is correct and slower.

Every entry is made at debug depth, and core keeps it at the host's.

## What it passes

- Core's engine conformance suite (`@overstory/sprout/engine-conformance`):
  every case the TypeScript engine passes — commands, lines and intents,
  ticks, wakes, catch-up, arrival, departure, nicknames, the log, the
  view in whole and in parts with the cache, rounds of ticks, and the
  host's questions.
- The corpus differential (`src/differential.spec.ts`): every script of
  every `corpus/good` world, played through core over both engines, gives
  the same turns, log, stored world, polls and questions after every
  step.

Nothing is listed as failing. What it does not do, by design:

- It runs the steps a line planned only for lines it handed out itself:
  a `Command` carrying another engine's `planned` reading is refused in
  words.
- `Engine.command` takes a typed line, as lang's `Command` is; a reading
  built from a view's chips is run through `WasmInstance.command`.
- A turn's wall-clock backstop reads the process's clock, not the host's
  `clock`.
