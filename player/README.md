# @overstory/sprout-player

A Sprout microworld played from a script, through real turns over a
freshly loaded world: `sprout play dir script.json` prints it back with every step expecting what it made, and
`sprout test` checks an author's own tests against what the world says.
The player is a local host: it keeps the world's stored state as a store
would and runs every turn, poll and question through one engine, core's
`Engine` — the TypeScript runtime (`ts`) or the C runtime built for
WebAssembly (`wasm`), as the caller names it. `chooseEngine` is the
default a tool takes: `wasm` where `@overstory/sprout-engine-wasm` has its
module, and otherwise `ts`, with a line saying why.
`reportOf` counts what one or more scripts reached between them — the
lines misread, every fault, the places, objects, verbs, handlers and
passages reached of those the world declares, and the prose never
rendered — for `--report`; which handlers ran and which lines were
misread or refused are the engine's account of each turn, which only the
TypeScript engine gives yet, and are null in a report played on the other.
`resolveScript` writes a script's readings file, the TypeScript runtime's
record of it that the C runtime's replay is compared with, so it always
plays on that engine.
The [`sprout` command](../cli/README.md) is how most people run it; the
script format is described there.

```ts
import { playScript, readScript, runTests, writeScript } from '@overstory/sprout-player';

const played = playScript(bundle, readScript(text, 'walk.json'), 'walk.json', 'wasm');
process.stdout.write(writeScript(played));
```

A script is JSON: steps of what visitors type and what the host does,
each of which may expect what it should make. `script.ts` holds the
format, and the typed line grammar an interactive session reads into the
same steps.

It also stands one visitor in a world as it loads, which the CLI's
inspectors (`sprout parse`, `sprout view`) look through.

`./fixtures` holds the worlds this package's specs play, and helpers to
write a script as typed lines and read one as a transcript, for the specs
of the packages built on it; no command imports it.

MIT. Imports `@overstory/sprout/lang`, `@overstory/sprout/core`,
`@overstory/sprout-engine-wasm` and `node:*` only, and none of the
language's turns, polls or state.
