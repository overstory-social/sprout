# Sprout — the test harness

2026-10-14 · @Someone

What each layer of testing in this repository is for and what it checks.
The rules a contributor follows are in `CLAUDE.md`; this is the reasoning.

## The gate, step by step

`npm run gate` runs before every commit, and every step must pass. In
order:

1. **`npm run conflicts`** (`scripts/check-conflicts.mjs`): no tracked file
   holds a merge-conflict marker.
2. **`npm run lint`** and **`npm run format:check`**: ESLint and Prettier
   over every package's sources, the corpus JSON and the design and manual
   pages.
3. **`npm run build`**: every package, in dependency order; the
   WebAssembly engine's `engine.wasm` is built into
   `@overstory/sprout-engine-wasm`, and the build fails, naming what is
   missing, without clang's wasm32 target and wasm-ld.
4. **`npm test`**: every package's vitest suites — the colocated specs (1),
   the invariants (3), the boundary specs (4) and the conformance suites
   (5).
5. **`npm run typecheck:spec`**: the specs and fixtures typecheck as the
   sources do.
6. **`npm run check`**: the corpus (2), through the built CLI on the
   WebAssembly engine. `scripts/check-corpus.mjs`: every `good/` world
   passes, every `bad/` world prints exactly its `expected.txt`, every
   `view.txt` is current, and `corpus/skill/SKILL.md` is what `sprout skill`
   prints. `scripts/check-transcripts.mjs`: every transcript plays as written
   (2a), from the folder and from the cartridge. `scripts/check-tests.mjs`:
   every world's own tests pass (2b), from the folder and from the cartridge.
7. **`node scripts/check-runtime-c.mjs`**: the C layers (7). runtime-c built
   and its ctest run (7a); the library built again at `-O2` under
   `-Wall -Wextra -Werror`, and once more without the parser, as the
   Playdate takes it; `sproutc play` printing a packed world's header; the
   WebAssembly engine against the goldens (7b); and the Playdate app (7e)
   where `PLAYDATE_SDK_PATH` is set. Its last line says which parts ran.

`npm run e2e` (6) runs before a PR is opened.

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
to the manifest reader, and later to the prose reader.

The rule: a change to recovery without an invariant test for the class of
input it handles is not finished.

### 4. Boundary specs

Each package has a `boundary.spec.ts` that lists what it may import. They
are cheap and they are what keeps the language free of any host. They are
never loosened to make something build.

### 5. The conformance suites

`sprout/core/src/conformance.ts` is what a store adapter passes, under any
test runner. It imports no framework. Both store packages run it, and a
host with its own adapter runs it too.

`sprout/core/src/engine-conformance/` is what an engine a host may name
passes, the same way: core's turns, admission and the log, polls in whole
and in parts with the cache, rounds of ticks, the host's questions, and a
log replayed to the world it wrote, each over a memory store. The
WebAssembly engine runs it in `engine-wasm/src/engine.spec.ts`. Neither
suite is ever fenced. Core's own specs check what core does around an
engine (the lock, the log and its depth, the caches, the ticker,
conversation, a replay's divergences) on a stand-in engine over one hall,
`sprout/core/src/fixtures/hall.ts`, which is held to nothing itself.

### 6. End to end

`npm run e2e` (`scripts/e2e.sh`) packs every tarball, installs them into an
empty folder, and runs the installed packages from outside the repository,
which nothing else does: `sprout scaffold` and `check` a fresh world and a
corpus world; `parse`, `view`, `play` (scripted and interactive) and `test`
(and its report) on the worked microworld, its transcripts compared to the
goldens and a test that must fail; `skill`; the MCP host over stdio, whose
recording plays back as written; a world served by the installed server to
the installed terminal client; and the installed language server. It runs
the C layers twice with `--required`, which fails rather than skips without
a C compiler: first sanitized (7c), and last plain, as the gate does.

### 7. The C layers

`runtime-c/` and `sprout-player/` are tested in layers, each with a
different job. The design they test is
[`sprout-playdate.md`](sprout-playdate.md). The C runtime is held to the
spec through its own tests, the frozen goldens and the engine conformance
suite; no other runtime is its oracle. The C tests need the build first
(`npm run build`): ctest's setup packs every corpus world through the built
CLI, and dumps what each cartridge declares through the built language.

#### 7a. The C unit layer and the goldens

Every module of `runtime-c/src` has a `foo.test.c` beside it, built by CMake
and run by ctest (one header-only runner, `test/check.h`). The library calls
nothing from libc but `memcmp`, `memcpy`, `memset`, `strlen`, `floor` and
`pow`; `nm -u` is how that is checked. The plain run builds the library at
`-O2` under `-Wall -Wextra -Werror -pedantic`, as the device does.

The tests that load worlds, stores, expressions, statements, readings, prose
or views replay **goldens**, the fixtures in `corpus/goldens/`. A golden is
committed data, not the output of a spec: nothing in the gate writes one.
It changes only on purpose, with `node scripts/write-goldens.mjs <golden>`
where a writer exists, or by hand where none does. The script rewrites one
file and prints its diff, and the diff is read before the file is
committed. A golden rewritten to whatever the code now says, with no
judgement of whether that is right, is a finding in review. Run
`npm run build` and `node scripts/check-runtime-c.mjs` first: the writers
use the built CLI, the built `engine.wasm` and that script's `sproutc`.

Each golden is written by whatever owns what it says. The C runtime writes
what a turn or a poll gives. The host writes the turn seed. The rest are
hand-kept. What a corpus cartridge declares is not a committed golden at all
(below).

| golden                                             | written by                                                                                    | what it holds                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `stored-worlds.json`                               | the script, from the WebAssembly engine: each world opened empty, and its transcripts played  | each world's initial state and states from its transcripts                                                                     |
| `views.json`                                       | the script, from `sproutc view --golden`, over states the WebAssembly engine's arrival leaves | a bench world's polls and a visitor's arrival in every corpus world: the view's JSON, the chip tree, steps and fault           |
| `seeds.json`                                       | the script, from the host's `turnSeed`                                                        | the turn seed of a tick or a wake                                                                                              |
| `eval`, `exec`, `nicknames`, `prose`, `readings`, `views` `.sproutworld` | the script, compiled from `benches/<name>/`                                | the bench worlds the cases below run in                                                                                        |
| `eval.json`                                        | hand-kept                                                                                     | about seventy expression cases and the spawns: the value or the fault, and the steps spent                                     |
| `exec.json`, `readings.json`                       | hand-kept                                                                                     | statements and range walks; readings (carried, wildcards, each engine verb, exits, value roles, a fault)                       |
| `prose.json`                                       | hand-kept                                                                                     | every kind of slot, `{if}`, `{for}`, `{one of}`, reflow; the edge of every run of letters and every upper-case change          |
| `nicknames.json`, `budgets.json`                   | hand-kept                                                                                     | nickname admission and refusal; the budget faults' words                                                                       |
| `draws.json`, `numbers.json`, `stored-canon.json`  | hand-kept                                                                                     | the first sixteen draws from a seed, number text, the stored canon (the diff form) read and written back                       |
| `parser-words.json`, `addresses.json`              | hand-kept                                                                                     | the parser's word lists; a visitor's arrival in every corpus world: each live thing's address, what they may name, near and carried |
| `stored-reopened.json`                             | the script, from the WebAssembly engine: a sample of corpus worlds, each edited by the script's rules | stored worlds edited against their world: what the engine saves of each, or the words it refuses it in                       |

**The bench worlds.** Each bench cartridge is compiled from a real world
folder, `corpus/goldens/benches/<name>/`: a manifest and its `.sprout` and
`.prose` files. A change to the cartridge format, or to the standard
library a bench pins, re-emits the cartridges with the script. Most benches
are packable by `sprout pack`. The exec bench pins an extension no host
installs, and two of its cases run a body the checker refuses, so the
script compiles every bench itself and rewrites those two nodes after
compiling. A case file (`eval.json`, `exec.json`, and the rest) names a body
by its entry in the cartridge's graph. A re-emitted cartridge can move
those entries, and nothing finds them again for you. The C test that
replays the case fails, naming the case. Find the entry again by reading
the cartridge's preamble and graph for the body the case's name and text
describe, then edit the index by hand and read the diff.

**The corpus-built goldens.** Five goldens hold what the corpus worlds
give. Which of them is generated at ctest setup and which is committed
turns on one question: is its producer something other than the C runtime?

- **Generated at setup: `catalogues.json`.** Its producer is the language:
  `runtime-c/test/dump-catalogues.mjs` reads each freshly packed cartridge
  back with `loadCartridge` and writes the dump beside the cartridges in
  the build folder, where the catalogue tests read it. The test then holds
  the runtime's load to the language's, a real cross-check between two
  readers, and an edit to a corpus world or to the standard library needs
  no golden change. Nothing is committed. The setup never leaves an empty
  or partial dump for a test to pass against: a CLI or language that is not
  built, a world that does not pack, or a cartridge the language refuses
  fails the setup in words, and ctest runs none of the tests after it.
- **Committed, written by the script: `stored-worlds.json`,
  `stored-reopened.json` and `views.json`.** Their only producer is the C
  runtime (through the WebAssembly engine, and `sproutc`). Generated at
  setup, each would compare the runtime with itself and pin nothing across
  a change, so they stay fixtures a reviewer reads. The native tests and
  the WebAssembly step (7b) both replay the one committed
  `stored-worlds.json`, which already holds the two builds to each other.
  `stored-reopened.json` holds, for a sample of the corpus worlds, each
  edit the script makes to a fresh state (a destroyed declared object, an
  object moved, a property at its default, and what a declaration cannot
  explain: an undeclared object or property, a spawn of no kind, a value
  not of its type) with what the engine saves of it or the sentence it
  refuses it in; the refusals' words are what a reviewer reads.
- **Committed, hand-kept: `addresses.json`.** The parser's reach has no
  producer but the C runtime. An edit to a corpus world it covers breaks
  the C test until the world's entry is edited by hand, or removed with
  the diff read.

Four rules keep the layer honest.

- **A budget is compared by its row, its figure and the steps spent.** The
  sentence a budget fault's detail says is the host's to word, so the step
  that went over is compared and the sentence is not.
- **A faulted turn leaves the stored world byte for byte as it was.**
  `corpus/good/turn-faults`, a world whose handlers fault on purpose, is
  what `turn_<kind>.test.c` runs each of the six turn kinds on.
- **The Unicode tables are pinned by edge.** The prose layer carries two
  tables (`runtime-c/src/prose/unicode.c`, generated by
  `scripts/generate-prose-unicode.mjs` from Node's own Unicode data);
  `prose.json` holds the edge of every run of letters and numbers
  and every letter whose upper case differs, each capitalised as JavaScript
  does.
- **A release in a test fills the block with a pattern before it frees it,**
  so a read after free fails in the plain build as well as the sanitized one.

#### 7b. The WebAssembly engine against the goldens

`runtime-c/wasm/build.sh` builds the runtime for wasm32, and
`runtime-c/wasm/engine.test.mjs` checks the build with the frozen goldens,
not with another runtime. Every corpus world opens empty to the state
`stored-worlds.json` holds for it. Every transcript is played through the
engine by the player's own host (`player/src/play.ts`, as `sprout play`
plays it), and each step must make exactly what the transcript expects;
after each step the golden pins, the stored world, written back by the
engine, must be the golden's. The test ends by checking that every state
the golden holds was compared, so a world or a transcript that goes missing
fails it. Beside the corpus it holds the export layer to its edges (loading
and opening again without growing, input it cannot read refused in words,
a reading built from chips, a line handing out its next command only once
the last ran), an arrival to a world that admits no one, which still has
words for the person, an entry at debug depth that is the play-depth entry
once core takes it there, and `libc.c` against the C standard. Without
clang's wasm32 target and `wasm-ld` the step is skipped, and its line says
so.

The same engine passes core's engine conformance suite in
`engine-wasm/src/engine.spec.ts` (5), and every `npm run check` step runs
the CLI on it.

#### 7c. The sanitized run

`node scripts/check-runtime-c.mjs --sanitize` configures a second build with
`-DSPROUT_SANITIZE=ON` (AddressSanitizer and UndefinedBehaviorSanitizer,
`-fno-sanitize-recover=all`) and runs ctest there with `halt_on_error=1` and
leak detection on; any report fails the script. It also builds and runs the
Playdate app's C tests under the sanitizers. The gate keeps the plain build
to stay fast; `npm run e2e` runs this one.

On Linux the sanitized ctest, and the sanitized `sproutc` the player step
plays saves and plays through, run under `setarch "$(uname -m)" -R` when `setarch` is on
the PATH (`player/src/aslr.ts` chooses, and the run prints one line saying
which). AddressSanitizer maps its shadow memory at fixed addresses, and a
kernel with high-entropy address-space randomisation (large
`vm.mmap_rnd_bits`, as on WSL2) can occupy them first, which fails the run at
random. Without `setarch` the line gives the remedy, `setarch -R npm run e2e`.

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
- **`sproutc` prints them.** `sproutc play` says `Ines (extension): [cellar.png]`,
  and its `--trace` keeps that line as the reader's; `sproutc view --json` prints
  `"effects":[{"extension":"media","statement":"show","payload":{"image":"cellar.png"},"transcript":"[cellar.png]"}]`
  in the view, and the page `sproutc view` and `sprout view` print has an
  `effects` section after the description when there are any.
- **The Playdate player draws it.** `sprout-player/src/ui/images.h` finds the
  asset at `<cartridge path>.assets/<image>` and the pictures screen
  (`src/ui/pictures.h`) shows each picture a turn asked for on the whole
  screen, scaled to fit above its caption. `scripts/playdate-player.mjs` packs
  the assets of the graduated worlds into the pdx. `test/pictures.test.c` and
  `gallery.test.c` pin it over corpus cartridges through the fake
  `PlaydateAPI`.

`corpus/good/media-room` pins it all: its transcript holds the transcript
lines, its `view.txt` the page, and `corpus/bad/media-missing-file`,
`media-not-one-bit` and `media-bad-names` the words of each refusal.

#### 7e. The Playdate app

`sprout-player/` is tested without a console and without the Simulator, in
parts that `scripts/check-runtime-c.mjs` runs when `PLAYDATE_SDK_PATH` is set
(the gate says on its last line which parts ran, and that it skipped when the
variable is not set).

- **A test program beside each module** of `sprout-player/src`
  (`sprout-player/test/<module>.test.c`), through a fake `PlaydateAPI` that
  implements only what the app uses, over corpus cartridges: catching up
  `wakes` after four hours tells nothing, `ticks` tells what its place says, a
  clock set back is clamped, a world left open is put away, a damaged save is
  set aside, and a save that cannot be written is told. `played.test.c` plays
  `chip-tree` through the session against its transcript and keeps
  the saves of built turns, which `scripts/playdate-player.mjs` then holds to
  `sproutc`: the save must read and write back byte for byte, and the turns
  built from the view's chips must leave the stored world the same lines typed
  leave when `sproutc play` reads them (`corpus/good/chip-tree`,
  `corpus/good/value-first`).
- **The screens** (`sprout-player/src/ui`) are driven a frame at a
  time through the same fake, whose graphics draw into a 400 by 240 one-bit
  frame and keep each run of text with where it was drawn, and whose buttons
  and crank a test sets. `ui.test.c` builds `main.c`, so
  the update callback the system would call is the one driven, arrives in
  `printers_shop` and holds the reader to rules: read top to bottom, the
  transcript is the client's line and then exactly what the arrival told; the
  status line is the view's place and ways out; the column is full, no row is
  wider than it and nothing is drawn below it; up and the crank scroll a line
  at a time and stop at either end. `wrap.test.c` holds word wrap to its rules
  over generated text (no line wider than the column but a single character, no
  character lost or moved, every break as late as it can be, none inside a
  character), and `transcript.test.c` the scrollback. Three programs drive
  the sentence builder over `builder_support.c`: `builder_disc.test.c` the disc
  as drawn (a greyed chip drawn greyed with its reason, the sentence line
  fitting the screen), `builder_sentence.test.c` the picks and runs (a verb
  descended into and back, a completed reading run and told, `everything`), and
  `builder_crank.test.c` the front always what A picks after any crank turn;
  `shelf.test.c` and `nickname.test.c` their screens (the filters folding as
  the host folds, a name the engine refuses told in its words), and
  `pictures.test.c` the pictures.
- **The listed plays of the shipped worlds.** Each graduated world may list
  plays in `sprout-player/worlds.json` (the studio's `underground_caverns`,
  pinned in `sprout-player/worlds/`, lists the whole of Zork,
  `tests/walkthrough.json`); the player step plays
  each through `sproutc play --offered --poll-steps` under the app's own poll
  budget, which polls the view before every command turn and fails where the
  reading the runtime reads the turn as is not among what it offers, a set
  role one member at a time, as the sentence builder builds it. No turn may
  fault, and each step must say what the play expects of it, as `sprout test`
  holds a test (`unmetExpectation`, read from `sproutc`'s `--trace`). A world
  the chips cannot play to the end, or that outgrows the poll budget, fails
  the build.
- **Shipped worlds and downloads** are tested at each seam, with no network.
  `ed25519.test.c` holds the signature check to all of RFC 8032 section 7.1's
  vectors (and refuses a key or R of small order or in a non-canonical
  encoding, a changed message, signature or key, an S not below the group
  order, and a key that is no point); `shipping.test.c` verifies a signature
  and digests a file (a 4 MiB one without ever asking the allocator for a
  block near its size), and verifies the signature Node
  made over the committed index fixture (`sprout-player/test/fixtures/index.json`,
  signed with the test key in `sprout-player/test/`, whose private half is
  public on purpose and trusted by nothing real); `shipped.test.c` shelves
  every world in the packed `worlds/` folder, so a graduated world the app
  would grey fails the build. `canonical.test.c` holds the canonical text to
  the fixture's and its rules over generated objects; `signed_index.test.c`
  accepts the signed index and refuses one changed after signing or signed by
  another key, one unsigned, oversized or not JSON, and each signed entry the
  app cannot use; `net.test.c` drives the HTTP adapter over the fake network
  (permission asked and refused, no network, no Wi-Fi, a silent server, a
  redirect, a sink that refuses); `downloads.test.c` drives the whole screen
  over the fake network and files (a world that arrives whole and is shelved,
  a tampered index, bytes that are not the listed ones, leaving mid-download,
  every way the list cannot be had) and asserts what is left on disk (nothing,
  for a world that did not arrive). In Node, `scripts/publish-index.spec.mjs` signs
  with the test key (the canonical text, the index built from packed
  cartridges and checked against `index.schema.json`, the command's refusals,
  key generation) and `scripts/playdate-player.spec.mjs` packs a fake
  `worlds.json` (names or paths, a list that cannot be used, assets copied, a
  world that does not pack, the public key read); `scripts/playdate-player.mjs`
  runs both and the build's check of the graduated list.
- **The sanitizers** run the player's C tests too (7c).
- **The build itself is a test.** The Simulator target must compile and `pdc`
  must package the pdx with no compiled script in it, and the device target is built too where
  `arm-none-eabi-gcc` is installed.

What no part can do is run the Simulator or a console, fetch over a real
network, or ask the person's permission. The player on a screen, the crank's
feel, the device's speed and memory, a real download and the system's
permission dialog are checked by hand, in the Simulator and on a console; the
design doc lists them.

## Still to build

- **A generated-input harness shared across readers**: the parser's
  invariant loop extracted into a helper the lexer, manifest reader and
  command parser use, so the pattern is one thing rather than four.
