# Outside review — language design correctness

`design/proposals/2026-09-17-sprout-split.md`, read against `sprout.md`,
`packages/sprout/README.md` and the implementation in `packages/sprout/src`.
One perspective only: is the language design in here sound, complete, and
honest about what it costs.

---

## 1. MUST-CHANGE — §3.2 / §3.3: microworld-wide compilation makes every problem a global one, and source-as-truth gives no way to degrade

**Claim.** §3.3 compiles the whole published set into one `Program` and §3.2
compiles it at load; §3.3 says an unresolved name "is a problem on its line".
The document never says what happens to a **published, running** microworld
whose stored source stops compiling. On the shape as written the answer is: the
`Program` is `null`, the turn cannot be served, and the entire world goes dark —
every room, including the ones that are fine.

**Evidence.** `compileMicroworld(...) : { program: Program | null; problems }`
(§3.3) is all-or-nothing by its own type. Today the failure mode is per row:
`compileSprout` refuses one definition (`packages/sprout/src/sprout-lang.ts`,
`compileAny` → `{ definition: null, problems }`), and the loader simply has one
fewer published room — §7.1's take-down and `door.spec.ts`'s "a zone whose entry
room is unpublished" both depend on that. Three live paths can produce a
non-compiling published set under the proposal: a moderator take-down
(`core.unpublish`, §7.1, finding 2), a lang version that tightens a check
(finding 3), and an `importMicroworld` of someone else's world (§4.4).

**Fix.** Make the load-time compile total by construction: problems are
*attributed to a definition*, and a definition that cannot be compiled or
resolved is **dropped from the program** with its exits and references treated
as absent — the same rule §3.3 already gives for "an exit to a room in a draft
that is not published is legal and simply absent at play". The microworld keeps
running minus the broken part; `inspect` reports the dropped definitions and
`publish` (which is the visible, builder-initiated moment) stays strict. State
this as a numbered call in §8: **save and publish refuse; load degrades.**

---

## 2. MUST-CHANGE — §4.4: `unpublish` skips the check `publish` was given

**Claim.** §4.4 says "Publish compiles the set it would leave standing … so a
running microworld is never left with an unresolvable chain", and then, two
lines later, "`unpublish(microworldId, unit, now)` — **immediate**". Unpublish
removes definitions from exactly the same published set, so it can leave the
unresolvable chain that publish exists to prevent — and §7.1 routes **sysmod
take-down** through `core.unpublish`. A take-down that bricks a world is the
worst possible version of this bug.

**Evidence.** §4.4's bullet names the failure ("an object published against
draft kinds can meet different published ones at load") and fixes it only on the
publish path. Today unpublish is per row and safe *because* the loader tolerates
a missing definition (`build.ts`'s `unpublishUnderstoryRoom`, "going backward —
unpublish — is instant"); microworld compilation removes that tolerance.

**Fix.** Either (a) adopt finding 1's degradation rule, which makes unpublish
safe again for free, or (b) make `unpublish` compile the remaining set and
return the dependent units it would break, with an explicit cascade
(`unpublish(unit, { withDependents: true })`). Moderation must never be able to
fail: take-down uses the cascade and records what it withdrew in the audit
entry. Say which in §8-7, which currently covers only the publish direction.

---

## 3. MUST-CHANGE — §3.2: the compatibility promise is asserted, not mechanised, and the project has already broken it twice

**Claim.** "core … compiles older ones as they are, because syntax is added, not
changed" and "a parse error surfaces to a visitor — only if a newer compiler
refuses older text, which the compatibility rule above forbids". The rule
forbids it by fiat. Every refusal in `sprout.md` §3 is a **semantic** check, not
syntax, and tightening one is exactly how this language has evolved.

**Evidence.** #441 added "describe refuses writes"
(`SPROUT_MUTATING_STATEMENTS`, `statementProblems`'s `scope.describe` branch),
and it was survivable only because the AST was the stored artefact: old trees
kept running and the engine **skipped** the offending statement (§2.12: "the
engine skips a mutating statement that reaches a `describe` anyway"). #337 did
the same for a well-known property redeclared with another type. With source as
the stored truth and compilation at load, each of those tightenings turns
previously-published text into a load failure — the skip has nowhere to live,
because there is no tree until the compiler succeeds. "There are no Understories
in production yet" paid for both; it will not pay for the third.

**Fix.** Two mechanisms, both small:
1. **Stamp the lang version on each minted version**, not only on the
   microworld (§4.1 puts it on the microworld). A version records the language
   it was minted under.
2. **Two severities in the compiler**: *structural* problems (syntax,
   resolution, caps) are fatal at every moment; *policy* refusals carry the
   lang version that introduced them, and at LOAD a policy refusal older than
   the version's stamp is a warning plus the engine's existing skip semantics,
   surfaced in `inspect`. At PUBLISH every check is fatal, so tightening lands
   the next time a builder publishes — visibly, with the problem named.

Also state the honest cost of the escape hatch: "the one time the language
breaks syntax, the migration is a text rewrite the printer can do" requires
keeping the **old front end** (lexer + parser, ~1,200 lines in `sprout-lang.ts`)
alive to parse the old text before the printer can print it. That is strictly
more retained code than the `upgradeSproutDefinition` (≈70 lines) the section
deletes. Source-as-truth is still the right call — but the argument in §3.2 as
written wins by not counting this.

---

## 4. MUST-CHANGE — §3.5: the four extension points do not cover what `media` actually is

**Claim.** §3.5 asserts the four points are enough for media "as specified in
sprout.md §2.9". Checking each piece against the implementation, three of the
four are under-specified and one piece has no home at all.

**Evidence, piece by piece:**

- **`media` as a value type.** In the implementation it is a member of
  `SproutField`'s discriminated union (`definitions.ts`), and its values are
  members of `SproutValue` — `z.null()` is in `SproutValue` *only* for media
  ("#345: a media property with no picture"). It participates in `fit`,
  `defaultOf`, `normalizeState`, `literalFits` (`sprout.ts`) and the printer
  (`printField`'s `case 'media'`). §3.5's `ValueType` = "a literal form, a
  `fit()`, a default" covers two of six. In particular the extension must be
  able to add a member to the **persisted** state union and to the printer.
- **The literal grammar has a hole without it.** There is no string property
  type in core Sprout: `:p "text"` is parsed as a *media* field
  (`sprout-lang.ts`: "if (this.at('string')) return { type: 'media', … }"). Take
  media out of core and a quoted literal after a property name becomes a syntax
  error — i.e. removing an extension changes the meaning of a construct the core
  grammar of §2.2 says is legal ("a literal default: true/false, an integer, a
  string, or a symbol"). Either core keeps a `string` field type (my
  recommendation; §2.2 already claims one) or §8 must record that §2.2's
  "a string" default is extension-only.
- **`:image` as a well-known.** `{ name, type, on: ['room','object','kind'] }`
  is coarser than `wellKnownFor(def)`, which keys off role *and* whether the
  kind is a `Container`. More seriously, `wellKnownFor` is consulted by
  `fieldOf`, `takeableOf`, `openOf`, `capacityOf` and **`normalizeObjectState`**
  — and §3.4 threads `ext` through only `runVerb`, `runMove`, `describe` and
  `openVerbs`. `normalizeObjectState` is what CORE calls to build a Scene from
  store rows; without `ext` it drops `image` from state, so §2.9's runtime
  `self.set(:image, "m-…")` is silently lost on the next load.
- **`show` as a statement, `pure: true`.** §3.5 defines `pure` as "may appear
  where nothing may write: **describe and consent guards**". `show` is refused
  in a consent guard today (`statementProblems`: a consent scope admits only
  `if`, `allow`, `refuse`), and allowing it breaks §8-4 of sprout.md — "a
  refused `take` must leave the world exactly as it was" — because an effect
  recorded on a refusal *is* a change the actor sees.

**Fix.** Split `pure` into two flags (`inDescribe`, `inConsent`) and default
`inConsent` to false. Give `ValueType` the full set: literal syntax, `fit`,
default, `print`, and the JSON storage shape. Thread `ext` (or a resolved
well-known table) into the Scene itself, so every projection and normalisation
sees the same property table as the evaluator — one answer to one question, per
the house rule. And add a fifth point or say why not: the compiler's
**warnings** (`sproutDefinitionWarnings` already special-cases what the engine
emits) need to know an extension's statements do not "send" anything.

---

## 5. MUST-CHANGE — §3.5: keywords reserved per unit are incoherent across units of one microworld

**Claim.** "`use` per unit" plus "reserves an extension's keywords only in units
that `use` it" makes the same identifier mean different things in two units of
one microworld, while §3.3 makes identifiers resolve **across** units. The two
rules contradict each other.

**Evidence.** `KEYWORDS` in `sprout-lang.ts` is consulted by `atTarget()`,
`target()` and the message-name check. Suppose unit B, with no `use media`,
legally defines `object show: Lamp in hall` (the proposal explicitly blesses
this: "an object called `show` in a microworld without pictures is legal"). Unit
A does `use media`, so in A `show` is a keyword — and A can therefore never
write `send show :lit` or `move show to actor`, though §3.3 says A and B share
one identifier namespace. The microworld is not compilable as one program in any
consistent keyword set.

The inheritance case the brief asks about lands the same way, from the other
side: a kind in A declares `:image`, an object in B inherits it. At runtime this
works — `resolveDefinition` folds the parent's properties into the child, so the
flattened definition carries `image` as a *declared* property (`sprout.ts`). But
at compile time B cannot override it (`:image "m-2"` in the instance body needs
media's literal form) and cannot `self.set(:image, …)`, because `wellKnownFor`
is computed per definition. So `use` is not really a per-unit scope at all — the
semantics it gates are program-global.

**Fix.** Make `use` a **microworld-level manifest**: the union of the units'
`use` lines (or, better, one manifest unit) determines the keyword set and the
well-known table for the entire compilation. Keep the per-unit `use` line as
documentation and as the CLI's "install ext-media to play this" signal, but
compile every unit with the same reserved set, and refuse a microworld that uses
an extension keyword as an identifier anywhere. This costs the "`show` as an
object name" example and buys a language with one namespace.

---

## 6. SHOULD-CHANGE — §4.4: `saveDraft` compiling the whole draft set blocks ordinary building

**Claim.** "`saveDraft(microworldId, unit, source, now): Problems` — compiles
the microworld's drafts with this unit replaced; **refuses on problems**." Since
§3.3 resolves cross-unit references at compile, a builder cannot save unit A
that names a kind they have not written yet — and worse, once *any* draft is
broken, saving an unrelated unit B fails too, because B's save compiles the set
containing A.

**Evidence.** Today a save refuses only the definition being saved
(`compileSprout` with `zoneKinds` supplied, `sprout-lang.ts`); the "cross-unit"
checks that exist are warnings (`sproutDefinitionWarnings(def, zoneMessages)`).
The proposal silently promotes them to save-blocking errors and widens their
blast radius to every unit.

**Fix.** Save is per unit: syntax, caps and self-contained semantics are fatal;
cross-unit resolution failures come back as **warnings on the draft set**, with
`checkDraft` returning them for the editor's panel. The strict gate already
exists where it belongs — §4.4's `publish` compiles the published set and
refuses. That preserves the distinction the brief asks about ("draft compiles
against draft kinds, published runs against published kinds") without making a
half-written world unsaveable.

Two smaller gaps in the same section: (a) the draft program is "compiled from
the drafts", but a unit with no draft edit has no draft text — say it falls back
to its published version; (b) `publishedStamp` keys the program cache, and
nothing keys the **draft** program cache — either add a `draftStamp` bumped by
`saveDraft`/`deleteUnit` or state that draft play recompiles per turn.

---

## 7. SHOULD-CHANGE — §3.3 / §4.1: identifiers as object ids change three things the document does not mention

**Claim.** Moving from host uuids to source identifiers (§1: "Objects are
addressed by their source identifier … a spawned thing is `Kind#n`") is right,
but it silently changes delivery order, orphans live state on a rename, and
turns a room rename into a silent loss of exits.

**Evidence.**
- **Order.** §2.5's determinism rule is "container-first, then contents in id
  order", implemented as a lexicographic sort on `id`
  (`engine.ts`'s `sorted`). With uuids that order is arbitrary-but-stable; with
  identifiers it becomes alphabetical and **builder-visible** — renaming `torch`
  to `brand` reorders delivery — and with `Kind#n` it is wrong: `Cup#10` sorts
  before `Cup#2`, so spawn order stops being delivery order at the tenth spawn.
- **Orphaned state.** `sprout_object` is "keyed by microworld, realm, id"
  (§5.1). Rename an object's identifier and its live row is an orphan with no
  definition; §4.1's "a placed object with no row is at home at its defaults"
  covers the other direction only.
- **Exits.** §3.3 makes an exit to an unpublished room legal-and-absent, and
  §4.4 refuses only an unresolvable *kind* at publish. So renaming a room
  silently deletes every door into it, while renaming a kind is refused — an
  asymmetry with no stated reason.

**Fix.** (a) Define delivery order explicitly in §3.4 — declaration order within
a unit, units in name order, spawned objects after placed ones in spawn
sequence — rather than inheriting "id order" whose meaning has changed; sort
`Kind#n` numerically. (b) At load, drop object rows whose identifier resolves to
nothing, and report the drop in `inspect`. (c) Distinguish at compile between
"a room no unit defines at all" (a problem, at save) and "a room defined in a
draft, not yet published" (legal, absent) — the compiler has both sets in hand
and can tell them apart; only the second should be silent.

---

## 8. SHOULD-CHANGE — §2.8's instance→kind-version binding is dropped without being listed as an amendment

**Claim.** sprout.md §2.8 says "an instance binds to a kind's **published
version**", implemented as `understory_instance.kind_version_id`. Under per-unit
versioning plus one compiled `Program`, an object's kind is resolved from
whatever the published units say *now*; there is no per-instance version pin
left. §8 does not list this.

**Evidence.** §4.1's `ObjectRecord` is "id, kind chain root, container id, home
room, state, spawned, destroyed" — no kind version. §5.1's `sprout_object` has
no version column. The consequence is a live-data one: republish a kind that
drops or retypes a property and every instance's state for that property is
dropped on the next load (`normalizeState` keeps only declared fields;
`fit` returns `undefined` for an enum option that no longer exists, so the value
falls back to the default).

**Fix.** Add it to §8 as a call — "instances re-bind to the current published
kind at load; a property a republished kind no longer declares is dropped from
live state" — and make `publish` warn when a kind's republish drops or retypes a
property that live instances hold, computed from the objects the store already
has. That warning is cheap (one pass over `sprout_object.state` keys) and it is
the difference between a builder understanding the sweep and filing a bug.

---

## 9. SHOULD-CHANGE — §4.5: a per-microworld lock plus `look` as the poll makes the world a global mutex

**Claim.** §4.2 makes `look` "the poll, and the presence heartbeat" and a
`TurnInput` like any other; §4.2's order puts "the store's transaction on the
microworld" first; §4.5 makes the contract "turns on one microworld are
serialized" and demotes per-room locking to "an adapter optimisation". Every
client's few-second poll now takes an exclusive lock on the whole world.

**Evidence.** Today the lock is per room (`lockRoom`; §2.6: "a `go` locks both
rooms in id order"), which is what lets a busy zone have people in different
rooms. §2.11's own pressure-test triggers name "a room routinely holds more than
~10 actors" as a revisit signal; a microworld-wide lock reaches that ceiling
with ten actors anywhere in the world, doing nothing but polling.

**Fix.** Put read-only turns in the contract, not in an adapter: `look` and
`complete` (which §7.1 already exempts) run without the write lock, on a
consistent read. If that is too subtle for a document store, make the port's
lock scope a *declared capability* — `transaction(microworldId, fn)` as the
floor, `transaction(microworldId, { rooms }, fn)` where the adapter supports it
— and say that Overstory's SQL adapter uses the room scope, as it does today.
Related: §4.2 compiles the program **inside** the transaction. Compiling
possibly megabytes of source while holding `FOR UPDATE` on the microworld row is
the worst place for it; read the stamp, compile outside the lock, then take the
lock and re-check the stamp.

---

## 10. SHOULD-CHANGE — §3.2: lang *does* persist a format, and it is the state value union

**Claim.** "The stored, versioned, flag-pinned artifact is source text … nothing
writes [the AST] down" — but `ObjectRecord.state` and `MemoryRecord` are
`SproutState`, whose values are lang's `SproutValue`, normalised by lang's
`fit` and `defaultOf`. That is a persisted, cross-host, lang-owned format with
no stated stability promise, and §3.2's freedom clause ("a minor version of lang
may change [the tree]") is one sentence away from it.

**Evidence.** `definitions.ts`'s `SproutValue = boolean | int | string | null`
and `normalizeState`/`fit` in `engine.ts`; §4.6's `StoreTx.objects(realm)` /
`putObjects` carry those values across the port; §5.1 says the SQL adapter's
columns "are the record fields and are versioned with the package".

**Fix.** Say it plainly in §3.2 and §8-2: *the AST is unstable and unpersisted;
`SproutValue`, `SproutState` and each extension's storage shape are a stable,
semver-guarded format lang owns.* An extension that adds a value type therefore
also adds to the persisted union — which is another reason (finding 4) the
`ValueType` interface needs a storage shape.

---

## 11. CONSIDER — §3.1: the parser/lang seam leaves the built-in verbs and the default grammar on the wrong side

**Claim.** "`parser.ts` … goes to core: it turns a player's words into a command
against a scene." The line is right, but the split as drawn puts *language*
facts in core.

**Evidence.** `parser.ts` today owns `grammarLines(m)` — the §2.7 rule that a
message with no `grammar` line gets `"<name> [self]"` plus one per argument —
and the built-in verb vocabulary (`take`, `look`, `go`, `give`, `inventory`,
`wait`, `help`). Both are language facts: the built-ins are in lang's
`SPROUT_RESERVED_MESSAGES`, their semantics are lang's `runMove`, and
`sproutSkill()` teaches both. The compiler already checks grammar slots
(`GRAMMAR_SLOT` in `sprout.ts`); if core re-derives the default lines, the
compiler, the skill and the parser answer the same question three times — the
house's "two answers to one question is a smell".

**Fix.** The `Program` carries, per reachable message, the **complete** grammar
line list (authored plus defaults) already tokenised, and the built-in verb
table with its slots — both produced in lang, pinned to the skill by a spec.
Core keeps only matching: tokenising a player's line, the dictionary from live
state, scoring, disambiguation, pronouns, completion. Say so in §3.1, because
"grammar lines stay in lang" as written covers the authored lines only.

---

## 12. CONSIDER — §3.4 / §1: the `Scene` rename is not complete, and "scene" understates what the type is

**Claim.** §1 defines a scene as "one room, one actor, everything in reach, and
an *elsewhere* for a move". `SproutWorld` is also the turn's mutable
accumulator: it carries `kinds` (for `spawn`), `mint()` (id minting), 
`instanceCount` (the zone cap) and `budget` — and the evaluator writes object
state through it in place.

**Evidence.** `engine.ts`'s `SproutWorld` fields and `SproutBudget` ("made by
the first runner over this world and shared by every later one"). §3.4's four
signatures also omit the projections core needs to build §4.2's `SceneView`:
`describeWith`, `renderProse`, `memoryOf`, `visibleItems`, `verbLabel`,
`normalizeObjectState`, `actorObject`/`ACTOR_DEFINITION`, `takeableOf`/`openOf`/
`capacityOf`. Several are load-bearing for finding 4's `ext` threading.

**Fix.** Either name the type for what it is (`Turn`, or `Scene` with the
mutable half called out) or split it: an immutable `Scene` plus an explicit
`TurnContext { budget, mint, instanceCount, kinds }` passed alongside. Then list
the whole lang→core edge in §3.4, not four entry points — that list is the seam
this document exists to draw.

---

## 13. CONSIDER — §3.2 / §4.4: the cost model for load-time compilation is asserted, and `importMicroworld` has no compile step

**Claim.** "Parsing the whole of a capped microworld (a few hundred definitions,
64 KB each at most …) is milliseconds." A few hundred × 64 KB is up to 13 MB of
source per cold compile, per process, and §4.4's limits cap rooms, objects,
kinds and instances but never **total source bytes**.

**Evidence.** `UNDERSTORY_DEFINITION_BYTES_MAX = 64 * 1024` (`definitions.ts`)
is per definition; §4.4's limits list has no aggregate. The functions runtime
cold-starts often, so the cache hit rate is a guess, not a property.

**Fix.** Add a microworld source-bytes limit to §4.4's list (256 KB is generous
at the current 16 rooms × 12 items), and measure compile time in the action row
the instrumentation already writes (§4.1's `actions`) so the claim is evidence
in a month rather than prose. Separately: §4.4's `importMicroworld(export, now)`
takes minted, immutable version text from another host — the one place where
text reaches a host that never compiled it. Say that import **recompiles and
re-mints** under this host's lang and extension set, and refuses what it cannot
compile (including "this host has no pictures"); otherwise it is the hole §3.2
argues does not exist.

---

## 14. NOTE — silent amendments to sprout.md §2 that §8 does not list

Collected, because §8 asks to be complete and the brief asks the question
directly. Each is small; together they are the difference between §8 being a
changelog and being a gesture.

- **§2.2's well-known table** loses `:image` (disclosed in §8-5 in general
  terms, but the table is the normative text and is not named).
- **§2.4's grammar** loses `show` from `statement :=`, and the `media`/`none`
  literal forms — with the string-literal hole of finding 4.
- **§2.12's enumeration** "What is left to describe: `if`, `text`, `show` and
  `each`" becomes extension-dependent.
- **§3's refusal list** loses "`show` … fault as not in the world yet" and gains
  the extension refusals.
- **§2.8's** instance→kind-version binding (finding 8).
- **§2.5's** delivery order (finding 7).
- **§2.3's** "nothing else about [the actor] is readable" is untouched in the
  language, but §4.1 now **persists** the host's display name on the actor row
  and §4.4's `inspect` reports "actors present" to the builder and the
  moderator. In Overstory that is a mask's display name becoming legible to a
  zone owner — a product-privacy change riding in on a language document. Either
  `inspect` returns presence as a count, with names only inside the turn's
  `SceneView` for people in the same room, or §8 records the change deliberately.

---

## Verdict

The three big calls are right and worth making: source as the stored truth
(§3.2), compilation of a microworld rather than a definition (§3.3), and
extensions that record effects rather than perform them (§3.5) — that last rule
is the best sentence in the document, because it is the one that keeps the
computation class intact no matter who writes an extension. What the document
has not yet done is pay for them. Source-as-truth trades a stored-format
migration for a **language-version compatibility promise**, and a promise with
no mechanism behind it is exactly the kind of rule this codebase has learned to
make mechanical — the project has already tightened two checks (#441, #337) in
ways that would have bricked published text, and got away with it only because
the AST was stored and the engine could skip. Microworld compilation trades
per-row failure for whole-world failure, and the proposal has not noticed that
`unpublish` — the path a **moderator** takes — can now leave a world that does
not compile. And the extension mechanism, checked piece by piece against the one
extension it was designed for, covers roughly half of what `media` actually is:
a persisted value type, a well-known property consulted by five helpers the
`ext` parameter never reaches, a statement whose "pure" flag would newly admit
it into consent guards, and a `use` scope that contradicts the single identifier
namespace §3.3 introduces two sections earlier. None of this is fatal to the
design; all of it is fixable in the document before a line of code moves, which
is the cheapest place it will ever be fixable. Fix findings 1–5, decide 6–10,
and this is a proposal I would build from.
