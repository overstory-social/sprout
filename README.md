# Sprout

A small, total, deterministic language for interactive rooms and objects — the
kind of thing a person builds and other people walk through — with its runtime,
two stores, its first extension, and a command line.

```sh
npx @overstory/sprout-cli play node_modules/@overstory/sprout/examples/pottery-studio
```

```sprout
room porch {
  :name "The Porch"
  :lit false
  prose "Wet boards. A screen door."
  exit "through the screen door" to kitchen
  on :lantern_lit { self.set(:lit, true) }
}
```

Two packages, one version:

| package                 | what                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@overstory/sprout`     | `./lang` (the language: definitions, compiler, printer, engine, parser, the skill) · `./core` (the runtime: load an archive, take turns) · `./conformance`, `./testing` · `./store-sql` · `./store-document` · `./ext-media` · `./examples` |
| `@overstory/sprout-cli` | `sprout init · check · play · serve · pack · skill` on an archive folder or zip                                                                                                                                                             |

Each directory's README is its reference: [`sprout/lang`](sprout/lang/README.md)
is the language spec, [`sprout/core`](sprout/core/README.md) opens with the
twelve-line embedding, [`sprout/store-sql`](sprout/store-sql/README.md) and
[`sprout/store-document`](sprout/store-document/README.md) are the two stores,
[`sprout/ext-media`](sprout/ext-media/README.md) is pictures, and
[`cli`](cli/README.md) the command line. [`SKILL.md`](SKILL.md) is the language
for an LLM that writes Sprout with you (`sprout skill` prints it).

## Versions, and the language level

The package version is the npm version: both packages move together (a
changesets `fixed` group), and `0.x` means the API may still move between
minors. **The language's own compatibility promise is a separate integer,
`LANGUAGE_LEVEL`** (`sprout/lang/src/definitions.ts`): a microworld's manifest
records the level it was written for, a runtime refuses text newer than its
compiler, and a policy the language tightens after a text was accepted becomes
a warning at load rather than a refusal. The level moves only when the language
does; it is never the package version.

## Design

`docs/design/` is the design history: [`sprout.md`](docs/design/sprout.md), the
language proposal; [`2026-09-17-sprout-split.md`](docs/design/2026-09-17-sprout-split.md),
the architecture of core, the stores, the extensions and the CLI, with the six
outside reviews that shaped it beside it; and
[`sprout-worked-example/`](docs/design/sprout-worked-example/), one microworld
that uses every construct, kept compiling by a spec. Sprout was designed for
[Overstory Social](https://overstory.social)'s Understory, and the sections of
those documents that are about that product's hosting of it stay in that
product's repository; what is here is the language and the runtime.

## Developing

```sh
npm ci
npm run gate      # before every commit: lint, prettier, builds, every suite, spec typechecks, `sprout check` over the corpus
npm run e2e       # before opening a PR: install both tarballs into an empty folder, check and play an example
npm run check     # `sprout check` over sprout/examples and corpus/ (good passes, bad fails as expected)
npm run skill     # regenerate SKILL.md
npx changeset     # with a change that should be released
```

There is no CI: the gate and e2e run locally, a PR carries their receipts,
and the `pr-review` agent re-runs the gate at the PR head. `CLAUDE.md` has
the rules, including the `legacy/` fence for suites the rewrite leaves
behind. The language is mid-rewrite; `docs/design/sprout-design-spec.md`
is the language as it will be, and the code here is the one before it.

Every directory has a `boundary.spec.ts` that pins what it may import: the
language imports zod and nothing else; core imports the language; a store
imports core; the CLI imports the packages, PGlite and `node:*`. The
conformance suite in `./conformance` is what every store adapter must pass; the
two contention cases a single connection cannot prove are in
`store-sql/src/contention.db.spec.ts` and run against a real Postgres when
`DATABASE_URL` is set.

## Support

One maintainer. Issues are read and triaged when they are triaged; a bug with a
`.sprout` file that reproduces it gets there first. Pull requests are welcome
for bugs and for the language's own corpus; a language change is a design
conversation first (open an issue). No security contact beyond the issue
tracker: the runtime is a library that trusts its host, and the CLI's `serve`
is a development toy on loopback.

MIT.
