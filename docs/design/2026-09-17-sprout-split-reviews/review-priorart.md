# Outside review: prior art and "just use system X"

Target: `design/proposals/2026-09-17-sprout-split.md`. Read alongside
`sprout.md` §2.11/§4/§5.1/§8, `understory.md` §3.1–3.3, `PRINCIPLES.md`,
`packages/sprout/README.md`. One perspective only: for each piece this
builds, does something that already exists do it better — and where the
bespoke choice is right, why.

---

## 1. SHOULD-CHANGE — §2 (packages), §9 stage 4: six published packages is three too many

**Claim.** §2 answers "three repos?" well and then answers the wrong
follow-up question. The repo count is settled; the *package* count is
not, and six interdependent packages under one scope reintroduces most
of what §2 rejected — six semver ranges that must move together every
time the lang↔core seam moves, which §2 itself says will be wrong "the
first three times".

**Evidence.** The libraries that ship a port plus many adapters mostly
do it inside one package: `unstorage` ships ~30 drivers as subpath
exports (`unstorage/drivers/fs`, `/cloudflare-kv-binding`); Kysely ships
`PostgresDialect`, `MysqlDialect` and `SqliteDialect` in the main
package and leaves only community dialects outside it; zod is one
package. Separate packages earn their keep when a consumer would
otherwise install a heavy transitive dep — which here is only `pg` (a
type-only dep, per the §2 table) and PGlite (the CLI's). Meanwhile the
repo has no release tooling at all: root `package.json` is a private
workspace with turbo + npm workspaces, there is no `.changeset`, no
version script, so "publish 0.1.0 of each" (stage 4) is six manual
publishes and six hand-edited ranges, forever, for one maintainer.

**Recommendation.** Publish two artifacts: `sprout` (lang + core +
memory store + document store, with `store-sql`, the backends and
`ext-media` as subpath exports; `pg` an optional peer) and
`sprout-cli`, bundled by esbuild so it need not depend on a published
core at all (the `wrangler` pattern — the CLI ships a bundle, not a
dependency graph). If more than one package really must ship, adopt
`@changesets/cli` with a `fixed` group so the whole scope versions in
lockstep; it is a day of setup and it is what essentially every
multi-package TS workspace uses.

## 2. CONSIDER — §2, §9 stage 4: "publish as packages at all" — publish the language, not the runtime

**Claim.** The document already sequences publishing last, which is
right. But it assumes the whole family gets published. Publishing
`core`, the adapters and `ext-media` before a second host exists buys
nothing and converts every seam mistake into a major version.

**Evidence.** This repo has already done one split — PR #513, 2026-09-16,
`packages/sprout` as `@overstory/sprout` — and this document is that
seam being redesigned three weeks later (§0: "stages 2 and 3 of that
plan are what this document replaces"). §2 predicts the same again. A
library API is an untestable hypothesis until a caller who is not the
author uses it; the rule of three exists for this. Nothing about the
MIT goal requires npm: the source being public in `overstory-social/sprout`
satisfies it entirely.

**Recommendation.** Do the repo split at stage 4 as planned, and
publish exactly the two things with an audience *today*: the
**language** (a grammar, a compiler, a printer, and a generated
SKILL.md — useful to IF people and to model tooling with no runtime at
all) and the **CLI** (bundled). Mark core, the adapters and the
extension `"private": true` in the public repo until a second host
asks for them. Related and cheap while it is still free: the scope
`@overstory-social` ties an MIT language to a social network it is
explicitly trying not to be part of (`inkjs` is not `@inkle/…`); a
scope named for the language ages better and costs nothing to pick now.

## 3. CONSIDER — §3.2: source-as-truth is right; "no compiled artifact is ever persisted" overshoots

**Claim.** §3.2's case — a stored AST is a frozen public format with a
forever upgrade path, and a language embedded by other hosts cannot ask
every host's database to follow its internal tree — is correct and
decisive for the **stored, versioned, moderated** artifact. It does not
follow that no derived compiled artifact may ever be written down, and
the performance argument offered in its place is the document's weakest
paragraph.

**Evidence.** Ink is the exact counter-case and it resolves the same
way: compiled ink JSON carries `inkVersion`, and the runtime compares
it against `inkVersionCurrent` / `inkVersionMinimumCompatible` and
*refuses* what it cannot read — the remedy being recompilation from
source, not an upgrade function kept forever. Python's `.pyc` (magic
number), V8's `vm.Script` `cachedData` (rejected wholesale on version
mismatch) and Glulx's `.ulx` distribution are the same pattern: derived,
discardable, keyed by a version stamp, never a migration target. The
claim "a warm process compiles a microworld once per edition" is the
soft spot in a Firebase Functions host specifically — gen-2 instances
are recycled and scaled horizontally, so a per-process `Map` misses on
every new instance, and a microworld at the cap (hundreds of
definitions, up to 64 KB each, hand-written recursive descent) is
asserted to be milliseconds without a measurement.

**Recommendation.** Keep source as the stored truth — the moderation
argument ("what a moderator diffs is text") is the right reason and it
stands on its own. Then measure a cold compile of a capped microworld,
and if it is not free, add one **derived** row to the SQL adapter:
`sprout_program_cache(microworld, lang_version, published_stamp, blob)`,
written on compile, read on load, dropped wholesale when `lang_version`
changes. It is not a format, because nothing ever reads a stamp it did
not write. Say that explicitly in §3.2 so a future reader does not
mistake the invariant for "compilation may never be cached anywhere".

## 4. SHOULD-CHANGE — §5.1: "copy the migration files into your own sequence, verbatim" is a drift bug with no detector

**Claim.** The SQL adapter ships numbered SQL plus its own runner and
`sprout_migration` table, and then tells a host with its own migration
system (Overstory) to transcribe the files. That makes two schema
authorities and a silent divergence the first time the adapter's `002`
lands and nobody re-copies it — directly against CLAUDE.md's
"`migrations/` is the schema authority".

**Evidence.** The Postgres libraries that solve embedding own a
**schema**, not a table prefix, and migrate themselves: graphile-worker
manages `graphile_worker` and decides whether to create or migrate by
looking for its own migrations table ("just point graphile-worker at
your database and we handle our own migrations"); pg-boss does the same
with a `pgboss` schema. A namespace is also what makes "no foreign key
to anything of the host's" (§5.1) visible rather than a convention, and
it makes the drop in §7.7 trivially auditable.

**Recommendation.** Put the tables in a Postgres schema
(`sprout.microworld`, `sprout.unit`, …), have the adapter migrate itself
against `sprout.migration` on first use, and have Overstory's `migrate`
invoke that as a step rather than transcribe it — one authority, and
`schema:check` still executes it. If the transcribe route is kept for
CI-shape reasons, make it mechanical the house way: ship a checksum per
SQL file and have a spec assert the copy in `migrations/` matches
("when a rule gets broken twice, make it mechanical" — this one will be
broken on the first adapter patch release).

## 5. SHOULD-CHANGE — §4.6, §9 stage 5: the store port has no per-actor outbox, and that is the field you least want to add later

**Claim.** §9 stage 5 defers "narration to other actors in a room …
core's actor row is where it would live". But `ActorRecord`'s fields are
enumerated in §4.1 and the port's only actor methods are `actor`,
`putActor`, `actorsIn`. Adding an outbox after the adapters exist is a
record-shape change plus a read method — a breaking change to every
adapter and to the conformance suite, i.e. a major on the one interface
the design most wants stable.

**Evidence.** Every multiplayer text world since the first MUD pushes a
line to bystanders; it is not an enhancement, it is the multiplayer.
§6's `serve` is sold as "telnet in from two terminals and give each
other things" — and with no outbox, actor B sees nothing until B types.
The turn API makes this worse, not better, because `look` is
explicitly "the poll and the presence heartbeat": the shape as written
bakes polling in, and the thing that would replace polling has nowhere
to live.

**Recommendation.** Put it in now and leave it empty: `pending:
TranscriptLine[]` on `ActorRecord`, drained at the top of the next turn
and returned in `TurnResponse.lines`, plus one conformance case that
round-trips it. Cost today: one field and five lines of suite. Cost
after publication: a coordinated major across the family.

## 6. CONSIDER — §4.5, §7: the one off-the-shelf runtime that actually matches this contract is Cloudflare Durable Objects — and Overstory already runs Cloudflare

**Claim.** The document never asks "is there a system whose native
concurrency model *is* §4.5's contract?" There is, and it is already in
the stack.

**Evidence.** §4.5's contract is "turns on one microworld are
serialized; a turn's writes land together or not at all". A Durable
Object is precisely that: one single-threaded, globally unique instance
per id that serializes access to its own transactional, strongly
consistent storage (SQLite-backed, GA), with the WebSocket Hibernation
API giving the push channel from finding 5 at near-zero idle cost.
Overstory already deploys `overstory-ssr` on Workers and mirrors media
to R2 (CLAUDE.md), so the operational surface exists. For the record,
the other "whole runtime" candidates and why they lose: Firestore and
RTDB were weighed in sprout.md §2.11 and lose on two-sources-of-truth
(the tick, flags, versions and takeout are SQL); Supabase and PocketBase
are a different BaaS, not an embedding, and would be the host, not the
runtime; **Convex** is the closest in shape — deterministic
transactional server functions in an isolate — but it solves
*developer*-authored code, and the entire problem here is
*user*-authored code, which is why a bespoke total language exists at
all (understory.md §3.2).

**Recommendation.** Do not adopt for v1: the audience rule, moderation,
flags, takeout and the tick live in Postgres, and splitting the truth is
the objection sprout.md §2.11 already sustained. Do name Durable Objects
in §5 as the third intended adapter target and check the port against it
now — `transaction(microworldId, fn)` maps to a DO id, and a DO's
storage is a document store, so `store-document` is already that
adapter. A paragraph makes the port's central design decision
falsifiable instead of self-asserted, and it is the honest answer to
"how would the multiplayer claim ever become real?"

## 7. CONSIDER — §4.5/§4.6: the suite cannot prove the one property everything rests on, and there is a cheap way to prove it

**Claim.** §4.5 candidly notes that PGlite cannot prove contention, and
then leaves it there. Per-microworld serialization is the *entire*
concurrency story — no optimistic retry, no merge, no CRDT — so it is
the assumption most deserving of a real test, not a documented caveat.

**Evidence.** PostgreSQL's own project tests exactly this class of
property with `isolationtester` / `pg_isolation_regress`: named
sessions, interleaved steps, and a blocking detector that asserts a step
*waits*. Nothing exotic is needed to borrow the idea — two node-postgres
clients and an assertion that B's `FOR UPDATE` blocks until A commits.

**Recommendation.** One CI job against a real Postgres (a container, or
the dev Cloud SQL instance) running the serialization and fault-rollback
cases with two connections: open A, take the lock, assert B has not
resolved, commit A, assert ordering. Sixty lines, and it converts the
design's load-bearing contract from documented to tested.

## 8. NOTE — §4.6: the conformance suite is the best-chosen pattern in the document; ship it the way the precedents do

**Claim.** "One exported vitest file that takes a store factory" is
exactly right and has a named precedent worth copying in detail.

**Evidence.** `@keyv/test-suite` is a published vitest suite that takes
the adapter's store factory and proves API compliance for every Keyv
storage adapter; `abstract-level` does the same for LevelDB-shaped
stores. Both are deliberately **separate** from the core package, so an
adapter author does not inherit core's test framework.

**Recommendation.** Keep it; ship it as a subpath (`sprout/conformance`)
or its own package with `vitest` as a **peer**, never a dependency of
core. This is not pedantry in this repo: CLAUDE.md records the
2026-09-03 outage where `@vitest/browser-playwright@5`'s *peer graph*
killed every deploy, because arborist resolves devDependencies' peers
before pruning. A runtime package that depends on vitest is that
accident waiting for a second turn.

## 9. NOTE (keep bespoke) — §3.4, sprout.md §5.1: Evennia and Ranvier belong in the rejected list, on the record

**Claim.** sprout.md §5.1 correctly dispatches "run Inform itself"
(Z-machine/Glulx under Quixe or ZVM — the world would have to be written
in Inform 7, the VM has its own state model, no room transaction, no
per-visitor memory, no moderation surface). The two "just use a MUD
engine" answers are never weighed anywhere, and a public MIT repo will
be asked about them on day one.

**Evidence.** **Evennia** is the mature, actively maintained framework
for exactly this shape — but it is Python/Django/Twisted with an
always-on server, and its extensibility is Python typeclasses plus an
in-game `py` console: precisely the sandboxed-general-purpose-language
model understory.md §3.2 refuses ("our own language, never
user-supplied JavaScript, no matter how good the sandbox"). **Ranvier**
(Node, still getting commits) is closer to the host language, but its
scripting is plain JavaScript in the server process — same objection —
and it assumes a long-lived socket server, which a Firebase Functions
host does not have. Neither is moderatable in the sense PRINCIPLES §10
needs: you cannot read a room and know what it does.

**Recommendation.** Keep bespoke; add two rows to §0's table naming
Evennia and Ranvier with those reasons, so the question closes on the
record rather than being re-asked by every reader of the public repo.
Same for Twine / Ink / ChoiceScript / Ren'Py, in one line: they are
authored-branching systems with no shared persistent world and no
parser, so they are not alternatives to this at all — a sentence saves
a hundred issues.

## 10. NOTE — §4.4 limits, understory.md §3.2–3.3: LambdaMOO is cited only for the least interesting lesson it has

**Claim.** LambdaMOO/ToastStunt is the closest thing that has ever
existed to what the Understory is — users programming objects in a
shared persistent world, thirty years in production — and understory.md
mentions it once, to say MOO needed Turing-completeness because MOO
implemented the server in MOO. That is correct and it is the smallest
thing MOO knows.

**Evidence.** MOO solved, in the field, the governance problems §4.4's
`limits` table is now approaching fresh: per-**owner** object quotas
(`@quota`), an explicit programmer bit, per-verb and per-property
permission bits with an owner, and the wizard-bit-is-root failure mode
that follows inevitably from "everything is in the db". The design's
limits are all per-*microworld*; MOO's decisive one was per-*owner*,
which is what actually bounds abuse when one person creates fifty
zones. Separately, Sprout's grammar lines (`"light [self] with [with]"`)
are Inform-shaped rather than MOO-shaped (`this none this` plus a fixed
preposition table) — the better call for builders, and readers coming
from MUDs will expect the latter.

**Recommendation.** No code change. Before stage 2 freezes
`MicroworldReport` and the limits, decide explicitly whether a per-owner
budget belongs in core's limits or in the host (I think the host, since
core has no identity — but it should be a decision in §8, not an
omission). And state the Inform-vs-MOO grammar choice in the README; it
is a selling point to the audience most likely to pick this up.

## 11. CONSIDER — §6: `serve` that prints only `text` wastes the one audience most likely to adopt Sprout

**Claim.** `TurnResponse` carries `affordances` and `effects`, and §4.2
says a telnet client "prints `text` and nothing else". That throws away
the structured half of the turn for the one front end aimed at people
who already have tooling.

**Evidence.** The MUD world standardised out-of-band structured data
twenty years ago: **GMCP**, telnet option 201, frames of
`IAC SB 201 <package> SP <json> IAC SE`, supported out of the box by
Mudlet and TinTin++ (MSDP, option 69, is the other). A few dozen lines
of option negotiation on top of a socket server turns `serve` from a
two-window demo into something real MUD clients can script against —
which is a far better proof of "one turn API, many front ends" than any
paragraph.

**Recommendation.** Negotiate GMCP in `serve` and emit
`Sprout.Affordances` and `Sprout.Effects` packages, falling back to
plain lines on DONT. It also gives `ext-media` somewhere sensible to put
an image id in a terminal, which the current design answers with
"[a picture opens]".

## 12. CONSIDER — §4.1/§5.1, §8 call 11: say why event sourcing is refused, and that CRDTs are the wrong shape

**Claim.** Both will be proposed by the first outside reader of a public
repo containing an append-only action log, and neither is addressed.

**Evidence.** `sprout_action` is already an append-only log of
deterministic, total, serialized turns against source-versioned
programs — the exact precondition for replay, and replay would give
`snapshot(microworldId, room)` (§4.4, a flag's evidence) and moderation
time-travel for free. What kills it is §4.4's own retention limit:
actions are trimmed at 30 days, so the log is instrumentation, not
truth. CRDTs are not close: they buy convergence for *concurrent
divergent replicas*, and this runtime has one authoritative evaluator,
per-microworld serialization, and a consent protocol whose whole point
is that a refusal leaves the world byte-identical (sprout.md §8 call 4).
Merge semantics would destroy the property — "refuse means nothing
happened" — that makes a room reviewable at all.

**Recommendation.** Keep rows-as-truth (§8 call 11 is right). Add one
sentence saying the action log is deliberately trimmed and therefore
deliberately not the truth, and that `snapshot` consequently *stores*
its evidence rather than deriving it. One sentence forecloses a
recurring argument.

## 13. CONSIDER — §3.1/§3.6: hand-written recursive descent is right; finish the job by exporting the lexer

**Claim.** sprout.md §5.1 says a parser library "is the right tool for
§3 (the DSL), and what I would use there", but §3.1 keeps the
hand-written 1,187-line `sprout-lang.ts`. The document should resolve
that contradiction rather than leave both statements standing.

**Evidence.** Chevrotain, Ohm and peggy would each break the invariant
that makes lang publishable — `boundary.spec.ts`'s "imports nothing but
zod" — for a grammar this small, and none of them supplies what
actually costs the effort here: §3's *refusals* (a write to anything but
self, `text` outside `describe`, a grammar slot that is not `[self]`)
are a hand walk over the tree either way. The one library with a real
extra is **Lezer**, because CodeMirror 6 is built on it and
`views/understory/sprout-language.ts` currently hand-keeps the keyword
set — but adopting it means two grammars, editor and compiler, which is
the failure this repo already legislates against ("One renderer",
CLAUDE.md).

**Recommendation.** Keep the hand-written compiler; ship §3.6's derived
`SPROUT_KEYWORDS`, and go one step further — export the **lexer** so the
frontend drives CodeMirror's `StreamLanguage` from the same tokenizer
rather than a mirrored keyword list. One grammar, one source of truth,
no new dependency, and §3.6's drift problem disappears rather than being
re-mirrored at a coarser grain.

---

## Verdict

Judged only on prior art, this is an unusually well-read design: the
two decisions most often got wrong — a bespoke total language instead of
sandboxed JS, and a hand-written Inform-lineage command parser instead
of an LLM or a regex pile — are the right ones for reasons the documents
state accurately, and the constraints that make them right
(moderatability, totality, one server-side evaluator, a Functions host
with no long-lived process, one maintainer) genuinely rule out Inform,
Evennia, Ranvier, Convex and Firestore-as-truth. The port-plus-adapters-
plus-conformance-suite shape is the Keyv/abstract-level pattern arrived
at independently and is the strongest structural idea in the document.
Nothing here rises to MUST-CHANGE. What the design does reinvent is
mostly *packaging and operations*, where it is furthest from its own
evidence: six npm packages with no release tooling where two would do,
a SQL adapter that asks its host to transcribe migrations where
graphile-worker and pg-boss own a schema and migrate themselves, a
conformance suite that cannot test the one contract everything rests
on, and a store port missing the one field (a per-actor outbox) that
multiplayer will demand and that cannot be added cheaply after
publication. The sharpest unasked question is Durable Objects: not
because Overstory should adopt them, but because they are the existing
system whose concurrency model *is* §4.5's contract, and checking the
port against them would prove the port is a port. And on "publish at
all" — publish the language and the CLI, keep the runtime private until
a second host exists; the seam has already been redesigned once in three
weeks, and a published core turns the next redesign from a PR into a
major version.
