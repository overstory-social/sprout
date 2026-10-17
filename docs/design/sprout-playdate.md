# Sprout — the Playdate player

2026-10-10

The design of the Playdate player as it is built: a C runtime that
runs a closed world file, a C app over it that lets a person play one with a
crank, and the checks that hold the first to the spec. The
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
C runtime has, including the `media` extension; saves; time that
passes while the app is closed; a signed list of worlds to download.

Out of scope: a typed command line (the console has no keyboard, so the app
reads no typed line); more than one person in a world (that is
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
  Playdate app is C over the same runtime (_The Playdate app_); the TypeScript hosts (CLI,
  server, terminal client) run the same runtime as WebAssembly
  (`@overstory/sprout-engine-wasm`).

The **stored world** (the spec's _State_) is the second meeting point: the
C runtime writes the stored form the language's schema
(`sprout/lang/src/host/stored.ts`) reads, the diff from the world a fresh
load makes, byte for byte as `corpus/goldens/stored-canon.json` pins it,
so a save made on a console loads on a laptop and the other way round. The
**view** is the third: a poll gives the visitor's place, ways out, people,
carried things and every reading they could make, and that, not a typed
line, is what a viewer without a keyboard works from.

Why C and not TypeScript on the device: there is no JavaScript on the
Playdate, and Lua is too slow and too loose for a runtime whose output must
equal every other host's to the byte. Why not C for the compiler: the
compiler is most of the code, it changes most often, and it only ever runs
where Node does.

## The cartridge

`sprout pack <dir> [-o file]` compiles strictly and writes
`<name>.sproutworld`. The spec's _What compiling produces_ names no file;
the layout is hole 462.

- **Header, 16 bytes.** `SPRT`, the format version and the language level as
  little-endian 16-bit numbers, then the body's inflated size and the offset
  of its table in it as 32-bit numbers. The format is the layout of the file
  and moves only when the layout does (it is 3: the entries moved from JSON
  into a table the runtime reads in place); the level is the spec's
  _Language levels_. A reader refuses a format other than the one it reads,
  or a level newer than it reads, naming the number and `sprout pack`.
- **Body.** Gzip-compressed, two parts. First a JSON preamble held to one
  schema (`bundle/cartridge-schema.ts`) shared by the writer and the reader,
  everything but the entries: `header` (name, namespace, version, author,
  license, the highest language level, the bundle hash, the files and
  libraries), `caps` (the static caps the world was checked against),
  `extensions` (the ones it pins, by name and major, with their assets),
  `kinds`, `tree` (what the world declares to be where, and where visitors
  arrive), `verbs`, `grammar` (scoped phrases, intents and the word set a
  nickname is admitted against; every phrase's and every exit's and link's
  label carries its typed words), `messages`, `bodies` (what every name a
  body writes names, and which slots render an option) and `table` (the
  files places name). Then, eight-aligned, the table
  (`bundle/cartridge-table.ts`, `runtime-c/src/table.h`): the three runs of
  entries (passages; statements and expressions; everything else) as
  twelve-byte nodes, one pool of child indexes, one run of strings, the
  doubles and the shapes objects share, with one node per distinct scalar
  after the entries, a place among them holding its file, line and column.
  An identifier is written as its text and an object path as its steps
  joined by dots; only a name the name table binds stays an entry, with no
  place (`bundle/cartridge-names.ts`). The runtime inflates the body into one
  block and reads the table where it lies, so a shared object is one node
  and nothing is built from it. The preamble's cells refer to entries by
  index.
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
- **Loading.** `load.c` reads a cartridge as a stream: `stream.c` walks the
  body's JSON text over `inflate.c` a buffer at a time, the small sections are
  read as trees into the load's scratch and the table's entries one at a time
  into `graph.c`, and `catalogue*.c` build the catalogue from them, so the body
  is never whole in memory; `stored*.c` read, check and write the stored world;
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

**The calls.** `sprout_load` reads a cartridge, and `sprout_load_begin`,
`sprout_load_step` and `sprout_load_finish` read one across many calls, a
budget of entries at a time with its progress told, so a host with frames
to answer reads a big world behind a loading line; `sprout_peek` reads only
a cartridge's header and caps, cheap however large it is; `sprout_state_open`
reconciles a store with it; `sprout_run_turn` runs one of the six turn
kinds (the spec's _Turns_) and returns an outcome; `sprout_view` polls a
visitor; `sprout_reading_run` submits a reading; `sprout_admit` checks a
nickname. A turn runs in a draft that commits or is dropped: a fault leaves
the stored world byte for byte as it was, except that a faulted departure
still takes the visitor out and a faulted wake is consumed (hole 499).

**Memory.** Every allocation comes from the host's `alloc`, in pages of the
host's size. A turn's arena is dropped whole at its end, and dropping it
drops the draft. The Playdate host gives it `system->realloc` and a 32 KB
page. A loaded world is its body's block, with the table read where it
lies, and its catalogue. The host need not hold the cartridge either:
`sprout_load_begin` reads it from a `sprout_source`, front to back, 8 KB at a
time into the load's scratch, so a load's peak is the loaded world and its
scratch (the caverns: 3.69 MB at the peak and 3.36 MB loaded, on x86-64 with
32 KB pages), and the
graph's nodes are small (a union for the payload, 32 bytes on a 64-bit host
and 20 on the console) with every distinct scalar cell and field name held
once, so a word the table writes a thousand times is one node. The
catalogue holds one record for each thing the graph shares (a kind, a
property, a group of plays) and keeps the name table and the option slots
by entry index for only the entries they name: on `underground_caverns`
it is about 0.35 MB on the console (0.63 MB of a 64-bit host's arena), and
its build adds about 0.13 MB of scratch.

**Determinism.** Nothing a turn does reads the clock, the filesystem or
the network. The only time is the `elapsed` the host passes. Every draw
comes from the turn's seed, by the spec's rule: SHA-256 for a turn's seed,
mulberry32 and the rejection draw for the draws; the same inputs give the
same bytes on every platform (`seeds.c`, `draws.c`, held to the goldens in
`corpus/goldens/`).

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

- `sproutc play <cartridge> [--state f] [--script s] [--trace f] [--clock N] [--offered] [--poll-steps N]`
  plays a script on a fake clock, with the script's seeds, through
  `sprout_run_turn`, each typed line read by the runtime as the command
  turns it runs. `--trace` writes what each step told readers; `--offered`
  polls the view before each command turn and fails where it does not offer
  the reading the runtime reads the turn as.
- `sproutc view <cartridge> --state f [--visit KEY] [--poll-steps N] [--json | --golden]`
  prints the page `sprout view` prints, over a stored world. `--golden`
  prints the poll as `views.json` holds one: the view, its chip tree, the
  steps it spent and its fault.
- `sproutc eval` evaluates one expression of a goldens cartridge against a
  stored world.

## Conformance

The C runtime is held to the spec by its own tests, the frozen goldens and
core's engine conformance suite; no other runtime is its oracle.
`npm run gate` runs all of it; `npm run e2e` runs it plain and sanitized
([`sprout-test-harness.md`](sprout-test-harness.md), 7).

- **Goldens under `corpus/goldens/`**, fixtures the C tests replay byte for
  byte: `stored-worlds.json` and `stored-reopened.json` (stored worlds,
  and stored worlds edited against their world, with the load report),
  `eval.json`, `exec.json`, `readings.json`, `views.json`, `prose.json`,
  and `seeds.json`, `nicknames.json`, `budgets.json`, `draws.json`,
  `numbers.json`, `stored-canon.json`. No spec writes them.
  `node scripts/write-goldens.mjs <golden>` rewrites the ones that have a
  writer, and the rest are hand-kept. Either way, the diff is read like any
  golden ([`sprout-test-harness.md`](sprout-test-harness.md), 7a). What each
  corpus world declares (its ids, kinds, properties, verbs and phrases) is
  not committed: ctest's setup dumps it from the language over the packed
  cartridges, and the catalogue tests hold the runtime's load to it.
- **The corpus on the WebAssembly engine.** `runtime-c/wasm/engine.test.mjs`
  opens every corpus world empty to the state `stored-worlds.json` holds,
  and plays every transcript through the engine, each step making what it
  expects and the stored world after each pinned step the golden's.
  `npm run check` plays every transcript and every world's tests through the
  CLI on the same engine.
- **The engine conformance suite** (`@overstory/sprout/engine-conformance`),
  which the WebAssembly engine passes in its package's specs.

**What no check pins:** the object a fault names in a poll (a C fault
carries none, hole 497); the record of where each effect's words were
written, which is for an author's tools; any extension but `media`; a run on
a Unicode newer than 17.0 (hole 498).

**The Playdate app's own checks** are below, under _What is checked_.

## The Playdate app

`sprout-player/` is the app, and it is C over the engine. The engine of
`runtime-c/` is compiled into it as one source. The session
(`src/session.h`) holds the one world open on the device: it hands back the
runtime's structs (the view, a level of the chip tree, the lines a call's
turns told) and takes a reading as the runtime's struct. The Playdate's side
of the host contract, its files, its network and the stack a frame runs on
are `src/host/`; the screens are `src/ui/`. `main.c` sets the update
callback at `kEventInit`, which tells the system the game is pure C, and
hands the app the lock, low-power, unlock, pause and terminate events; the pdx
carries no script, only `pdxinfo`, the fonts, the shipped worlds and the
binaries `pdc` packages from `Source/`. Each frame runs on the player's own
stack (`src/host/stack.h`), since a turn may run in it, and the file calls
inside it hop back to the main stack.

The app (`src/ui/app.h`) holds the session, the pen (`src/ui/pen.h`), the
shelf and the screen on show. The pen draws every screen but the disc of
words in one of three text sizes (`src/ui/text_size.h`): S is the system's
Asheville Sans 14 Light, M its Roobert 20 Medium and L its Asheville Sans 24
Light, each loaded by path from `/System/Fonts/`, one held at a time. "text"
in the system menu is an options item, S / M / L; the size set there is
applied when the menu closes, written beside the saves as the one letter in
`text-size.txt`, and read back at the next launch (no file, or one that says
anything else, is S). A font the device cannot read leaves the pen as it was,
puts the item back, and says so over the screen on show until A or B. A screen (`src/ui/screen.h`) is functions over its own
context: update with the buttons and the crank, draw, leave, and refit, which
runs when the pen's font has changed and wraps again whatever the screen
keeps wrapped; a screen
moves the app to another, and the move takes effect when its update is over.
The app starts on the shelf (`src/ui/shelf.h`), as The shelf below describes
it; the app holds it, so it outlives its screen and a cartridge is
inspected once for as long as the app runs. Its "more worlds..." row opens
the download screen (`src/ui/downloads.h`), and when the list of worlds could
not be had there, the row's panel says why until it is tried again. A on a
world shows the arrival
(`src/ui/arrival.h`), which reads the cartridge a step a frame behind a
loading line, loads the save and shows the nickname screen
(`src/ui/nickname.h`), as Nickname below describes it:
"Who are you in <world>?" over one name of the pool, which the crank (24
degrees a name) and up and down move through, A entering it and B closing
the world and going back to the shelf. A name `player_admit` refuses is told
in the engine's words over the screen until A or B, and the person picks
again; with no name free, A says so on the message screen. An admitted
visitor goes on to the reader, behind the arrival's pictures. What
stops an open is told on the message screen (`src/ui/message.h`), whose A
or B goes back to the shelf: a world refused at its open or a step keeps the
reason on the shelf, and one whose save could not be written is greyed
until a save of it succeeds. The shelf's cues go through `player_cue` like
every screen's. "leave world" in the system menu, chosen while a reader is
open, leaves the world as B on the nickname screen does: the visitor leaves,
the save is written and the app goes back to the shelf; chosen elsewhere it
does nothing. "start over" beside it, chosen while a reader is open, puts a
question over the screen on show, which waits under it: "Start this world
over?" and "All you did here will be forgotten.", with A to start over and B
to go back to the screen as it was. A removes the world's save and log under
`saves/` (and any `.tmp` a write cut short left beside them), lets the state
go while the world stays read, and shows the nickname screen for a fresh
arrival, with no loading line between; no departure runs, since nothing of
the world is kept to depart from. Chosen elsewhere it does nothing. The signed index is read by `src/signed_index.h`, over the
canonical text of `src/canonical.h`, which orders an object's names as the
signer's JavaScript sort does, by UTF-16 code unit, and writes an empty
object as `{}`, as the signer does.

The reader (`src/ui/reader.h`) is the transcript
wrapped to the column, the newest at the bottom, under the status (the
place and its ways out, from the view), scrolled a line for each 12 degrees
of crank and each press of up or down. The status wraps to the column as the
transcript does, and the header is as tall as its lines, at most three: a place
whose ways out run past three lines has the rest clipped, so the transcript is
never squeezed out. The transcript's rows are fitted under the header whenever
the status is set, as on moving to a place with more ways out, and nothing
told is lost by the fit. The keys under the transcript take one line. Its word wrap (`src/ui/wrap.h`) is
over the font's widths (`getTextWidth`), rather than the SDK's `drawTextInRect`:
scrolling a line at a time needs the lines, which `drawTextInRect` does not
give back. A wrapped block keeps the words it was made from ahead of its
lines, so when the text size changes the transcript wraps each of its kept
paragraphs and its status again from the words (a newline still a line, a
cut word cut afresh) and shows the rows the new line height allows under the
status's new lines, with nothing told lost; the shelf's and the download screen's panels, a message, a refused
name and the words over the disc wrap again the same way, and the lines a
screen lays out each frame follow the pen of themselves. Text is drawn as written, on the reading that the C API's
`drawText`, which takes no font family, has no bold or italic to read `*`
and `_` as; the Simulator has yet to confirm it. A on the reader opens the
sentence builder (`src/ui/builder.h`, over `src/ui/sentence.h` and
`src/ui/disc.h`) over the session's chip levels, as The chip tree and the
crank sentence builder below describes it; a
confirmed sentence runs through `player_turn` and is told in the reader, led
by the sentence as typed. The reader is lent to the builder while it is up.
The sentence so far above the disc fits the screen however long it grows: in
the system font, else the small font, else trimmed from the left behind
`...`, so its end, the part being built, stays in view.

The pictures (`src/ui/pictures.h`) are shown as Images below describes them.
After the arrival
is told, every picture its lines and then the place's view asked for, and
after a sentence runs, every picture its turn asked for once the builder has
closed, is shown one at a time on the whole screen over the reader, which is
lent to it; a picture the world's assets do not hold is left out, and a turn
that asks for none goes straight to the reader. The queue and the slat-clack
motion are `src/ui/gallery.h`, which holds names and never bitmaps; finding
an image in `<cartridge>.assets/` (compiled without `.png`, else as asked)
and reading the effect's payload are `src/ui/images.h`. The screen loads a
picture with `loadBitmap` when it first draws it, on the main stack as every
file call is, holds at most the one on screen and the one leaving, frees the
one that left once the next has landed, and frees both when A or B closes
it, so a picture costs memory only while it is on screen.

The sounds (`src/ui/sound.h`) are cues, each a short
note on a synth of its own (`pd->sound->synth`) with its own
waveform, pitch, volume, length and envelope, made when the app starts and
freed when it ends. Every screen sounds a cue through `player_cue` in
`src/ui/app.h`: the builder's tick, clack, pick, back and refusal, the
nickname screen's tick, pick, back and refusal, and the pictures' tick and
clack. With no synth a cue is silent.

The reader's clock (`src/ui/clock.h`): while a
reader is open, a tick is asked of the session (`player_tick`) every ten
seconds of the device's clock, clamped so a clock set back brings no tick
sooner; what the tick told is added to the transcript and the status looked
at again, and the pictures it asked for are shown as a turn's are. A tick
that changed the state and told nothing (`player_told.changed`: a save is
owed) is looked after too, in the tick, where the cost is the tick's, so the
view the builder opens from is never stale. A tick is
asked for only while the reader itself is on show, so one that falls due
under the builder or the pictures comes when they close. A tick whose save
could not be written stops play as a turn's does. `kEventLock` and
`kEventLowPower` stop the count and `kEventUnlock` begins it afresh, so the
time the device was locked or asleep owes no tick of its own; the next tick's
`elapsed` carries it, and the session's catch-up and clamp are unchanged.
The C API has no wake event: the device wakes from low-power sleep locked,
on the reading that its unlock is what starts the ticks again.
`kEventTerminate` frees the app, which leaves the screen on show and closes
the world, the save written.

The download screen (`src/ui/downloads.h`) works over the SDK's C network API
(`src/host/net.h`, each call on the main stack as the file calls are). The C
API cannot pause the game for the permission dialog, so a fetch asks with
`requestAccess` and the purpose string and waits for the answer across
frames, saying so on the screen; the system's answer, the header that carries
a redirect's `Location`, and the end of an answer all come by callback, and
the screen polls. The index is read and verified by `src/signed_index.h`
against the key the build bakes in as the generated `publickey.h`
(`PLAYER_INDEX_PUBLIC_KEY_FILE`, which `scripts/playdate-player.mjs` sets
from `SPROUT_INDEX_PUBLIC_KEY`), and a world is written a
piece at a time (`player_file_create` and its kin in `src/host/files.h`),
hashed with `player_digest`, and shelved as Shipped worlds and downloads
below describes, with the share of the file arrived in the panel. The index
address is `PLAYER_INDEX_URL` in `downloads.h`, a placeholder, and the Data
folder's `downloads.json` points it elsewhere.

The fake PlaydateAPI the C tests drive (`test/fake_playdate.h`) loads a
bitmap from a PNG at the size its header declares, draws it as a black block
and records each draw, and records each note a synth plays; `gallery`,
`pictures` and `sound` are the test programs. Its network serves canned
answers a piece a frame behind the permission a test says the person gives,
answers an address it does not know with 404, and can fall silent; `clock`,
`net` and `downloads` are those test programs, and `ui` drives the ticks
across a lock and a low-power sleep through `main.c`'s event handler.

### The chip tree and the crank sentence builder

A reading is not typed. The view lists every reading the visitor could make,
and `chips.c` (`sprout_chip_tree_of`) arranges them as
a tree: a verb, then what fills each of its roles in the order the verb
declares them (a thing, a set of things, a way out), then each value role's
word or number, ending in a leaf that holds the typed line, the refusal if
the consent pass refuses it, and the options. A reading carries its fillers
by id, which is what lets a viewer hand the runtime a reading without a
parser.

The tree stays in the session, and is built a verb at a time. `player_view`
polls the scene alone (`sprout_scene`): the place, the description, the
ways out, who is there and what is carried, and the verbs the world
offers, with no readings, and keeps it (`seen.c`) until the state changes,
the next load or the close: a turn that commits or changes the state marks
the kept view stale and the next view polls again, and a view asked while
the kept one stands is the kept one, nothing polled, so A opens the builder
over the view the reader already has. `player_chips`, with the picks so far as 1-based indexes
(none for the verbs), answers one level: each choice with `greyed`, whether
nothing under it can be done, and `reason`, the first refusal under it, and
the level's `leaf`. The first level under a verb asks the runtime for that
verb's readings alone (`sprout_readings_for`: the offers and consent passes
for one verb over what is in range, a hundredth of the whole poll), arranges
them as the verb's subtree and keeps it; at the root a verb not yet reached
is neither greyed nor not (`PLAYER_GREYED_UNKNOWN`), and the level under a verb says of the
verb what the root then shows. The sentence builder asks for no verb's
readings when it opens: the disc is drawn first, in the frame A was pressed,
and the verb at its front is asked after on the next frame, as the verb the
disc settles on is, so a verb is greyed or not before it is picked and A to
the wheel costs the root level and a draw. The caverns' whole
tree was 223 KB of JSON and 2,194 nodes built in one poll that reset the
console; now a level is a few hundred bytes, a verb's readings cost one
small poll, and the screens never hold the tree.

The sentence builder (`src/ui/sentence.h`) turns the crank over those levels. A is pick, B is step back,
the crank or the d-pad moves a wheel of the choices at this step (24
degrees of crank for a step). It lists the verbs in the view's order, then
what fills each role, then a word or a number for each value role (a number
role is on the crank, with left and right moving it by ten), then confirm.
A leaf the consent pass refuses is drawn greyed with its reason and cannot
be confirmed. An optional tool is a step of its own, since the view offers
the reading with it left out and filled by each thing that fits: after the
target the wheel offers the tool by the word its phrase puts before it
("from" for `take [target] from [source]`, as the view's filler carries it
in `words`; the role's name where it carries none) beside "that's all", and
picking the word opens the things that fit it as a wheel of their own, with
"everything" where it is offered, B stepping back to the word; the sentence
so far shows the word before the pick, `take -> the sack -> from the table`,
and the reader's `> ` line follows it. A set role is
joined from the singletons the view offers:
after the first member the wheel offers the others and "that's all", and
the roles after it are offered under the first member. Where the parser
would read `all` for a role (Parsing › Sequences, again and all), the wheel
offers "everything" first, before the things themselves, so it is found
without cranking (`src/ui/everything.h`): on a level whose role binds things,
when two or more of them can be done and the view says `all` would take
them; each filler of a thing says so, by the parser's own rule, so a greyed
thing and what a typed `all` would pass over (the visitor's own place, the
people here in an open role, scenery that plays no part in a world verb) are
left out, and with one thing or none it is not offered. For a set role it joins them all at once, at most as
many as the host lets a set role bind, and the sentence goes on to its next
role or "that's all". For a role that takes one thing the sentence goes on
under the first of them, and once confirmed it runs one turn for each thing,
in the level's order, leaving out any whose reading with the rest of the
sentence the view does not offer or refuses, at most as many as a set role may
bind: each turn goes through `player_turn` as a built sentence does, one after
another from the builder (the runtime's line of turns hands out only what a
typed line plans, and the Playdate has no parser), is told in the reader as
its own sentence (`> take -> a lamp`, then its answer), and is logged with
the whole sentence as its words, as each turn of a line of `all` is logged
with the line; the first that does not let a line go on, a refusal or a fault,
ends it, and what ran before stays done. Only one role in a sentence takes one
thing as "everything". The sentence so far reads "everything" where it was
picked. A finished reading
lists the roles a thing fills in the tree's order and then its value roles,
which is the order the parser binds them in
(`corpus/good/value-first` pins it). The view offers readings and not
intents, so the wheel has no intents at the top (hole 500).

On the screen the wheel is a disc of words (`src/ui/disc.h`): a hub on the
screen's left edge with a marker pointing at the front, and each entry a
sector of 24 degrees fanning to the right, its word in the large font along
its ray. The selected word lies level at the front as an inverted label (a
greyed one dotted, its reason on the panel below); its neighbours tilt away
above and below in the entries' order and run off the screen's edges, a
long word cut where the screen ends. The rays dividing the sectors bend
outward toward the rim and are drawn only where a word sits. The disc turns
with the crank, every word with it, through a detent curve
(`disc_detent`): the crank's place inside its 24-degree step, raised to a
power (`DISC_DETENT`, 3) about the step's middle, is the share of a sector
the disc is drawn turned. It holds the word back as the crank starts and
slots the next one in quickly near the step, and meets the next word's
half-sector exactly where the step happens, so nothing jumps: the crank feels
like resistance and then a click, the tick being the clack. Once the crank has rested for a few
frames it settles on the nearest sector, completing a step the crank took
past halfway rather than sliding back. Each word is drawn once into a
one-bit label while its level stands and turned to its ray in the player's
own code, a pixel at a time, while its angle stands, and never with the
firmware's `drawRotatedBitmap`. Each sector passing the front ticks, the disc settling clacks, a pick
and a step back each sound a note and a refusal a buzz (`src/ui/sound.h`: short notes on the
SDK's synths, silent where there is no sound to play on). The fonts are
Panic's Asheville Sans 24 Light and Roobert 10 Bold (CC BY 4.0), shipped
under `Source/fonts/`.

### Nickname

The console has no keyboard, so a visitor picks from a pool of plain words
(Alder, Aster, Birch, …) filtered by the cartridge's word set, folded as the
engine folds a typed line (lower case, split on white space), and by who is
present. A returning visitor is offered their last name first. The device
keeps no list of names apart from the saves: the last name is the visitor's
record in the world's save, and starting a world over carries it across to
the fresh nickname screen, so it is still offered first. The engine's
own admission, `sprout_admit`, is the authority: it also refuses a reserved
word.

### Saves

A world is saved after every input that committed a turn:
`saves/<bundle hash>.json` is the stored world, byte for byte what `sproutc`
reads and writes, and `saves/<bundle hash>.log` is the last 32 log entries
and the clamp's seconds. The save is the diff from the world the cartridge
makes on a fresh load: an instance is written only where something about it
differs from its declaration, and only the fields that differ, so a new
world with the mailbox open is the world's name, its serial, one visitor
and one instance with one property, and the reader lays the records over a
fresh load of the cartridge the save is keyed to. One input is one save however many turns it runs: a
sentence with `everything` for a role that takes one thing runs a turn for
each thing in one frame, the log written at each, and the state is written
once, after the last, as a single turn's is. A crash part way through such a
line loses the line.

A bundle with another hash is a redeploy and starts afresh, with the old
save unused. A save that will not read, one written in a form before the
diff among them, is set aside as `.damaged` and the world starts again, in
words. A save that cannot be written, at the turn or
at any slice, stops play with the words on the screen, the world is let go,
and the shelf greys it with the reason until a save of it succeeds: a move
that is not kept is not played. "start over" in the system menu removes a
world's save and log, so its next arrival is a fresh one.

When the state is on disk: the log is written at the end of the turn, before
its reply shows; the state is written over the frames that follow, while the
visitor reads and builds the next sentence. The first frame after the turn
makes the state's bytes (`sprout_state_write`, a few kilobytes for the
caverns after a short play, under a millisecond on a desktop) and opens
`<hash>.json.part`; each frame after writes 16 KB of them
(`PLAYER_SAVE_SLICE`, one frame for such a save); the last closes the part,
renames it to `<hash>.json.tmp`, removes the old save and renames the `.tmp`
over it. The rename after an unlink is the pattern the whole-file writes
already use, since the SDK does not say that `rename` replaces a file; a
read that finds no save reads the `.tmp`, so a save cut short at any point
leaves the last whole state readable, and a half-written `.part` is never
read. The state does not change under the writer: a turn asked before the
save is done (a command, a tick, an arrival, a departure) first writes the
rest of it in that frame, then runs; the later turns of a line, which
nothing writes between, are the exception. Leaving the world, "start over"
(which drops the save rather than finishing it), opening the system menu
(`kEventPause`), locking the device and its low-power sleep all write what
is owed first, so the state is on disk whenever the app could be ended. The
bytes being written are held in an arena of their own until the last slice,
about the size of the state.

A tick's save waits. A visitor's own turn (a command, an arrival, a
departure) saves at once, as above. A tick that changed the state writes
its log line at once and owes a save, but the save begins only when
`PLAYER_SAVE_WAIT_SECONDS` (30) have passed since the last save began, or at
once on pause, sleep, leaving the world or the visitor's next turn, whose
save carries the tick's changes. A world whose every tick changes the state
(an NPC that roams) is so saved every 30 seconds while the visitor reads,
not every ten; what a crash between loses is at most that long of ticks,
which is the trade chosen: a save every 30 to 60 seconds is enough, and a
tick must never cost the reader a frame.

One visit per world, keyed by the world alone, with no token. A world left
open (the battery, a kill) is put away by a departure that tells nothing
when it is next opened, then caught up and arrived in.

### Time and the clamp

Host seconds are the device's seconds since 2000-01-01
(`playdate.getSecondsSinceEpoch`), clamped so they never go below the
greatest seen, which the save records. The reader asks for a tick every ten
seconds while a world is open, never on the shelf, in the background or
while the device sleeps or is locked; the time away owes no tick of its own
and is carried by the next tick's `elapsed`. A tick's save waits on the same
clamped seconds: it begins 30 seconds after the last save began (Saves
above), so a clock set back delays it rather than bringing it sooner, and a
pause, a sleep, leaving or a turn writes it regardless. A world opened after an absence is caught up by one
maintenance turn: wakes due are delivered at that turn, at most 64, with the
instant of the turn rather than their due times, and it narrates nothing.
A step's seed is drawn from the clock at the step's start and mixed by
`seeds.c`'s rule, and is written to the log.

A due tick waits for the hands to rest: it runs only in a frame with no
button down and the crank still, once a full second
(`PLAYER_REST_MILLISECONDS`, on the device's millisecond counter, which no
setting of the clock moves) has passed since the last such input on any
screen. A tick's turn is the world's work under the interpreter, 60 to 260
ms for the caverns while the thief roams, and the look after one that
changed the state is another 130 ms, so a tick that ran in the frame a
press landed in would hold the press for that long; held until the hands
rest, it lands where nobody is waiting. The ticks that fall due while the
visitor keeps cranking are one tick when the hands rest, the time between
carried by its `elapsed`, as the spec's Time › Ticks folds a missed
interval.

The look after a silent tick stays. A tick that changed the state and told
nothing is looked after in the tick (the scene polled again, the status
set), and the poll is not skipped when the turn's changes all sit outside
the visitor's place and hands: a place's description, a conditional exit
and a consent pass may read any object by its path (the spec's Names ›
Identifiers and scope), so the thief's purse filling three caves away can
change the words of the place the visitor stands in, and the spec's The
view makes a view stale at the world's next committed write turn, whatever
it wrote. The containment of what a turn upserted says nothing about what
the poll read. A poll that recorded what it read would let the reader keep
a view that no change touched; that is an engine change, not the reader's.

### Images

`media.show("cellar.png", "a damp cellar")` in a `describe` or a `do`
records the effect `{"image": "cellar.png", "caption": "a damp cellar"}`;
the transcript line a text client reads is the caption, or `[cellar.png]`.
The author places the `media.show` where the picture belongs: in a place's
`describe` for its scene, in a thing's `describe` or its `examine` for its
portrait, behind a flag the world keeps for "the first time". The app shows
what a turn asked for: after the turn's lines are told, every picture its
effects asked for (and, on arrival, the place's own) is shown one at a time
on the whole screen (`src/ui/gallery.h`), scaled to fit above a caption
line that also says `2 of 3  crank: next   A: close`, until A or B closes
them and the transcript reads (a tick's turn can ask for one too, so a picture
may come up while the reader is open and idle). The crank, or left and right, steps between
them slat by slat: the picture on screen is held an elastic moment,
stretched the way it will go, then whizzes out as the next whizzes in and
lands with the clack the sentence wheel makes; each step ticks. A picture is
a name until it is drawn: `src/ui/images.h` finds the asset at
`<cartridge path>.assets/<image>` when the screen draws it and lets it go
when another is on screen or the gallery closes, so pictures never count
against the world's memory on the console. The pdx holds a compiled image
under its name without `.png`.

### Opening a world

Opening a world is `sprout.open`, which reads and checks the cartridge's
header and caps, and then `sprout.step` once a frame, each inflating 32 KB
of the body into the block the world is read from, behind
`Loading Underground Caverns... 37%` with a bar, until the step that is
done maps the table, builds the catalogue and brings the world's words, and
the nickname picker follows. The open reads the file whole for the peek and
lets it go; the load then reads it again with `pd->file->read`, a piece as
the inflater asks, on the main stack, so the cartridge is never whole in
memory beside the world being built (on the console that is the file's
0.98 MB off the load's peak for the caverns). The caverns' 2.7 MB body takes
about 83 steps. A step that fails, a read of the file among them, says why
on the shelf, as a refused open does.

### The shelf

The shelf lists the `.sproutworld` files at the root of the app and of its
Data folder and in each one's `worlds/` folder (a copy in Data shadows the
app's). Each is inspected once, by file name and size, through
`sprout_peek`: its header and caps alone, so the shelf costs no more for a
big world than a small one. One the engine refuses (another format, a newer
language level, a static cap over the app's, a damaged file) is listed
greyed with the engine's reason and cannot be opened; a world too big for
the console's memory is refused at its open, with the same words on the
shelf afterwards. A world is titled by its name as
words, since a cartridge carries no other title: `printers_shop` is shelved
as `Printers Shop`, and the picker and the reader's first line call it the
same. The last row, "more worlds…", opens the download screen.

### Shipped worlds and downloads

The pdx carries the **graduated** worlds, listed in
`sprout-player/worlds.json` (`{"graduated": [{"world": "<corpus/good name or
a path>", "title": "…"}]}`). `scripts/playdate-player.mjs` packs each with
`sprout pack`, with its assets, into the pdx's `worlds/`, as
`<name>.sproutworld` for the name the world's manifest gives it. Today the
list is the worked microworld `printers_shop` and the studio's finished
`underground_caverns`. Every world the list names is inside this repository,
so the build and the gate never read another checkout. A studio world ships as a
pinned snapshot under `sprout-player/worlds/<world>/`: the files the studio
commits under `worlds/<world>/world`, less its `tests/` but for the plays this
list names, and a `source.json` (`{ repository, world, commit }`) naming the
studio commit they were copied at. New content lands in sprout-studio; when it
is worth shipping, `node scripts/sync-world.mjs <world> <path to a
sprout-studio checkout>`, run by hand, replaces the snapshot with the world at
that checkout's HEAD and rewrites the pin, and its diff is read before it is
committed. It refuses, writing nothing, a checkout with no such world, no
manifest, uncommitted changes to the world or no origin, and a world this list
has no entry for. The studio will write this file; until then this repository
owns it (hole 502). The build fails if the app would grey a listed world.

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

The index address is `PLAYER_INDEX_URL` in `src/ui/downloads.h`, a placeholder that
never resolves until a real one is chosen; `downloads.json` in the Data
folder points a built app elsewhere. Without Wi-Fi, with permission
refused, or with a server that cannot be reached, the screen says why, B
goes back, and the shelf says what happened and still lists what it has.

### Budgets the app ships

One table (`src/budgets.c`): the spec's figures where it gives one (50,000
steps, 8,000 output characters, 256 events, cascade 20, passages 8, set
role 8, spawns 8, shortest wake 60 seconds, one pending wake, nickname 24,
lists 16); people in a place unbounded, since a device has one visitor; and
where the spec leaves the row to the host, 64 extension effects a turn, a
five-second wall clock and 1,024 live instances. The poll's budget is the
app's own, `PLAYER_POLL_STEPS` in `src/budgets.h`, 500,000 where the spec's
default is 10,000: a poll lists every reading a visitor could make, and the
studio's `underground_caverns` spends 344,254 steps in its fullest room (the
living room with every treasure in the case, 12,153 readings, a 2.7 MB chip
tree); under 10,000 it faulted in 343 of its walkthrough's 354 rooms. The
build holds each graduated world's listed plays to that figure. The other
steps are the spec's and are not tuned: the Simulator runs far faster than
the console. The ten static caps with figures are checked
against a cartridge's recorded ones when it is shelved, and one recorded
larger is refused cap by cap in the words the compiler gives every host
(`bundle/compile/recorded.ts`, repeated by `src/budgets.c`), less the offer
of an exception; the five the spec leaves to the host (places, objects,
kinds, files, source bytes) are unset (hole 500).

### What is checked

Without a console and without the Simulator: the screens driven a
frame at a time through a fake `PlaydateAPI` whose graphics draw into a 400
by 240 one-bit frame; a C test program
beside each module of `sprout-player/src` through the same fake;
`played.test.c`, which plays `chip-tree` through the session against its
transcript; a round trip of
the save through `sproutc` (the save must read and write back byte for byte,
and the turns built from the chips must leave the stored world the
same lines typed leave); the download screen over a fake network, files and
engine; the signature check against RFC 8032; every packed world shelved;
the Node specs for the index and the build; and each graduated world's
listed plays (`"plays"` in `worlds.json`, scripts under the world's folder)
played through `sproutc play --offered` over the packed cartridge, the view
polled before every command under the app's poll budget and each reading
required to be among what it offers, a set role one member at a time, as the
sentence builder builds it, no turn faulting and each step saying what the
play expects of it. The Simulator target must compile and `pdc` must package the pdx with no
compiled script in it; the device target is built too where
`arm-none-eabi-gcc` is installed.
`docs/design/sprout-test-harness.md` lists each.

### What has run on a screen, and what has not

The app has run on the Linux Simulator (SDK 3.1.2, under WSLg): the shelf
with both graduated worlds, the arrival's loading line and bar, the nickname
screen with the remembered name first, the reader, the sentence builder's
fonts, greyed leaves and their reasons, the disc of words under the d-pad
and the crank, the arrival's picture with its caption, the download screen's
permission prompt and its refusals in words, and the ticks stopping while the
Simulator is locked and starting again after. The layout at 400 by 240 reads
as designed.

Not yet checked:

- a console: the device pdx builds and `pdc` packages it, and the app has
  not yet run on one;
- that the C API's `drawText` draws `_` and `*` as written;
- the sounds, which the Simulator's sandbox does not route;
- the crank's feel (24 degrees a step and 12 degrees a scrolled line are
  guesses);
- the budgets, tuned on hardware (the Simulator is far faster);
- the memory and the time of a big world on a console's 16 MB and 168 MHz:
  `underground_caverns` packs to 0.98 MB, its stored world is 480 KB, and
  its fullest room polls 344,254 steps into a chip tree of 12,153 readings
  that stays in the session and is read a level at a time; it plays whole
  through `sproutc` and the Simulator;
- a real download: a refusal of permission is read as `requestAccess`
  answering no or `newConnection` giving NULL, both told in words; which
  callbacks the system calls on a server that closes without a
  `Content-Length`, and whether the network calls need the main stack as
  the file calls do, are unchecked (they are put there to be safe);
- that a console waking from low-power sleep sends `kEventUnlock`;
- the time a picture takes to load on a console;
- "start over" in the system menu and its question, which the C tests drive
  over the fake;
- the text sizes on a console: that `/System/Fonts/Roobert-20-Medium.pft`
  and `/System/Fonts/Asheville-Sans-24-Light.pft` read on the device as they
  do in the SDK's `Disk/System/Fonts`, the line height `getFontHeight` gives
  for each, and that an options item's callback runs when the menu closes;
  the C tests drive the item over the fake;
- the time the save's first frame (making the bytes) and its 16 KB slices
  take on a console, and whether the slice size is right.

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
- `pdc` packages every `pdex.*` in the folder it compiles, so one pdx can hold
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
- `eventHandler` receives `kEventInit` first; a game that sets an update
  callback there is run as pure C, with no script; the allocator is
  `system->realloc`; files open with `kFileRead | kFileReadData`, which reads
  the app bundle and the Data folder together, and `listFiles` lists both.
- `system->getSecondsSinceEpoch` counts seconds since 2000-01-01.
- The network API needs system software 2.7. Wi-Fi sleeps 30 seconds after
  the last request.
- In C (`pd_api_network.h`, `Inside Playdate with C`), `http->requestAccess`
  must be called before `newConnection`, since C cannot pause the game for
  the dialog: it answers `kAccessAllow`, `kAccessDeny`, or `kAccessAsk` with
  the person's answer to come through its callback. `newConnection` gives
  NULL where permission was not given; a header, the end of an answer and the
  server closing each come through a callback on the connection; and `read`
  waits for more than is available, so the app reads only what
  `getBytesAvailable` says is there. The events are `kEventLock`,
  `kEventUnlock`, `kEventLowPower` and `kEventTerminate`; there is no wake
  event.
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
node scripts/check-runtime-c.mjs                             # now also builds the Simulator target and runs the player's C tests
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
  travelling final, and a typed line and a nickname folded by `typed.c` as
  `typedWords` folds them.
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
