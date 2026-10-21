# Sprout

A small, total, deterministic language for multiplayer interactive-fiction
worlds, and the runtime that hosts them. A world is places, the objects in
them, and the kinds those objects are made of; visitors type or tap, and the
world answers in prose. It is being built to
[`docs/design/sprout-design-spec.md`](docs/design/sprout-design-spec.md),
which is the language whole and the authority where anything disagrees.

**New to Sprout?** Start with [the manual](docs/manual/README.md): what
Sprout is, how to play a world from the terminal, a quickstart that
builds a first world, the language reference, serving a world, and
playing on the Playdate.

```sprout
import * as sprout from 'sprout'
import {Creature} from 'creature'

world printers_shop is sprout.World {
  visitors are Creature
  visitors arrive at composing_room
  :season Season default autumn
}

enum Season { spring, summer, autumn, winter }
message :stir
```

The compiler (`sprout/lang`) reads a whole world — its manifest, its
`.sprout` and `.prose` files and the libraries it vendors — into a closed
bundle and its cartridge, checking every declaration, expression and
passage against the spec. The engine (`runtime-c/`, C11) runs a cartridge:
it reads a visitor's typed line as a reading, runs it as a turn, answers
the engine verbs (`go`, `look`, `examine`, `inventory`, `wait`, `help`),
gives back what every turn said as one ordered sequence of effects, each
rendered for the one person who reads it, and polls a visitor's view:
their place, its ways out, who is there, what they carry, and every
reading they could make. Every host runs that one engine: the `sprout`
command and the server through its WebAssembly build, the Playdate app
compiled in directly.

Nine packages, all at one version:

| package                             | what                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@overstory/sprout`                 | `./lang` (the language, its compiler and the cartridge) · `./core` (the store port, records, the memory store, turns, views, conversation, delivery; `./conformance` for stores and `./engine-conformance` for engines) · `./store-sql` · `./store-document`                                                                             |
| `@overstory/sprout-engine-wasm`     | the C engine built for WebAssembly, as one world's engine for core                                                                                                                                                                                                                                                                       |
| `@overstory/sprout-player`          | a world played from a script, its transcript, an author's tests, and a visitor stood in a world as it loads (`sprout play dir script`, `sprout test`, `view`, `parse`)                                                                                                                                                                   |
| `@overstory/sprout-repl`            | a world played interactively, one typed line at a time (`sprout play dir`)                                                                                                                                                                                                                                                               |
| `@overstory/sprout-server`          | the reference host: worlds served to clients over a WebSocket (`sprout-server start`, or `sprout server start`)                                                                                                                                                                                                                          |
| `@overstory/sprout-tui`             | the terminal client: one visitor on a server, with scrollback, history, completion and a status line (`sprout client connect`)                                                                                                                                                                                                           |
| `@overstory/sprout-mcp`             | a world as tools for an agent, a visitor and only a visitor, over MCP (`sprout mcp`)                                                                                                                                                                                                                                                     |
| `@overstory/sprout-language-server` | the language server: the whole world checked as it is edited, with hover, go-to-definition and completion (`sprout-language-server`)                                                                                                                                                                                                     |
| `@overstory/sprout-cli`             | the `sprout` command: `scaffold · check · pack · parse · view · skill` on a microworld folder (`pack` writes its `.sproutworld` cartridge), `play · test` through the player and the REPL, from a folder or a cartridge, `keygen · index` for a publisher's signed index, and `client · server · mcp` where those packages are installed |

The VS Code extension, `editors/vscode`, bundles the language server and
is installed from its folder; it is not published.

## Layout

```
sprout/lang/src
  source/    where a thing was written: spans, the AST node rule, diagnostics, hashing
  syntax/    the lexer, the AST, the parser
  declare/   what a declaration means: types, enums, kinds and composition, objects, properties, messages, verbs, the world, actors, what an extension is
  check/     bindings and the expression checker
  bundle/    limits, the manifest, the closed bundle and its cartridge, the standard library, strict and lenient compiling, the generated skill
  host/      what a host and its engine exchange: ids, the stored form and its changes, the catalogue and the cartridge reader, typed phrases, levels, the seed stream, each turn's inputs, effects, faults, nickname refusals and the view's shapes
sprout/core/src   the store port, its records, the memory store, the conformance suite, the engine interface and its conformance suite, turns under the lock, the log, conversation beside the world, what each client is sent and what a screen reader speaks
sprout/store-sql  sprout/store-document   the two store adapters
engine-wasm/src   the C engine built for WebAssembly as one world's engine for core, and its live state kept in the instance
player/src        play (a script through real turns on an engine, and its transcript), test (an author's own tests of their world), the report of what a playthrough reached, standing a visitor in a world, and the engine a world runs on
repl/src          play interactively, one typed line at a time under one visitor's prompt
mcp/src           a world as tools for an agent: a session of visitors on the player's stage, its tools, over stdio or HTTP
server/src        the reference host: its config, the worlds it serves and redeploys, the protocol's connections, and its clock
tui/src           the terminal client: a session with a server, its screen (Ink) and its plain mode
cli/src           the `sprout` command: scaffold and check, pack, the inspectors parse (what a world accepts) and view (what a visitor is offered), skill, play and test through the player and the REPL, keygen and index for a publisher, and the hand-off to the client, the server and the MCP host
editors/language-server  the language server: the whole world checked as it is edited, and hover, go-to-definition and completion
editors/vscode    the VS Code extension: TextMate grammars for `.sprout` and `.prose`, generated from the compiler's reserved words, and the language server's client
runtime-c/        the C11 runtime that runs a cartridge (`sprout pack`): loading, the stored world, evaluation, readings, prose, the view and the six turn kinds, each module with its `.test.c`; `host/`, the desktop host `sproutc` (`play`, `view`, `eval`); built by CMake and ctest; and `wasm/`, the runtime built for WebAssembly (`build.sh`): `engine.wasm` from the modules of `engine/`, one world per instance driven from JavaScript (`@overstory/sprout-engine-wasm`, checked by `engine.test.mjs`), and `sproutc` under Node's WASI (`sproutc-wasi.mjs`)
sprout-player/    the Playdate app, pure C over the C runtime: the session and its saves, the signed index and its Ed25519 check, the host adapter (`src/host`: files, the network, the frame's stack) and the screens (`src/ui`: shelf, arrival, nickname picker, reader, the disc of words and the crank sentence builder, pictures, downloads, text size, messages); built by CMake against the Playdate SDK, with C tests over a fake `PlaydateAPI`; `worlds/` holds the pinned snapshot of a studio world and `worlds.json` lists what the build ships and what the gate only checks
scripts/          the gate's and the e2e's steps: `check-conflicts.mjs`, `check-corpus.mjs`, `check-transcripts.mjs`, `check-tests.mjs`, `check-runtime-c.mjs` (build, ctest, the WebAssembly engine against the goldens, the player), `e2e.sh`; and the tools: `write-goldens.mjs`, `profile-runtime-c.mjs`, `profile-wasm.mjs`, `pin-standard-library.mjs`, `generate-prose-unicode.mjs`, `sync-world.mjs`, `playdate-sdk.sh`, `playdate-pdc-wsl.sh`, `playdate-player.mjs`
corpus/           worlds the gate checks: good ones pass, bad ones print exactly their page; `goldens/` are the fixtures the C tests replay; `skill/SKILL.md` is what `sprout skill` prints
docs/manual/      the manual, for people playing and writing worlds
docs/design/      the spec, the working notes, the backlog, the Playdate and server designs, the test harness, the reviews
```

## Developing

A machine needs Node 22 or later, CMake, a C compiler, and clang with the wasm32 target and wasm-ld
for the WebAssembly engine every tool runs on: install [wasi-sdk](https://github.com/WebAssembly/wasi-sdk/releases)
25 or later and put its `bin/` first on `PATH` (or LLVM 18 or later with lld). Without them `npm run build` fails, saying so.

```sh
npm ci
npm run gate      # before every commit: no conflict markers, lint, prettier, builds, every suite, spec typechecks, the corpus, the C runtime
npm run e2e       # before opening a PR: install every tarball into an empty folder, scaffold, check, play, serve, sign an index
npm run check     # the corpus, its golden transcripts, its worlds' own tests and the skill; `node scripts/check-corpus.mjs --write`
                  # and `node scripts/check-transcripts.mjs --write` regenerate them
```

There is no CI: the gate and e2e run locally, a PR carries their receipts,
and the `pr-review` agent re-runs the gate at the PR head. The gate builds the
C runtime plain to stay fast; the e2e also runs its tests under
AddressSanitizer and UndefinedBehaviorSanitizer
(`node scripts/check-runtime-c.mjs --sanitize`), where any report fails. On Linux
that run goes under `setarch "$(uname -m)" -R` when `setarch` is installed, because
AddressSanitizer's fixed shadow memory clashes at random with the high-entropy
address-space randomisation of newer kernels (large `vm.mmap_rnd_bits`, as on
WSL2); without `setarch` it prints the remedy, `setarch -R npm run e2e`.
`CLAUDE.md` has the rules.

## Cartridges and the C runtime

```sh
sprout pack corpus/good/printers_shop -o printers_shop.sproutworld   # compile strictly, write the cartridge, pictures and all
sprout play printers_shop.sproutworld                                # play and test take a cartridge where they take a folder; test is then given its scripts
npm run build && node scripts/check-runtime-c.mjs            # build runtime-c/, run ctest, play the corpus on the WebAssembly engine against the goldens
node scripts/write-goldens.mjs <golden>                      # rewrite one file under corpus/goldens on purpose, and print its diff
node scripts/profile-runtime-c.mjs <world>                   # the C runtime's bytes held and peak per step over a long play
node --expose-gc scripts/profile-wasm.mjs <engine.wasm> <world>  # a world served as a server serves it, many visitors, through the C runtime built for WebAssembly
sh runtime-c/wasm/build.sh                                   # build engine.wasm (and, given WASI_SYSROOT, sproutc.wasm) into runtime-c/wasm/out
```

`sproutc` is the C runtime's desktop host, built under `${TMPDIR}/sprout-runtime-c-<hash>/`:
`sproutc play <cartridge> [--state f] [--script s] [--trace f] [--profile f] [--clock n] [--offered] [--poll-steps n]` (plays a
script, reading each typed line as the command turns it runs; `--trace` writes what each step told readers; `--clock n`
moves the fake clock on n milliseconds at each read; with `--offered` the view is polled before each command turn and
must offer the reading the runtime reads the turn as, as the Playdate's sentence builder needs; `--profile` writes each
step's bytes held and peak),
`sproutc view <cartridge> --state f [--visit k] [--poll-steps n] [--json | --golden | --scene | --verb name]` (`--scene` prints the
scene, which lists the verbs in place of the readings, and `--verb` one verb's readings, by its qualified name, as
`sprout view --scene`, `--verb` and `--poll-steps` do),
and `sproutc eval`. [`docs/design/sprout-playdate.md`](docs/design/sprout-playdate.md) is the
design; [`docs/design/sprout-test-harness.md`](docs/design/sprout-test-harness.md) says what each
check holds the C runtime to.

## Playdate

`sprout-player/` is a Sprout player for the Playdate console, written in C over the C runtime, with
a crank sentence builder in place of a keyboard. You need the Playdate SDK (Panic's, 3.1.2; never
committed here), CMake, a C compiler, and the repository built (`npm ci && npm run build`).

```sh
export PLAYDATE_SDK_PATH="$(bash scripts/playdate-sdk.sh)"   # downloads, checks and unpacks the SDK once (Linux)
npm run playdate                                             # builds the pdx, packs the graduated worlds (Printer's Shop) into sprout-player/build/worlds/
"$PLAYDATE_SDK_PATH/bin/PlaydateSimulator" sprout-player/build/sprout-player.pdx
```

On macOS or Windows install the SDK from play.date/dev and point `PLAYDATE_SDK_PATH` at it. With
the variable set, `node scripts/check-runtime-c.mjs` (and so the gate) also builds the Simulator
target and runs the player's C tests; with it unset the last line says they were skipped.

`npm run playdate` writes **one pdx** that carries every binary the machine can build, and says
which: the Simulator library of the platform that built it (`pdex.so` on Linux, `pdex.dylib` on
macOS), `pdex.dll` for the Windows Simulator where `x86_64-w64-mingw32-gcc` is on the `PATH`
([llvm-mingw](https://github.com/mstorsjo/llvm-mingw) cross-compiles it from Linux), and
`pdex.bin` for a console where `arm-none-eabi-gcc` is (Arm's GNU toolchain). A Simulator runs only
a pdx that holds its own platform's library; the device runs only `pdex.bin`.

**On Debian 12 and WSL2** the Linux SDK's `pdc` and Simulator do not run: they need glibc 2.38,
and Debian 12 has 2.36. The build still works there with the Windows SDK installed on the host:
`scripts/playdate-pdc-wsl.sh`, copied over `$PLAYDATE_SDK_PATH/bin/pdc`, forwards `pdc` to the
Windows one (its header says how), and the pdx is opened in the Windows Simulator, which needs the
`pdex.dll` above. Copy the pdx to a folder on the Windows side and run it from there, or the
Simulator leaves its crash-log folder in the checkout:

```sh
cp -r sprout-player/build/sprout-player.pdx /mnt/c/Users/<you>/sprout-playdate/
(cd /mnt/c/Users/<you>/sprout-playdate && /mnt/c/Users/<you>/Documents/PlaydateSDK/bin/PlaydateSimulator.exe \
  'C:\Users\<you>\sprout-playdate\sprout-player.pdx')
```

In the Simulator the A button is the S key and B is the A key. To put the app on a console, with
the pdx holding `pdex.bin`: plug the Playdate in over USB and use
the Simulator's **Device › Upload Game to Device**; or `"$PLAYDATE_SDK_PATH/bin/pdutil" install
sprout-player.pdx` where the Linux `pdutil` runs; or zip the pdx folder and sideload it from your
account at play.date, which the console then fetches over Wi-Fi.

The pdx carries no worlds. A cartridge made by `sprout pack` and copied into the app's Data folder
(`Data/social.overstory.sprout-player/worlds/` on the console's data disk; in the Simulator,
`$PLAYDATE_SDK_PATH/Disk/Data/social.overstory.sprout-player/worlds/`) shows on the shelf. The build
packs the graduated worlds listed in `sprout-player/worlds.json` into `sprout-player/build/worlds/`
for installing that way, today the worked microworld `printers_shop` alone. The studio's
`underground_caverns` is released through sprout-studio's index, not this build: `worlds.json` lists
it under `testOnly`, worlds the gate packs and checks but the build never ships, and keeps a
snapshot of it pinned in `sprout-player/worlds/underground_caverns/` whose `source.json` names the
studio commit it was copied at (to refresh it, run
`node scripts/sync-world.mjs underground_caverns <path to a sprout-studio checkout>` by hand and
read the diff; the build never reads outside this repository). A world on either list may list
`plays`, scripts under its folder the gate plays through `sproutc` with the view polled first under
the app's poll budget, so the gate fails on a world its sentence builder cannot play to the end
(the caverns' walkthrough is one).

The shelf's last row fetches more worlds from a **signed index**. `sprout keygen <prefix>` makes
the publisher's key pair, whose private half never enters this repository; `sprout index <folder>
--base-url <url> --key <prefix>.key` writes the index and, beside it, each cartridge under the name
the device gives it. The app trusts the publisher's public half, `sprout-player/publisher.pub`,
unless `SPROUT_INDEX_PUBLIC_KEY` names another at build, and fetches the index from sprout-studio's
GitHub Pages, `PLAYER_INDEX_URL` in `sprout-player/src/ui/downloads.h`, unless the Data folder's
`downloads.json` names another address. Of the builds an index lists under one title and author
the app offers only the newest, by semver, and the shelf lists its own cartridges the same way, the older builds of a world staying on disk unlisted; a build already on the shelf is greyed in the list. The first fetch
asks the person's permission with the purpose the app states, through the console's own dialog.
The design doc, [`docs/design/sprout-playdate.md`](docs/design/sprout-playdate.md), has the whole
of it. For players, see the manual's [Playing on the Playdate](docs/manual/06-playdate.md).

## Versions, and the language level

The package version is the npm version: the packages move together, and
`0.x` means the API may still move between minors. The language's own
compatibility promise is a separate integer, `LANGUAGE_LEVEL`
(`sprout/lang/src/bundle/bundle.ts`): a microworld's manifest records the
level it was written for, a compiler refuses text newer than itself, and a
policy the language tightens after a text was accepted becomes a warning at
load rather than a refusal.

## Support

One maintainer. Issues are read and triaged when they are triaged; a bug
with a `.sprout` file that reproduces it gets there first. A language change
is a design conversation first: open an issue.

MIT.
