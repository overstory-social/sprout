# Outside review: scalability, concurrency and storage

Target: `design/proposals/2026-09-17-sprout-split.md` (§4.1, §4.2, §4.5,
§4.6, §5, §7.4). Read against today's implementation
(`packages/backend/src/understory/{world,walk,say,carry,actions,misses}.ts`,
`packages/backend/src/db.ts`, `migrations/032,040,042,044`), `sprout.md`
§2.11 and `understory.md` §10.3–§10.4.

The design is good in the large — the port is small, the fault rule is
right, source-as-truth is right, and the SQL adapter is the correct
default. What follows are the places where the concurrency and storage
story is either weaker than what it replaces, or is stated in a way
that will be wrong the first time a non-SQL adapter is written. The
first five are the ones I would not merge without.

---

## 1. MUST-CHANGE — §4.5-1 + §4.2: making `look` a locked turn is a real regression at the stated caps, and it leaks out of the feature

**Claim.** §4.5-1 makes *every* turn take an exclusive per-microworld lock,
and §4.2 makes `look` a turn ("`{ kind: 'look' }` — the poll, and the
presence heartbeat"). Today `look` takes **no** lock at all. Under the
proposal the 5-second poll of every visitor in a zone serializes behind
every other visitor's poll *and* behind every mutating action, on one
lock, holding a pooled Postgres connection for the whole wait.

**Evidence.**

- `walk.ts:262-286` (`lookUnderstory`) calls
  `loadPublishedWorld(..., lock: false, ...)` (`walk.ts:101-107`); the only
  write is `UPDATE understory_visitor SET last_seen` on the caller's own
  row. `world.ts:210-231` (`lockRoom`) is reached only from
  `loadPublishedWorld` when `lock: true`, i.e. from `performGo`,
  `doUnderstoryVerb`, `sayUnderstory` and `carry`. So today a poll and a
  verb in the same room run concurrently under READ COMMITTED, and two
  visitors in *different* rooms of the same zone never contend at all.
- `understory.page.ts:276`: `setInterval(() => void this.look(),
  UNDERSTORY_POLL_MS)`, `UNDERSTORY_POLL_MS = 5000`
  (`packages/schema/src/understory.ts:44`).
- `db.ts:41,44,56`: the pool is `max: 4` **per function instance**. A turn
  waiting on `FOR UPDATE` holds its pooled client for the whole wait.
- Cloud SQL `db-f1-micro` (the booked tier, memory
  `storage-decision-status`) defaults to `max_connections = 25` across the
  whole project.
- Postgres default `lock_timeout = 0` — a lock wait is unbounded.

**Numbers.** With N visitors in one microworld and a turn costing `T`, the
lock saturates at `N ≥ 5000 ms / T`: N=100 at T=50 ms, N=20 at T=250 ms,
N=10 at T=500 ms. Saturation is not the threshold that hurts — at N=10,
T=250 ms the utilisation is already ρ=0.5 and mean queueing delay is
≈ ρT/(2(1−ρ)) = 125 ms with a far worse tail. The binding constraint
arrives earlier than that: **four** concurrently-blocked turns exhaust
`max: 4` and every unrelated request on that instance (feed, post,
comment) then waits on `pool.connect()`. A feature behind a flag, with a
handful of visitors, can stall the product on the same instance. Today
that cannot happen, because the poll never queues.

**Fix.** Two changes, both small.

1. Keep the port's contract ("turns on one microworld are serialized") but
   give it a **read mode**: `store.transaction(microworldId, fn, { mode:
   'read' | 'write' })`. A `look` and a `complete` take the read mode. In
   SQL that is a shared lock; in the memory store it is a no-op on the
   promise chain's read side; in a document store it is a plain read.
   Nothing about the atomicity contract changes, because a read turn
   writes only the actor's own row.
2. Do not take the lock on a **tuple**. Use
   `pg_advisory_xact_lock(hashtext($1))` /
   `pg_advisory_xact_lock_shared($1)` keyed on the microworld id. It
   releases at commit like `FOR UPDATE`, it creates no dead tuple on the
   hottest row in the system (see finding 10), it has a natural shared
   mode, and it can be taken with `pg_try_advisory_xact_lock` + a bounded
   retry so a turn fails fast instead of pinning a connection.
3. Whatever lock is chosen, the adapter must issue `SET LOCAL lock_timeout
   = '<n>ms'` and `SET LOCAL statement_timeout` at the top of its
   transaction. Without it a stuck turn holds a Cloud Functions instance
   to the function timeout and a connection for the same duration.

---

## 2. MUST-CHANGE — §4.5/§4.6: the port does not say whether `fn` may run more than once, and the two named future backends both re-run it

**Claim.** `transaction(microworldId, fn)` is specified as if the lock were
pessimistic. Firestore and Mongo — the two backends §5.2 promises — are
**optimistic**: their transaction APIs re-invoke the callback on
contention. Core's `fn` is not written to be re-entrant (it mints spawn
numbers off `nextSpawnNumber`, appends to an action log, and takes `now`
as a parameter fixed before the call), so a retry silently produces
duplicate spawn ids, duplicate action rows, or a turn whose narration and
committed state disagree.

**Evidence.** Firestore's server SDKs run the transaction function
repeatedly until commit succeeds (the Node admin SDK retries by default);
Mongo's `withTransaction` callback API explicitly re-runs the callback on
`TransientTransactionError` / `WriteConflict`. §4.5 says nothing about
re-entrancy, §4.6's conformance list ("round-trips; serialization;
atomicity; the fault rule; trim; destroy") contains no re-entrancy case,
and the two adapters that *are* tested (memory: a promise chain, §5.3;
PGlite: pessimistic and serialized anyway, CLAUDE.md) can never surface
it.

**Fix.** Write the rule into the port, in one line, the way §3.5's
extension rule is written: **`fn` may be invoked more than once; it must
have no effect outside the `StoreTx` it is handed, and every id it mints
must be derived from state it read inside that same invocation.** Then
add the single test that enforces it (finding 11a): a
`retryingStore(inner, n)` wrapper in the conformance suite that runs
every turn twice and asserts identical committed state and no duplicate
records. That test costs an afternoon and is the only thing standing
between this design and a class of bug that will not appear until someone
writes the Firestore binding.

---

## 3. MUST-CHANGE — §5.2: actors and objects in one document + a 5 s heartbeat per visitor exceeds Firestore's sustained per-document write rate, and rewrites ~300 KB to do it

**Claim.** §5.2's layout is "one document per microworld per realm holding
the objects and the actors together". Presence is a heartbeat on every
`look` (§4.2). So every poll of every visitor is a write of the *whole*
objects+actors document.

**Evidence and numbers.**

- Firestore's documented guidance is a **sustained limit of 1 write per
  second to a single document**; beyond it you get contention, rising
  latency and `ABORTED` transaction retries (which, per finding 2, re-run
  the turn).
- At `UNDERSTORY_POLL_MS = 5000`, **6 visitors** in one microworld =
  1.2 writes/s to that one document, sustained, from polls alone —
  already over the guidance before anybody *does* anything. The proposal's
  own §2.11 trigger tolerates "~10 actors in a room"; ten actors is
  2 writes/s, double the limit.
- Each of those writes carries the full objects map. §5.2's own sizing is
  "2,000 objects at roughly a hundred bytes each … a few hundred
  kilobytes". So a presence heartbeat costs a ~300 KB document rewrite.
- The 1 MiB headroom is thinner than stated: Firestore charges the
  document's *encoded* size including every field name at every
  occurrence plus ~32 bytes per map entry, and enforces **40,000 index
  entries per document**. A 2,000-entry map of small nested objects with
  ~10 sub-fields each is ~20,000 index entries before the arrays, so the
  layout requires blanket single-field index exemptions on the objects map
  to be writable at all — which §5.2 does not mention.

**Fix.** Split the layout along the write-rate seam, not the read seam:
`microworld/<id>/<realm>/objects` (low frequency, high value, written only
when a turn changes something) and `microworld/<id>/<realm>/actors/<actorId>`
(one small document per actor, written every poll). Presence then costs a
~200-byte write to an uncontended document and `actorsIn` becomes a
collection query. Additionally: state in §5.2 that the objects payload is
stored as an **opaque serialized blob** (a Bytes/string field) with
indexing disabled, and that the 1 MiB budget applies to the serialized
bytes — otherwise the first real Firestore binding discovers the index-entry
ceiling the hard way.

---

## 4. MUST-CHANGE — §5.2: "append-only documents for actions and misses, dated" overflows a Firestore document in about ninety minutes

**Claim.** An "append" to a *document* is a read-modify-write of the whole
document. A dated action document accumulates every turn of that day.

**Numbers.** An action record is command text + events + depth + spawned +
faulted + chain ≈ 150–250 bytes serialized (cf. `understory_action`,
`migrations/040_understory_actions.sql:12-30`). Firestore's 1 MiB limit is
therefore reached at roughly **4,000–7,000 actions**. At the 1.2 turns/s
of finding 3 that is **~1.5 hours**, after which every further turn fails
to commit — and it fails inside the turn, so the microworld stops
entirely. The same document is also being rewritten in full on every
append, so the last append of the day costs 1 MiB of write amplification.

**Fix.** Actions and misses are a *collection*, one document per record,
not a dated document. If a dated container is wanted for cheap trimming,
shard it by hour **and** cap it by count with a rollover, and say the
number out loud in §5.2. (This also makes `actions(opts)` and
`misses(opts)` implementable as ordered queries instead of an in-memory
scan of the day.)

---

## 5. MUST-CHANGE — §4.1/§4.4: the program cache's stamp does not cover drafts, the language version, or memory, and each hole is a live bug

**Claim.** §4.1 defines exactly one cache key: "`publishedStamp` (bumped on
publish and unpublish — the program cache's key)". Three things that
determine a compiled `Program` are outside that key.

1. **Drafts.** §4.4 makes draft play a realm whose program "is compiled
   from the drafts". Drafts change on `saveDraft`, which by §4.1's wording
   does **not** bump `publishedStamp`. So a builder saves a unit, plays the
   draft, and gets the program compiled before their edit — and because
   the cache is per Cloud Functions instance, *which* stale program they
   get depends on which instance answers. This is the single most
   user-visible bug in the document as written, and it hits the one user
   who will notice instantly.
2. **The language version and the extension set.** The same source
   compiles to different programs under different lang versions, and §3.2
   already stores "the lang version that last compiled it". During a
   rolling deploy, warm old instances and new instances hold different
   programs under an identical stamp.
3. **Memory bound.** Nothing names an eviction policy. A `Program` holds
   the full AST of up to 16 rooms × up to 64 KB of source
   (`UNDERSTORY_DEFINITION_BYTES_MAX = 64 * 1024`,
   `packages/sprout/src/definitions.ts:23`) — megabytes each. A Firebase
   function instance defaults to 256 MB. A few dozen popular microworlds on
   one warm instance, with every historical stamp still resident because
   nothing evicts the old key on a bump, is an OOM that looks like a random
   cold start.

**Fix.** Key the cache on `(microworldId, realm, stamp, langVersion,
extensionSetId)`; give the microworld record a **`draftStamp`** bumped by
`saveDraft` / `deleteUnit` alongside `publishedStamp`; bound the cache with
an LRU whose size is a named option on the core instance, and delete the
prior key on a stamp bump rather than letting both live. Also note in §4.4
that the tick publishing every zone at noon invalidates every stamp at
once — a bounded thundering herd, but one worth a sentence.

---

## 6. SHOULD-CHANGE — §4.2: "the action appended" is unconditional, which would grow the action log ~100× and poison the instrumentation it exists for

**Claim.** §4.2's ordered list of what happens inside a turn ends with "the
action appended" with no exception for read-only inputs. `look` is a turn.

**Evidence.** Today `lookUnderstory` (`walk.ts:262-286`) writes **no**
action row; only `performVerb`, `performGo`, `move` and a parser miss call
`recordUnderstoryAction` (`actions.ts:84`). The log's stated purpose is
sprout.md §2.11's measurement — "how many events does a root action
trigger, and what are the quartiles of depth", one `GROUP BY instigator`
and one `percentile_cont` away — plus `zoneMisses` (`actions.ts:115-123`),
a miss *rate* whose denominator is action rows.

**Numbers.** One visitor idling for eight hours with the tab open is
8 × 3600 / 5 = **5,760** `look` turns. Eight visitors = 46,000 rows per
zone per day, against a 30-day retention
(`UNDERSTORY_ACTION_DAYS = 30`). Every percentile and every miss rate then
describes the poll timer.

**Fix.** Say in §4.2 which inputs append: `say`, `command`, and the moves
they produce. `look`, `complete` and `enter` do not. If poll volume is
wanted as a metric, it belongs in a counter, not in the row the analytics
read.

---

## 7. SHOULD-CHANGE — §4.5-2: the SAVEPOINT design is mechanically correct on both node-postgres and PGlite, but it silently drops a property today's two-transaction dance has, and the subtransaction budget is unstated

**Claim.** `SAVEPOINT sprout_turn … ROLLBACK TO … then append the action`
works. PGlite is real Postgres in wasm and supports savepoints through
plain `query()`; node-postgres issues them on the same client, which the
port already guarantees via `SqlStore.on(client)`. `ROLLBACK TO SAVEPOINT`
correctly **keeps** locks acquired since the savepoint, so the microworld
lock survives a fault — good. Three things are missing.

1. **The fault record no longer survives a host rollback.** Today
   `recordingFaults` (`actions.ts:74-82`) writes the fault in a *brand-new*
   transaction after the first is abandoned, so the fault is recorded even
   if the whole outer attempt dies. Under §4.5-2 the action insert lives
   inside the host's transaction; if the host then throws for its own
   reasons, the fault evidence goes with it — and faults are precisely the
   evidence you want when things are going wrong. Say this out loud, and
   offer the adapter an optional `faultSink` the host can point at a
   second connection if it wants today's behaviour.
2. **Fault vs. genuine error.** After `ROLLBACK TO`, the adapter cannot
   distinguish "the evaluator faulted" from "the connection dropped
   mid-statement" or "a bug threw". As written it would append a fault
   record for both. Core should signal a fault by *returning* an outcome
   with `fault`, never by throwing, and the store should append only on
   that signal.
3. **The subtransaction cliff.** Postgres tracks at most **64**
   subtransaction ids per backend in `PGPROC` before the transaction is
   marked overflowed and every concurrent snapshot check falls through to
   the `pg_subtrans` SLRU — a well-documented performance cliff. One
   savepoint per turn is nowhere near it, but `say.ts:212-278`'s "take all"
   loop already runs up to nine `runMove`s in one call, and a host that
   wraps several turns in one `withTransaction` multiplies it. State the
   rule: **one savepoint per turn, never one per sub-move**, and never
   nest.

---

## 8. SHOULD-CHANGE — §4.1/§4.6: "load all objects per turn" is fine at 2,000 today, but the port forecloses ever narrowing it

**Claim.** §4.1 is right that this is what happens today, and the split
actually *improves* the read: because source compiles once and caches
(§3.2), the per-turn read loses the definition blobs entirely. But
`objects(realm)` in §4.6 takes no filter, and once the package is
published that signature is a compatibility surface.

**Numbers, today (a poll, `loadPublishedWorld`, `world.ts:242-363`):** one
room row with its `definition` jsonb; **all** zone kinds with definitions
(`world.ts:269-275`, ≤ 32); **all** zone items with their published
`definition` (`world.ts:279-286`, ≤ 16 rooms × 12 items = 192, each capped
at 64 KB); **all** instance rows (`world.ts:288-295`, ≤
`UNDERSTORY_MAX_INSTANCES = 2000`). At typical 2 KB definitions that is
~450 KB of definition plus ~250 KB of instance rows, i.e. **0.5–1 MB per
poll**; at the caps it is over 12 MB. At eight pollers (1.6 polls/s) that
is roughly 1 MB/s off a shared-core `db-f1-micro` with 0.6 GB of RAM.

**After the split:** microworld row + (cache hit → no units read) + ≤ 2,000
object rows + the actor row + `actorsIn` ≈ **250–400 KB per turn**. That is
a genuine win and the document should claim it explicitly, with the
number, because "a few hundred kilobytes" currently appears only as the
*Firestore* estimate.

**Two things to fix while the port is still private.**

- Add an ignorable hint now: `objects(realm, hint?: { rootedAt?: string[] })`,
  where an adapter may return a superset (core filters in memory anyway,
  `world.ts:196-208`). `home_room_id` already exists
  (`migrations/042_understory_instances.sql:59,68`) and covers the common
  case. Adding this after publication is a major version; adding it now is
  a line.
- Fix the scene build's complexity while moving it. `world.ts:309-324`
  does `[...kinds.values()].find(...)` **and** `[...byName.values()].find(...)`
  *inside* the loop over instances — O(n·k) with a fresh array
  materialisation per iteration. At 2,000 spawned objects and 32 kinds
  that is 64,000 finds and 4,000 array spreads per turn, inside the lock.
  Core's scene build should be O(n) with two prebuilt maps.

Related, and worth a sentence in §4.6: `memory(actorId)` returns one
`MemoryRecord` for the whole microworld, where today memory is one blob
*per room per visitor* (`understory_visitor_state`, read at
`world.ts:296-300`). One blob per actor per microworld is read and written
whole on every remembering turn and grows with the object count. Bounded,
but name the bound.

---

## 9. SHOULD-CHANGE — §4.6/§5.1: `trim` and `destroy` sit on `StoreTx`, so the tick's housekeeping takes the same lock every visitor's poll takes

**Claim.** Every method in §4.6 is on `StoreTx`, which only exists inside
`transaction(microworldId, fn)`. So `trim(before, keepMisses)` — called per
microworld from the tick (§7.1) — acquires the microworld's turn lock while
it deletes thirty days of log rows.

**Evidence.** Today's trim is one table-wide statement that takes no zone
lock whatever: `DELETE FROM understory_action WHERE created_at < $1`
(`actions.ts:147-150`). Under the proposal it becomes N locked
transactions, one per zone, all at noon, competing with the polls of
whoever is in those zones. The action and miss tables are append-only and
no turn reads them, so the lock buys nothing.

On Firestore the same methods are additionally **not implementable
atomically**: a commit or transaction is capped at **500 writes**, and
`destroy()` must remove every minted version, every action and every miss
document — easily thousands. `trim` has the same shape.

**Fix.** Move `trim` and `destroy` off `StoreTx` and onto `SproutStore`
itself, declared as *not* atomic and *not* serialized against turns —
"best-effort, resumable, may be called repeatedly" — which is true of
every backend and lets Firestore/Mongo page through in batches of 500. In
the SQL adapter keep today's single table-wide statement as the
implementation, driven from the tick once rather than per zone.

---

## 10. SHOULD-CHANGE — §5.1: `actorsIn` has no index named, the microworld row becomes the hottest row in the system, and the uuid→opaque-text change walks straight into #468

Three storage-layer specifics the adapter's `001_sprout.sql` has to get
right on the first try, because migrations are append-only.

**(a) `actorsIn(realm, room, since)`.** Today `alsoHere` (`world.ts:370-386`)
is `WHERE v.room_id = $1 AND v.profile_id <> $2 AND v.last_seen >= $3`
served by `understory_visitor_room_idx (room_id)`
(`migrations/032_understory.sql:60`), with the `last_seen` filter applied
after. §5.1 names `sprout_actor (microworld, realm, id)` and no index. Without
`(microworld_id, realm, room_id, last_seen DESC)` this is a sequential scan
of every actor of every microworld — **inside the turn lock**, on every
poll, since presence is what a poll is for.

**(b) The microworld row is the hot row.** §5.1: "`transaction` takes the
microworld's row `FOR UPDATE`". §4.1 puts `publishedStamp` **and** "the next
spawn number" on that same row. So every turn takes an exclusive row lock
on it and every spawning turn `UPDATE`s it, producing a dead tuple per
spawn on the one row that every concurrent turn is queued behind. Use an
advisory lock (finding 1) so the tuple is not the lock; if the row lock is
kept, use `FOR NO KEY UPDATE` so it does not block the host's foreign-key
readers; and move `nextSpawnNumber` off the lock row (a sequence, or derive
`Kind#n` from `max(n)` among live objects, which core already has loaded).

**(c) uuid → opaque text.** §1 makes ids "opaque, the host's", and object
ids are `torch` / `Kind#3` — so `sprout_*` id columns are `text`, while
`understory_zone.profile_id` is `uuid`
(`migrations/042_understory_instances.sql:26`). Any host query that joins
the two invites exactly CLAUDE.md's #468 trap: the natural spelling
`z.profile_id::text = s.microworld_id` casts the **column**, defeating the
index and scanning. §5.1 should say, in the paragraph that promises the
tables are "documented and stable": never join `understory_*` to `sprout_*`
in SQL; render the microworld id to text in TypeScript and bind it as a
parameter.

---

## 11. SHOULD-CHANGE — §4.6: the conformance suite as described proves the absence of obvious bugs, not serialization or atomicity

**Claim.** The suite's serialization case runs on a promise chain (memory,
§5.3) and on PGlite, where — as §4.5 itself concedes and CLAUDE.md states
— queries serialize so `FOR UPDATE` contention never truly blocks. Both
backends pass the test *for reasons unrelated to the adapter being
correct*. The atomicity case ("a turn that throws leaves no row") does not
test the one novel claim of §4.5-2, which is that the **host's**
pre-existing writes survive the turn's rollback.

**Fix — four specific cases, each cheap:**

1. **Re-entrancy** (finding 2): wrap the store so `fn` is invoked twice;
   assert identical committed state, no duplicate action rows, no
   duplicate spawn ids. This is the only test that would catch the
   Firestore/Mongo retry class, and it runs on the memory store.
2. **Host writes survive.** Open a host transaction, insert a host row,
   run a turn that faults, commit; assert the host row is present and the
   action record is the only sprout row written.
3. **Real contention**, in Overstory rather than in the package: one
   `*.db.spec.ts`-shaped test against real node-postgres with two pooled
   clients, asserting the second turn blocks until the first commits and
   that `lock_timeout` fires rather than hanging. If that cannot be run in
   CI, §4.5 should say the property is asserted **by construction** (an
   advisory lock is a primitive; a hand-rolled ordering is not) and
   untested — which is a legitimate answer, but it has to be written down.
4. **A turn at the cap.** 2,000 objects, assert the round-trip reads a
   bounded number of rows and completes inside a named millisecond budget.
   Without it, "load all objects per turn" is an assertion nobody re-checks.

---

## 12. SHOULD-CHANGE — §5.2: `webStorageBackend(localStorage)` cannot honour `transact`, and the conformance suite's "fake" will hide that

**Claim.** §5.2 ships Web Storage as a real backend and §0 advertises "the
port's contract is small enough to implement on localStorage in an
afternoon". Three of `DocumentBackend`'s promises are unimplementable
there.

- **Atomicity.** localStorage has no transactions. `transact(keys, fn)`
  writing several keys can be interrupted by a tab close or by a
  `QuotaExceededError` on the second key, leaving torn state with no
  rollback. The only atomic multi-key write is "put everything in one key
  and write it once" — which collapses the layout.
- **Serialization.** Two tabs on the same origin share localStorage, and
  nothing in the API lets tab A block tab B. The `storage` event is
  after-the-fact. So a microworld open in two tabs violates §4.5-1 with no
  error and no detection.
- **Quota.** ~5 MB per origin, stored as UTF-16 (≈ 2 bytes per character
  in practice). §5.2's own ~300 KB objects estimate is ~600 KB of quota;
  add every minted version document (immutable, §4.4) and the append-only
  action documents and the budget is exhausted by an ordinary week of
  building, with a synchronous throw mid-write.

§4.6 says store-document runs the suite "on Web Storage (through a fake)".
A fake is single-context, has no quota and no interruption — it will pass
every case that the real thing fails.

**Fix.** Ship **IndexedDB**, not Web Storage, as the browser backend: it
has genuine multi-store transactions that the browser serializes across
every context of the origin, an async API that matches the port, and a
quota measured in hundreds of MB. If localStorage is kept as a toy, label
it single-tab, best-effort, non-atomic in §5.2 and exclude it from the
serialization and atomicity cases rather than faking them. Note also that
Overstory's own lint forbids raw `localStorage` outside `shared/storage.ts`
(CLAUDE.md), so a future `sprout-web` reaching for it directly would trip
the gate.

---

## 13. SHOULD-CHANGE — §5.1: "one `INSERT … ON CONFLICT DO UPDATE` per changed row, chunked" is self-contradictory and reproduces a 2,000-round-trip write path

**Claim.** §5.1 says both "per changed row" and "chunked". Today it is
literally per row: `saveWorld` (`world.ts:537-562`) issues one `await
client.query(...)` per changed object in a loop, and `sweep` / `import` /
`clearObjects` touch every object in the microworld.

**Numbers.** At the 2,000-object cap, an import or a sweep is 2,000
sequential round trips. Against Cloud SQL over the Node connector (mTLS,
not a local socket — `db.ts:50-56`) at ~1 ms RTT that is ~2 seconds, held
**inside the microworld lock**, blocking every poll in that zone. The tick
does this for every zone with `sweep_at_tick`.

**Fix.** Write `putObjects` as a single statement over array parameters —
`INSERT … SELECT * FROM unnest($1::text[], $2::text[], $3::jsonb[], …) ON
CONFLICT … DO UPDATE`. Per CLAUDE.md, array parameters are **one**
parameter, so no chunking is needed at all and the 500-row `VALUES` rule
does not apply. Then delete "chunked" from §5.1 and say why.

---

## 14. CONSIDER — §4.5 / §7.1: `completeUnderstory` is correctly exempted from the lock, but the reason given generalises further than the document admits

§7.1 says "`completeUnderstory` stays its own (it is not a turn and should
not take the lock)". That instinct is exactly right and is the same
instinct finding 1 applies to `look` — but the document draws the line at
one callable rather than at the property. The property is: **a turn that
writes nothing but the actor's own row does not need exclusive access to
the microworld.** `look`, `complete`, and `enter`-when-the-position-exists
all have it. Name the property in §4.5 and let `TurnInput` carry it
(`readOnly: true` on the three kinds), rather than carving out one
callable by hand — otherwise the next read-only input added will take the
lock by default.

---

## 15. CONSIDER — sprout.md §2.11: two of the four pressure-test triggers are now dead or unmeasurable; here is the replacement set

**Where §2.11's triggers stand after this design.**

| §2.11 trigger | status |
| --- | --- |
| "a zone's live instances pass ~10,000" | **Dead.** `UNDERSTORY_MAX_INSTANCES = 2000` (`packages/sprout/src/definitions.ts:42`) and §4.4 keeps 2,000 as the default limit. The trigger can never fire; the cap fires first. |
| "an action's p95 inside the transaction passes ~300 ms" | **Unmeasurable.** The action record (§4.1, and `understory_action`, `migrations/040:12-30`) holds `events`, `max_depth`, `spawned`, `faulted` — no duration. There is nothing to take a p95 of. |
| "a room routinely holds more than ~10 actors" | **Wrong unit now.** Per-microworld serialization makes actors-per-*microworld* the number that matters, not actors-per-room. |
| "visitors need to see each other's lines in under ~2 s" | **Still right**, and still the channel question, not the store's. |

**Fix, and the replacement list.** Add `durationMs` and `lockWaitMs` to
core's `ActionRecord` **now**, while the record shape is still private —
after publication it is a compatibility surface, and §5.1 explicitly makes
these columns "what a host's analytics read". Then the triggers become
measurable:

1. **Lock duty cycle** — `actors_in_microworld × p95(durationMs) > 2500 ms`
   (half the 5 s poll interval). This is the trigger that replaces both
   "10 actors" and "300 ms", and it is the one that actually predicts the
   cliff in finding 1.
2. **`p95(lockWaitMs) > 100 ms`** on read turns — the direct signal that
   polls are queueing.
3. **Pool wait** — any measurable time in `pool.connect()` on an instance
   serving understory traffic, given `max: 4` (`db.ts:41`). This is the
   first symptom that will be *misattributed* to the rest of the product.
4. **Bytes per turn** — `objects_loaded × avg_row_bytes × turns_per_second`
   against the `db-f1-micro`; alarm at 1 MB/s sustained per instance
   (≈ 8 concurrent pollers at today's payload, finding 8).
5. **Program cache residency** — compiled programs held per instance × their
   size against the 256 MB function memory (finding 5-3).
6. **If a document host ever appears**: serialized objects-document size
   against 1 MiB, and writes/second against 1 per document (findings 3–4).

Retire trigger 1 and replace trigger 2's wording; keep trigger 4 as-is.

---

## Verdict

The split is architecturally sound and the store port is the right size,
but the concurrency contract is currently written for the easiest backend
and tested on the two that cannot disprove it. Three things must change
before this is built: **`look` must not take an exclusive lock** — today's
poll takes none, and putting a 5-second-per-visitor heartbeat behind a
per-microworld exclusive lock, held on a pooled connection out of a
`max: 4` pool against a 25-connection `db-f1-micro`, converts a flagged
feature into a head-of-line block on unrelated product traffic (a shared
mode on an advisory lock fixes it in a line); **the port must state that
`fn` may run more than once**, because both promised document backends are
optimistic and re-run their callback, and nothing in the described
conformance suite can catch the resulting duplicate spawns and action
rows; and **§5.2's document layout must split presence from objects and
actions from days**, because six polling visitors already exceed
Firestore's 1-write/s per-document guidance while rewriting ~300 KB each
time, and a dated action document hits the 1 MiB ceiling after about
ninety minutes of modest traffic. The program cache's stamp has a real,
user-visible hole on the draft realm that a builder will hit on their
first save-then-play. Everything else is tightening: index `actorsIn`,
get `trim`/`destroy` off the turn lock, write `putObjects` as one array
statement, keep the savepoint to one per turn, prefer IndexedDB to
localStorage, add `durationMs`/`lockWaitMs` to the action record while it
is still private, and replace §2.11's two dead triggers with a lock-duty-cycle
one. None of these changes the shape of the design; all of them are
cheaper now than after `@overstory/sprout-core` has a version number.
