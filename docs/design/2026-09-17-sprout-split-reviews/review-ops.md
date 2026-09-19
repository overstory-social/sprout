# Outside review: supportability and operations
### `design/proposals/2026-09-17-sprout-split.md`, read 2026-09-17

One reviewer, one lens: can one person run this, what breaks at 3 a.m., and
how would they know. Fourteen findings, then a verdict.

---

## 1. MUST-CHANGE — §4.2, §4.5: every turn takes a microworld-wide write lock, including the poll

**Claim.** §4.5 makes `store.transaction(microworldId, fn)` — "that microworld
locked against every other transaction on the same microworld" — the only way
into a turn, and §4.2 routes `{ kind: 'look' }` through it. `look` is the
poll and the presence heartbeat: it fires every few seconds, per visitor, for
as long as anyone stands in the microworld. The design therefore serializes
the read path behind an exclusive row lock, and demotes today's finer lock
("per-room locking is an adapter optimisation that a SQL adapter may add
later") at the same moment it coarsens the grain from room to microworld.

**Evidence.** `packages/backend/src/understory/walk.ts`: `lookUnderstory`
calls `loadPublishedWorld(..., lock: false, ...)` — the poll deliberately
takes no lock today. `performGo` and `performVerb` call it with `lock: true`,
which takes `lockRoom` (`world.ts`: `SELECT id FROM understory_instance WHERE
id = $1 FOR UPDATE`) on one room, or two in id order. So the current system
has exactly the property the proposal removes: reads are free, writes
serialize per room. The proposal itself already knows the shape of the
problem — §7.1 carves `completeUnderstory` out of the turn "(it is not a turn
and should not take the lock)" — and then puts the far more frequent `look`
inside it.

**Fix.** Add a second entry to the port: `read<T>(microworldId, fn)`, which
takes no lock (SQL adapter: nothing; document adapter: a plain `get`), and
route `look` and `complete` through it. Keep `transaction` for inputs that
write. If `look` must stamp `lastSeen`, do that as a single unlocked
`UPDATE ... SET last_seen` in the host, outside the port, the way
`lookUnderstory` does now. Then say in §4.5 that per-room locking is a
*conformance-visible* option, not a private optimisation, so a host can ask
for it rather than discovering it is gone.

---

## 2. MUST-CHANGE — §7.1, §4.4: per-microworld publish, sweep and trim inside the tick's one transaction

**Claim.** §7.1 replaces three set-based SQL statements with a loop of
per-microworld core calls — `core.publish` for every zone with a requested
unit, `core.sweep` for every zone with `sweep_at_tick`, `core.trim` for *all*
— inside `runTick`'s single transaction. Each call, per §4.5, takes that
microworld's row `FOR UPDATE` and holds it until the tick commits; each
`publish` additionally *compiles the published set* (§4.4: "Publish compiles
the set it would leave standing"). And §4.4 says publish "refuse[s] if it does
not compile" — inside a transaction that also publishes every post on the
site.

**Evidence.** `tick/run-tick.ts` is one `withTransaction` that already does a
full `DELETE FROM post_audience` + five-source rebuild, a full
`rebuildEffectiveCapabilities`, `post_media` rebuild, the media sweep, the
purge and the club lifecycle, on a `db-f1-micro` (DEPLOY §1). Today's
Understory steps are three statements
(`publish.ts`'s three `WITH pending AS ... UPDATE`), one `DELETE ... USING`
(`sweep.ts: sweepUnderstoryZones`) and one `DELETE ... WHERE created_at < $1`
(`actions.ts: sweepUnderstoryActions`) — all O(1) round trips regardless of
how many zones exist. The replacement is O(zones) round trips, O(zones)
compiles, and O(zones) row locks held for the tick's whole duration. Three
concrete failures follow: (a) the tick's duration — the file's own comment
calls the capability rebuild "a KNOWN scale ceiling" and the elapsed time "the
tripwire"; (b) any Understory turn on a locked microworld blocks for the tick's
full duration and then dies on the callable timeout — at noon UTC, daily;
(c) one builder whose published set does not resolve throws out of the loop and
**rolls back the entire edition** — no posts published, no capabilities
rebuilt, no tick row — and the next run at noon+1 hits the same draft again.

**Fix.** Three changes, all small. (i) Move `publish` and `sweep` out of the
tick's transaction into a post-commit loop, each microworld in its own small
transaction, exactly as `sweptMedia` / `releases` / `purged` already work at
the bottom of `runTick` ("what SQL cannot hold — never inside the edition's
transaction"). (ii) Wrap each per-microworld call in a catch that logs
`{ microworldId, problems }` and continues; a zone that cannot publish is a
zone that did not publish, not a site-wide outage. Surface the refusal on the
builder's panel so they learn about it without Eric. (iii) Keep `trim`
set-based: the SQL adapter should expose `trimAll(before, keepMisses)` as one
statement over `sprout_action` / `sprout_miss`, because trimming "for all" one
microworld at a time is a round trip per profile for a table a `DELETE ...
WHERE created_at < $1` already handles.

---

## 3. MUST-CHANGE — §7.1: takeout and wipeout lose the actor, who is scattered across other people's microworlds

**Claim.** §7.1 covers takeout and wipeout in one line — "`core.exportMicroworld`
into `takeoutExtras`; profile deletion calls `core.destroyMicroworld` — by code
now, since there is no foreign key to cascade." Both are microworld-shaped.
A person's Understory footprint is not: it is actor rows, memory, narration,
last noun, action rows and donated misses *inside microworlds other people own*.
Nothing in the port can find or erase them, and §5.1 removes the foreign keys
that would have cascaded.

**Evidence.** `profiles/purge.ts` deletes `understory_visitor` and
`understory_visitor_state` **by `profile_id`**, and un-carries what the
departing person held, precisely because the zone's cascade does not reach
another owner's zone. The data is not trivial: `understory_action` carries
`profile_id` and `command` ("light — Brass lantern"); `understory_miss` carries
the visitor's literal typed line (`misses.ts: recordDonatedMiss`, `input`).
§4.6's `StoreTx` offers `memory(actorId)` / `clearMemory(actorId)` and nothing
else keyed by actor — `actor(realm, id)` needs a microworld, `appendAction` has
no actor-scoped delete. So after the split, wiping out an account leaves that
person's words and presence in every microworld they ever visited, forever,
with no FK, no cascade and nothing that would ever notice.

**Fix.** Two methods on the port, both in the conformance suite:
`forgetActor(actorId)` (actor rows in every realm of every microworld, memory,
and action/miss rows either deleted or with the actor id nulled) and
`exportActor(actorId)` (the same rows, for takeout). Call the first from
`purge.ts` and the second from `takeout.ts` alongside the microworld export,
and pin both with a spec the way the existing `takeout.spec.ts` pins the
current arms. Separately, because §5.1 removes the FKs on purpose: log an
orphan count in the tick (`sprout_microworld` with no `understory_zone`,
`sprout_actor` with no live `profile`) so a missed call is visible in a log
line rather than in a subject-access request.

---

## 4. MUST-CHANGE — §3.2: source-as-truth moves compile failure from one builder at save time to every visitor at deploy time

**Claim.** §3.2 answers the objection "a parse error surfaces to a visitor"
with "only if a newer compiler refuses older text, which the compatibility
rule above forbids." A rule in a document does not stop a parser regression.
Today a compiler bug cannot break stored content, because what is stored is
validated structure; after this change, the compiler runs in the read path of
every zone, and the first time anyone finds out is when a visitor opens a door.

**Evidence.** `understory/world.ts` reads definitions through
`AnySproutDefinition.safeParse` and turns a failure into `HttpsError('internal',
'This room cannot be read right now.')` — a *data* check against a zod schema,
not a re-parse of text. The proposal replaces that with `compileMicroworld` over
stored source on every cache miss. There is nothing between a lang change and
production that compiles the *production corpus*: the gate compiles the
examples, the journeys compile the seed, and neither knows what Eric's zone
says. There is also no alerting anywhere in this repo — I grepped for
`alerting`, `log-based metric`, `notification channel`, `Cloud Monitoring` and
`backup` across `*.md`, `*.yml` and `*.sh`; DEPLOY.md has a smoke list and
nothing else. So "how would they know" is: a visitor tells them.

**Fix.** (i) A unit that fails to compile at load is **absent**, not fatal —
the same treatment §3.3 already gives an exit to an unpublished room — logged
with `{ microworldId, unit, problems }` and reported on the builder's panel.
A microworld with one bad unit should still open. (ii) Add a
`verifyMicroworlds` admin callable (or a release-checklist script) that
compiles every published unit in the database with the candidate bundle and
prints the failures; run it as a DEPLOY §3 smoke line after the functions
deploy, before the frontend goes out. (iii) Extend `sprout check` in CI to run
over a small committed corpus of *real* published units, not only the two
studios, so a parser regression fails a PR and not a door.

---

## 5. SHOULD-CHANGE — §3.2, §4.1: the lang-version refusal has no rollback story

**Claim.** "A microworld records the lang version that last compiled it; core
refuses to load a microworld compiled by a *newer* lang than itself." Read
operationally, that rule says: every zone that published after a deploy goes
dark if that deploy is rolled back. A functions rollback is the cheapest
recovery Overstory has, and this makes it destructive.

**Evidence.** The stamp is a package version and is written on publish (§4.1).
Overstory publishes at the tick (§4.4, §7.1), so after a noon tick *every*
zone that requested a publish carries the new version. Roll the functions back
that afternoon — for a reason that has nothing to do with Sprout — and core
refuses to load all of them. The proposal gives no way out short of rolling
forward, which is precisely what a rollback exists to avoid. The `importMicroworld`
path (§4.4) makes the same skew reachable between hosts: a microworld authored
by the CLI at a newer version, imported into Overstory at an older one.

**Fix.** Record a **feature level** — a small integer lang bumps only when it
adds syntax — not a package version, and store it as "the minimum level this
text needs", computed by the compiler from what the text actually used, rather
than "the version that last touched it". Then a rollback darkens only units
that genuinely used new syntax, and only those units (per finding 4, absent
rather than fatal). Keep the package version alongside it as a diagnostic
field, not a gate.

---

## 6. SHOULD-CHANGE — §2: publish one package, not six

**Claim.** §2 argues, convincingly, for one repository: the lang↔core seam
"will be wrong the first three times", and three repos means "a version bump,
a publish, a dependency bump and a second PR, per package, per change". Every
word of that applies to six independently versioned npm packages published
from that one repo. The design solves the problem at the git layer and
reintroduces it at the registry layer.

**Evidence.** Under §9 stage 4, a one-line lang fix reaching production is:
PR + gate in the sprout repo → bump and publish lang → bump core's dependency
and publish core → bump `-ext-media` → PR in Overstory bumping N exact pins →
gate + the e2e subset → release PR to `prod` → `migrate:prod` if store-sql
moved → functions deploy. Eight steps, two repos, one person. It also creates
an npm publish token to hold and rotate — this project already tracks one such
expiry as a standing memory item (the Cloudflare token, due 2026-09-30) —
and CLAUDE.md's exact-pin rule means a sprout patch *never* reaches production
on its own; `deps.yml`'s weekly dry run will not bump it. Note also that §3.2's
entire "core refuses a microworld compiled by a newer lang" machinery exists
only because lang and core can have different versions.

**Fix.** Publish **one** package, `@overstory/sprout`, with subpath
exports (`./lang`, `./core`, `./store-sql`, `./store-document`, `./ext-media`)
and the `sprout` bin. Keep the directories, keep the dependency arrows, keep
each `boundary.spec.ts` — the internal seam the design cares about is enforced
by specs, not by package.json files. One version number, one publish, one exact
pin in Overstory's root manifest, and finding 5's skew becomes unrepresentable.
Split packages out later if a second host ever wants `-lang` without `-core`;
that is a strictly easier move than merging them back. While you are there, put
a support policy in the README (0.x, breaking changes in any minor, issues
triaged when triaged): an `npx`-runnable MIT package invites drive-by bug
reports at exactly the volume one person cannot absorb.

---

## 7. SHOULD-CHANGE — §3.2, §4.4: the program cache is unspecified as an operational object, and the cost estimate is an order of magnitude light

**Claim.** "A warm process compiles a microworld once per edition, not once per
action" and "parsing the whole of a capped microworld (a few hundred definitions,
64 KB each at most ...) is milliseconds". Both sentences need numbers. On Cloud
Run the cache is per-instance and per-cold-start, it is unbounded in the design,
and the worst case it must survive is far larger than "milliseconds".

**Evidence.** DEPLOY §3: ~150 functions, each its own gen-2 Cloud Run service,
scale to zero. A flag-gated feature with a handful of zones gets *mostly cold*
traffic, which is the case where the cache buys nothing and the compile is on
the critical path. The corpus at today's caps is 16 rooms
(`UNDERSTORY_ROOMS_PER_ZONE`) × 12 items (`UNDERSTORY_ITEMS_PER_ROOM`) + 32 kinds
(`UNDERSTORY_KINDS_PER_ZONE`) = 240 units, each up to 64 KB
(`UNDERSTORY_DEFINITION_BYTES_MAX = 64 * 1024`) — **~15 MB of source per
microworld**, read over the Cloud SQL connector and parsed on every miss.
§4.4's limits list caps rooms, objects, kinds, instances, spawns and retention;
it does **not** cap a microworld's total published source. And the cache is keyed
on `publishedStamp` with no eviction named, in a process that may hold many
microworlds.

**Fix.** (i) Bound it: an LRU with an entry count *and* a byte budget, sized
against the function's memory, with eviction counted in the log. (ii) Add
`publishedBytes` to §4.4's limits and enforce it at publish, so the worst case
is a number you chose rather than a product of five other numbers. (iii) Log
`{ microworldId, cacheHit, unitBytes, compileMs, loadMs, turnMs }` on every
turn. That line is the entire observability story for this feature, and it is
also what makes sprout.md §2.11's pressure-test triggers ("p95 inside the
transaction passes ~300 ms") measurable — today they are thresholds nobody
measures.

---

## 8. SHOULD-CHANGE — §4.5: the SAVEPOINT path is sound against node-postgres and PGlite, but only if a fault stops being an exception — and it gives up the one durability guarantee worth keeping

**Claim.** The mechanism works: `SAVEPOINT sprout_turn` / `ROLLBACK TO` is
plain Postgres, PGlite is Postgres, and a turn's fault is an *engine outcome*
rather than a SQL error, so there is no aborted-transaction state to recover
from. But the proposal's framing ("a savepoint inside the host's transaction
replaces the two-transaction fault path") skips why there are two transactions
today, and quietly changes the wire contract.

**Evidence.** `understory/actions.ts`: `ActionFault` is thrown out of the
transaction ("when it throws an ActionFault, the transaction is already
abandoned"), and `recordingFaults` opens **a second** `withTransaction` to
write the record, then throws `HttpsError('aborted', UNDERSTORY_FAULT_TEXT)`.
The second transaction is what makes the fault record durable *no matter what
the outer transaction did*. Under one transaction, the record survives only if
the host commits — any later throw in the callable (an audience check, a
`ProfileSummary` lookup, a schema validation of the response) loses it silently.
Faults are the one artifact you cannot afford to lose at 3 a.m.: they are the
only evidence of what the engine was doing. Second: with one transaction the
handler cannot both commit and throw, so the fault must come back as
`TurnResponse.faulted: true` on a **200** rather than an `aborted` error — a
client-visible change the frontend, the journeys and `UNDERSTORY_FAULT_TEXT`'s
call site all follow.

**Fix.** State both in §4.5. (a) "A fault returns; it never throws" — and say
the savepoint is `RELEASE`d on the success path so savepoints do not accumulate
across a host transaction that runs several turns. (b) Keep a fallback: if the
host's transaction aborts after a faulted turn, the host writes the action
record in its own transaction, as `recordingFaults` does today. (c) Note in §7.3
that the client stops seeing `aborted` and starts seeing a faulted response.

---

## 9. SHOULD-CHANGE — §4.6: the conformance suite proves serialization only on the two backends where it is free

**Claim.** The suite's headline case — "serialization (two turns racing on one
microworld land in order)" — is run against `memoryStore` (a promise chain per
microworld, §5.3), PGlite (store-sql's tests), and a fake for Web Storage. None
of those can fail it, and the one backend that runs in production is not among
them. The suite will be green on the day Cloud SQL contention is broken.

**Evidence.** CLAUDE.md states the gap outright: "What the tier does NOT prove
is concurrency — PGlite is one backend and queries serialize, so `FOR UPDATE`
contention never truly blocks." §4.5 acknowledges the same gap in one sentence
and then makes serialization the first clause of the port's contract — the
property everything else rests on. Meanwhile CLAUDE.md's `.db.spec.ts` rule
(#440 as the worked example: "its correctness lives in the SQL rather than in
the TypeScript around it") describes the turn handler exactly, and §9's proof
lists do not mention one.

**Fix.** (i) Have the suite *report* which cases it could not really exercise,
so a green run does not read as a proof it is not. (ii) In the sprout repo,
where a containerised Postgres is cheap and nothing about Overstory's CI
constrains it, run the serialization case against real Postgres with two
connections. (iii) In Overstory, add `understory/turn.db.spec.ts` under
`npm run test:db` for the SQL the turn depends on — at minimum the lock
acquisition and the savepoint's fault path, which no `fakeClient` can see.

---

## 10. SHOULD-CHANGE — §5.1: migrations copied "verbatim" into `migrations/` is two ledgers, two runners and nothing checking the copy

**Claim.** The package ships numbered SQL with its own runner recording into
`sprout_migration`; "a host with its own migration system (Overstory) copies
the files into its own sequence, verbatim, and the adapter checks the schema
version on first use." Overstory then has files it did not author, renumbered,
recorded in a *different* ledger, verified by a check against a table nothing
populates.

**Evidence.** `packages/backend/src/migrate.ts` records applied migrations by
**filename** in `public.schema_migrations`, orders by numeric prefix, and
refuses duplicate prefixes. So the package's `001_sprout.sql` becomes
Overstory's `057_sprout.sql` and the two systems disagree about that
migration's identity. The adapter's "check the schema version on first use"
then reads `sprout_migration`, which Overstory's runner never writes — so
either the check is dead, or it fails on the first visitor after a deploy,
which is the worst possible moment to discover it. Worse, "verbatim" is a
convention: when the package ships `002_sprout.sql`, nothing detects that
Overstory never copied it, or copied it with an edit, until a query hits a
column that is not there. CLAUDE.md's own rule — "a migration and its seeder
change together" — has a mechanical backstop (the `schema` job); this one has
none.

**Fix.** Do not copy files. Export the migrations from the package as an
ordered `{ name, sql }[]`, and have Overstory hold **one** checked-in migration
that applies them with the package's names recorded in `schema_migrations` under
a namespaced prefix (`sprout/001_sprout.sql`). Add a gate spec that hashes the
package's exported SQL and compares it against a committed manifest, so a
version bump that changes the schema fails the gate rather than production.
Make the adapter's schema-version check explicit and loud — `SqlStore({ client,
schemaVersion: 3 })` that throws at construction with the expected and found
numbers — so the failure lands in the deploy smoke, not in a turn.

---

## 11. SHOULD-CHANGE — §7.1, §9: a hard cutover of twelve frozen callable names, against a flag that gates the UI only

**Claim.** "One turn callable replaces twelve" (§8-13), with "callable names
are a contract with `backend.service.ts` and `boundary.spec.ts`; both change in
the same PR, which a flag-gated feature with a data reset can afford." The data
reset covers the *rows*. It does not cover the deploy window or an open tab.

**Evidence.** understory.md §10.4: "The flag gates the UI only ... Every
callable still carries its normal guards — no flag check server-side." So the
old callables are reachable by anything holding an old bundle. DEPLOY §4c and
the release workflow deploy **functions first, then the frontend SSR worker** —
there is a window, minutes long, in which the new backend is live and the old
frontend is still being served, plus however long already-open tabs stay open.
During it, `lookUnderstory` is simply gone: a `not-found` with no message
anyone wrote.

**Fix.** Keep the twelve exports for exactly one release as one-line forwarders
onto the turn — they cost nothing, `boundary.spec.ts`'s table keeps its rows,
and the deploy-order hazard disappears — then delete them in a follow-up PR
after that release has landed. Do the same for `UnderstoryScratch`: accept and
ignore it for one release rather than rejecting it at the zod boundary.

---

## 12. SHOULD-CHANGE — §9 stage 2a: green journeys over a memory store are not a green seam, and the stopgap may drop the room lock

**Claim.** 2a is "core with the memory store, the conformance suite, and the
backend's wrappers in front of it — the understory callables run on core over a
store built in memory from today's tables, so the journeys prove the turn
contract before any table changes." They prove the turn's *shape*. Serialization,
atomicity, the savepoint fault path and the lock grain — the four things most
likely to be wrong — all arrive unproven in 2b, behind a PR that also drops
eleven tables and rewrites the seed.

**Evidence.** §5.3: the memory store is "a `Map`, a promise chain per
microworld" — it satisfies §4.5's contract by construction, so the conformance
suite under 2a is a tautology for exactly the clauses that matter. And a store
that reads today's tables into memory and writes back at the end is a
lost-update machine unless it still takes a row lock: `world.ts: lockRoom` is
what prevents that today, and nothing in 2a's description keeps it.

**Fix.** (i) Have 2a's adapter take the zone row `FOR UPDATE` inside the host's
`withTransaction` from the first commit — three lines, and it keeps the
existing guarantee rather than re-deriving it in 2b. (ii) Say plainly in §9
that 2a proves the *contract* and 2b proves the *storage*, so nobody reads 2a's
green journeys as a proven seam. (iii) Move the savepoint fault path into 2a if
it can be made to fit: it is the change most likely to need a second try, and
2b is already the largest PR in the plan.

---

## 13. SHOULD-CHANGE — §7.4, §9 stage 4: the split-out strands Overstory's seed and CI on files that leave the repo

**Claim.** §7.4 makes the e2e seed read `examples/*.sprout` and
`importMicroworld` them, and says the round-trip proof "becomes `sprout check`
in CI on both sides". §2 says `examples/` is "Not published". §9 stage 4 moves
`examples/` into the sprout repo. After stage 4, Overstory's seed reads files
that are neither in the repo nor in any published package, and its CI wants a
CLI it no longer has.

**Evidence.** `packages/e2e/areas.mjs` lists `packages/e2e/seed-understory.ts`
as an Understory source, and CLAUDE.md makes the seed load-bearing for every PR
(the `schema` job runs "PGlite, every migration, the e2e seed"). A seed that
cannot find its input does not fail the Understory journeys; it fails
`schema:check`, which blocks **every** PR.

**Fix.** Copy the two studio `.sprout` files into `packages/e2e/` as Overstory's
own fixtures at stage 2b — they are the product's demo content, not the
language's — and let the sprout repo keep its own copies for its README and CLI
tests. Two small files diverging is a better failure than a cross-repo build
dependency. Also note in §9 that once the seed imports and publishes through the
compiler, `schema:check` exercises the compiler on every PR: that is a feature
worth naming (it is finding 4's canary, cheaply), but it means a compiler
regression now fails the `schema` job, and whoever sees that failure should know
why. On the area map: stages 1–3 create `packages/sprout-*` directories with no
glob, so those paths classify as unmapped and run **every** journey — safe, and
slow; the `packages/sprout/src/**` glob must be updated in whichever PR renames
that directory or `e2e-areas.mjs check` fails the gate then, not at stage 4.

---

## 14. CONSIDER — §4.4, §4.6, §5.2, §6: what is over-engineered for a flag-gated feature with a handful of zones

**Claim.** Four items in the design are built for hosts that do not exist, and
one replaces targeted SQL with a whole-microworld read.

**Evidence and fix, item by item.**

- **`inspect` as one call.** §4.4 makes it the builder's panel, the moderator's
  view *and* (§7.4) the source of "the door's open flag". Computed "by core
  from these reads" it means loading every unit, every minted version's full
  text, every object, every action and every miss into the function instance —
  where today `zoneFaults` is `LIMIT 20`, `zoneMisses` is a `count(*)`,
  `spawnedInZone` is `LIMIT 200`, and `openDoor` is one indexed join.
  *Fix:* put `{ limit, since, faultedOnly }` on the port's `actions` / `misses`;
  make `versions(unit)` metadata-only with a separate `versionText(unit, n)`;
  and let the host answer "is the door open?" with its own SQL against the
  documented `sprout_*` tables — §4.6 already blesses that escape hatch.
- **`store-document`.** A `DocumentBackend` interface, a document layout, two
  backends and the conformance suite run against both, shipping in stage 3
  (M-sized) with zero consumers — Firestore and Mongo are explicitly deferred.
  *Fix:* defer the package. The port is the design work; writing an adapter
  later costs nothing the design has not already paid for. Keep the memory store
  (§5.3), which earns its place as the test double.
- **`serve`.** A TCP line-protocol server inside an `npx`-runnable published
  package, with no auth, no TLS and no rate limit named anywhere in §6.
  *Fix:* if it ships, bind `127.0.0.1` by default, require an explicit `--host`
  to widen it, and say in the README that it is a development toy. One sentence
  now is cheaper than a CVE later.
- **Backups and cost, which are simply absent.** Nothing in DEPLOY.md mentions
  Cloud SQL automated backups or PITR, and there is no alerting policy in the
  repository. That is survivable while the data "is a flag-gated test feature
  and is reset" (§0) — but source-as-truth means a builder's `.sprout` text
  becomes the **only** copy of their work, on a `db-f1-micro`, and the day the
  flag comes off that stops being test data. *Fix:* one paragraph in §7
  confirming automated backups and PITR are on before the `sprout_*` tables hold
  anything a builder would mourn, and a line in DEPLOY's runbook saying how a
  single microworld is restored — `exportMicroworld` / `importMicroworld` (§4.4)
  is already the right tool and should be named as the recovery path.

---

## Verdict

This is a good design that has been thought about from the language end and not
yet from the pager end. The seam it draws — builder-facing lang, player-facing
core, the host keeping every product fact — is right, the `now`-as-a-parameter
discipline and the one-repo argument are exactly this codebase's house style,
and source-as-truth is the correct call for a language meant to be embedded.
What is missing is the operator: the design reaches production through a tick
transaction that it would turn from three set-based statements into a loop of
locked, compiling, individually-fatal calls (2); through a poll that would start
taking a write lock (1); through a compiler newly placed in every visitor's read
path with no canary and no alerting to catch a regression (4); and through a
wipeout that no longer reaches the person it is meant to erase (3). Each of
those is a small fix made now and a bad night made later. The two structural
changes I would argue hardest for are **publishing one package instead of six**
— which deletes the cross-repo version question, the skew machinery of §3.2 and
five sixths of the release chain for a project with one maintainer and one host
— and **not copying migration files between repos**, which is the one place the
design substitutes a convention for a mechanism in a codebase whose stated rule
is that a convention broken twice becomes a spec. Fix findings 1–4 and 10 before
stage 2 is cut; fold 6 into stage 4's plan while it is still cheap; and treat 14
as permission to ship less.
