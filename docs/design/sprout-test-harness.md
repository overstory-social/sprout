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
and a test that must fail.

### 7. The C runtime's differential layer

`runtime-c/` is tested twice. Its own unit tests (`runtime-c/test`, built by
CMake and run by ctest) cover each module and the desktop host. The
differential layer holds the C runtime to the TypeScript one: `sproutc play`
(`runtime-c/host`) plays a cartridge's script on a fake clock with the
script's seeds, and `scripts/check-runtime-c.mjs` replays every corpus
world's transcripts through it. The C side has no parser, so
`scripts/resolve-script.mjs` first plays each script with the TypeScript
runtime and writes, beside it, the reading the TypeScript parser made of each
typed line (`player/src/readings.ts`); a line the parser answered is marked
and skipped. The replay prints one line per world and the list of worlds
that pass, and fails unless that list is `EXPECTED_PASSING` in the script,
which each later runtime item grows. The replay compares what each reader
was told, the log's entry for each turn that ran, and the stored world after
every step. `scripts/fuzz-runtime.mjs` extends it
over generated input: from a seed it plays offered, refused and unreadable
lines, ticks, time and tight budgets through both runtimes and writes the first divergence
as a transcript under the world's `transcripts/`, to be fixed and kept;
`npm run e2e` runs about two thousand of its readings over the corpus.

The C unit tests that load worlds and stores are held to goldens the
TypeScript specs write, in `corpus/goldens/`: `catalogues.json` (every corpus
world's ids, kinds, properties, verbs and typed phrases, written by
`cartridge.spec.ts`), `stored-worlds.json` (each world's initial state and
states from its transcripts) and `stored-reopened.json` (stored worlds edited
against their world, with TypeScript's `loadWorld` result and report), the last
two written by `play.spec.ts`. A spec compares what it computes with the file
and fails on a difference; `SPROUT_WRITE_GOLDENS=1 npx vitest run …` rewrites
it, and the diff is read like any golden. The C tests need the TypeScript build
first (`npm run build`), since ctest packs the corpus worlds through the built
CLI.

The evaluator is held to the TypeScript one the same way. `eval-goldens.spec.ts`
compiles a bench world whose bodies hold every expression a case names, packs it
as `corpus/goldens/eval.sproutworld`, and writes `eval.json`: two stored worlds
and, for each case, the cartridge entry that holds the expression, the object
whose body it is, the names bound, the seed and the step budget, and what
`evaluate.ts` ended in (the value in its canonical form, or the fault's name and
words) with the steps it spent. `runtime-c/test/eval.test.c` replays every case
and every spawn, and `sproutc eval` runs one case from the command line. The
step budget is held to the host's figure and the host's words, which differ from
the TypeScript budget's detail, so a budget fault is compared by the budget, its
figure and the steps spent, the step that went over included.

Prose is held to the TypeScript renderer the same way. `prose-goldens.spec.ts`
compiles a bench world (`fixtures/prose-bench.ts`) whose passages hold a slot of
each kind, `{if}`, `{for}`, `{one of}`, paragraphs and the edge cases of
reflow, packs it as `corpus/goldens/prose.sproutworld`, and writes `prose.json`:
two stored worlds and, for each case (`fixtures/prose-cases.ts`), the lines a
turn said unrendered, the seed, how many draws its bodies made first, the host's
output, step and passage-depth figures and whose turn it was, with what
`renderEffects` gave each reader of each line (or whom it cut short, or the fault
it ended in) and the steps spent. A last list holds the edge of every run of
letters and numbers and every letter whose upper case differs, each capitalised
as JavaScript does, which pins the Unicode tables the C layer carries
(`scripts/generate-prose-unicode.mjs`). `runtime-c/test/prose.test.c` replays
every case, and each `prose_*.test.c` replays its own area beside its direct tests.

The view is held to `pollView` the same way. `view-goldens.spec.ts` compiles a bench
world (`fixtures/view-bench.ts`: a yard, a gallery of value roles, a cloakroom, two
sacks, a dark cellar, a link) and writes `views.json`: for each bench case a stored
world, the visit, the host's poll figures and what `pollView` gave (the view as the
canonical JSON `view_json.c` writes, the chip tree over it, the steps it spent and the
fault it raised), and the same for a visitor arriving in every corpus world.
`runtime-c/test/view.test.c` replays them all, byte for byte, and each of
`offers`, `options`, `describe`, `darkness`, `chips` and `reading_sure` tests its
module beside the replay. `sproutc view` prints the page `sprout view` prints; the
check script compares the two for every corpus world, on its own line apart from
the transcript replay, over the stored world the TypeScript runtime writes for
the arrival.

The turns are tested on `corpus/good/turn-faults`, a world whose handlers fault on
purpose: `runtime-c/test/turn_<kind>.test.c` runs each kind on it and holds a faulted
turn to leaving the stored world byte for byte as it was. `seeds.test.c` and
`nickname.test.c` are held to goldens the TypeScript specs write
(`seeds.json`, `nicknames.json`, `budgets.json`).

## Still to build

- **Replay determinism**: a log recorded once and replayed against the same
  bundle produces byte-identical effects. A property test over random
  command sequences on the worked microworld, once B34 and B40 exist.
- **A generated-input harness shared across readers**: the parser's
  invariant loop extracted into a helper the lexer, manifest reader and
  command parser use, so the pattern is one thing rather than four.
