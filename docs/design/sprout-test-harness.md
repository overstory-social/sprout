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

### 2a. Golden transcripts

A `good/` world may carry `transcripts/*.txt`. Each is a script that
`sprout play` plays through real turns over the world as it loads: what
visitors type, `Marta> take brass key`, and what the host does,
`@arrive Marta`, `@leave`, `@tick`, `@advance 40 minutes`, `@seed 7`.
Playing it prints the script with what every reader read of each line
indented under it, so a transcript is its own golden: `npm run check`
plays each and compares, and `node scripts/check-transcripts.mjs
--write` replays each and writes what it printed. The diff is read as a
page's is. The worked microworld's transcripts play every chain in it
end to end, and where one plays in a way the spec did not mean, the
transcript pins what happens and the working notes' Open list says why
(the group "Found while playing the worked microworld").

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

`npm run e2e` packs both tarballs, installs them into an empty folder, and
runs the installed CLI: `init` a world, `check` it, and `check` a corpus
world. It proves the published packages work from outside the repository,
which nothing else does. It also checks the worked microworld and plays
each of its transcripts from the installed CLI, comparing what it prints
to the golden.

## Still to build

- **An author-facing test format** (B52): the same idea an author can
  write in a world's own folder — "after `light torch`, expect this line" —
  and run with `sprout test`. Golden transcripts are what it is built on.
- **Replay determinism**: a log recorded once and replayed against the same
  bundle produces byte-identical effects. A property test over random
  command sequences on the worked microworld, once B34 and B40 exist.
- **A generated-input harness shared across readers**: the parser's
  invariant loop extracted into a helper the lexer, manifest reader and
  command parser use, so the pattern is one thing rather than four.
