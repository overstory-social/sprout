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
runtime-c/        the C11 runtime: arenas, the host interface, values and lists, a JSON reader, the seeded draws and the budget meter, a gzip inflater, the cartridge loader and its catalogue, the stored world (read, checked, written canonically and reconciled with a world) the one-turn draft, the evaluator and the statements that run a body (the bus, range, moves through consent, wakes, the effects a turn records, and the prose that renders them for each reader), the reading pass (the consent and effect passes, carried roles, wildcard plays, exits and links, intents, the engine's `go`), the call that submits a reading, the turn call (a visitor's arrival and departure, a command, a place's tick, a wake and catch-up, each leaving its entry in the log, with the seeds they draw from and the nicknames visitors are admitted by), and the call that polls a visitor's view (a description, the ways out, who is there, what they carry and every reading they could make, with its refusal and the options of its value roles), each with its `.test.c`, and `host/`, the desktop host `sproutc` that plays a cartridge's script and prints a visitor's view; built and run by CMake and ctest, with the corpus transcripts replayed through it (`node scripts/check-runtime-c.mjs`, after `npm run build`: the tests pack the corpus worlds through the built CLI)
sprout-player/    the Playdate app: the C runtime under a Lua UI (a shelf with the graduated worlds in `worlds.json` and a download screen for more, a reader with crank scrolling, the crank sentence builder, a nickname picker), an Ed25519 check of the signed index of worlds,, the C functions that register the engine with the Lua runtime, saves under Data, and the device's clock; built by CMake against the Playdate SDK, with its Lua tests and a C test of the glue over a fake `PlaydateAPI`
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
(`node scripts/check-runtime-c.mjs --sanitize`), where any report fails.
`CLAUDE.md` has the rules.

## Playdate

`sprout-player/` is a Sprout player for the Playdate console. The C engine of `runtime-c/` is
compiled into the app and registered with the Lua runtime as a few functions (`sprout.open`,
`sprout.admit`, `sprout.view`, `sprout.turn`, `sprout.tick`, `sprout.save`, `sprout.load`,
`sprout.close`); everything the player sees is Lua: a shelf of cartridges, a reader whose
transcript the crank scrolls, a sentence builder that turns the crank over the view's chips (a
verb, then what fills each role, then a word or a number, then confirm), and a picker for the
visitor's nickname. A world is saved after every committed turn, one stored world and one log
tail per world under the app's Data folder, and catches up on the device's clock when it is
opened again, without narrating what happened while it was closed.

You need the Playdate SDK (Panic's, version 3.1.2; it is never committed here), CMake, a C
compiler, and the repository built (`npm ci && npm run build`).

```sh
export PLAYDATE_SDK_PATH="$(bash scripts/playdate-sdk.sh)"   # downloads, checks and unpacks the SDK once
npm run playdate                                             # packs the graduated worlds and builds the pdx
"$PLAYDATE_SDK_PATH/bin/PlaydateSimulator" sprout-player/build/simulator/sprout-player.pdx
```

`scripts/playdate-sdk.sh` fetches the Linux SDK. On macOS or Windows install the SDK from
play.date/dev and point `PLAYDATE_SDK_PATH` at it; the build there makes the library that
platform's Simulator loads, and the Simulator pdx it builds runs only on that platform.

`npm run playdate` builds the Simulator pdx at `sprout-player/build/simulator/sprout-player.pdx`
and, when `arm-none-eabi-gcc` is on the `PATH` (the SDK's macOS installer puts it under
`/usr/local/playdate`), the device pdx at
`sprout-player/build/device/sprout-player_DEVICE.pdx`, which holds both binaries and runs in the
Simulator too. To put it on a console, attach it by USB, unlock it, run the pdx in the Simulator
and choose Upload Game to Device from the Simulator's Device menu. Cartridges come from the
app's `worlds/` folder and from the Data folder: a `.sproutworld` made by `sprout pack`,
copied into `worlds/` of the game's Data folder (in the Simulator,
`$PLAYDATE_SDK_PATH/Disk/Data/social.overstory.sprout-player/`; on a console, the same
folder when it is mounted as a disk), shows on the shelf. A cartridge recorded against larger
static caps than the player allows, or too large for the console's memory, is listed greyed
with the reason.

### Shipped worlds and downloads

The pdx carries the **graduated** worlds and the shelf can fetch more.

- **`sprout-player/worlds.json`** is the list of graduated worlds:
  `{ "graduated": [ { "world": "<name under corpus/good, or a path>", "title": "..." } ] }`. The
  build (`scripts/playdate-player.mjs`) packs each with `sprout pack`, with its `.assets/`, into the
  pdx's `worlds/`. The studio is a separate codebase and will write this file (its own change
  there); until then the repository owns it, listing the corpus worlds whose transcripts replay
  byte for byte through the C runtime and that the app can shelve. The gate fails if the app
  would grey a listed world.
- **The index** (`sprout-player/index.schema.json`) is the file the download screen fetches:
  `{ "worlds": [ { title, author, version, bytes, hash, sha256, url, assets? } ], "signed": "..." }`.
  `hash` is the world's bundle hash, its identity; `sha256` is the SHA-256 of the cartridge file,
  which is what proves the bytes arrived whole (`bytes` is its size); `url` is absolute or relative
  to the index's own address; `assets` lists the files of the cartridge's `.assets` folder the same
  way. `signed` is an Ed25519 signature, in hexadecimal, over the canonical text of `worlds` (no
  spaces, keys in order, integers in decimal; `canonicalText` in `scripts/index-signing.mjs`).
  The app verifies it in C (`sprout-player/src/ed25519.c`, tested against RFC 8032) before it
  reads anything else in the index, and refuses a changed index with a sentence.
- **Publishing.** Pack worlds with `sprout pack`, then
  `node scripts/publish-index.mjs <folder of cartridges> --base-url https://example.com/sprout/ --key <private key file> [--out <folder>]`
  writes `index.json` (and, with `--out`, copies the cartridges and assets beside it) ready to
  upload so that `https://example.com/sprout/index.json` is the app's index address.
- **Keys.** `node scripts/publish-index.mjs --generate-key <path-prefix>` writes `<prefix>.key` (the
  private key: 64 hexadecimal digits, readable by its owner only) and `<prefix>.pub` (the public
  half). **The private key never enters this repository**; keep it in a password manager or a
  secrets store and give the publish step its path with `--key` or `SPROUT_INDEX_KEY`. Build the
  app with the public half: `SPROUT_INDEX_PUBLIC_KEY=<prefix>.pub npm run playdate` writes it
  into `Source/publickey.lua` (not committed). Without the variable the build uses
  `sprout-player/test/index-test.pub`, whose private half is in the repository for the tests, so a
  build you hand to anyone else must set it. Changing the key means a new build of the app; there
  is no revocation or expiry inside the index.
- **Where the app looks.** `sprout-player/Source/config.lua` holds the index address, a placeholder
  (`worlds.example.invalid`, which never resolves) until a real one is chosen: edit it before a
  build, or put `downloads.json`, `{ "indexUrl": "http://localhost:8000/index.json" }`, in the
  app's Data folder (in the Simulator, `$PLAYDATE_SDK_PATH/Disk/Data/social.overstory.sprout-player/`)
  to point a built app at another address without a build.
- **On the shelf.** The last row, "more worlds...", opens the download screen. It asks the system
  for permission to reach the server (with a purpose string; the Playdate shows its own dialog the
  first time), fetches and verifies the index, lists title, version and size, and on A downloads
  the cartridge and its assets into the Data folder's `worlds/`. Each file is written as a
  `.part`, checked against the size and SHA-256 in the signed index, and put in place only
  whole; the cartridge is last, after the engine has confirmed its bundle hash is the one listed.
  A world the app cannot play (a newer language level, caps over its budgets, an extension it
  lacks) is kept and shelved greyed with the engine's reason. With no Wi-Fi network set up, or
  permission refused, or a server that cannot be reached, the screen says why, B goes back, and
  the shelf says what happened and still lists what it has.

Try `chip-tree`: arrive, pick a name with the crank and press A, press A to build a sentence,
turn the crank to `ask`, A, `a guard`, A, `weather`, A, and A again to confirm; B steps back.
The system menu has `leave world`.

The Lua tests need only a desktop Lua 5.4: `lua5.4 sprout-player/test/run.lua`. The gate builds
the Simulator target and runs those tests, the glue's C tests and a round trip of the save
through `sproutc` whenever `PLAYDATE_SDK_PATH` is set, and says on its last line which parts ran
(`node scripts/check-runtime-c.mjs`).

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
