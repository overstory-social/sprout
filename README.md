# Sprout

A small, total, deterministic language for multiplayer interactive-fiction
worlds, and the runtime that hosts them. A world is places, the objects in
them, and the kinds those objects are made of; visitors type or tap, and the
world answers in prose. It is being built to
[`docs/design/sprout-design-spec.md`](docs/design/sprout-design-spec.md),
which is the language whole and the authority where anything disagrees.

**New to Sprout?** Start with [the manual](docs/manual/README.md): what
Sprout is, how to play a world from the terminal, a quickstart that
builds a first world, and the language reference.

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

Seven packages, one version:

| package                    | what                                                                                                                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@overstory/sprout`        | `./lang` (the language and its compiler) · `./core` (the runtime's store port, records, memory store and turns; `./conformance`) · `./store-sql` · `./store-document`                                                                                          |
| `@overstory/sprout-player` | a world played from a script, its transcript, and an author's tests (`sprout play dir script`, `sprout test`)                                                                                                                                                  |
| `@overstory/sprout-repl`   | a world played interactively, one typed line at a time (`sprout play dir`)                                                                                                                                                                                     |
| `@overstory/sprout-server` | the reference host: worlds served to clients over a WebSocket (`sprout-server start`, or `sprout server start`)                                                                                                                                                |
| `@overstory/sprout-tui`    | the terminal client: one visitor on a server, with scrollback, history, completion and a status line (`sprout client connect`)                                                                                                                                 |
| `@overstory/sprout-mcp`    | a world as tools for an agent, a visitor and only a visitor, over MCP (`sprout mcp`)                                                                                                                                                                           |
| `@overstory/sprout-cli`    | the `sprout` command: `scaffold · check · pack · parse · view · skill` on a microworld folder (`pack` writes its `.sproutworld` cartridge), `play · test` through the player and the REPL, from a folder or a cartridge, and `client · server` where installed |

The compiler reads the declarations the backlog has reached (enums,
messages, properties, the world root and the kind its visitors are made
of, kinds and objects with their composition and grammar blocks, a
place's exits and links, and verbs with their roles resolved across
libraries, passages and the `.prose` files they live in, and the
extensions a world pins against the ones its host installed) and checks the
expressions Phase 1 defined, the prose every passage holds and each
`describe`; the runtime reads a visitor's typed line as a reading, runs it
as a turn, answers the engine verbs (`go`, `look`, `examine`, `inventory`,
`wait`, `help`), gives back what every turn said as one ordered
sequence of effects, each rendered for the one person who reads it, an
extension's among them with its transcript line, sent to each client as
its payload where the client can render it and as words where it cannot, and
polls a visitor's view: their place, its ways out, who is there, what
they carry, and every reading they could make. Everything else lands one
backlog item at a time;
see the build order in
[`docs/design/sprout-build-backlog.md`](docs/design/sprout-build-backlog.md)
and the tracking issue #54.

## Layout

```
sprout/lang/src
  source/    where a thing was written: spans, the AST node rule, diagnostics, hashing
  syntax/    the lexer, the AST, the parser
  declare/   what a declaration means: types, enums, kinds and composition, objects, properties, messages, verbs, the world, actors, what an extension is
  check/     bindings and the expression checker
  bundle/    limits, the manifest, the closed bundle, the standard library, strict and lenient compiling, the generated skill
  runtime/   the turn's meter, values, range, ids, stored and live state, what is remembered about an actor, the queue, turns, the command parser, descriptions, nickname admission, the engine verbs' answers, an extension's values and statements run, a turn's effects, and a visitor's view
  prose/     what is said and described, rendered for each reader: names, slots, blocks and loops, reflow, who hears it, a turn's effects, the view as its visitor reads it
sprout/core/src   the store port, its records, the memory store, the conformance suite, turns under the lock, the log, conversation beside the world, what each client is sent and what a screen reader speaks
sprout/store-sql  sprout/store-document   the two store adapters
player/src        play (a script through real turns, and its transcript), test (an author's own tests of their world), and standing a visitor in a world
repl/src          play interactively, one typed line at a time under one visitor's prompt
mcp/src           a world as tools for an agent: a session of visitors on the player's stage, its tools, over stdio or HTTP
server/src        the reference host: its config, the worlds it serves and redeploys, the protocol's connections, and its clock
tui/src           the terminal client: a session with a server, its screen (Ink) and its plain mode
cli/src           the `sprout` command: scaffold and check, the inspectors parse (what a world accepts) and view (what a visitor is offered), skill, and play and test through the player and the REPL
editors/language-server  the language server: the whole world checked as it is edited, and hover, go-to-definition and completion
editors/vscode    the VS Code extension: TextMate grammars for `.sprout` and `.prose`, generated from the compiler's reserved words, and the language server's client
runtime-c/        the C11 runtime that runs a cartridge (`sprout pack`): loading, the stored world, evaluation, readings, prose, the view and the six turn kinds, each module with its `.test.c`, and `host/`, the desktop host `sproutc` (`play`, `view`, `eval`); built by CMake and ctest
sprout-player/    the Playdate app: the C runtime under a Lua UI (shelf, reader, crank sentence builder, nickname picker, downloads); built by CMake against the Playdate SDK, with Lua tests and C tests over a fake `PlaydateAPI`
scripts/          the gate's and the e2e's steps: `check-runtime-c.mjs` (build, ctest, the corpus replay, the view comparison, the player), `fuzz-runtime.mjs`, `playdate-sdk.sh`, `playdate-player.mjs`, `publish-index.mjs`
corpus/           worlds the gate checks: good ones pass, bad ones print exactly their page; skill/SKILL.md is what `sprout skill` prints
docs/manual/      the manual, for people playing and writing worlds
docs/design/      the spec, the working notes, the backlog, the reviews
```

## Developing

```sh
npm ci
npm run gate      # before every commit: no conflict markers, lint, prettier, builds, every suite, spec typechecks, the corpus, the C runtime
npm run e2e       # before opening a PR: install every tarball into an empty folder, scaffold and check
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
sprout pack corpus/good/chip-tree -o chip-tree.sproutworld   # compile strictly, write the cartridge (and <cartridge>.assets/)
sprout play chip-tree.sproutworld                            # play, test and view take a cartridge where they take a folder
npm run build && node scripts/check-runtime-c.mjs            # build runtime-c/, run ctest, replay every transcript and compare every view
node scripts/fuzz-runtime.mjs --corpus --readings 2000       # the C runtime against the TypeScript one over generated plays
```

`sproutc` is the C runtime's desktop host, built under `${TMPDIR}/sprout-runtime-c-<hash>/`:
`sproutc play <cartridge> [--state f] [--script s]`, `sproutc view <cartridge> --state f [--json]`
and `sproutc eval`. [`docs/design/sprout-playdate.md`](docs/design/sprout-playdate.md) is the
design; [`docs/design/sprout-test-harness.md`](docs/design/sprout-test-harness.md) says what each
check holds the C runtime to.

## Playdate

`sprout-player/` is a Sprout player for the Playdate console: the C runtime under a Lua UI, with
a crank sentence builder in place of a keyboard. You need the Playdate SDK (Panic's, 3.1.2; never
committed here), CMake, a C compiler, and the repository built (`npm ci && npm run build`).

```sh
export PLAYDATE_SDK_PATH="$(bash scripts/playdate-sdk.sh)"   # downloads, checks and unpacks the SDK once (Linux)
npm run playdate                                             # packs the graduated worlds and builds the pdx
"$PLAYDATE_SDK_PATH/bin/PlaydateSimulator" sprout-player/build/simulator/sprout-player.pdx
lua5.4 sprout-player/test/run.lua                            # the Lua tests alone, with no SDK
```

On macOS or Windows install the SDK from play.date/dev and point `PLAYDATE_SDK_PATH` at it. With
the variable set, `node scripts/check-runtime-c.mjs` (and so the gate) also builds the Simulator
target and runs the player's Lua and C tests; with it unset the last line says they were skipped.
`npm run playdate` also builds the device pdx
(`sprout-player/build/device/sprout-player_DEVICE.pdx`, which runs in the Simulator too) where
`arm-none-eabi-gcc` is on the `PATH`; upload it from the Simulator's Device menu. Nothing here has
run on a screen or a console yet.

A cartridge made by `sprout pack` and copied into the app's Data folder (in the Simulator,
`$PLAYDATE_SDK_PATH/Disk/Data/social.overstory.sprout-player/worlds/`) shows on the shelf. The pdx
carries the graduated worlds listed in `sprout-player/worlds.json`; the shelf's last row fetches
more from a signed index (`node scripts/publish-index.mjs --generate-key <prefix>` makes the
publisher's key, which never enters this repository; `publish-index.mjs <folder> --base-url <url>
--key <file>` writes the index; the app is built with the public half through
`SPROUT_INDEX_PUBLIC_KEY`, and `Source/config.lua` or the Data folder's `downloads.json` holds the
address). The design doc, [`docs/design/sprout-playdate.md`](docs/design/sprout-playdate.md), has
the whole of it. For players, see the manual's
[Playing on the Playdate](docs/manual/06-playdate.md).

## Versions, and the language level

The package version is the npm version: both packages move together, and
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
