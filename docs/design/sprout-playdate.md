# Sprout — the Playdate player

2026-10-10

The design of the Playdate player as it is built: a C runtime that
runs a closed world file, a Lua app that lets a person play one with a
crank, and the checks that hold the first to the TypeScript runtime. The
design spec says what any host owes a world (_The host contract_,
_Limits_); this document is the concrete choices the Playdate host makes.
Where the two disagree, the spec wins. Every choice the spec leaves open is
a numbered hole in the working notes, named here and listed in _Still for
Eric_.

## Goal and scope

A person with a Playdate plays a Sprout world on the console, alone, with
no keyboard: they read a transcript, and they build each command from
choices the world offers, turning the crank. They can keep several worlds
on a shelf, come back to one after days, and fetch more worlds from the
web.

In scope: one visitor per world, on one device; every language feature the
TypeScript runtime has, including the `media` extension; saves; time that
passes while the app is closed; a signed list of worlds to download.

Out of scope: a typed command line (the console has no keyboard, so the C
runtime has no command parser); more than one person in a world (that is
the server); the studio, which authors and approves worlds elsewhere; any
extension but `media`.

## The split

Three programs share one language and meet at two files.

- **The compiler is TypeScript** (`sprout/lang`). It is the only thing
  that reads source. `sprout pack` writes the **cartridge**, a
  `.sproutworld` file, and, beside it, the **assets** the world names.
- **The runtime is C11** (`runtime-c/`). It reads a cartridge and a
  stored world and runs turns. It calls nothing from libc but `memcmp`,
  `memcpy`, `memset`, `strlen`, `floor` and `pow`, takes its memory,
  clock and seed from a host record, and holds no default for any limit.
- **The viewer is per host.** The desktop host `sproutc` prints text; the
  Playdate app is Lua over the C functions; the TypeScript hosts (CLI,
  server, terminal client) are unchanged.

The **stored world** (the spec's _State_) is the second meeting point: the
C runtime writes the same bytes the TypeScript runtime writes, so a save
made on a console loads on a laptop and the other way round. The
**view** is the third: a poll gives the visitor's place, ways out, people,
carried things and every reading they could make, and that, not a typed
line, is what a viewer without a keyboard works from.

Why C and not TypeScript on the device: there is no JavaScript on the
Playdate, and Lua is too slow and too loose for a runtime whose output must
equal another runtime's to the byte. Why not C for the compiler: the
compiler is most of the code, it changes most often, and it only ever runs
where Node does.

## The cartridge

`sprout pack <dir> [-o file]` compiles strictly and writes
`<name>.sproutworld`. The spec's _What compiling produces_ names no file;
the layout is hole 462.

- **Header, 16 bytes.** `SPRT`, the format version and the language level as
  little-endian 16-bit numbers, eight reserved zeros. The format is the
  layout of the file and moves only when the layout does; the level is the
  spec's _Language levels_. A reader refuses a format or level newer than
  it reads, naming the number.
- **Body.** Gzip-compressed JSON held to one schema
  (`bundle/cartridge-schema.ts`) shared by the writer and the reader. Its
  sections: `header` (name, namespace, version, author, license, the highest
  language level, the bundle hash, the files and libraries), `kinds`, `tree`
  (what the world declares to be where, and where visitors arrive), `verbs`,
  `grammar` (scoped phrases, intents and the word set a nickname is admitted
  against; every phrase's and every exit's and link's label carries its typed
  words), `messages`, `prose` and `bodies` (passages, statements and
  expressions as trees with every name bound), `table`, `caps` (the static
  caps the world was checked against) and `extensions` (the ones it pins, by
  name and major, with their assets). The bundle's object graph is a flat
  table of entries that refer to one another by index, so shared objects stay
  shared.
- **Closed.** Libraries are statically linked. The cartridge holds no
  source text and no diagnostics; synonym words do not travel as words (a
  verb's own are appended to its phrases).
- **The bundle hash** is a field the compiler stores in the header, the
  world's identity (the spec's _What compiling produces_). It is not a digest
  of the file, so it cannot prove the bytes arrived whole (see _Downloads_).
- **Caps.** The caps a cartridge records are what it was checked against
  when published. A load runs under the host's own caps; the Playdate host
  compares them when it shelves a cartridge (see _Budgets_).
- **Assets.** `<cartridge>.assets/<path>` holds each file an extension names,
  at the path the world writes it by. The `extensions` section lists them as
  `{"name":"media","major":1,"assets":[{"path":"cellar.png","bytes":80,"sha":"…"}]}`.
  A picture is a PNG of one bit a pixel (grey scale or palette). Their total
  size is the static cap `assetBytes`, the host's and unset by default.
- **Versioning.** A cartridge from a newer format or level is refused by
  every reader with text; on the shelf it is kept and greyed with that text,
  since the person may update the app.

`sprout play` and `sprout test` take a cartridge where they take a folder.
`--report` over a cartridge is refused (a cartridge does not keep the
declarations the report counts), and `sprout test <cartridge>` with no
script is refused (a cartridge carries no `tests/`).

## The C runtime

`runtime-c/` is a static library (`libsprout`) behind one header,
`include/sprout.h`, and a desktop host. It is laid out by what each part
does, one `.c` file and one `.test.c` per module:

- **Memory and values.** `arena.c` (page arenas from the host's allocator,
  freed all at once), `values.c` (numbers as doubles holding whole
  integers, strings as validated UTF-8 ordered by UTF-16 code unit),
  `lists.c`, `json.c` (a reader into an arena with no recursion, a
  canonical writer), `draws.c` (the seeded draws), `budget.c` (the meter),
  `inflate.c` (gzip).
- **Loading.** `graph.c`, `load.c`, `catalogue*.c` read a cartridge into a
  catalogue; `stored*.c` read, check and write the stored world;
  `state.c` reconciles a store with a world; `draft.c` is the one-turn
  copy-on-write layer.
- **Evaluating.** `eval.c` and `expr/` (the expression kinds), `exec.c` and
  `stmt/` (the nineteen statements), `bus.c`, `range.c`, `move.c`,
  `guards.c`, `wakes.c`, `effects.c`.
- **Readings.** `reading.c` and `reading/` (the consent and effect passes,
  carried roles, wildcard plays), `exits.c`, `intents.c`, `engine-verbs.c`,
  `hearing.c`, `submit.c`.
- **Prose and the view.** `prose.c` and `prose/` (slots, reflow, names, the
  Unicode tables), `offers.c`, `options.c`, `describe.c`, `darkness.c`,
  `view.c`, `view_json.c`, `chips.c`.
- **Turns.** `turn.c` and `turn/` (arrival, departure, command, tick, wake,
  maintenance), `schedule.c`, `seeds.c`, `nickname.c`, `answers.c`.
- **Extensions.** `media.c` (see _Images_).

**The host interface** (`sprout_host`): `alloc` and `release`, `now`
(milliseconds from the turn's start), `seed`, `read` and `write` (the stored
bytes), `emit`, `ctx`, `page_bytes`, and `budgets`, one row for each figure
in the spec's _Runtime budgets_ table plus the rows the spec leaves to the
host. An unset row is unbounded. The library holds no figure of its own.

**The calls.** `sprout_load` reads a cartridge; `sprout_state_open`
reconciles a store with it; `sprout_run_turn` runs one of the six turn
kinds (the spec's _Turns_) and returns an outcome; `sprout_view` polls a
visitor; `sprout_reading_run` submits a reading; `sprout_admit` checks a
nickname. A turn runs in a draft that commits or is dropped: a fault leaves
the stored world byte for byte as it was, except that a faulted departure
still takes the visitor out and a faulted wake is consumed (hole 499).

**Memory.** Every allocation comes from the host's `alloc`, in pages of the
host's size. A turn's arena is dropped whole at its end, and dropping it
drops the draft. The Playdate host gives it `system->realloc` and a 32 KB
page.

**Determinism.** Nothing a turn does reads the clock, the filesystem or
the network. The only time is the `elapsed` the host passes. Every draw
comes from the turn's seed, by the spec's rule: SHA-256 for a turn's seed,
mulberry32 and the rejection draw for the draws; the same inputs give the
same bytes on every platform (`seeds.c`, `draws.c`, held to goldens the
TypeScript specs write).

**Faults.** A budget that runs out faults the turn naming the row, the
figure and what a turn may do, in words the runtime holds (hole 499; they
are not among the engine lines an author may replace). A defect of the host
(a seed out of range, an instant before the last tick, a visit that never
came) returns `SPROUT_BAD_INPUT` with words and writes nothing.

**The sanitizers.** `-DSPROUT_SANITIZE=ON` builds the library, the host and
every test under AddressSanitizer and UndefinedBehaviorSanitizer, with no
recovery: any report fails. The plain run builds the library at `-O2`, as the
device does, under `-Wall -Wextra -Werror -pedantic`. The sanitized run
catches reads of freed arena memory, leaks, out-of-bounds accesses and
undefined arithmetic, which the plain tests can miss and which crash a
device.

**`sproutc`** is the desktop host (`runtime-c/host/`), which may use libc:

- `sproutc play <cartridge> [--state f] [--script s] [--readings f] [--trace f] [--clock N]`
  plays a script on a fake clock, with the script's seeds, through
  `sprout_run_turn`.
- `sproutc view <cartridge> --state f [--visit KEY] [--poll-steps N] [--json]`
  prints the page `sprout view` prints, over a stored world.
- `sproutc eval` evaluates one expression of a goldens cartridge against a
  stored world.

## Conformance

The TypeScript runtime is the oracle. The C runtime is correct when it does
what the TypeScript runtime does, and the checks below say how that is
shown. `npm run gate` runs all of them except the fuzzer; `npm run e2e`
runs the plain check, then the sanitized check, then the fuzzer (plain).

- **Goldens under `corpus/goldens/`**, written by TypeScript specs from the
  oracle and replayed by the C tests byte for byte: `catalogues.json`
  (every world's ids, kinds, properties, verbs and phrases),
  `stored-worlds.json` and `stored-reopened.json` (stored worlds, and
  stored worlds edited against their world, with the load report),
  `eval.json`, `exec.json`, `readings.json`, `views.json`, `prose.json`,
  and `seeds.json`, `nicknames.json`, `budgets.json`, `draws.json`,
  `numbers.json`, `stored-canon.json`. A TypeScript spec compares what it
  computes with the file; `SPROUT_WRITE_GOLDENS=1 npx vitest run …`
  rewrites it, and the diff is read like any golden.
- **The replay of every transcript.** `scripts/check-runtime-c.mjs` packs
  every `corpus/good` world with transcripts or tests and plays each script
  through `sproutc`. The C side has no parser, so
  `scripts/resolve-script.mjs` first plays the script with the TypeScript
  runtime and writes the reading its parser made of each typed line; a line
  the parser answered instead of reading is marked and skipped. The replay
  fails unless the list of passing worlds is `EXPECTED_PASSING`, which is
  every world.
- **The view comparison.** For every corpus world, `sproutc view` and
  `sprout view` print the same page over the stored world the TypeScript
  runtime writes for an arrival. It has its own line apart from the replay.
- **The differential fuzzer.** `scripts/fuzz-runtime.mjs` plays offered,
  refused and unreadable lines, ticks, time, departures and arrivals and
  tight budgets through both runtimes from a seed, and writes the first
  divergence as a transcript under the world's `transcripts/`, to be fixed
  and kept. The e2e runs about two thousand readings over the corpus.

**What is compared:** what each reader was told, in order; the log's entry
for every turn that ran; the stored world after every step; a view byte for
byte, with the steps it spent and its fault; an expression's value or its
fault and its steps; a rendered line with the steps it spent.

**What is not compared:** a command's parsing, which is TypeScript's alone;
the budget faults' detail where the two runtimes count differently (the
step budget is compared by its row, figure and steps spent); the object a
fault names in a poll (a C fault carries none, hole 497); the record of
where each effect's words were written, which is for an author's tools; any
extension but `media`; a run on a Unicode newer than 17.0 (hole 498).

**The Playdate app's own checks** are below, under _What is checked_.

## The Playdate app

`sprout-player/` is the app. The engine of `runtime-c/` is compiled into it
as one source and registered with the Lua runtime at `kEventInitLua`, before
`main.lua` runs, as eleven functions: `sprout.inspect`, `open`, `load`,
`admit`, `view`, `turn`, `tick`, `save`, `close`, `verify` and `digest`
(`src/bridge.c`). Each takes strings and returns a JSON string. The app
sets no update callback; Lua's `update()` runs everything. Everything a
person sees is Lua; `Source/engine.lua` is the one place the registered
functions are called.

### The chip tree and the crank sentence builder

A reading is not typed. The view lists every reading the visitor could make,
and `chipTree(view)` (`prose/chips.ts`, and `chips.c` in C) arranges them as
a tree: a verb, then what fills each of its roles in the order the verb
declares them (a thing, a set of things, a way out), then each value role's
word or number, ending in a leaf that holds the typed line, the refusal if
the consent pass refuses it, and the options. A reading carries its fillers
by id, which is what lets a viewer hand the runtime a reading without a
parser.

`sentence.lua` turns the crank over that tree. A is pick, B is step back,
the crank or the d-pad moves a wheel of the choices at this step (24
degrees of crank for a step). It lists the verbs in the view's order, then
what fills each role, then a word or a number for each value role (a number
role is on the crank, with left and right moving it by ten), then confirm.
A leaf the consent pass refuses is drawn greyed with its reason and cannot
be confirmed. A set role is joined from the singletons the view offers:
after the first member the wheel offers the others and "that's all", and
the roles after it are offered under the first member. A finished reading
lists the roles a thing fills in the tree's order and then its value roles,
which is the order the TypeScript parser binds them in
(`corpus/good/value-first` pins it). The view offers readings and not
intents, so the wheel has no intents at the top (hole 500).

### Nickname

The console has no keyboard, so a visitor picks from a pool of plain words
(Alder, Aster, Birch, …) filtered by the cartridge's word set, folded as the
TypeScript host folds (lower case, split on white space), and by who is
present. A returning visitor is offered their last name first. The engine's
own admission, `sprout_admit`, is the authority: it also refuses a reserved
word.

### Saves

A world is saved after every committed turn: `saves/<bundle hash>.json` is
the stored world, byte for byte what `sproutc` reads and writes, and
`saves/<bundle hash>.log` is the last 32 log entries and the clamp's
seconds. A bundle with another hash is a redeploy and starts afresh, with
the old save unused. A save that will not read is set aside as `.damaged`
and the world starts again, in words. A save that cannot be written stops
play with the words on the screen, the world is let go, and the shelf greys
it with the reason until a save of it succeeds: a move that is not kept is
not played.

One visit per world, keyed by the world alone, with no token. A world left
open (the battery, a kill) is put away by a departure that tells nothing
when it is next opened, then caught up and arrived in.

### Time and the clamp

Host seconds are the device's seconds since 2000-01-01
(`playdate.getSecondsSinceEpoch`), clamped so they never go below the
greatest seen, which the save records. The reader asks for a tick every ten
seconds while a world is open, never on the shelf, in the background or
while the device sleeps. A world opened after an absence is caught up by one
maintenance turn: wakes due are delivered at that turn, at most 64, with the
instant of the turn rather than their due times, and it narrates nothing.
A step's seed is drawn from the clock at the step's start and mixed by
`seeds.c`'s rule, and is written to the log.

### Images

`media.show("cellar.png", "a damp cellar")` in a `describe` or a `do`
records the effect `{"image": "cellar.png", "caption": "a damp cellar"}`;
the transcript line a text client reads is the caption, or `[cellar.png]`.
`Source/images.lua` loads the asset from `<cartridge path>.assets/<image>`
and the reader draws the newest picture above the transcript, scaled to
fit 392 by 80 pixels, with its caption under it. A picture a turn shows wins
over the one the place's description records. The pdx holds a compiled image
under its name without `.png`.

### The shelf

The shelf lists the `.sproutworld` files at the root of the app and of its
Data folder and in each one's `worlds/` folder (a copy in Data shadows the
app's). Each is inspected once, by file name and size. One the engine
refuses (a newer language level, a static cap over the app's, a world too
big for the console's memory, a damaged file) is listed greyed with the
engine's reason and cannot be opened. The last row, "more worlds…", opens
the download screen.

### Shipped worlds and downloads

The pdx carries the **graduated** worlds, listed in
`sprout-player/worlds.json` (`{"graduated": [{"world": "<corpus/good name or
a path>", "title": "…"}]}`). `scripts/playdate-player.mjs` packs each with
`sprout pack`, with its assets, into the pdx's `worlds/`, as
`<name>.sproutworld` for the name the world's manifest gives it. Today the
list is the worked microworld `printers_shop` and the studio's finished
`underground_caverns`, reached by path into a `sprout-studio` checkout beside
this one, so the player's checks need that checkout on a machine with the
SDK. The studio will write this file; until then this repository owns it
(hole 502). The build fails if the app would grey a listed world.

The **signed index** (`sprout-player/index.schema.json`) is what the
download screen fetches: `{ "worlds": [ { title, author, version, bytes,
hash, sha256, url, assets? } ], "signed": "…" }`. `hash` is the bundle
hash, the world's identity; `sha256` is the SHA-256 of the cartridge file,
which is what proves the bytes arrived whole. `signed` is an Ed25519
signature, in hexadecimal, over the canonical text of `worlds` (no spaces,
keys in order, integers in decimal; `canonicalText` in
`scripts/index-signing.mjs`). The app verifies it in C
(`src/ed25519.c`, tested against RFC 8032) before it reads anything else.

One publisher key is baked into the app at build
(`SPROUT_INDEX_PUBLIC_KEY=<prefix>.pub`); a new key is a new build. The
private key never enters the repository. The index has no expiry,
revocation list or version counter, so an old signed index can be replayed
to a device. A world the publisher withdraws is one the next index leaves
out; a cartridge already downloaded stays on the shelf.

Each file is written as a `.part`, counted as it arrives (a file longer
than listed is dropped at once), hashed a chunk at a time and never held in
memory, checked against the size and SHA-256 in the signed index, and put in
place only whole. The cartridge goes last, after the engine has confirmed
its header hash is the one listed. A file is named for the title and the
first eight digits of the bundle hash, so two builds of one world sit side
by side; a newer build does not replace or remove an older one, whose save
would be orphaned. The index is read to at most 256 KB.

The index address is `sprout-player/Source/config.lua`, a placeholder that
never resolves until a real one is chosen; `downloads.json` in the Data
folder points a built app elsewhere. Without Wi-Fi, with permission
refused, or with a server that cannot be reached, the screen says why, B
goes back, and the shelf says what happened and still lists what it has.

### Budgets the app ships

One table (`src/budgets.c`): the spec's figures where it gives one (50,000
steps, 10,000 poll steps, 8,000 output characters, 256 events, cascade 20,
passages 8, set role 8, spawns 8, shortest wake 60 seconds, one pending
wake, nickname 24, lists 16); people in a place unbounded, since a device
has one visitor; and where the spec leaves the row to the host, 64
extension effects a turn, a five-second wall clock and 1,024 live
instances. The steps are the spec's and are not tuned: the Simulator runs
far faster than the console. The ten static caps with figures are checked
against a cartridge's recorded ones when it is shelved, and one recorded
larger is refused cap by cap in the TypeScript host's words, less the offer
of an exception; the five the spec leaves to the host (places, objects,
kinds, files, source bytes) are unset (hole 500).

### What is checked

Without a console and without the Simulator: the Lua modules under a
desktop Lua 5.4 (`lua5.4 sprout-player/test/run.lua`); a C test program
beside each module of `sprout-player/src` through a fake `PlaydateAPI` that
implements only what the glue calls; `glue.test.c`, which plays `chip-tree`
through the registered functions against its transcript; a round trip of
the save through `sproutc` (the save must read and write back byte for byte,
and the turns built from the view's chips must leave the stored world the
same lines typed leave); the download screen over a fake network, files and
engine; the signature check against RFC 8032; every packed world shelved;
and the Node specs for the index and the build. The Simulator target must
compile and `pdc` must package the pdx; the device target is built too where
`arm-none-eabi-gcc` is installed. `docs/design/sprout-test-harness.md`
lists each.

### What has run on a screen, and what has not

The app has run on the Windows Simulator (SDK 3.1.2), from a pdx built on
WSL2 with the `pdex.dll` that llvm-mingw cross-compiles: the shelf with its
greyed rows, the nickname picker, the reader's status line and transcript,
the sentence builder through a `many` role, and turns through the C engine.
The layout at 400 by 240 reads as designed. Seen there and fixed: the SDK's
`drawText` reads `_` and `*` as styling, so every world's words are drawn
through `markup.lua`, which doubles them.

Not yet checked:

- a console: the device pdx builds and `pdc` packages it, and no Playdate
  has been on the bus;
- the crank's feel (24 degrees a step and 12 degrees a scrolled line are
  guesses);
- how long `json.decode` takes on the view of a big world on the device;
- the budgets, tuned on hardware (the Simulator is far faster);
- the memory of a big world on a console's 16 MB (`underground_caverns`
  packs to 1.5 MB and plays through `sproutc`);
- a real network fetch, and the system's permission dialog: what the system
  returns when the person refuses is not documented, so a refusal is read
  as `http.new` returning nothing or the request failing, both told in
  words;
- the picture's look (1-bit scaling) and the time it takes to load one.

## Verified SDK facts (SDK 3.1.2)

Read from the SDK 3.1.2 tree and exercised by the builds above, not from
memory:

- `scripts/playdate-sdk.sh` fetches the Linux SDK
  (`PlaydateSDK-3.1.2.tar.gz`, 33,810,967 bytes), checks its size and
  SHA-256 (the download page publishes no checksum, so they are pinned in
  the script) and unpacks it once. The SDK is Panic's and is never
  committed. `PLAYDATE_SDK_PATH` names it.
- The C API builds with CMake: `C_API/buildsupport/playdate_game.cmake` for
  the Simulator target, a shared library; `arm.cmake` with
  `-DTOOLCHAIN=armgcc` for the device, an ELF that needs `arm-none-eabi-gcc`.
  `pdc` packages either into a pdx.
- `pdc` packages every `pdex.*` beside the Lua, so one pdx can hold
  `pdex.so`, `pdex.dylib`, `pdex.dll` and `pdex.bin` and run wherever one of
  them was built for; a Simulator loads only its own platform's library and
  never executes `pdex.bin`. `scripts/playdate-player.mjs` builds each it can
  and runs `pdc` once over all of them, copying the binaries from the build
  trees itself, because the SDK's copy is a POST_BUILD step that an unchanged
  target does not repeat. Upload to a console is the Simulator's Device menu,
  `pdutil install`, or the account's sideload page.
- The Linux SDK's `pdc` and Simulator are linked against glibc 2.38 and
  `GLIBCXX_3.4.32`, and the Simulator wants `libwebkit2gtk-4.1`; Debian 12
  has glibc 2.36. The Windows `pdc.exe` runs from WSL over
  `\\wsl.localhost\` paths, which is what `scripts/playdate-pdc-wsl.sh`
  relies on.
- `playdate.graphics.drawText` styles `*bold*` and `_italic_`; a doubled
  character is drawn once, plain. `font:drawText` styles nothing.
- The Simulator's keyboard: the A button is S, B is A, the d-pad the arrow
  keys. On its first run it shows a modal "Heads up" dialog that takes every
  key until it is dismissed.
- The device is a Cortex-M7 (`-mcpu=cortex-m7 -mfpu=fpv5-sp-d16 -mfloat-abi=hard`)
  at 168 MHz with 16 MB of RAM; its screen is 400 by 240, one bit, and the
  app asks for 30 frames a second.
- `eventHandler` receives `kEventInitLua` before `main.lua`; `lua->addFunction`
  registers a C function under a dotted name; the allocator is
  `system->realloc`; files open with `kFileRead | kFileReadData`, which reads
  the app bundle and the Data folder together, and `listFiles` lists both.
- `playdate.getSecondsSinceEpoch` counts seconds since 2000-01-01.
- `playdate.network.http` needs system software 2.7. `http.new` asks the
  person's permission for a server, with a purpose string, by pausing the
  runtime, so a request starts from `update()` and never from a callback.
  Wi-Fi sleeps 30 seconds after the last request.
- A compiled image is kept in the pdx under its name without `.png`.
- The data folder in the Simulator is
  `$PLAYDATE_SDK_PATH/Disk/Data/<bundleID>/`, here
  `social.overstory.sprout-player`.

## Building and checking it

From a clone, with Node 22, CMake and a C compiler:

```sh
npm ci && npm run build
node scripts/check-runtime-c.mjs            # builds runtime-c/ outside the repository, runs ctest, replays the corpus
node scripts/check-runtime-c.mjs --sanitize # the same under the sanitizers (on Linux under setarch -R)
```

The first step builds the C runtime at `-O2 -Wall -Wextra -Werror`, runs its
unit tests and the goldens, replays every transcript through `sproutc`,
compares every world's view, and prints one line each. The build tree is
`${TMPDIR}/sprout-runtime-c-<hash of the checkout>`. The C tests pack the
corpus worlds through the built CLI, which is why `npm run build` comes
first.

The Simulator pdx, and the player's checks, need the SDK:

```sh
export PLAYDATE_SDK_PATH="$(bash scripts/playdate-sdk.sh)"   # once
npm run playdate                                             # packs the graduated worlds, builds the one pdx
"$PLAYDATE_SDK_PATH/bin/PlaydateSimulator" sprout-player/build/sprout-player.pdx
node scripts/check-runtime-c.mjs                             # now also builds the Simulator target and runs the Lua and glue tests
```

The pdx carries every binary the machine can build and the script says
which (`carries:` and `not built:`): the host's Simulator library, `pdex.dll`
where `x86_64-w64-mingw32-gcc` is found, `pdex.bin` where `arm-none-eabi-gcc`
is. The README's Playdate section has the WSL2 arrangement, where the build
runs on Linux and the Simulator on Windows.

With the variable unset, the check's last line says the player step was
skipped, and which parts did not run. `npm run gate` runs the plain check;
`npm run e2e` runs the sanitized one and the fuzzer too. On a kernel whose
address-space randomisation clashes with AddressSanitizer's fixed shadow
memory (large `vm.mmap_rnd_bits`, as on WSL2) the sanitized run goes under
`setarch "$(uname -m)" -R` when `setarch` is installed, and prints the
remedy, `setarch -R npm run e2e`, when it is not.

## Still for Eric

Each is built the narrow way and recorded in the working notes' _Holes in
the spec_ with the alternatives; none is closed until Eric decides it.

- **462.** The cartridge's file layout, versioning, and what it leaves out
  (`pack`, `--report`, `test` over a cartridge, synonyms); the spec names
  no file.
- **493.** What C does with a store and cartridge the spec leaves open:
  stored order, whole numbers only, refusal wording, the typed words
  travelling final, and nickname admission folded in Lua as TypeScript folds
  it.
- **494.** What a spawn costs (the instance and each content), what bounds
  live instances (a host row), and that C does not decode extension-typed
  properties.
- **495.** What a statement records for the passes after it, and an
  extension statement of an extension the world does not pin recording
  nothing.
- **497.** The C poll's three attempts, a fault laid against the visitor's
  place, and the budget row it reports.
- **498.** The JavaScript Unicode rules the C prose layer reproduces (white
  space, capitalisation, character counts), and the engine line
  `not_a_place`, which the spec's replaceable list lacks.
- **499.** What the six turn kinds settle: budget-fault words held by the
  runtime, a catch-up's shared meter and wake handling, the host's defects,
  a faulted departure or wake still changing the store.
- **500.** What the app settles for the host: budgets, static caps, time and
  ticks, visits, nicknames, saves, and the sentence builder's order and
  set roles.
- **502.** What "graduated" means, the index and its signing, takedown, and
  the device's file handling.
- **The media paragraph** (_Extensions on a host that is not TypeScript, and
  the `media` extension_ in the working notes): the sentence the spec needs
  for extensions on a host that is not TypeScript, optional statement
  parameters, the `assetBytes` cap, the cartridge's asset listing, and an
  absent cap reading as unset.
