# Sprout — the test harness

2026-09-22 · @Someone

What each layer of testing in this repository is for, what it caught or
failed to catch in the first two phases, and what is still to build. The
rules a contributor follows are in `CLAUDE.md`; this is the reasoning.

## What the first two phases taught

Phases 0 and 1 landed with about 900 colocated unit tests and a green gate
on every merge, and still produced eleven regressions across four PRs, all
in the parser's recovery. Every one had the same shape: a fix for one
malformed input made an adjacent malformed input drop a well-formed item
silently. The unit tests did not catch it because each asserted on the
input it was written for. What finally caught the class was an invariant
over generated input — "a well-formed item never vanishes without a
diagnostic naming it" — added late, by hand, in the parser's spec.

Two other gaps were visible by the end of Phase 1. Nothing exercised the
new compiler end to end: the world resolver and the type checker were
called only by their own specs, against hand-built fixtures, and the
gate's corpus step still ran the previous language. And the words the
compiler says to an author, which the spec makes a requirement, were pinned
only where a unit test happened to quote them.

## The layers

### 1. Colocated specs

`foo.ts` has `foo.spec.ts`, and the spec exercises the file directly. This
is the unit layer and it stays the largest. Two rules keep it honest:

- Assert on the rule, not on the fixture. A test whose expectation was
  copied from the code's output, with no reading of whether the output is
  right, tests nothing. A reviewer who finds one says so.
- Test-only entry points (`parseExpression`, `parseLet` and their kin) are
  how a construct is exercised before the construct that contains it
  exists. They live in the module and are not exported from the package.

### 2. The corpus: golden pages

`corpus/good/<world>` compiles with no problems. `corpus/bad/<world>` fails,
and `expected.txt` beside it is the exact page `sprout check` prints:
every diagnostic with its file, line, column, sentence and remedy, in
reading order, then the summary line. `npm run check` runs both, and it is
in the gate.

This is the layer that pins the compiler's words, exercises the whole
pipeline from folder to bundle, and shows a reader what the language
looks like. It grows one world per construct: when kinds land, a
`good/kinds` world and a `bad/` world for each refusal the spec lists
under *What it refuses*. The worked microworld is `good/printers_shop`,
its files as the spec writes them, and its golden transcripts are the
runtime's version of the same idea (below).

`node scripts/check-corpus.mjs --write` regenerates the pages. The diff is
read, not accepted: a changed page is either a deliberate change to the
compiler's words, which the PR explains, or a regression. A `good/` world
may also carry an `expected.txt`, pinning its warnings the same way; a
`good/` world without one only has to pass.

`corpus/skill/SKILL.md` is the page `sprout skill` prints, the generated
skill, pinned the same way: every table it is read from, every example
it compiles and every message it quotes is in it, so a change to any of
them shows as a diff of the page, read like any other.

### 2a. Golden transcripts

A `good/` world may carry `transcripts/*.json`. Each is a script that
`sprout play` plays through real turns over the world as it loads, JSON
steps of what visitors type, `{ "as": "Marta", "type": "take brass key" }`,
and what the host does, `{ "arrive": "Marta" }`, `leave`, `tick`,
`{ "advance": "40 minutes" }`, `{ "seed": 7 }`. Playing it prints the
script with every step expecting all it made, each reader's line and
each host line, so a transcript is its own golden: `npm run check`
plays each and compares, and `node scripts/check-transcripts.mjs
--write` replays each and writes what it printed. The diff is read as a
page's is. The worked microworld's transcripts play every chain in it
end to end, and where one plays in a way the spec did not mean, the
transcript pins what happens and the working notes' Open list says why
(the group "Found while playing the worked microworld").

### 2b. A world's own tests

A world may also carry `tests/*.json`, which are what an author writes
and runs with `sprout test`: the same scripts, with only the lines the
author expects under a step, whole or as the words alone, each of which
must be among what the step made in the order written. A turn that
faults fails the test unless its fault is expected.
`npm run check` runs `sprout test` on every `good/` world with a `tests/`
folder and requires it to pass; the page a failing test prints is pinned
in `player/src/test.spec.ts`. The worked microworld carries tests written
the way an author would, and its transcripts pass as tests too.

### 3. Invariants over generated input

Where the code recovers, resynchronises or otherwise decides what to do
with input it did not expect, a unit test per input is not enough,
because the interesting inputs are the ones nobody wrote. The parser's
spec holds the model: a table of well-formed items, a table of defects,
and a loop that injects each defect beside each item and asserts that the
well-formed item is either kept or named in a diagnostic. The same shape
applies to the lexer (a refused character never merges its neighbours),
to the manifest reader, and later to the command parser and the prose
reader.

The rule: a change to recovery without an invariant test for the class of
input it handles is not finished.

### 4. Boundary specs

Each package has a `boundary.spec.ts` that lists what it may import. They
are cheap and they are what keeps the language free of any host. They are
never loosened to make something build.

### 5. The conformance suite

`sprout/core/src/conformance.ts` is what a store adapter passes, under any
test runner. It imports no framework. Both store packages run it, and a
host with its own adapter runs it too.

### 6. End to end

`npm run e2e` packs every tarball, installs them into an empty folder, and
runs the installed CLI: `init` a world, `check` it, and `check` a corpus
world. It proves the published packages work from outside the repository,
which nothing else does. It also checks the worked microworld and plays
each of its transcripts from the installed CLI, comparing what it prints
to the golden, runs its tests and its transcripts as tests, which pass,
and a test that must fail. It also runs the C layers' sanitized run and the
fuzzer (7b, 7c), and the player's checks when `PLAYDATE_SDK_PATH` is set.

### 7. The C layers

`runtime-c/` and `sprout-player/` are tested in layers, each with a
different job. The design they test is
[`sprout-playdate.md`](sprout-playdate.md). The TypeScript runtime is the
oracle throughout: a C test passes when C does what TypeScript does, and
where the two cannot be compared (below) the test says what it pins instead.
The C tests need the TypeScript build first (`npm run build`): ctest packs
every corpus world through the built CLI.

#### 7a. The C unit layer

Every module of `runtime-c/src` has a `foo.test.c` beside it, built by CMake
and run by ctest (one header-only runner, `test/check.h`). The library calls
nothing from libc but `memcmp`, `memcpy`, `memset`, `strlen`, `floor` and
`pow`; `nm -u` is how that is checked. The plain run builds the library at
`-O2` under `-Wall -Wextra -Werror -pedantic`, as the device does.

The tests that load worlds, stores, expressions, statements, readings, prose
or views are held to **goldens the TypeScript specs write**, in
`corpus/goldens/`. A TypeScript spec computes the value from the oracle,
compares it with the file and fails on a difference; the C test replays the
file. `SPROUT_WRITE_GOLDENS=1 npx vitest run …` rewrites a file, and the
diff is read like any golden.

| golden                                             | written by                        | what it holds                                                                                                                  |
| -------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `draws.json`, `numbers.json`, `stored-canon.json`  | the `draws`, `values`, `stored` specs | the first sixteen draws from a seed, number text, the stored canon read and written back                                    |
| `catalogues.json`                                  | `cartridge.spec.ts`               | every corpus world's ids, kinds, properties, verbs and typed phrases                                                           |
| `stored-worlds.json`, `stored-reopened.json`       | `play.spec.ts`                    | each world's initial state and states from its transcripts; stored worlds edited against their world, with `loadWorld`'s report |
| `eval.json`, `eval.sproutworld`                    | `eval-goldens.spec.ts`            | about seventy expression cases and the spawns: the value or the fault, and the steps spent                                     |
| `exec.json`, `readings.json`                       | the exec and reading golden specs | statements and range walks; readings (carried, wildcards, each engine verb, exits, value roles, a fault)                       |
| `prose.json`, `prose.sproutworld`                  | `prose-goldens.spec.ts`           | every kind of slot, `{if}`, `{for}`, `{one of}`, reflow; the edge of every run of letters and every upper-case change          |
| `views.json`, `views.sproutworld`                  | `view-goldens.spec.ts`            | a bench world's polls and a visitor's arrival in every corpus world: the view's JSON, the chip tree, steps and fault           |
| `seeds.json`, `nicknames.json`, `budgets.json`     | the turn specs                    | the turn seed, nickname admission, the budget faults' words                                                                    |

Four rules keep the layer honest.

- **A budget is compared by its row, its figure and the steps spent.** The
  host's figure and the host's words differ from the TypeScript budget's
  detail, so the step that went over is included and the sentence is not.
- **A faulted turn leaves the stored world byte for byte as it was.**
  `corpus/good/turn-faults`, a world whose handlers fault on purpose, is
  what `turn_<kind>.test.c` runs each of the six turn kinds on.
- **The Unicode tables are pinned by edge.** The prose layer carries two
  tables (`runtime-c/src/prose/unicode.c`, generated by
  `scripts/generate-prose-unicode.mjs` from the Node that wrote the
  goldens); `prose.json` holds the edge of every run of letters and numbers
  and every letter whose upper case differs, each capitalised as JavaScript
  does.
- **A release in a test fills the block with a pattern before it frees it,**
  so a read after free fails in the plain build as well as the sanitized one.

#### 7b. The sanitized run

`node scripts/check-runtime-c.mjs --sanitize` configures a second build with
`-DSPROUT_SANITIZE=ON` (AddressSanitizer and UndefinedBehaviorSanitizer,
`-fno-sanitize-recover=all`) and runs ctest there with `halt_on_error=1` and
leak detection on; any report fails the script. It also builds and runs the
Playdate app's glue tests under the sanitizers. The gate keeps the plain build
to stay fast; `npm run e2e` runs this one.

On Linux the sanitized ctest, and the sanitized `sproutc` the player step
plays saves through, run under `setarch "$(uname -m)" -R` when `setarch` is on
the PATH (`player/src/aslr.ts` chooses, and the run prints one line saying
which). AddressSanitizer maps its shadow memory at fixed addresses, and a
kernel with high-entropy address-space randomisation (large
`vm.mmap_rnd_bits`, as on WSL2) can occupy them first, which fails the run at
random. Without `setarch` the line gives the remedy, `setarch -R npm run e2e`.

#### 7c. The differential layer

`sproutc play` (`runtime-c/host`) plays a cartridge's script on a fake clock
with the script's seeds, and three scripts hold the C runtime to the
TypeScript one over whole worlds.

- **The replay of every transcript.** `scripts/check-runtime-c.mjs` packs
  every `corpus/good` world that has transcripts or tests and plays each
  script. The C side has no parser, so `scripts/resolve-script.mjs` first
  plays each script with the TypeScript runtime and writes, beside it, the
  reading the TypeScript parser made of each typed line
  (`player/src/readings.ts`); a line the parser answered instead of reading
  is marked and skipped. It prints one line per world and the list that
  pass, and fails unless that list is `EXPECTED_PASSING`, which is every
  world. It compares what each reader was told, the log's entry for each turn
  that ran, and the stored world after every step.
- **The view comparison.** `sproutc view` prints the page `sprout view`
  prints; the script compares the two for every corpus world, on its own
  line, over the stored world the TypeScript runtime writes for the arrival.
- **The fuzzer.** `scripts/fuzz-runtime.mjs` plays, from a seed, offered,
  refused and unreadable lines, ticks, time, departures and arrivals, and
  tight budgets through both runtimes, and writes the first divergence as a
  transcript under the world's `transcripts/`, to be fixed and kept.
  `npm run e2e` runs about two thousand readings over the corpus; longer
  campaigns are run by hand.

What is not compared, and why: a command's parsing (the device has none);
the object a poll's fault names (a C fault carries none); the record of where
each effect's words were written (an author's tool); any extension but
`media`. Each is a numbered hole in the working notes.

#### 7d. Extensions on a host that draws

`media` is the one extension the hosts install (the CLI, the player, the
server, the language server and the C runtime), and the contract a host that
draws reads is this. `media.show("cellar.png")` and
`media.show("cellar.png", "a damp cellar")` stand in a `describe` and in a
`do`.

- **The effect's payload** is the JSON object `{"image": "<path>"}` or
  `{"image": "<path>", "caption": "<text>"}`, `image` first, no `caption` key
  where there is none. `<path>` is the image's path from the world's folder,
  `/` between folders. The transcript line a text client reads is the caption,
  or `[<path>]`.
- **The asset** sits at `<cartridge>.assets/<path>`, where `<cartridge>` is the
  cartridge's file name (`media_room.sproutworld.assets/pictures/cabinet.png`),
  written by `sprout pack`. It is a PNG of one bit a pixel (grey scale, colour
  type 0, or palette, colour type 3). The cartridge lists each in its
  `extensions` section,
  `{"name":"media","major":1,"assets":[{"path":"cellar.png","bytes":80,"sha":"…"}]}`,
  so a host can check what it loaded. No size is imposed on the picture; the
  total is the host's `assetBytes` cap, unset by default.
- **In the C API** a turn's extension effect is a `sprout_told_effect` of kind
  `SPROUT_LINE_EXTENSION` with `extension`, `statement` and `payload` (JSON
  text) and its transcript line as its one paragraph (the outcome's `lines`,
  each pointing at its effect by `effect`); a view's are
  `sprout_seen_view.effects`, each a `sprout_seen_effect` with the same three
  and its `transcript`. A description's effects follow its `described` effect
  in a turn, and in the view they are kept apart from the description's
  paragraphs.
- **`sproutc` prints them.** `sproutc play` says `Ines (extension): [cellar.png]`
  and its `--trace` puts
  `"extension":"media","statement":"show","payload":{"image":"cellar.png"}` on
  the effect in the log entry (the TypeScript player writes the same, and the
  replay compares them); `sproutc view --json` prints
  `"effects":[{"extension":"media","statement":"show","payload":{"image":"cellar.png"},"transcript":"[cellar.png]"}]`
  in the view, and the page both runtimes print has an `effects` section after
  the description when there are any.
- **The Playdate player draws it.** `sprout-player/Source/images.lua` loads the
  asset from `<cartridge path>.assets/<image>` and the reader draws the newest
  picture above the transcript, scaled to fit 392 by 80 pixels, with its
  caption under it. `scripts/playdate-player.mjs` packs the assets of the
  graduated worlds (`media-room` among them) into the pdx.
  `test/images_test.lua` and `main_test.lua` pin it over a saved view
  (`fixtures/media-room.view.json`).

`corpus/good/media-room` pins it all: its transcript holds the transcript
lines, its `view.txt` the page, and `corpus/bad/media-missing-file`,
`media-not-one-bit` and `media-bad-names` the words of each refusal.

#### 7e. The Playdate app

`sprout-player/` is tested without a console and without the Simulator, in
parts that `scripts/check-runtime-c.mjs` runs when `PLAYDATE_SDK_PATH` is set
(the gate says on its last line which parts ran, and that it skipped when the
variable is not set).

- **The Lua modules** (`sprout-player/test/*_test.lua`, run by a desktop Lua
  5.4: `lua5.4 sprout-player/test/run.lua`) are tested as logic: the sentence
  builder over a saved chip tree (`ask`, the guard, the weather; a refused leaf
  greyed with its reason; a set role joined from singletons; a number role on
  the crank), word wrap in pixels, the reader's scrollback, the clock's clamp,
  the nickname filter, the shelf, and `main.lua` driven frame by frame over
  stand-ins for `playdate` and the engine.
- **The C glue** has a test program beside each module of `sprout-player/src`
  (`sprout-player/test/<module>.test.c`), through a fake `PlaydateAPI` that
  implements only what the glue uses, over corpus cartridges: catching up
  `wakes` after four hours tells nothing, `ticks` tells what its place says, a
  clock set back is clamped, a world left open is put away, a damaged save is
  set aside, and a save that cannot be written is told. `glue.test.c` plays
  `chip-tree` through the registered functions against its transcript and keeps
  the saves of built turns, which `scripts/playdate-player.mjs` then holds to
  `sproutc`: the save must read and write back byte for byte, and the turns
  built from the view's chips must leave the stored world the same lines typed
  leave (`corpus/good/chip-tree`, `corpus/good/value-first`).
- **The listed plays of the shipped worlds.** Each graduated world may list
  plays in `sprout-player/worlds.json` (the studio's `underground_caverns`
  lists the whole of Zork, `tests/walkthrough.json`); the player step resolves
  each with the TypeScript parser and plays it through `sproutc play
  --offered --poll-steps` under the app's own poll budget, which polls the
  view before every command and fails where the reading is not among what it
  offers, a set role one member at a time, as the sentence builder builds it,
  and compares every line with the TypeScript runtime's. A world the chips
  cannot play to the end, or that outgrows the poll budget, fails the build.
- **Shipped worlds and downloads** are tested at each seam, with no network.
  `ed25519.test.c` holds the signature check to all of RFC 8032 section 7.1's
  vectors (and refuses a key or R of small order or in a non-canonical
  encoding, a changed message, signature or key, an S not below the group
  order, and a key that is no point); `shipping.test.c` calls `sprout.verify`
  and `sprout.digest` as Lua does (and digests a 4 MiB file without ever asking
  the allocator for a block near its size), and verifies the signature Node
  made over the committed index fixture (`sprout-player/test/fixtures/index.json`,
  signed with the test key in `sprout-player/test/`, whose private half is
  public on purpose and trusted by nothing real); `shipped.test.c` shelves
  every world in the packed `worlds/` folder, so a graduated world the app
  would grey fails the build. In Lua, `canonical_test.lua` holds the canonical
  text to the fixture's, `index_test.lua` accepts the signed index and refuses
  one changed after signing, one unsigned, oversized or not JSON, and each
  signed entry the app cannot use; `net_test.lua` drives the HTTP adapter over a
  scripted `playdate.network` (permission refused, a request that cannot be
  queued, an error, a stalled transfer, a redirect and a redirect loop, no
  Wi-Fi); `downloads_test.lua` drives the whole screen over a fake network,
  files and engine (a download with assets placed and reported, a tampered
  index, no network, permission refused, a checksum mismatch, another build's
  bundle hash, a file shorter or longer than listed, a world the engine refuses
  kept and greyed, a connection that breaks part way, a Playdate out of room,
  leaving mid-download) and asserts what is left on disk each time (nothing, for
  a world that did not arrive); `main_test.lua` drives the shelf's "more
  worlds" row with no network. In Node, `scripts/publish-index.spec.mjs` signs
  with the test key (the canonical text, the index built from packed
  cartridges and checked against `index.schema.json`, the command's refusals,
  key generation) and `scripts/playdate-player.spec.mjs` packs a fake
  `worlds.json` (names or paths, a list that cannot be used, assets copied, a
  world that does not pack, the public key written); `scripts/playdate-player.mjs`
  runs both and the build's check of the graduated list.
- **The sanitizers** run the glue's tests too (7b).
- **The build itself is a test.** The Simulator target must compile and `pdc`
  must package the pdx, and the device target is built too where
  `arm-none-eabi-gcc` is installed.

What no part can do is run the Simulator or a console, fetch over a real
network, or ask the person's permission. The player on a screen, the crank's
feel, the device's speed and memory, a real download and the system's
permission dialog are checked by hand, in the Simulator and on a console; the
design doc lists them.

## Still to build

- **Replay determinism**: a log recorded once and replayed against the same
  bundle produces byte-identical effects. A property test over random
  command sequences on the worked microworld, once B34 and B40 exist.
- **A generated-input harness shared across readers**: the parser's
  invariant loop extracted into a helper the lexer, manifest reader and
  command parser use, so the pattern is one thing rather than four.
