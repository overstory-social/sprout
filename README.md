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

| package                 | what                                                                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@overstory/sprout`     | `./lang` (the language and its compiler) · `./core` (the runtime's store port, records and memory store; `./conformance`) · `./store-sql` · `./store-document` |
| `@overstory/sprout-cli` | `sprout init · check` on a microworld folder                                                                                                                   |

The compiler reads the declarations the backlog has reached (enums,
messages, properties, the world root and the kind its visitors are made
of, kinds and objects with their composition, and verbs checked against
themselves) and checks the expressions Phase 1 defined. Everything else —
verbs across libraries, prose, turns — lands one backlog item at a time; see the build order in
[`docs/design/sprout-build-backlog.md`](docs/design/sprout-build-backlog.md)
and the tracking issue #54.

## Layout

```
sprout/lang/src
  source/    where a thing was written: spans, the AST node rule, diagnostics, hashing
  syntax/    the lexer, the AST, the parser
  declare/   what a declaration means: types, enums, kinds and composition, objects, properties, messages, verbs, the world, actors
  check/     bindings and the expression checker
  bundle/    limits, the manifest, the closed bundle, the standard library, strict and lenient compiling
  runtime/   the turn's meter, values, range, ids, stored and live state, and what is remembered about an actor
sprout/core/src   the store port, its records, the memory store, the conformance suite
sprout/store-sql  sprout/store-document   the two store adapters
cli/src           init and check
corpus/           worlds the gate checks: good ones pass, bad ones print exactly their page
docs/design/      the spec, the working notes, the backlog, the reviews
```

## Developing

```sh
npm ci
npm run gate      # before every commit: lint, prettier, builds, every suite, spec typechecks, the corpus
npm run e2e       # before opening a PR: install both tarballs into an empty folder, init and check
npm run check     # the corpus alone; `node scripts/check-corpus.mjs --write` regenerates its pages
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
