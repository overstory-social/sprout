# @overstory/sprout-engine-wasm

Sprout's C engine (`runtime-c/`) built for WebAssembly, as one world's
`Engine` for a host that runs on `@overstory/sprout/core`: every turn,
poll and question a host asks of the world runs in one instance of the
engine, which keeps the world's state live between turns.

```ts
import { emitCartridge, loadCartridge } from '@overstory/sprout/lang';
import { wasmEngine } from '@overstory/sprout-engine-wasm';

const cartridge = emitCartridge(bundle);
const catalogue = loadCartridge(cartridge, { caps });
const host = { catalogue, budgets, engine: wasmEngine({ cartridge, catalogue, budgets }) };
// runCommand(store, id, host, command), runView(…), new Ticker().round(…), … as with any engine.
```

`sprout-server` runs every world it serves on it, as the `sprout` command
does.

## The module

The package ships `engine.wasm`, which its build makes with
`runtime-c/wasm/build.sh`. That needs clang with the wasm32 target and
wasm-ld (wasi-sdk has both); without them the build fails with one error
that names what is missing and how to install it, and leaves no
`engine.wasm`. An installed package without it has `engineBuilt()`
false, and `wasmEngine` refuses in `NOT_BUILT`'s words.

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
  commands, lines and intents, ticks, wakes, catch-up, arrival,
  departure, nicknames, the log and its replay, the view in whole and in
  parts with the cache, rounds of ticks, and the host's questions.
- The frozen goldens (`runtime-c/wasm/engine.test.mjs`, in the gate's C
  step): every corpus world opens empty to the state
  `corpus/goldens/stored-worlds.json` holds, and every transcript plays
  as it expects, its stored world after each pinned step the golden's.

Nothing is listed as failing. What it does not do, by design:

- `Engine.command` takes a typed line, as lang's `Command` is; a reading
  built from a view's chips is run through `WasmInstance.command`.
- A turn's wall-clock backstop reads the process's clock.
