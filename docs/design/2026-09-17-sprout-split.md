> **Design history.** This is the proposal as it was written and revised
> inside Overstory Social's repository in September 2026, kept here as the
> record of why Sprout is shaped as it is. Package names in it predate the
> published ones (`@overstory/sprout` with subpaths, `@overstory/sprout-cli`);
> paths like `packages/sprout-*` are the monorepo's, now `sprout/*` here.

# Sprout on its own — the runtime split (proposal, 2026-09-17; revision 3)

Eric's brief (2026-09-17): split the Understory's runtime out of
Overstory so that **Sprout** — a language and runtime for embeddable,
multiplayer, interactive-fiction vignettes — is publishable on its own,
and the **Understory** becomes Overstory's embedding of it. This
document pressure-tests the brief part by part, then designs the
result. It amends sprout.md where it says so (§8 lists every change);
the language itself — the grammar of §2, the compiler's refusals of
§3, the parser of §5 — is untouched except where §8 names a line. Data
in production is a flag-gated test feature and is reset; nothing here
migrates rows.

**Revision 3** (Eric's feedback on revision 2, 2026-09-17, §11.4):
core is a _player_ of a microworld, not an authoring system. A
microworld reaches core as an **archive** — a folder or a zip of
`.sprout` files with a small manifest — and core interprets it and
unfolds it into whatever store it was given so actors can traverse it.
Drafting, versions, publishing and the tick's schedule are the host's
(the Understory's), and a host outside Overstory authors in text files
with an editor. This cut core's surface roughly in half; §4 and §7 are
rewritten, and the rest is touched where the words changed.

**Revision 2.** The first revision (PR #519, merged 2026-09-17) was
put to six outside reviewers, one perspective each — operations,
language correctness, scalability and storage, prior art, a second
host's developer experience, and security — and this revision folds in
what survived pressure-testing. §11 records the method, what changed and
what was declined, with reasons; the raw critiques are beside this file
under `2026-09-17-sprout-split-reviews/`. The shape of the design did
not change. What changed is that its contracts are now written down in
enough detail that a host could build against them, and that four
mechanisms the first draft dissolved without noticing they were
load-bearing — per-definition publication, lock-free polling, the
published-definition media rule, and the foreign keys that made wipeout
complete — have named replacements.

Where things stand today (stage 1 of the split, PR #513, 2026-09-16):
`packages/sprout` is `@overstory/sprout` — the definition format, the
compiler and printer, the engine, the command parser, the skill —
importing nothing but zod. Everything else the Understory needs — the
world loader, the callables, the tick's publish step, the tables, the
Angular pages — is Overstory's, in `packages/backend/src/understory`
and `views/understory`. Stages 2 and 3 of that plan (the runtime's
ports; the frontend library) are what this document replaces.

---

## 0. The brief, pressure-tested

| Eric's proposition                                                                             | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three public repos: `sprout-lang`, `sprout-core`, `sprout-cli`                                 | **One repo; two published artifacts** (§2). The lang↔core seam will move for months; three repos means three release trains in lockstep and a stacked-PR problem across repositories. Revision 1 said "six packages, one repo"; the review showed that six independently versioned packages reintroduce at the registry what one repo removed at git (§11). So: one package with subpath exports, plus a bundled CLI, released together from one version number.                                                    |
| Lang = the language definition and interpreter; core = the runtime                             | **Yes, with the seam named precisely** (§1, §3, §4): lang owns what a _builder_ writes and what one message _means_ — the compiler, the evaluator, the extension points, the grammar table. Core owns what a _player_ does — microworlds, actors, turns, the typed-command matcher, storage, versions. The evaluator (today's `engine.ts`) is lang's; it is the language's semantics, not a runtime service.                                                                                                        |
| Sprout does not care about permissions or reachability                                         | **Yes.** Core's one entry point takes `(microworld, actor, input)` and assumes the host already decided the actor may act there. Reachability _inside_ a microworld (exits, closed doors) is the language's; reachability _to_ a microworld is the host's. Presence stays core's — "also here" is runtime state — with the host supplying each actor's stable name per turn (§4.3). What the host also owes, and the first draft forgot to say: a turn budget per actor (§7.1), because core has no clock.          |
| Basic input/output in Sprout; the embedder wraps it in a web interface                         | **Yes: a turn in, a turn out** (§4.2). Input is a typed line, or an opaque chip token core itself minted for the scene; output is the lines to print, the scene as it now stands with a stamp, and the affordances (what could be said, what could be clicked). Rendering — HTML, chips, a lightbox, ANSI — is the wrapper's.                                                                                                                                                                                       |
| A CLI, maybe a separate package, on PGlite                                                     | **Yes, separate** (§6): `init`, `check`, `play`, `serve`, `skill`. It takes a folder or a zip and plays it. `serve` is a loopback line-protocol server two terminals can share, and it shows multiplayer for real because the runtime delivers other actors' arrivals and moves to a per-actor inbox (§4.3).                                                                                                                                                                                                        |
| An extension mechanism; media and `show` as an extension the Understory installs               | **Yes** (§3.5). Five extension points, every one declarative, under one rule: an extension statement _records an effect_; it never performs one. Extensions are host-trusted code, not sandboxed, and core contains a buggy one the way it contains a faulting object. `use media` in a microworld names the dependency, so a microworld is portable and a host without pictures refuses it at compile time.                                                                                                        |
| Storage agnostic; SQL and document adapters                                                    | **Yes** (§4.6, §5): one store port, two layouts (rows for SQL; several small documents per microworld for document stores, split along the write-rate seam), one conformance suite every adapter runs. The port states what a document store's optimistic transaction needs stated: the turn may run more than once.                                                                                                                                                                                                |
| Firebase functions treat core as a runtime dependency: input in, what-to-show and metadata out | **Yes** (§7). One turn callable replaces twelve (kept for a release as forwarders); the builder keeps its own draft and version tables of source text; the tick assembles each zone's published archive and hands it to core's `load`, per zone, in its own transaction after the edition commits; the runtime tables become the SQL adapter's `sprout` schema with no foreign key to a profile — and two port methods, `forgetActor` and `exportActor`, replace what the foreign keys did for wipeout and takeout. |
| Interpreted (or JIT-compiled) rather than stored in a compiled format                          | **Yes — and it changes more than it looks** (§3.2). The stored, versioned, flag-pinned artifact becomes Sprout _source_; the AST is compiled at load, cached per published stamp, never persisted. That deletes the source-beside-AST rule, `format: 1`, the upgrade path, the form editor and the `mode` flag. It also trades a stored-format migration for a language-compatibility promise, and §3.2 now gives that promise a mechanism instead of a sentence.                                                   |
| _(not in the brief)_ Evennia, Ranvier, LambdaMOO; Inform; Twine, Ink, ChoiceScript             | **Considered and declined, on the record** (§11.3). MUD engines script in a general-purpose language in the server process, which understory.md §3.2 refuses; Inform's world would be written in Inform 7 on a VM with its own state model (sprout.md §5.1); the authored-branching systems have no shared persistent world and no parser. The bespoke total language and Inform-lineage matcher stay.                                                                                                              |

Three things the brief did not say that the design has to decide, all
made here and listed in §8: **core plays an archive and owns no
authoring state** — drafts, versions, publishing and schedules are the
host's; **a builder's draft is just another microworld** loaded from the
draft archive under an id the host chooses; and **the host's save and
publish refuse, core's load degrades** — a definition that cannot
compile at load is absent from the microworld, never a dark world and
never compiler text in a visitor's transcript.

---

## 1. Words

The brief says "sprout instance" for the unit core loads. The language
already uses _instance_ for a placed or spawned thing of a kind
(sprout.md §2.8). Renaming the language's word would touch every
document a builder reads; so the runtime unit gets a different word —
**microworld** (Eric, 2026-09-17: a nod to Papert's microworlds, the
bounded, explorable little universes of the Logo tradition, which is
what a Sprout vignette is) — and the engine's loaded slice, today
confusingly called `SproutWorld`, is renamed too.

| word           | means                                                                                                                                                                                                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **microworld** | The unit core loads and the host permissions: a set of definitions (rooms, objects, kinds) with their versions, the live state of every object in it, its actors, its log. One Understory zone is one microworld. Opaque id, the host's. An object exists in exactly one microworld, ever (§4.1).                                                          |
| **scene**      | The immutable slice the evaluator reads for one action: one room, one actor, everything in reach, and an _elsewhere_ for a move. The mutable half of today's `SproutWorld` — budget, id minting, the live count, the kinds — is the **turn context** beside it (§3.4).                                                                                     |
| **definition** | A room, an object or a kind as written. _Instance_ keeps its §2.8 meaning: a placed or spawned object with state.                                                                                                                                                                                                                                          |
| **archive**    | How a microworld reaches core: a set of named `.sprout` files plus a manifest (`sprout.json`: the language level the text was accepted at, the extensions it uses, the entry room) — a folder, a zip, or an in-memory list of `{ name, source }`. What the host stores, versions and edits is its own business; core sees the archive it is handed (§4.4). |
| **file**       | One `.sprout` file in an archive, holding one or more definitions. Revision 1 called this a _unit_; the word collided with unit tests.                                                                                                                                                                                                                     |
| **program**    | An archive compiled (§3.3): every definition resolved or marked absent, every kind chain folded, every exit checked, the grammar table built. Cached per archive stamp; never stored.                                                                                                                                                                      |
| **actor**      | A player, to core: an opaque id and a stable, host-unique name the host supplies per turn. An `Actor` object to the language, as today.                                                                                                                                                                                                                    |
| **turn**       | One request to core and its answer (§4.2). A **read turn** writes nothing but the actor's own row and takes no lock; a **write turn** may change the microworld and is serialized (§4.5).                                                                                                                                                                  |
| **store**      | The port core reads and writes through (§4.6); an **adapter** implements it for one storage.                                                                                                                                                                                                                                                               |
| **extension**  | Host-installed, host-trusted code that adds a value type, a well-known property, a statement, a compile check and a transcript line to the language (§3.5). An archive says `use <name>` to depend on one.                                                                                                                                                 |
| **host**       | Whoever embeds core: the Understory, the CLI, someone else's server.                                                                                                                                                                                                                                                                                       |

Objects are addressed by their **source identifier** within a
microworld (`cellar`, `torch`), which is what a builder writes and a
player of the CLI can read in a log; a spawned thing is `Kind#n` from a
per-microworld counter, sorted numerically (no identifier contains
`#`). The uuid a host keeps for a file row (Overstory's builder URLs,
a flag's pin) is the host's and core never sees it. In code the word is
`microworldId`, everywhere, so prose and signatures agree.

---

## 2. Packages and the repository

One public repository, `overstory-social/sprout`, MIT, an npm workspace.
Inside it the seam is kept by **directories and their boundary specs**
— `lang/` imports zod and itself; `core/` imports lang and itself;
`store-sql/`, `store-document/`, `ext-media/`, `cli/` each import what
their row says — exactly as `packages/sprout/src/boundary.spec.ts`
holds the line today. What is **published** is two artifacts:

| artifact                       | contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@overstory/sprout`     | The runtime and the language, as subpath exports: `.` (lang + core + the memory store — hello world is one install); `./lang`; `./core`; `./store-sql` (`pg` types only; the host supplies a client); `./store-document` (the port over a `DocumentBackend`, with the memory and IndexedDB backends); `./ext-media`; `./conformance` (the store suite, framework-free); `./testing` (`testWorld`); `./examples` (the studios as archives — what the README, the CLI and Overstory's seed all read). |
| `@overstory/sprout-cli` | `sprout` on the command line (§6), **bundled** by esbuild so it carries its own copy of the runtime and PGlite and depends on nothing at install. `npx @overstory/sprout-cli play` runs it.                                                                                                                                                                                                                                                                                                  |

Why one package where revision 1 had six, said once: the review found
that six independently versioned packages under one scope reintroduce
what the one-repo argument removed — six semver ranges that move
together every time the seam moves; a `peerDependency` story for lang
that nobody had written, without which two copies of lang silently
break the extension registry; and a "newer lang than core" skew that
exists only because lang and core can differ in version. A subpath
export is a boundary a host can see and a spec can enforce; a package
boundary adds a version number to it and nothing else. The one reason
to split a package is a heavy transitive dependency, and there is none
here: `pg` is a type-only dependency, and PGlite is the CLI's, which is
why the CLI is the second artifact and bundles. If a second host ever
wants lang without core, `./lang` is already that.

Versioning, stated for a host in one line: **pin `@overstory/sprout`
and `-cli` to the same exact version; they are released together.**
`0.x` for as long as the seam moves; breaking changes in any minor;
the language's own compatibility promise is a separate integer (§3.2)
and never a package version. The repo uses `@changesets/cli` with a
`fixed` group, so a release is one command. A support policy sits in
the README from day one: issues are triaged when triaged; there is one
maintainer.

Overstory consumes the published package the way it consumes zod:
an exact pin in the **root** manifest, bundled by esbuild into the
functions bundle (nothing changes in the backend manifest or its
`--external:` list; CLAUDE.md's rule for build-time dependencies
applies because the bundle is what ships). Until the split-out (§9
stage 4) the directories live in Overstory's own workspace under
`packages/sprout-*`, exactly as `packages/sprout` does today, so the
gate is the bar throughout.

---

## 3. `@overstory/sprout/lang`

### 3.1 What moves, what changes name

From `packages/sprout/src`: `definitions.ts` and `sprout.ts` (the
types and caps), `sprout-lang.ts` (lexer, parser, printer),
`sprout-skill.ts`, `engine.ts`. `parser.ts` — the typed-command
matcher — goes to core, but not all of it: the **grammar table** is a
language fact and stays in lang. Today `parser.ts` owns both the
matching and the rule that a message with no `grammar` line gets
`"<name> [self]"` plus one line per argument, and the built-in verb
vocabulary (`take`, `look`, `go`, `give`, `inventory`, `wait`, `help`).
The compiler already checks grammar slots; the skill teaches the
defaults and the built-ins. So the `Program` (§3.3) carries, per
reachable message, the **complete** tokenised line list — authored plus
defaulted — and the built-in verb table with its slots, produced in
lang and pinned to the skill by a spec. Core keeps only what is a
runtime question: tokenising the player's line, the dictionary from live
state, scoring, disambiguation, pronouns, completion.

Renames, all mechanical: `SproutWorld` → `Scene` plus `TurnContext`
(§3.4); `SproutObject` stays; `UNDERSTORY_*` caps → `SPROUT_*` (the
language's caps carry the language's name; the product's caps — rooms
per zone and the like — are core's microworld limits, §4.4, and
configurable). `VerbOutcome` → `Outcome`, and it grows an `effects` list
(§3.5).

### 3.2 Source is the truth (amends sprout.md §4)

sprout.md §4 chose (c): store the source and the AST, the AST
authoritative, the runtime never parsing text. Eric's intuition is that
Sprout should be interpreted, and he is right, for a reason §4 did not
weigh: **a stored AST is a public, frozen format.** Every change to the
tree — a renamed node, a new statement, a field made a list — becomes a
stored-format migration with an upgrade function kept forever, which is
exactly what `format: 1 → 2` and `upgradeSproutDefinition` already are,
one version in. A language that is meant to be embedded by other hosts
cannot ask every host's database to follow its internal tree.

So:

- **The stored, versioned, flag-pinned artifact is source text.** A
  file's draft is text; a file's published version is text. What a
  moderator diffs is text, which is what a moderator reads anyway.
- **Compilation happens at two moments and never persists.** In the
  host's authoring tools — the Understory's save and publish, the CLI's
  `check`, an editor plugin — to refuse problems (§3.3, §7.1); at
  core's _load_, to build
  the program core runs. The program is cached per microworld by a
  key of `(microworldId, archive stamp, LANGUAGE_LEVEL, extension set)`
  — the stamp is a hash of the archive's contents, so reloading an
  unchanged archive invalidates nothing — in an LRU bounded by entry count _and_ bytes, sized as a
  named option of the runtime, evicting the prior key on a bump.
  Compilation runs **outside** the write lock (read the stamp, compile,
  take the lock, re-check the stamp). A microworld's total published
  source is capped (§4.4 `sourceBytes`), so the worst compile is a
  number Eric chose rather than a product of five other numbers, and
  every turn logs `compileMs` and whether the cache hit (§4.7) so the
  "milliseconds" claim is evidence in a month rather than prose. If
  measurement ever says the cold compile is not free, the SQL adapter
  may add a **derived** row — compiled program by stamp and level,
  dropped wholesale on a level change. That is not a stored format,
  because nothing ever reads a stamp it did not write; §11 records it
  as allowed and not built.
- **What is persisted and public is a closed, short list**, and the
  list is the whole of lang's compatibility surface: **Sprout source**;
  the **archive manifest** (`sprout.json`, with its own `format: 1`);
  and the **value shapes** `SproutValue` / `SproutState` plus each
  extension's storage shape, because object state and memory are
  stored and cross the port. Those are semver-guarded. Everything
  else — the AST, the `Program`, the store's other records, the chip
  token — is internal and may change in a minor version. The AST is an
  exported TypeScript type and an unstable one; the editor's problem
  markers, the skill generator and the printer use it; nothing writes
  it down.
- **The compatibility promise has a mechanism.** Revision 1 said
  "syntax is added, not changed" and left it there; the review pointed
  out that the project has already tightened two _semantic_ checks
  (#337, #441) in ways that would have made published text stop
  compiling, and got away with it only because a stored AST let the
  engine skip the offending statement. So:
  1. Lang exports **`LANGUAGE_LEVEL`**, an integer bumped only when
     syntax is _added_. An archive's manifest records the **minimum level
     its text needs**, computed by the compiler from what the text
     actually used — not "the version that last touched it" — and the
     host stores it with whatever it versions. Core refuses to load a
     file whose level exceeds its own with a closed door and an operator
     log line, never a visitor-visible error; a functions rollback
     therefore darkens only files that genuinely used new syntax, and
     only those files (they are absent, §3.3).
  2. The compiler has **two severities**. _Structural_ problems —
     syntax, resolution, caps — are fatal at every moment. _Policy_
     refusals (the §3 list: a write in `describe`, a redeclared
     well-known type, …) each carry the level that introduced them; in
     the host's **check and publish** every check is fatal, so a
     tightening lands the next time a builder publishes, visibly, with
     the problem named; at **load**, a policy refusal newer than the
     archive's recorded level is a warning plus the engine's existing
     skip semantics (#441's rule, generalised), surfaced in `inspect`.
  3. The honest cost, counted: a syntax _break_ — the one thing the
     level scheme does not cover — would require keeping the old front
     end alive to parse old text before the printer can rewrite it, and
     that is more retained code than the seventy-line upgrade function
     this section deletes. The commitment is therefore **add-only
     syntax**, and the printer-rewrite escape hatch is for the one time
     that promise is broken, done once, at publish, visibly.
- **Nothing to JIT, and nothing to stop one.** The evaluator walks the
  tree the compiler built; if a closure-compiling evaluator is ever
  worth it, lang adopts it and no host notices.
- **What is deleted:** `format`, `format: 1`, `upgradeSproutDefinition`,
  the `source` field beside the tree, the `mode: form | code` flag, the
  v0 form editor and its `SproutBehaviour` types, `sproutProblems` for
  the form. The v0 definitions in `seed-understory.ts` are printed to
  `.sprout` files once (the printer already round-trips both studios on
  every PR) and become the archives under `./examples`.

What §4 (a) feared, answered: _untrusted text in the hot path_ — the
same compiler that accepted the text at save runs at load, on text that
has already passed it; it is total and capped and has no `eval`, and
the per-turn log line is where a regression would show. _A parse error
surfaces to a visitor_ — never: a file that fails to compile at load is
absent (§3.3), the visitor reads the fixed fault text if their room was
in it, the host is told with the problems. _No static checks_ — every
check runs in the host's authoring tools, as now; only the tree is
thrown away. _Autocomplete needs the grammar of every message_
— it reads the program, held in memory.

### 3.3 Microworld compilation

Today a source is one definition, compiled alone with options the
saver gathers from the zone, and the backend keeps a room-identifier ↔
uuid map with `_2` suffixes for collisions. All of that is the
language's job once compilation is of a **microworld**:

```ts
compileMicroworld(archive: Archive, options): Compilation;      // Archive = { files: { name; source }[]; manifest }
// Compilation = { program: Program; problems: Problem[]; warnings: Warning[]; absent: Absent[] }
// Problem = { file, line, column, message, severity: 'structural' | 'policy', level?: number }
// Absent  = { definition, reason }   // what the program runs WITHOUT, and why
```

- A file may hold any number of `kind`, `room` and `object`
  definitions (sprout.md §2.1's example is one file). Identifiers are
  unique across a microworld's rooms and objects; kinds are capitalised
  and separate.
- `exit "up" to hall`, `object torch: Torch in cellar`, `send bench :x`
  resolve within the compilation. The compiler distinguishes **a room
  no file defines at all** (a problem, at save) from **a room defined in
  a draft but not published** (legal; the door is absent at play,
  understory.md §10.4). Revision 1 made both silent.
- **`use <extension>` is an archive-level fact.** Each file may say
  it; the union of the files' `use` lines is the archive's extension
  set (the manifest repeats it, so a host can refuse before compiling),
  and _every_ file compiles under that one keyword set and one
  well-known table. Revision 1 reserved keywords per file, which
  contradicted the single identifier namespace two paragraphs earlier
  (an object called `show` in one file, a `show` statement in another).
  The CLI reads the same lines to say "install ext-media to play this".
- **Compilation is total at load; the host's checks are strict.** The
  same function serves both, by a flag. In `strict` mode (the
  Understory's save and publish, the CLI's `check`, an editor) an
  unresolvable reference is a problem naming the file. In `lenient`
  mode (core's `load`) a definition that cannot be compiled or resolved
  is **dropped from the program** and listed in `absent`, with its
  exits and references treated as missing: an object of a missing kind
  is inert and unlistable, a `send` to a missing target is a no-op, a
  door to a missing room is not there. The microworld keeps running
  minus the broken part. This is what makes a moderator's take-down
  safe (§7.1): the host loads an archive without the file, the rest
  compiles with what is now absent, and nothing goes dark that did not
  depend on the removed file.
- **Delivery order is defined by the language, not by id strings.**
  sprout.md §2.5 says "contents in id order", which with uuids was
  arbitrary-but-stable and with identifiers would become alphabetical
  and builder-visible. The rule is now: within a container, placed
  objects in **declaration order** (files in name order, definitions in
  file order), then spawned objects in **spawn order**. Renaming a
  torch does not reorder a cascade.
- Every cross-definition check §3 lists — a placed kind with an
  abstract message, a `pass` rule on a non-container, a `:names`
  collision in one room, a `changed` for a property nothing sets —
  runs here, once, with the whole microworld in view. The warnings
  know that an extension statement does not "send" anything.
- The `Program` is what the evaluator and core's matcher read:
  resolved definitions by identifier, folded kind chains, the room
  graph, the complete grammar table (§3.1), the extension set, the
  `absent` list, and the media ids (or any extension's collectable
  values) the text names — which is how the Understory's media rule
  stays a join rather than a scan (§7.1).

`compileFile(source)` remains for an editor's per-keystroke check and
for the CLI's `check --json` of one file; it reports what can be known
alone, and it is the **only** compile an editor runs per keystroke —
the archive compile is for the host's save and publish (§7.1). Both
live in lang, so an authoring tool — the Understory's workspace, the
CLI, an editor plugin (§6) — needs lang and nothing of core.

### 3.4 The evaluator

Unchanged in semantics — sprout.md §2 and §8 stand: totality by
grammar, containers as the bus, every move a proposal, `describe`
reads, depth and budget as faults, deterministic order (now as §3.3
defines it). What changes is the edge, and the edge is listed in full,
because it is the seam this document exists to draw:

```ts
// the immutable slice, built by core from the store
interface Scene { room; actor; objects; elsewhere?; program: Program }
// the mutable half of today's SproutWorld, one per turn
interface TurnContext { budget: SproutBudget; mint(): string; liveCount: number; ext: ExtensionSet }

runVerb(scene, ctx, targetId, message, args): Outcome
runMove(scene, ctx, whatId, toId): Outcome          // refused carries the guard's words
describe(obj, scene, ctx): { prose; effects }
openVerbs(obj, scene, ctx): GrammarLine[]           // for affordances (§4.2)
visibleItems(scene, container); memoryOf(scene); takeableOf; openOf; capacityOf
normalizeObjectState(def, raw, ctx.ext); actorObject(id)
```

`ctx.ext` is the extension set the program was compiled with, and it
reaches **every** helper that consults the well-known property table —
`normalizeObjectState` included, so a `self.set(:image, …)` survives a
reload (revision 1 threaded `ext` into four entry points and lost the
value on the next load). `Outcome` carries, as today, the narration,
the ids whose state or memory changed, the moves, what was spawned and
destroyed, the envelope count and depth, and a fault; `shown` becomes
the general `effects`. `Scene` is built by core from the store; lang
never sees a row.

### 3.5 Extensions

The language's core vocabulary is what sprout.md §2 defines _minus_
media: `:image`, the `media` value type and `show` (§2.9) are the first
extension, and the shape they need is the shape every extension gets.
Checked piece by piece against what `media` is in the code today, the
mechanism has five points, all declarative:

```ts
const lang = sprout({ extensions: [media] });

interface SproutExtension<E extends Effect = Effect> {
  name: string;                                  // what `use <name>` names
  valueTypes?: Record<string, ValueType>;        // `:image media "m-…"`
  wellKnown?: WellKnownProperty[];               // { name: 'image', type: 'media', on: ['room', 'object', 'kind'] }
  statements?: Record<string, StatementSpec>;    // keyword → args, purity, check, run
  effect: ZodType<E>;                            // the wire shape of what `run` records — a host validates it
  transcript?: (e: E) => string;                 // '[a picture opens]' — the CLI's and the README's default
}

interface ValueType {                            // everything `media` needs today, not two of six things
  literal: LiteralSyntax;                        // `media "m-…"` | `media` (none)
  fit(raw: unknown): Value | undefined;          // storage → value, or "does not fit"
  default: Value;
  print(v: Value): string;                       // the printer's half
  storage: ZodType<Value>;                       // the persisted shape — part of §3.2's public list
}

interface StatementSpec<A extends string = string> {
  args: { name: A; kind: 'target' | 'symbol' | 'string' | 'expr'; optional?: boolean }[];
  inDescribe: boolean;                           // may appear in describe (read-only position)
  inConsent: boolean;                            // may appear in a consent guard — default false, see below
  check?(args: BoundArgs<A>, program: Program): Problem[];      // at save and publish, like every other check
  run(frame: ReadOnlyFrame, args: BoundArgs<A>): E | void;      // at play: read, and record
}

interface ReadOnlyFrame {                        // the WHOLE api an extension body programs against
  self: ObjectRef; room: ObjectRef; container: ObjectRef | null; actor: ObjectRef;
  resolve(name: string): ObjectRef | null;
  get(ref: ObjectRef, prop: string): Value | null;
  is(ref: ObjectRef, kind: string): boolean;
}
```

`args` being data gives the parser, the printer and the completion
table the statement for free — no `shape` mini-language, no printer
hook. The rule that keeps this safe, in one line: **an extension
statement records an effect; it never performs one.** `run` returns a
value the evaluator appends to `Outcome.effects`; what happens
_because_ of an effect — a lightbox, a signed URL, a line in a terminal
— is the host's, after the turn.

Two things revision 1 left as assertions are now mechanisms:

- **Purity is two flags, and `inConsent` defaults to false.** `show`
  belongs in `describe` (examine opens the picture) and must not be
  admitted to a consent guard: sprout.md §8-4 says a refused `take`
  leaves the world exactly as it was, and an effect recorded on a
  refusal is a change the actor sees. Revision 1's single `pure` would
  have opened that.
- **An extension is host-trusted code, and core contains a buggy one.**
  `run` is JavaScript in the host's process; a type named `ReadOnlyFrame`
  stops nothing at runtime. So the frame handed to `run` is a frozen
  view with accessors only, and the extension conformance spec asserts
  that a mutating `run` throws; every `run` is wrapped so that any
  throw becomes a `Fault` naming the extension (today a non-`Fault`
  error escapes the fault machinery and 500s the turn unrecorded);
  each `run` is charged against the turn's event budget and the number
  of effects per turn is capped, so a `describe` over two thousand
  objects cannot return two thousand effects; and `inDescribe: true` is
  **verified**, not trusted — the conformance spec runs every such
  statement in describe position against a frame whose write paths
  throw. The trust boundary is named for what it is: host ↔ extension
  author, an npm supply-chain boundary under `@overstory/*`, the
  shape CLAUDE.md already records an outage for.

`use media` at the top of a file names the dependency (§3.3: an
archive-level fact). The compiler refuses `show`, `:image` and `media`
in an archive without it, refuses `use` of an extension the host did
not install ("this host has no pictures"), and reserves an extension's
keywords across the whole archive that uses it.

**Two consequences for the core language, recorded in §8.** First, the
core grammar today parses `:p "text"` as a _media_ property, because
there is no string property type; take media out and a quoted default —
which sprout.md §2.2 already lists as legal — becomes a syntax error.
So the core language gains a **`string` property type**, and media's
literal becomes `:image media "m-…"` / `:image media` (none), which is
also more honest. Second, `SproutValue` gains nothing: `null` was
already in it for media, and an extension's `storage` schema says what
its values look like — the persisted union is closed by the extension
set, which is why the set is part of the program cache key.

Not extension points, on purpose: the matcher's built-in verbs
(`take`, `look`, …), the containment protocol, the bus, the budget. An
extension that needs a new _verb_ writes it as a message on a kind, in
Sprout; one that needs a new _value_ kind writes a value type. If a
real need appears for more (a timer, a random draw), it is a language
proposal, not a registry entry.

### 3.6 Also exported

`sproutSkill(lang)` renders the SKILL.md from the language _as
configured_ — with the extensions' statements and well-known properties
in it — so the Understory's skill mentions pictures and a plain host's
does not; `npm run sprout:skill` says which set it renders. The
**lexer** is exported, so the frontend drives CodeMirror's
`StreamLanguage` from the compiler's own tokenizer rather than the
hand-kept keyword set in `views/understory/sprout-language.ts` — one
grammar, one source of truth, no new dependency. The record types a
store carries (§4.6) are exported as zod schemas from `./core`, because
an adapter author needs them and the document adapter validates what it
reads back.

---

## 4. `@overstory/sprout/core`

### 4.0 An embedding, in twelve lines

Revision 1 specified the seams and omitted the surface: there was no
constructor. This is the block at the top of core's README, and every
signature below is a method on the value it makes. Core's whole job is
in the two calls at the end: **load** an archive, then **turn**.

```ts
import { sprout, createRuntime, memoryStore } from '@overstory/sprout';
import { media } from '@overstory/sprout/ext-media';

const runtime = createRuntime({
  lang: sprout({ extensions: [media] }),
  store: memoryStore(),                 // or sqlStore({ client }) / documentStore(backend)
  limits: { rooms: 32 },                // §4.4 defaults otherwise
  cache: { entries: 64, bytes: 64 << 20 },
});

await runtime.load('demo', archive, now);          // an archive: files + manifest; compiled, unfolded into the store
const res = await runtime.turn({ microworldId: 'demo', actor: { id: 'u1', name: 'marta' }, input: { kind: 'enter' }, now });
```

Errors are one class with codes — `SproutError` with `code` in
`no-such-microworld | language-too-new | not-loaded | limit-exceeded
| no-such-extension | duplicate-name` and a `detail` — and one rule:
**compile outcomes are always returned as `problems`, never thrown;
everything else throws `SproutError`.** A fault is neither: it is a
turn's outcome (§4.5).

### 4.1 The microworld model

What a store holds for one microworld, in words (the port's types are
§4.6). Core owns **runtime** state only; nothing here is authored.

- **Microworld**: id; the **archive** as last loaded (files and
  manifest — kept so a fresh process can recompile after a cold start
  without asking the host), its content stamp (the program cache's
  key), the manifest's language level and extension set, the limits in
  force (§4.4), and the actor and spawn counters — the spawn counter
  kept **off** the row a turn locks (§5.1).
- **Objects**: the live tree — id (identifier or `Kind#n`), kind chain
  root, container id, home room, state, `spawned` and `destroyed`. A
  placed object with no row is at home at its defaults, as today. A row
  whose identifier resolves to nothing in the program (the host loaded
  an archive without it) is dropped at load and reported in `inspect`.
  **An object exists in exactly one microworld and no core API moves
  one between microworlds**, so understory.md §7's "foreign items are
  inert outside their home zone" holds by construction.
- **Actors**: id, the name the host last supplied, the room they stand
  in, `lastSeen`, the narration of their last turn (so a reload prints
  it again), their last noun, and **`pending`**: the lines other
  actors' turns queued for them (§4.3), drained at the top of their
  next turn. Revision 1 deferred that field to "later"; the review
  pointed out it is the multiplayer, that `serve` proves nothing
  without it, and that adding a record field after publication is a
  major version across every adapter. It is in, and it starts empty.
- **Memory**: per **microworld and actor** — what each object
  remembers about them (`actor.remember`), keyed by object id. Every
  signature and every document key carries the microworld, because
  object ids are source identifiers and `torch` in one microworld must
  never share a blob with `torch` in another. Never reset by `reset`;
  the actor's to forget (§4.2 `forget`).
- **Actions** and **misses**: the instrumentation of sprout.md §2.11
  and §5.2 — per write turn: command, events, depth, spawned, faulted,
  the chain when faulted, `missed`, and now `durationMs` and
  `lockWaitMs` (§4.7); per donated miss: the input, what could have
  been said and named, the room's state. **The action record carries
  no actor.** Today's row does, and the review showed that a zone owner
  holding both tables re-attributes every "anonymous" donated miss to
  the mask that typed it with a one-second join; the instrumentation
  questions (`GROUP BY instigator`, depth quartiles) never needed a
  person. Read turns append nothing (§4.2). Retention is a limit
  (§4.4); `trim` is housekeeping off the turn path (§4.5).

A builder's **draft play** is not a second copy of state inside one
microworld: the host loads the draft archive as **another microworld**
under an id it chooses (`<zone>/draft/<builder>`), plays it, resets or
destroys it. One model, no branches (revision 2 had a `branch`
dimension on every row; Eric's feedback removed the reason for it).

The whole of a microworld's objects are loaded for a write turn, not a
slice — which is what `loadPublishedWorld` does today, minus the
definition blobs it also loads, since the program is cached. At the
2,000-object cap that is roughly 250–400 KB per turn against today's
0.5–1 MB per poll: a real win, claimed here with the number. The port's
`objects(hint?)` takes an ignorable `rootedAt` hint now, while the port
is private, so an adapter may narrow it later without a breaking
change. Core builds the scene in O(n) with prebuilt maps (today's
loader does two array-spreading `find`s inside the instance loop).

### 4.2 The turn

One entry point for playing, and two small ones beside it that
revision 1 wrongly folded in:

```ts
runtime.turn(req: TurnRequest): Promise<TurnResponse>
runtime.complete(q: { microworldId; actor; prefix; now }): Promise<{ completions: string[] }>
runtime.forget(q: { microworldId; actorId; now }): Promise<void>

interface TurnRequest {
  microworldId: string;
  actor: { id: string; name: string };      // §4.3: the name is a stable, host-unique token
  input: TurnInput;
  now: Date;
  knownStamp?: string;                      // the scene stamp the client already has (for a cheap poll)
  options?: { keepMissText?: boolean };     // #346: the host's per-actor donation switch
}

type TurnInput =
  | { kind: 'enter' }                       // the door, or back where they stood if that room still stands
  | { kind: 'look' }                        // the poll, and the presence heartbeat — a READ turn
  | { kind: 'say'; text: string }           // a typed line — the universal input
  | { kind: 'chip'; token: string; args?: string[] }   // a chip: a token core minted for THIS scene
  | { kind: 'leave' };                      // gone: presence ends now, not when the window expires

interface TurnResponse {
  lines: TranscriptLine[];                  // in order: pending lines from others, then what happened
  scene: SceneView | null;                  // null when knownStamp matched — nothing changed
  affordances: Affordances;
}

interface TranscriptLine { kind: 'said' | 'room' | 'question' | 'miss' | 'refused' | 'fault' | 'notice' | 'effect'; text: string; effect?: Effect }
interface SceneView { stamp: string; room: { id; name; prose; entry }; exits: { label; to }[]; items: ItemView[]; carrying: ItemView[]; memory; present: { id; name }[]; version }
interface Affordances { actions: { label: string; token: string }[]; nouns: { label: string; token: string }[] }
```

What the review changed here, and why:

- **Chips are tokens core minted, not a `Command` on the wire.**
  Revision 1's `affordances.verbs: string[]` were display strings with
  no path back to an object, so a chip client could not be written
  without re-parsing the ellipsis (the parser it had just moved
  server-side); and a structured `Command` input was untrusted data in
  the shape of a parser output that walked around the reach check, and
  a public format besides. Now every affordance carries an opaque
  `token` minted for the scene it describes and resolved by core
  against the scene it loads; a stale or forged token is a `refused`
  line. The chip client and the typing client are the same client with
  a different keyboard, and nothing of the parser crosses the wire.
- **One channel per fact.** Effects live in `lines` (kind `effect`) and
  nowhere else — a host that wants the list does
  `lines.flatMap(l => l.effect ?? [])`; revision 1 had them in two
  places and a naive client opened every lightbox twice. The three
  booleans (`moved`, `missed`, `faulted`) are gone: `scene.room.id` and
  the line kinds carry them.
- **The poll is cheap and its contract is written.** `look` is a
  **read turn** (§4.5): no write lock, no action row, no room block in
  `lines`. It returns pending lines from others, and `scene: null` when
  `knownStamp` matches the current scene stamp. The heartbeat is one
  unlocked write of the actor's own row (`touchActor`, §4.6), which also
  drains `pending`.
- **`complete` and `forget` are not turns.** Revision 1 listed both as
  `TurnInput` and then, in §7.1, exempted `complete` from the lock; a
  host writing a settings screen wants `forget` without a scene.
- **`leave` exists.** A telnet client that disconnects, or a tab that
  closes with a `beforeunload` beacon, would otherwise leave a ghost in
  the room for the whole presence window, and the other terminal would
  be told someone is there who is not.

Inside a **write** turn, in order: read the microworld record and the
archive stamp; refuse a newer language level; the program from the
cache or a compile of the stored archive outside the lock; the store's write transaction on the
microworld (§4.5) — re-check the stamp; the actor's row, or the door
for `enter`; the scene from the object rows; drain `pending`; for
`say`, the matcher against the scene, the open exits and the people
present; for `chip`, the token resolved; the evaluator; the outcome
applied to rows; notices queued to the other actors in the room
(§4.3); the action appended; the actor's narration and last noun
written; the answer projected. A fault rolls the turn's writes back and
appends only the action (§4.5). Only `say`, `chip` and the moves they
produce append an action; a miss appends one with `missed`.

### 4.3 Actors, presence, and the lines others read

Core does not know who an actor is. Each turn brings an id and a name;
core writes the name on the actor's row and uses it for "also here"
and for `give the cup to marta`. Three rules the review added:

- **The name is a stable, host-unique token, derived server-side.**
  Overstory supplies the mask's **handle**, never its display name and
  never anything read off the wire — display names are not unique, and
  `give the brass key to Marta` binding to whoever renamed themselves
  "Marta" is item theft at best. Core caps the name at the language's
  name cap and truncates rather than throws; if two present actors
  somehow share a name, the matcher asks "which do you mean?" rather
  than picking one. The host decorates ids in its own answer (Overstory
  adds avatars and display names by looking the ids up; the CLI prints
  the name).
- **Nothing else about an actor exists in core**: no email, no avatar,
  no relationship to any other actor, and — because the id and the
  name come from the same mask — masks stay unlinkable. That is the
  whole of the "no identity" invariant, kept by construction and pinned
  by a spec that fails on a new field in `ActorRecord`.
- **Other actors' turns reach you.** When a write turn moves an actor
  into or out of a room, or moves a thing, core queues a `notice` line
  to every other actor present in that room — "marta arrives from the
  hall.", "marta takes the brass key." — drained into their next
  turn's `lines`. This is core's, from the outcome; the language gains
  no statement for it (a builder-authored `tell`/`announce` is a later
  language proposal). It is what makes two terminals on `serve` a
  shared world rather than a shared database.

### 4.4 Loading, resetting, inspecting, limits

Core has no authoring surface. Eric's feedback on revision 2: drafting,
versions, publishing and schedules are the host's; core takes a
microworld as an archive and lets people traverse it. So the whole of
core's non-turn API is this:

```ts
load(microworldId, archive: Archive, now, opts?: { limits? }): LoadReport    // (re)load: compile leniently, unfold, keep state that still fits
reset(microworldId, now)                                                     // back to the archive's initial state: spawned gone, placed at defaults; memory untouched
destroyMicroworld(microworldId, now)                                         // everything of this microworld, in one transaction
inspect(microworldId, as: 'owner' | 'operator'): MicroworldReport            // two projections, redaction in core
snapshot(microworldId, objectId): ObjectSnapshot                             // an object's state and identifier — a flag's live half (§7.1)
exportState(microworldId): StateExport; importState(microworldId, state, now) // save states — the shape is reserved, the feature is later
forgetActor(actorId, now); exportActor(actorId)                              // across every microworld: wipeout and takeout for a VISITOR (§4.6)
trim(microworldId, now)                                                      // housekeeping; not a turn (§4.5)
```

- **`load` is the one door for content.** It compiles the archive in
  lenient mode (§3.3), stores the archive and its stamp, and unfolds
  the program into the store: placed objects that have no row need
  none; rows whose identifier no longer resolves are dropped and
  reported; state is re-normalised against the new definitions —
  a property a redeclared kind dropped or retyped is dropped from live
  state, a new one starts at its default — which is the state-migration
  seam understory.md §5 asked for, at the moment the host chose.
  `LoadReport` carries `absent`, the warnings, and what re-normalisation
  dropped, so the host can show a builder what a republish did. A
  first `load` creates the microworld; a later one replaces its
  archive and keeps its actors, memory and whatever state still fits.
  The host decides _when_: the Understory at the tick, the CLI when the
  files change, a save state never (it is state, not content).
- **The host's authoring checks are lang's, not core's.** The
  Understory's save compiles one file (`compileFile`, structural
  problems refuse, cross-file resolution a warning); its publish
  compiles the assembled archive in strict mode and refuses per file
  (§7.1); the CLI's `check` does the same over a folder. None of that
  touches core, which is why an editor plugin needs only lang.
- **`reset` is the sweep's mechanism**; the schedule is the host's
  ("the studio is swept every noon" is the Understory's flag driving
  `reset` from the tick). Memory is never reset (understory.md §3.2).
- **`inspect` has two audiences and core redacts.** The owner's report
  is the archive's file list and stamp, the limits, the `absent` list,
  faults **without envelope payloads**, presence as a **count**, and
  the donated misses; the operator's report adds the fault chains with
  payloads (a broadcast's `value` can carry another visitor's words) and
  the actors present by name. The reads behind it are bounded
  (`actions({ since, limit, faultedOnly })`, `misses({ limit })`).
- **Evidence is the host's to keep.** `snapshot` returns an object's
  identifier and live state; the host pairs it with its own pinned
  version of the source (§7.1) and stores both with the flag, so
  editing or destroying the microworld cannot remove it.
- **`destroyMicroworld` is transactional and enumerated**: the
  archive, objects, actors, memory, actions and misses of that
  microworld, in one transaction, with the host deleting its own rows
  in the same one. It does **not** reach the deleted profile's traces
  in other people's microworlds — that is `forgetActor` (§4.6), and a
  wipeout calls both.
- **Save states are reserved, not built.** `exportState` /
  `importState` are the shape a "save" would take — object rows and the
  actor's own row, never other actors, never memory that is not the
  actor's — named now so the record types are designed with it in mind
  and built when someone wants it (Eric: "maybe we will deal with save
  states in the future").
- **Limits are the microworld's, with defaults**, passed at `load`:
  rooms and objects per microworld (16 and 12 × 16 today), kinds,
  files, **`sourceBytes` of the archive** (256 KB is generous at today's
  caps; it bounds the worst compile), live instances (2,000), spawns per
  action (8), effects per turn, retention days for actions (30) and
  misses (500 rows). A **per-owner** budget across microworlds — MOO's
  decisive quota, and what bounds one person making fifty zones — is
  the **host's**, because core has no identity; §8 records that as a
  call. The language's own caps (definition bytes, node depth, cascade
  depth, event budget) are lang's constants and not configurable — they
  are what make the computation class what it is.

### 4.5 Transactions and locking

The port's contract, which every adapter must meet:

1. **Write turns on one microworld are serialized; read turns are
   not.** `store.transaction(microworldId, fn)` runs `fn` with that
   microworld locked against every other _write_ on it, in a defined
   order. `store.read(microworldId, fn)` runs `fn` on a consistent
   snapshot with **no lock**, and is what `look` and `complete` use.
   Revision 1 put the poll behind the write lock; with a heartbeat
   every five seconds per visitor and a `max: 4` pool per function
   instance, four blocked polls would have stalled every unrelated
   request on that instance. The floor is per microworld because it is
   the one grain an in-memory promise chain, a Firestore transaction
   and a Postgres advisory lock can all honour; per-**room** scope is an
   additive hint (`transaction(microworldId, fn, { rooms })`) the SQL
   adapter may honour later, as `lockRoom` does today, when §4.7's lock
   duty cycle says so.
2. **`fn` may be invoked more than once.** Firestore and Mongo
   transactions re-run their callback on contention. So `fn` must have
   no effect outside the `StoreTx` it is handed, and every id it mints
   must derive from state it read inside that same invocation — spawn
   numbers from the store, envelope ids from the turn's budget, `now`
   from the request. The conformance suite runs every turn under a
   wrapper that invokes `fn` twice and asserts identical committed state
   and no duplicate rows.
3. **A turn's writes land together or not at all, and a fault writes
   nothing but its action record.** A fault is an _outcome_, never a
   thrown error: core returns it, and the adapter appends the record
   only on that signal, so a dropped connection is not mistaken for a
   fault. The SQL adapter does this with **one** savepoint per turn
   (`SAVEPOINT sprout_turn` … `ROLLBACK TO` on a fault, `RELEASE` on
   success; never one per sub-move of a "take all", never nested —
   Postgres's sixty-four-subtransaction cliff is real) inside the host's
   transaction, so a host that wraps a turn with its own writes keeps
   them. The record then survives only if the host commits; a host
   that wants today's stronger property — the fault recorded even if
   the outer attempt dies — points the adapter's optional `faultSink`
   at a second connection, which is what `recordingFaults` does today.
   A document adapter computes in memory and writes only on success, so
   the same contract is free. The client stops seeing an `aborted`
   error and starts seeing a `fault` line on an ordinary answer (§7.3).
4. **Locks have timeouts and are not tuples.** The SQL adapter takes
   `pg_advisory_xact_lock(hashtext(microworldId))` (shared for a
   read that wants one, exclusive for a write), issues `SET LOCAL
lock_timeout` and `statement_timeout` at the top, and keeps the spawn
   counter off the microworld row, so the row every turn would
   otherwise queue behind gains no dead tuple per spawn and a stuck turn
   fails fast instead of pinning a connection to the function timeout.
5. **The host may supply the transaction.** `sqlStore({ client })`
   takes a client already inside a transaction (Overstory's
   `withTransaction`) and only locks; `sqlStore({ pool })` opens its own
   (the CLI). Nothing in core awaits anything but the store.
6. **Housekeeping is not a turn.** `trim`, `destroyMicroworld`,
   `forgetActor` and `exportActor` are methods of the store itself, not
   of a `StoreTx`; `load` and `reset` are write transactions of their
   own (a reload while someone is mid-turn waits its turn): declared non-atomic-as-a-whole, resumable, safe to
   repeat, so a Firestore adapter can page through them in batches of
   five hundred and the SQL adapter can run `trim` as one table-wide
   statement instead of a locked transaction per zone at noon.

### 4.6 The store port and the conformance suite

```ts
interface SproutStore {
  transaction<T>(microworldId: string, fn: (tx: StoreTx) => Promise<T>, opts?: { rooms?: string[] }): Promise<T>;
  read<T>(microworldId: string, fn: (tx: ReadTx) => Promise<T>): Promise<T>;    // ReadTx = the getters below + touchActor
  // housekeeping — off the turn path (§4.5-6)
  trim(before: Date, keepMisses: number): Promise<void>;
  destroyMicroworld(microworldId: string): Promise<void>;
  forgetActor(actorId: string): Promise<void>;                                   // every microworld: actor rows, memory, pending
  exportActor(actorId: string): Promise<ActorExport>;                            // the same rows, for takeout
}

interface StoreTx {
  microworld(): Promise<MicroworldRecord | null>;    putMicroworld(m): Promise<void>;          // id, archive, stamp, level, extensions, limits
  nextSpawn(): Promise<number>;                                                                 // off the locked row
  objects(hint?: { rootedAt?: string[] }): Promise<ObjectRecord[]>;                            // a superset is fine
  putObjects(change: { upsert: ObjectRecord[]; remove: string[] }): Promise<void>;             // one call; `destroy self` needs `remove`
  clearObjects(): Promise<void>;                                                                // reset
  actor(id): Promise<ActorRecord | null>;            putActor(a): Promise<void>;
  actorsIn(room, since: Date): Promise<ActorRecord[]>;
  touchActor(id, lastSeen: Date, drained: boolean): Promise<void>;   // the heartbeat, and draining `pending`: the ONE write a ReadTx may make — the actor's own row, never contended
  memory(actorId): Promise<MemoryRecord>;            putMemory(m): Promise<void>;              clearMemory(actorId): Promise<void>;
  appendAction(a): Promise<void>;                    actions(opts: { since?; limit; faultedOnly? }): Promise<ActionRecord[]>;
  appendMiss(m): Promise<void>;                      misses(opts: { limit }): Promise<MissRecord[]>;
}
```

Small on purpose, and smaller than revision 2: with files and versions
gone to the host, the port is twenty-three methods (six on the store,
seventeen on a transaction) over seven record types
— `MicroworldRecord`, `ObjectRecord`, `ActorRecord`, `MemoryRecord`,
`ActionRecord`, `MissRecord`, `ActorExport` — every one exported as a
zod schema from `./core`. No query language, no joins, no filters
beyond the ones the runtime needs (a room, a date, a limit). The
builder's panel and a moderator's view are `inspect`, computed by core
from these reads — a host that wants more (Overstory's "frequently
flagged" over many microworlds) queries the SQL adapter's tables
directly, which is why their shape is documented and stable (§5.1).

The **conformance suite** is exported from `./conformance` as
`cases: { name; run(makeStore) }[]`, importing **no test framework** —
a host runs it under vitest, jest, `node:test` or bun with a
three-line loop, and a runtime package never carries `vitest` (CLAUDE.md
records the 2026-09-03 peer-graph outage). It proves: round-trips of
every record; **re-entrancy** (§4.5-2, the wrapper that runs `fn`
twice); serialization (two write turns racing land in order) and that
a `read` during a `transaction` does not deadlock; atomicity, including
that a **host's own writes survive** a faulted turn; the fault rule;
**memory isolation** — microworld A's memory invisible in B; a turn at
the 2,000-object cap inside a named budget; a `load` over a live
microworld keeping what still fits; `trim`, `destroyMicroworld`,
`forgetActor`. It also **reports which cases a backend could not truly
exercise**, so a green run on PGlite does not read as a proof of
contention it is not. The memory store runs it in core; store-sql runs
it on PGlite; store-document runs it on the memory backend and on
IndexedDB (through `fake-indexeddb`, already a root devDependency).
Real contention — one connection's advisory lock blocking another until
commit, and `lock_timeout` firing rather than hanging — is proved once,
against a containerised Postgres in the sprout repo's CI, and once in
Overstory as `understory/turn.db.spec.ts` under `npm run test:db` for
the SQL the turn depends on (CLAUDE.md's rule for correctness that
lives in SQL).

`./testing` exports `testWorld(archive): { runtime; play(line, as?) }`
— ten lines that make the README's "try it" real for a host's own
tests.

### 4.7 Budgets, faults, the log, and what to watch

Unchanged from sprout.md §2.5, §2.11 and #441, moved: one budget per
turn shared by every runner, faults roll back and are recorded with
the chain, the miss row's shape. Two additions to the action record
while it is still private: **`durationMs`** and **`lockWaitMs`**. Every
turn also logs one structured line — `{ microworldId, kind, cacheHit,
compileMs, lockWaitMs, durationMs, objects, bytes }` — which is the
entire observability story for the feature and is what makes the
pressure-test triggers below measurable; today's triggers in sprout.md
§2.11 are thresholds nobody can measure (there is no duration column),
and one of them (instances past 10,000) can never fire because the cap
is 2,000. The replacement set:

1. **Lock duty cycle**: actors in a microworld × p95 `durationMs` of
   write turns approaching half the poll interval. This replaces both
   "ten actors in a room" and "300 ms p95".
2. **p95 `lockWaitMs`** over 100 ms on write turns — polls no longer
   wait, so this is contention between people acting.
3. **Pool wait** on any instance serving understory traffic — the first
   symptom that would be misattributed to the rest of the product.
4. **Bytes per turn** × turns per second against the `db-f1-micro`.
5. **Program cache residency** per instance against the function's
   memory.
6. For a document host: the objects document's serialized size against
   1 MiB, and writes per second per document against one.
7. Unchanged from §2.11: visitors wanting each other's lines in under
   ~2 s — still the channel question. `pending` (§4.3) answers it at
   poll granularity; a push channel is later.

`inspect` reports a microworld's recent faults and its miss rate; the
donated-miss text is kept only when the turn says `keepMissText` — the
switch stays the host's, per actor, exactly as #346 built it, and with
no actor on the action row the promise "never against the profile" is
true of the database, not only of the row.

---

## 5. Store adapters

### 5.1 `store-sql`

For node-postgres and PGlite alike: the adapter needs `query(text,
params)` and nothing else, and it detects neither. Its tables live in
a **Postgres schema, `sprout`** — `sprout.microworld` (with the
archive as `jsonb`, its stamp, level, extensions, limits),
`sprout.object` (keyed by microworld, id), `sprout.actor` (microworld,
id; indexed on `(microworld_id, room_id, last_seen desc)` for
`actorsIn`), `sprout.memory` (microworld, actor, object),
`sprout.action`, `sprout.miss`, `sprout.spawn_counter` — a namespace that makes "no
foreign key to anything of the host's" visible rather than conventional
and the eventual drop auditable. No foreign key to any host table;
`forgetActor` is served by indexes on `actor_id` instead.

**Migrations are exported, not copied.** Revision 1 said a host with
its own migration system copies the adapter's SQL files into its
sequence "verbatim"; the review called that two ledgers, two runners
and nothing checking the copy, in a codebase whose rule is that
`migrations/` is the one authority. So the adapter exports its
migrations as an ordered `{ name, sql }[]` and a runner; a host with
its own runner (Overstory) holds **one** checked-in migration that
applies the list, recording each under a namespaced name
(`sprout/001_sprout.sql`) in its own `schema_migrations`, and a gate
spec hashes the package's exported SQL against a committed manifest so
a version bump that changes the schema fails the gate rather than
production. The adapter checks its schema version **at construction**
— `sqlStore({ client, schemaVersion })` throws with expected and found
— so a mismatch lands in the deploy smoke, not in a visitor's turn.

Mechanics the review pinned: `transaction` takes an advisory
transaction lock keyed on the microworld id with `SET LOCAL
lock_timeout` (§4.5-4), never `FOR UPDATE` on the microworld row;
`putObjects` is **one statement** over array parameters
(`INSERT … SELECT FROM unnest($1::text[], …) ON CONFLICT DO UPDATE`,
plus one `DELETE … WHERE id = ANY($n::text[])`) — per CLAUDE.md, array
parameters are one parameter, so revision 1's "per changed row,
chunked" was both wrong and self-contradictory; `trim` is one
table-wide `DELETE … WHERE created_at < $1` and one windowed delete for
misses, called once from the tick, not per zone. Ids are `text`
(identifiers and `Kind#n`), while `understory_zone.profile_id` is
`uuid`: **never join `understory_*` to `sprout.*` in SQL** — the natural
spelling casts the column and walks into #468; render the id to text in
TypeScript and bind it as a parameter.

The `understory_*` runtime tables — room, room_version, item,
item_version, kind, kind_version, instance, visitor, visitor_state,
action, miss — are dropped in Overstory (§7.2); the zone table stays,
because it is the product's.

### 5.2 `store-document`

```ts
interface DocumentBackend {
  get(key: string): Promise<unknown | null>;
  put(key: string, doc: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  transact<T>(keys: string[], fn: () => Promise<T>): Promise<T>;   // serialize on these keys, all-or-nothing writes; MAY re-run fn
}
```

**The layout is split along the write-rate seam, not the read seam.**
Revision 1 put objects and actors in one document per microworld;
with a heartbeat per visitor every five seconds, six visitors
exceed Firestore's sustained one-write-per-second-per-document guidance
while rewriting a few hundred kilobytes each time. Now:
`microworld/<id>/objects` — one document, written only when a turn
changes something, holding the object rows as an **opaque serialized
blob** with indexing disabled (Firestore's 40,000 index-entry ceiling
per document would otherwise be hit by a map of two thousand small
objects, and the 1 MiB budget applies to the serialized bytes);
`microworld/<id>/actors/<actorId>` — one small document per actor,
written every poll, queried for `actorsIn`; `microworld/<id>/archive`
(the files and manifest as last loaded, a few hundred kilobytes at the
cap); `microworld/<id>/memory/<actorId>` — the microworld in the key,
always; and **actions and misses as collections**, one document per record, never a dated document
appended to (a dated document at a modest turn rate reaches the 1 MiB
ceiling in about ninety minutes, and then the microworld stops).
Serialization is `transact` on the objects key; atomicity is the single
write; re-entrancy is §4.5-2's rule, which is why the port states it.

Two backends ship: `memoryBackend()` (tests; the CLI's `--store
memory`) and **`indexedDbBackend()`** — a single-player microworld in a
browser tab, no server at all, the smallest embedding there is and a
good README example. Revision 1 said Web Storage; the review showed
that `localStorage` cannot honour `transact` (no multi-key atomicity,
no cross-tab serialization, ~5 MB of UTF-16 quota that a week of
building exhausts with a synchronous throw), and that a fake would pass
every case the real thing fails. IndexedDB has real multi-store
transactions serialized across the origin's tabs, an async API that
matches the port, and quota in the hundreds of megabytes. Firestore
and Mongo are each an implementation of the five methods over their
own transaction API, written when a host wants them; they are not in
v1, and the port has been checked against their limits above so that
nothing in v1 assumes their absence. **Cloudflare Durable Objects** are
named here as the third target the port is checked against: a Durable
Object _is_ §4.5's contract — one single-threaded instance per id with
transactional storage — and its storage is a document store, so
`store-document` is already that adapter's shape. Not adopted for v1,
because the audience rule, moderation, flags, takeout and the tick live
in Postgres and splitting the truth is the objection sprout.md §2.11
already sustained; named so that the port's central claim is
falsifiable rather than self-asserted.

### 5.3 In core: the memory store

`memoryStore()` in core itself — a `Map`, a promise chain per
microworld. It is what core's own specs run on, what the conformance
suite proves first, and what a host's unit tests use in place of a
database.

---

## 6. `@overstory/sprout-cli`

`npx @overstory/sprout-cli <command>`, bin name `sprout`, on a
**microworld archive**: a folder of `*.sprout` files with a
`sprout.json`, or a zip of the same. Authoring is text files in
whatever editor the author likes — a Sprout plugin for VS Code (syntax
from lang's exported lexer, problems from `compileFile`, later a
language server) is the natural companion and is not in v1. The CLI
keeps runtime state in `.sprout/` beside a folder (`.sprout/db` for
PGlite; nothing with `--store memory`); `check` reads regular files
only, so the state folder is never compiled.

| command                                   | does                                                                                                                                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sprout init [dir]`                       | A folder with `sprout.json`, one room, and a README line. A host's literal first command.                                                                                                                                           |
| `sprout check [dir\|zip] [--json]`        | `compileMicroworld` in strict mode; problems by file, line and column, or as JSON (§3.3's `Problem`, exactly) for an editor or a CI step; exit 1 on any.                                                                            |
| `sprout play [dir\|zip] [--as] [--fresh]` | `load` the archive (again, if the files changed since the last load — state that still fits is kept, `--fresh` resets), then a prompt: the transcript, ↑ history, Tab completion, `help`. `--as <name>` names the actor.            |
| `sprout serve [dir\|zip] [--port]`        | The same microworld on a TCP line protocol, bound to **`127.0.0.1`** unless `--host` widens it (a development toy: no auth, no TLS — the README says so). Two terminals, each seeing the other's arrivals and moves as they happen. |
| `sprout pack [dir] -o world.zip`          | The folder as one archive, `check`ed first.                                                                                                                                                                                         |
| `sprout skill`                            | The SKILL.md for the language as configured (with ext-media).                                                                                                                                                                       |

The CLI installs `ext-media` and prints its transcript line; an archive
that `use`s an extension the CLI lacks fails `check` with the
extension's name. `./examples` holds the two seeded studios as
archives; `sprout play` on the pottery studio is the README's first
line. A structured out-of-band channel for MUD clients (GMCP) is a
later addition, recorded in §11.

## 7. The Understory after the split

> This section — how Overstory Social's Understory hosts core (its tables,
> its tick, its audience rule, its moderation and takeout) — is that
> product's record and stays in its repository. What this document keeps is
> the language, the runtime, the stores, the extensions and the CLI.

## 8. Calls made here, for the record

Each reversible; each worth knowing about. Where one amends sprout.md
the section is named.

1. **One repository; two published artifacts** (§2): the package with
   subpath exports, and the bundled CLI; released together from one
   version; `0.x`.
2. **Source is the stored truth; no AST is ever persisted** (§3.2;
   amends sprout.md §4, which chose to store both). `format`,
   `format: 1`, the upgrade function, the form editor and `mode` go.
   The persisted, public, semver-guarded list is closed: source, the
   archive manifest, the value shapes.
3. **The language's compatibility promise is a mechanism**: an integer
   `LANGUAGE_LEVEL` recorded in the archive manifest as the minimum the
   text needs; structural checks fatal always, policy checks fatal in
   the host's checks and skip-with-warning at load; add-only syntax
   (§3.2).
4. **Core plays an archive and owns no authoring state** (§4.4; Eric,
   2026-09-17). Drafts, versions, publishing and schedules are the
   host's, on lang; core's content API is `load` and `reset`. A
   builder's draft is another microworld.
5. **The host's checks refuse; core's load degrades** (§3.3): a
   definition that cannot compile or resolve at load is absent, never a
   dark microworld and never compiler text to a visitor. Take-down is
   safe because of it.
6. **The evaluator is the language's; the matcher is the runtime's;
   the grammar table is the language's** (§3.1, §3.4).
7. **Compilation is of an archive** (§3.3): identifiers resolve across
   files; `use` is archive-level; delivery order is declaration order
   then spawn order (amends sprout.md §2.5's "id order"). The backend's
   identifier ↔ uuid map with `_2` suffixes goes.
8. **Extensions record effects and never perform them** (§3.5), are
   host-trusted and contained, and have five declarative points. Media
   is the first extension and is not in the core language; the core
   language gains a `string` property type and media's literal becomes
   `media "…"` (amends sprout.md §2.2's well-known table, §2.4's
   grammar, §2.9, §2.12's list).
9. **The runtime unit is a "microworld"; it arrives as an "archive"
   of "files"; the evaluator's slice is a "scene" beside a "turn
   context"**; _instance_ keeps the language's meaning (§1).
10. **Instances re-bind to the current definitions at load** (§4.4;
    amends sprout.md §2.8's per-instance version binding); `load`
    reports what re-normalisation dropped.
11. **Actors are an id and a stable host-unique name per turn** (§4.3);
    Overstory supplies the handle; presence and the per-actor inbox of
    notices are core's; decoration is the host's. The action record
    carries no actor.
12. **Read turns take no lock and append nothing; write turns are
    serialized per microworld; `fn` may run more than once; a fault is
    an outcome, and a turn's writes land together or not at all**
    (§4.5). Per-room scope is an additive hint, not the floor.
13. **Housekeeping is off the turn path** (§4.5-6): `trim`, `destroy`,
    `forgetActor`, `exportActor` are store methods, non-atomic as a
    whole, resumable.
14. **Evidence is the host's to keep**: the Understory's version rows
    are never deleted while the zone exists; a flag stores the pinned
    version and core's `snapshot` (§4.4, §7.1).
15. **Save states are reserved, not built** (§4.4): `exportState` /
    `importState`, never other actors, never memory that is not the
    actor's.
16. **Wipeout is `destroyMicroworld` plus `forgetActor`** (§7.1), by
    code, with an orphan count in the tick; takeout is the zone's own
    files plus `exportActor`, never other visitors' traces.
17. **The media audience arm stays the published-definition rule**,
    served from a table publish maintains (§7.1). Revision 1's shelf
    rule is withdrawn.
18. **The SQL adapter owns a Postgres schema and exports its
    migrations**; the host applies them through its one runner and
    pins their hashes (§5.1). Rows, not blobs, for Overstory (§2.11
    stands); a document per concern for document stores (§5.2).
19. **A per-owner budget is the host's** (§4.4), because core has no
    identity.
20. **One turn callable replaces twelve** (§7.1), kept as forwarders for
    one release; the wire request carries neither `now` nor `actor`.
21. **Two things named and not built**: a derived compiled-program row
    in the SQL adapter, allowed once measurement asks for it (§3.2);
    Durable Objects as the third adapter target the port is checked
    against (§5.2).

---

## 9. Build order

Every stage lands on `main` behind the existing flag with the five
Understory journeys green, inside Overstory's workspace, before any
package is published; the split-out is the last step, not the first,
so the gate is the bar throughout and a wrong seam costs a PR, not a
release. Each stage names what it proves **and what prose it must
leave true** — the review found the documentation debt was large and
off the plan. Sizes are the house scale.

1. **Lang: source as truth, archive compilation, extensions** (L). In
   `packages/sprout` as it stands: delete format 1 and the upgrade;
   `compileMicroworld` over an archive with the strict/lenient flag,
   `Program`, `absent`, the two severities and `LANGUAGE_LEVEL`; the
   manifest; identifier addressing and the defined delivery order;
   `Scene` + `TurnContext`; the grammar table in the program; the
   extension registry with all five points and the containment spec,
   media moved to `packages/sprout-ext-media`, the `string` property
   type, `use media` in the seeds, which become archives under
   `packages/sprout-examples`. The backend keeps working by compiling
   at load with a cache keyed on the room's published versions — a
   stopgap the next stage removes. _Proof_: every lang spec; the seeds
   compile; the journeys. _Prose_: CLAUDE.md's invariant paragraph on
   `@overstory/sprout` now names the directories and their allowlists,
   and `boundary.spec.ts` walks subdirectories; `packages/e2e/areas.mjs`
   gets a glob per new `packages/sprout-*` directory (an unmapped path
   runs every journey — safe and slow — and a renamed directory with a
   stale glob fails the gate's check); sprout.md
   §2.2/§2.4/§2.5/§2.8/§2.9/§4 carry pointers to §8 here.
2. **Core and store-sql** — **two PRs** (Eric, 2026-09-17), each L:
   - **2a**: `packages/sprout-core` with the microworld model, `load`,
     `reset`, the turn, `complete`/`forget`, the port with `read`, the
     memory store, the conformance suite (framework-free) including the
     re-entrancy wrapper and the memory-isolation cases; the backend's
     understory directory rewritten as §7.1's wrappers over an adapter
     that reads **today's** tables into records and writes them back —
     and that takes the zone's row lock inside the host's transaction
     from its first commit, so the existing guarantee is kept rather
     than re-derived; the tick assembling archives from today's
     version tables and calling `load`; the twelve callables as
     forwarders; the frontend on the turn contract with `knownStamp`
     and `chip` tokens; the savepoint fault path. _Proof_: the suite on
     the memory store; the journeys. _What 2a proves_: the turn and
     load contracts. _What it does not_: storage — say so in the PR.
     _As built (2026-09-18, the wrappers PR)_: the adapter is NOT over
     today's tables. Those were keyed by uuid and by room where core's
     records are keyed by identifier and by microworld, and every read
     would have carried the identifier ↔ uuid map §7.2 deletes; so
     migration 058 adds the seven record tables (`sprout_*`, public
     schema) and drops the five v0 runtime tables a day after 057 reset
     them. The adapter (`backend/src/understory/store.ts`) is a draft of
     store-sql living in the host, and passes the conformance suite on
     PGlite under `test:db` — minus the two cases that need a second
     backend. 2b moves it into the package with its own `sprout` schema
     and migrations; §7.4's `understory_file` fold is untouched by 2a.
     Also as built: a builder's "walk the draft" enters at the door (or
     where they last stood) — there is no teleport to the open room,
     since position is core's; and the tick's per-file strict compile
     stays inside the edition's transaction as it was, with the LOADS
     moved after commit (`understory/tick.ts`) — the three-step pre-pass
     of §7.1 is 2b's.
   - **2b**: `packages/sprout-store-sql` with the exported migrations
     and the `sprout` schema; `understory_file` and
     `understory_file_version` replacing the six room/item/kind tables;
     Overstory's one applying migration and the hash manifest spec; the
     dropped runtime tables; `understory_zone_media` and the authz arm;
     `forgetActor`/`exportActor` wired into purge and takeout; the
     tick's post-commit per-zone loop; the seed on the example archives;
     the form editor removed; `understory/turn.db.spec.ts`. _Proof_: the
     suite on PGlite (`test:db`); `schema:check`; the journeys,
     rewritten only where a callable's name changed. 2a is merged and
     its branch deleted before 2b is cut from `main` (CLAUDE.md on
     stacked PRs). _As built (2026-09-18)_: 2b lands as TWO PRs from
     `main`, each reviewable on its own — first the storage half
     (`@overstory/sprout-store-sql`, migration 059, `understory_zone_media`
     and the authz arm, wipeout and takeout through core,
     `verifyMicroworlds`, `turn.db.spec.ts`, the docs), then the
     authoring fold (`understory_file`/`understory_file_version`, the
     seed on the example archives, the tick's three-step pre-pass). The
     exported migrations are COPIED into `migrations/059_sprout_store.sql`
     between markers rather than applied by a second runner, because
     Overstory's runner applies plain files; the copy is pinned to the
     export by `store-manifest.spec.ts`, which is the "hash manifest" —
     the file itself. The conformance suite runs on in-process PGlite in
     the package (`@electric-sql/pglite`, no socket), so it is part of the
     gate rather than the db tier. _Prose_: understory.md §10.3–§10.6 marked as the v0
     architecture, superseded here; DEPLOY.md gains the backups
     paragraph and `verifyMicroworlds` in the smoke list. _The fold, as
     built (2026-09-18, #537)_: migration 060 creates `understory_file`
     (`role`, `ident`, `name`, `placed_in` — the last derived from the
     head like the first two, so the per-room list is a filter — the
     draft `source`, the request, `published_version`,
     `publish_problems`, a soft `deleted_at` that keeps the versions and
     frees the identifier) and `understory_file_version`, repoints
     `understory_zone.entry_room_id` and folds the flag's two columns
     into `understory_file_id`, and drops the six; nothing migrates. The
     callables keep their names and shapes (a room/item/kind id is a file
     id); the frontend changed only to show what the tick refused. The
     save's check became the whole-archive compile — the draft with the
     candidate in place, strict, refusing problems in the file's own text
     — so `in` may name any room or container here and an item moves by
     editing it; a delete takes what was placed in the file along (the
     old cascade, in code). The pre-pass is as §7.1 says, with "would
     leave the set unresolvable" read as problems in the file's own text:
     a rename that strands another room's exit is that room's problem,
     as it was. The e2e seed writes the pottery studio as DANA's zone so
     `schema:check` executes the seeder; the takeout carries every file
     (kinds were missing before).
3. **store-document and the CLI** (M). The backend interface, the
   split layout, the memory and IndexedDB backends, the suite on both;
   `packages/sprout-cli` with PGlite: `init`, `check --json`, `play`,
   `pack`, `skill`, and `serve` on loopback (in the first cut — Eric,
   2026-09-17). _Proof_: the suite; a scripted play of both example
   archives in CI, two actors on `serve` seeing each other's notices.
   _As built (2026-09-18, #527 — two PRs from `main`)_: store-document's
   `transact` hands `fn` a staged writer (`fn: (tx) => …`, not
   `() => …`): it is how a backend tells a transaction's writes from a
   concurrent heartbeat's `put`, and the shape of `runTransaction(fn(tx))`
   and an IndexedDB transaction; the spawn document is `counters`
   (`{ spawn, actions, misses }`), every number a turn mints read inside
   the transaction; ids are URL-encoded in keys (`<zone>/draft`); the
   suite runs every case on both backends, the IndexedDB one under
   fake-indexeddb. The CLI is not bundled — a bin shim over `dist/`,
   PGlite a runtime dependency — until stage 4 decides the bundle with
   the publish; its zip reader/writer is its own (`node:zlib`); `play`
   answers a piped script in order, and `serve` names an actor by the
   first line a connection sends.
   _Prose_: a README per directory (core's opens with §4.0; the
   language's loses its "definition format", "embedding" and "pictures"
   sections to core's and ext-media's).
4. **Split out and publish** (S–M). Review the history that is about to
   become public (commit messages and co-author lines written while the
   code lived in a product repo), then `git subtree split` (or
   filter-repo) of the `packages/sprout-*` paths into
   `overstory-social/sprout`; a `LICENSE` beside each package (the
   language's already has one); its own gate (lint, format, the suites,
   `sprout check` over `examples/` and the committed corpus, the
   real-Postgres contention job); changesets with a `fixed` group;
   publish `0.1.0` of the package and the CLI; Overstory swaps workspace
   references for one exact pin in the root manifest and deletes the
   directories; the e2e area map's `packages/sprout*` globs go. _Prose_:
   which of sprout.md travels to the public repo as its design history
   and which stays as Overstory's product record; the support policy in
   the README.
5. **Later, and not needed for any of the above**: a Sprout plugin for
   VS Code on lang's lexer and `compileFile` (§6); save states (§4.4);
   a framework-free web client; Firestore, Mongo and Durable Objects
   backends when a host asks; a `tell`/`announce` statement so builders
   can narrate to bystanders (core's notices cover arrivals and moves
   meanwhile); a push channel for `pending`; GMCP on `serve`; portals
   between microworlds, which are the host's consent closure first
   (§7.1).

---

## 10. Decided (Eric, 2026-09-17)

The four questions the first draft left open, answered after PR #519
merged, and one more from his read of revision 2:

1. **The npm scope** is `@overstory-social`, matching the GitHub org
   (§2). The bin name is `sprout`.
2. **The word** for the unit core loads is _microworld_ (§1); _scene_
   for the evaluator's slice; _instance_ unchanged.
3. **`serve` is in the CLI's first cut** (§6, §9 stage 3).
4. **Stage 2 lands as two PRs**, 2a and 2b (§9).
5. **Core plays an archive and holds no authoring state** (§4.4,
   §11.4): drafting, versions, publishing and the tick's schedule are
   the Understory's; a host outside Overstory authors in text files
   with an editor, and the CLI takes a folder or a zip.

One call this revision makes that Eric has not yet ruled on, flagged so
it is his to reverse: **two published artifacts instead of the six
packages** of revision 1 (§2, §11.2). His brief said three; revision 1
said six; the review's argument for fewer is the one-repo argument
applied one layer down, and it removes the lang/core version skew
entirely.

## 11. Outside review, 2026-09-17: what changed, what was declined

### 11.1 Method

Six reviewers read revision 1 with the code and the design documents
beside it, one lens each, and were asked for numbered findings with a
severity, the evidence and a concrete alternative: operations
(`review-ops.md`), language correctness (`review-lang.md`),
scalability and storage (`review-scale.md`), prior art
(`review-priorart.md`), a second host's developer experience
(`review-dx.md`), and security and moderation (`review-security.md`).
Their texts are under `2026-09-17-sprout-split-reviews/`. Every
finding was checked against the code before it was accepted; the
factual claims held with one exception (a missing `LICENSE` file that
exists). Where several reviewers converged from different directions
the finding was taken as settled; where one reviewer's alternative
conflicted with Eric's stated decisions or with another reviewer's
evidence, the reasoning is below.

### 11.2 Accepted, by theme

- **The poll took the write lock** (ops 1, scale 1, lang 9, security 1,
  dx 9 — five of six). Read turns, no lock, no action row, cheap by
  stamp; advisory locks with timeouts; `complete` and `forget` off the
  turn (§4.2, §4.5).
- **Whole-microworld compilation made every definition a single point
  of failure, and `unpublish` skipped the check `publish` got** (lang
  1–2, ops 4, security 5). Save and publish refuse; load degrades to
  absent; per-file publish (§3.3; since revision 3 the publish half is
  the Understory's, §7.1).
- **The compatibility promise had no mechanism** (lang 3, ops 5,
  dx 12). `LANGUAGE_LEVEL` per version as a minimum; two severities;
  add-only syntax with the cost counted (§3.2).
- **The extension mechanism covered half of media** (lang 4–5,
  security 6, dx 7). Five points with full types; purity in two flags,
  consent closed; containment of `run`; microworld-level `use`; the
  `string` property type (§3.5).
- **Optimistic backends re-run the callback** (scale 2). The
  re-entrancy rule and its conformance case (§4.5-2).
- **The document layout exceeded Firestore's write rate and document
  limits** (scale 3–4, 12). Split by write rate; collections for logs;
  IndexedDB instead of Web Storage (§5.2).
- **The program cache key missed drafts, the language version and a
  bound** (scale 5, ops 7, security 7). A key of microworld, archive
  stamp, language level and extension set (revision 2 also had a
  branch and a draft stamp; revision 3 removed drafts from core),
  bounded LRU, bump only on change, compile outside the lock, a
  `sourceBytes` limit, `compileFile` only per keystroke (§3.2, §4.4,
  §7.1).
- **Publish inside the tick's transaction** (ops 2, security 13).
  Per-zone transactions after the edition commits, error-isolated;
  sweep its own step (§7.1).
- **Wipeout and takeout no longer reached the visitor** (ops 3,
  security 3–4). `forgetActor`, `exportActor`; takeout gets the owner's
  furniture and never other visitors' traces (§4.4, §4.6, §7.1 — in
  revision 3 the furniture is the Understory's own tables).
- **The shelf rule was weaker than today's media rule** (security 2).
  Withdrawn; publish maintains the media set (§7.1).
- **Six packages reintroduced the version problem** (ops 6, priorart 1,
  dx 11–12). One package with subpaths plus a bundled CLI, lockstep
  releases (§2).
- **Copying migrations was two ledgers with no detector** (ops 10,
  priorart 4). Exported migrations, one runner, a hash manifest, a loud
  version check, a Postgres schema (§5.1).
- **No constructor, no chip path, contradictory `complete`, double
  effects, `now` on the wire, no errors, no delete** (dx 1–5, 8, 17).
  §4.0, tokens, `read`, `putObjects({ upsert, remove })`,
  `SproutError`, the wire envelope (§4.x, §7.1).
- **Multiplayer had no inbox** (priorart 5, dx 15). `pending` and
  core's notices, now (§4.1, §4.3).
- **The action record leaked misses by join; `inspect` served two
  audiences one answer; evidence could be deleted; names were a
  confused deputy; memory was keyed too loosely** (security 8–12).
  No actor on actions; two `inspect` projections; tombstones and stored
  snapshots (the Understory's since revision 3, §7.1); the handle as the
  name; the microworld in every memory key (§4.1–§4.4).
- **Identifiers changed order, orphaned rows and hid room renames;
  instances silently re-bound** (lang 7–8). Defined order; dropped
  rows reported; undefined vs unpublished rooms; the re-bind recorded
  with a load report of what was dropped (§3.3, §4.4; the publish-time
  warning is the Understory's, §7.1).
- **Ops hygiene**: the twelve callables as forwarders for a release
  (ops 11); 2a locks from its first commit and says what it does not
  prove (ops 12); the seed reads the published examples (ops 13,
  dx 13); the canary and backups (ops 4, 14); `serve` on loopback
  (ops 14); `durationMs`/`lockWaitMs` and the replacement triggers
  (scale 15); `unnest` not chunking (scale 13); the text-id join
  warning (scale 10); the lexer export (priorart 13); event sourcing and
  CRDTs declined in a sentence (priorart 12); Evennia, Ranvier and the
  authored-branching systems on the record (priorart 9); the per-owner
  budget as a host call (priorart 10); the docs column in §9 (dx 20);
  the framework-free conformance export and `testWorld` (priorart 8,
  dx 18); `file` for `unit`, and `branch` for `realm` until revision 3
  removed the dimension (dx 14).

### 11.3 Declined, and why

1. **Per-room locking as the port's floor** (lang 9, security 1b).
   Declined as the floor, accepted as an additive hint. A room-scoped
   lock requires the adapter to know the room graph and a move to lock
   two rooms in order; the floor has to be something a promise chain
   and a Firestore transaction can honour. With reads lock-free, write
   contention at the stated caps is between humans typing, and §4.7's
   duty-cycle trigger says when the hint is worth honouring.
2. **Defer `store-document` entirely** (ops 14). Eric asked for a
   document adapter and a browser embedding; and it is the adapter that
   proves the port is a port rather than a description of Postgres. The
   Web Storage backend, which could not honour the contract, is what
   was dropped.
3. **Keep the runtime private until a second host exists; publish only
   the language and the CLI** (priorart 2). The CLI _is_ a second
   host and embeds the runtime; Eric's stated goal is a publishable
   runtime; the `0.x` caveat and lockstep releases carry the risk the
   reviewer named. If the seam moves after 0.1, it is a minor, which
   `0.x` permits.
4. **A scope named for the language rather than the org** (priorart 2,
   ops 6). Eric decided `@overstory-social` (§10).
5. **Keep six packages, add a meta package and peer dependencies**
   (dx 11). One package with subpaths achieves the same install
   ergonomics with no peer-dependency story to get wrong; the directory
   boundaries and their specs keep the seam.
6. **A persisted derived-program row now** (priorart 3). Allowed and not
   built: measure `compileMs` first (§3.2, §8-21).
7. **GMCP on `serve`** (priorart 11). A good idea for later; `serve` in
   v1 is a loopback development tool (§9-5).
8. **`worldId` in code, `microworld` in prose** (dx 14). Eric chose the
   word; one word in prose and signatures beats two.
9. **Two ports, store and log** (dx 10). One interface with the
   housekeeping methods on the store itself is simpler for an adapter
   author than two interfaces; the log methods are four.
10. **Vendor the studios into `packages/e2e`** (ops 13). Unnecessary
    once `./examples` is a published subpath the seed reads (§7.4).
11. **Coarsen miss timestamps** (security 11, second option). Moot once
    the action record carries no actor.
12. **Adopt Durable Objects, Convex, Firestore or a BaaS as the
    runtime; Lezer or Chevrotain for the compiler; Inform, Evennia or
    Ranvier as the engine** (priorart 6, 9, 13 — each reviewer's own
    conclusion as well). Declined for the reasons sprout.md §5.1 and
    understory.md §3.2 already give, now on the record in §0 and §5.2.
13. **A missing `LICENSE`** (dx 19). `packages/sprout/LICENSE` exists;
    the point about one per package at the split is taken (§9-4).

If any of §8 reads wrong, say so and the document changes.

### 11.4 Eric's read of revision 2 (2026-09-17), and revision 3

Two points, both taken whole:

- **Core should not think about sweep or the tick; that is the
  Understory's.** Revision 2 had already made the schedule the host's,
  but it left the _mechanism_ of publishing — files, drafts, minted
  versions, `requestPublish`, `publish`, `unpublish`, `deleteFile` —
  inside core, and a `branch` dimension on every row so a builder could
  play a draft. Eric's framing is simpler and is now the design: core
  takes **one microworld as an archive** of `.sprout` files (a folder,
  a zip, an in-memory list) and lets people traverse it, unfolding it
  into whatever store it was given; `load` and `reset` are the whole of
  its content API; a draft is just another microworld loaded from the
  draft archive. Everything that was §4.4 moved to §7.1, where the
  Understory does it in its own tables on lang alone, and the port lost
  files and versions and the branch (§4.6). Save states — the one thing
  that might come back into core — are reserved as a shape and not
  built.
- **Authoring outside the Understory is text files in an editor.** So
  the CLI is `check`, `play`, `serve`, `pack` and `init`, with no
  `publish` or `sweep`; a VS Code plugin on lang's exported lexer and
  `compileFile` is the natural companion and is a §9-5 item. Every
  authoring check is lang's, which is why an editor plugin needs only
  lang — the split the brief asked for, sharper than revision 2 drew it.

What this cost, honestly: the "publish per file, refuse only what would
break" rule (§11.2) is now the Understory's to implement at the tick,
by compiling the assembled archive strictly and loading without the
refused file; and `LANGUAGE_LEVEL` is recorded in the manifest the host
stores rather than on a version row core owns. Both are the same
mechanisms in the host's hands.
