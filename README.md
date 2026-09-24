# Sprout

A small, total, deterministic language for multiplayer interactive-fiction
worlds, and the runtime that hosts them. A world is places, the objects in
them, and the kinds those objects are made of; visitors type or tap, and the
world answers in prose. It is being built to
[`docs/design/sprout-design-spec.md`](docs/design/sprout-design-spec.md),
which is the language whole and the authority where anything disagrees.

```sprout
world printers_shop is sprout.World {
  visitors are Creature
  visitors arrive at composing_room
  :season Season default autumn
}

enum Season { spring, summer, autumn, winter }
message :stir
```

Two packages, one version:

| package                 | what                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@overstory/sprout`     | `./lang` (the language and its compiler) · `./core` (the runtime's store port, records, memory store and turns; `./conformance`) · `./store-sql` · `./store-document` |
| `@overstory/sprout-cli` | `sprout init · check · parse · view · play` on a microworld folder, and `sprout skill`                                                                                |

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
cli/src           init and check, the inspectors: parse (what a world accepts) and view (what a visitor is offered), play, and skill
corpus/           worlds the gate checks: good ones pass, bad ones print exactly their page; skill/SKILL.md is what `sprout skill` prints
docs/design/      the spec, the working notes, the backlog, the reviews
```

## Developing

```sh
npm ci
npm run gate      # before every commit: no conflict markers, lint, prettier, builds, every suite, spec typechecks, the corpus
npm run e2e       # before opening a PR: install both tarballs into an empty folder, init and check
npm run check     # the corpus, its golden transcripts and the skill; `node scripts/check-corpus.mjs --write`
                  # and `node scripts/check-transcripts.mjs --write` regenerate them
```

There is no CI: the gate and e2e run locally, a PR carries their receipts,
and the `pr-review` agent re-runs the gate at the PR head. `CLAUDE.md` has
the rules.

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
