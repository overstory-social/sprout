# Changelog

Both packages carry one version (a changesets `fixed` group). The language
level (`LANGUAGE_LEVEL`) is a separate number and is noted here when it moves.

## Unreleased

### 0.1.0 — the first cut (language level 1)

The split out of [Overstory Social](https://overstory.social), where Sprout
was designed and first ran (`docs/design/`, and the git history before this
entry):

- **Stage 1 — the language** (`./lang`): definitions with caps, the compiler,
  the printer, the engine, the command parser, the skill; then extensions
  (`use <name>`; an extension statement records an effect and never performs
  one) with pictures as the first (`./ext-media`); then source as the truth —
  a microworld is text files, compiled at load, never a stored tree; then the
  archive: files and a manifest, compiled as one (`compileMicroworld`), with
  `in <room or container>` in an object's head.
- **Stage 2 — the runtime** (`./core`): `createRuntime({ store, ext })` →
  `load`, `reset`, `turn`, `complete`, `forget`, `inspect`, `snapshot`,
  `forgetActor`, `exportActor`, `trim`; the store port with a memory store and
  a framework-free conformance suite (`./conformance`); then `./store-sql`,
  the `sprout` Postgres schema with its migrations exported as data.
- **Stage 3** — `./store-document` (a five-method backend; memory and
  IndexedDB) and `@overstory/sprout-cli` (`init`, `check`, `play`, `serve`,
  `pack`, `skill`).
