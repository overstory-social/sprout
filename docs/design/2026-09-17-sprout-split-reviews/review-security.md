# Outside review — SECURITY, ABUSE AND MODERATION
`design/proposals/2026-09-17-sprout-split.md`, read against PRINCIPLES.md, understory.md §3–§7, sprout.md §2.5/§2.11/§5.2, CLAUDE.md's checklist, and the shipped code.

The split is the right shape and the "core does not do permissions" call is correct. What follows is where the *host side* of that boundary has been left underspecified, and where the mechanisms the Understory already relies on (per-definition publication, FK cascades, room-level locking, a published-definition media rule) are dissolved by the redesign without a replacement being named.

---

## 1. MUST-CHANGE — §4.5, §4.2: per-microworld locking plus a lock-taking `look` poll is a one-visitor denial of service on someone else's zone

**Claim.** §4.5-1: "Turns on one microworld are serialized. `store.transaction(microworldId, fn)` runs `fn` with that microworld locked against every other transaction on the same microworld… Per-room locking (today's `lockRoom`) is an adapter optimisation that a SQL adapter may add later." §7.1 adds that `completeUnderstory` "stays its own (it is not a turn and should not take the lock)" — which says every other input, `look` included, does take it.

**Attack.** Mallory opens Priya's zone. Her client (or a loop in a console) fires `{kind:'look'}` continuously. Each look now: takes `SELECT … FOR UPDATE` on the microworld row, loads all objects in the microworld (§4.1: "The whole of a microworld's objects are loaded for a turn… capped at 2,000 live objects"), builds the scene, runs `describe` over the room's contents (which can spend the whole 256-envelope budget legitimately — sprout.md §2.12 lets `describe` walk containers with `each`), then commits. Every other visitor's turn — and the owner's own draft play — queues behind it. Ten visitors polling on a presence heartbeat interact quadratically. One deliberate actor makes the zone unusable, and nothing in the product refuses them: `grep -rn throttle packages/backend/src/understory/` returns nothing, so there is no rate limit on any understory callable today, and the proposal adds none.

**Evidence.** `packages/backend/src/understory/walk.ts:262` — `lookUnderstory` calls `lookAt`, which loads with `lock: false` (`walk.ts:100-107`); only `performVerb`/`performGo` lock, and `world.ts:211-217` locks the *room*, several rooms in id order. So today's system is strictly better than the proposal on both axes. `packages/backend/src/throttle.ts` has the durable limiter and the `LIMITS` table the understory never joined.

**Fix.** (a) State that `look` and `complete` are read-only turns that take no write lock, and give the port a `readTransaction(microworldId, fn)` (a snapshot read) so the contract, not the adapter, distinguishes them. (b) Keep per-room locking in the *contract*, not as an adapter optimisation — the language already guarantees reach is the room's tree, so a room is the natural granularity and the microworld lock is a fan-in that only a document store needs; let the document adapter widen it, not the port. (c) Name the host's per-actor turn budget explicitly in §7.1 and wire it to `throttle.ts` (`understoryTurn` per profile, generous for people, a wall for scripts). Core has no clock, so this is the host's and has to be said out loud or it will not exist.

---

## 2. MUST-CHANGE — §7.1, §8-12: "a picture on the shelf of a zone the viewer may enter" is strictly weaker than today's rule, and it breaks take-down

**Claim.** §7.1: "the audience arm in `media/authz.ts` becomes *a picture on the shelf of a zone the viewer may enter* — simpler than scanning published definitions for ids, and no longer needing to." §8-12: "a picture on a zone's shelf is as open as the zone's door."

**Attack, three ways.**
1. *Drafts leak.* A builder uploads twelve photographs to the shelf while drafting; two are published, ten never are. Under today's rule only the two are readable. Under the shelf rule all twelve are readable by every signed-in mask that may enter the zone, from the moment they are shelved. The shelf is the builder's *workspace*, and the proposal turns it into a publication.
2. *Take-down does not revoke.* `adminTakedownUnderstoryRoom` (`takedown.ts:22-30`) sets `published_version = NULL`; today that closes the media arm at once (within the one-hour signature window DESIGN §7 allows). §7.1's take-down is `core.unpublish` on the unit — and the shelf row is untouched, because it is the host's table and nothing in the flow removes it. The abusive image stays readable by every visitor after the operator has taken the room down. The same holds for the builder's own panic-revert (understory.md §5: "going backward is instant").
3. *The reverse breaks live rooms.* `pictures.ts:52-55` documents the deliberate asymmetry — "taking a picture off the shelf deliberately leaves a published line still showing it" — so under the shelf rule a builder who tidies their shelf silently blanks a published room's picture for every visitor.

**Evidence.** `packages/backend/src/media/authz.ts:14-40` (the `#345`/`#437` arms and the comment explaining exactly why ownership is checked in the definition and not on the shelf); `packages/backend/src/understory/pictures.ts:11-15` — "this table is a list, not a permission".

**Fix.** Keep the published-definition arm. Under source-as-truth the scan is *cheaper*, not harder: at publish, core knows the program, so have `publish` emit the set of media ids the published program names and have the host store it (`understory_zone_media`, or a `media_ids` column on the picture row maintained at publish/unpublish/take-down). The authz arm becomes an indexed join on that set, `unpublish` and take-down clear it in the same transaction, and #437's ownership check is done once at publish instead of on every read. If the shelf arm is kept anyway, take-down must delete the shelf row in the same transaction and the doc must say the shelf is now a publication surface.

---

## 3. MUST-CHANGE — §5.1, §7.1: "no foreign key to a profile" silently removes the only thing that makes wipeout complete

**Claim.** §5.1: the `sprout_*` family has "no foreign key to anything of the host's". §7.1: "profile deletion calls `core.destroyMicroworld` — by code now, since there is no foreign key to cascade."

**Failure.** `destroyMicroworld` destroys the microworld the deleted profile *owns*. It does nothing about the same profile's data in **every other person's microworld**: its `sprout_actor` row (id **and the display name the host last supplied**), its `sprout_memory` rows (what a hundred objects in a hundred zones remember about it), and its `sprout_action` rows (its typed commands, including `say` text, attributed by id). Today all of those cascade: `migrations/032_understory.sql:53-55` — `understory_visitor.profile_id … ON DELETE CASCADE`; `034_understory_sprout.sql:53-56` — `understory_visitor_state` the same. The proposal deletes the cascade and replaces it with a call that reaches one row of the graph. A wiped-out profile's mask therefore survives, by name, in other people's worlds — which is a deletion failure and, given PRINCIPLES #11, a pseudonymity failure as well.

Half-way failure compounds it: `destroyMicroworld(id)` in §4.4 takes no `now`, is not described as transactional, and `StoreTx.destroy()` sits inside a transaction keyed on the microworld being destroyed. If it fails between tables there is no FK to make the remainder unreachable and no statement of what is orphaned — the host's `understory_zone`, `understory_picture` and `flag` rows point at a microworld that is now partly gone.

**Fix.** (a) Add `forgetActor(actorId)` to the store port — a cross-microworld erasure of actor rows, memory and action attribution — and call it from profile deletion. Say in §4.6 that it is the only port method that is not scoped to one microworld, and prove it in the conformance suite. (b) Make `destroyMicroworld` transactional and enumerate what it deletes; have the host delete `understory_zone`/`understory_picture` in the *same* transaction. (c) The store-sql migration should keep an index that makes `forgetActor` cheap, since there is no FK to do it.

---

## 4. MUST-CHANGE — §4.4, §7.1: `exportMicroworld` into `takeoutExtras` hands the zone owner a dossier on every visitor

**Claim.** §4.4 gives one function for three jobs: "`exportMicroworld(microworldId): MicroworldExport` — takeout, the CLI's directory, a copy between hosts". §7.1 wires it straight into `takeoutExtras`.

**Attack.** A builder makes a pleasant zone, invites people, and downloads their takeout monthly. If the export is the microworld — and §4.1's microworld *is* units, versions, objects, **actors, memory, actions and misses** — the file contains, for every visitor: the mask id, the display name the host supplied, the room they stood in, `lastSeen`, everything each object remembers about them, and their entire command history including every `say`. Nothing in understory.md sanctions this: §4.1 caps the owner's view of visitors at a **14-tick expiring provenance log**, "visible to the space owner about their own space only", and says expiry "is what keeps it a log rather than a dossier". Today's takeout is exactly the owner's furniture and nothing else — `packages/backend/src/profiles/takeout.ts:131-150` selects only `understory_room`/`understory_item` and their published versions.

It also defeats the donated-miss invariant (see finding 11) and, as "a copy between hosts", moves visitors' memory to another operator with no consent event anywhere — PRINCIPLES #13.

**Fix.** Split the function by audience, which is the honest shape: `exportDefinitions(microworldId)` (units, versions, objects' placements, limits, settings) is what takeout and a host-to-host copy get; `exportAll` exists only for the operator under audit. Say in §7.1 that `takeoutExtras` takes the former. And state that `importMicroworld` is never a callable — it is seed/CLI only — because as written it is a write path into a zone that bypasses every save-time check the builder callables perform (caps, ownership, the audience rule) and would accept actor and memory rows fabricated by the importer.

---

## 5. MUST-CHANGE — §3.3, §4.4: whole-microworld compilation makes every definition a single point of failure, and `unpublish` has no compile check

**Claim.** §3.3 compiles the microworld as a unit and §4.4 says "Publish compiles the set it would leave standing… refused if it does not compile". But `unpublish(microworldId, unit, now)` is "immediate; the program cache's stamp bumps" — no compile of what remains.

**Attack / failure.** A sysmod takes down the unit holding `kind Lamp`, which forty objects inherit and three rooms `send` to. `unpublish` succeeds. The next visitor's turn loads the published set, `compileMicroworld` reports "no kind called Lamp", and `program` is `null`. There is no published program, so *the whole zone* is dark — the operator intended to remove one room and removed a world. Worse, §3.2's promise that "a parse error surfaces to a visitor… only if a newer compiler refuses older text" is broken by a path §3.2 never considered, and the natural implementation prints the compiler's `Problem.message` to the visitor. Those messages quote builder-controlled identifiers and strings, so a builder can arrange for a chosen slur to be rendered into a stranger's transcript by an error path nobody moderates.

Today this cannot happen: definitions are compiled and published one at a time (`takedown.ts` nulls one room's `published_version`), and the rest of the zone keeps running.

**Fix.** (a) `unpublish` must compile the remaining published set and degrade rather than fail: an unresolvable reference at load becomes an *absent* definition, exactly as §3.3 already rules for "an exit to a room in a draft that is not published… simply absent at play". Define, per reference kind, what absence means (an object of a missing kind is inert and unlistable; a `send` to a missing target is a no-op). (b) The load path must never surface compiler text to a visitor: on a failed load, close the door with the fixed `UNDERSTORY_FAULT_TEXT` wording, record a fault, and notify the builder and the operator. (c) Pin the last-known-good program: `publish` compiled it, so store "this version set compiled" and refuse to *serve* a set that did not, rather than discovering it on a visitor's turn.

---

## 6. MUST-CHANGE — §3.5: "an extension records an effect and never performs one" is a TypeScript signature, not an enforcement, and `pure` is self-asserted

**Claim.** §3.5: "`run` gets a read-only view of the frame… It cannot write state, send, spawn, loop, await, or reach anything outside the scene. So an extension cannot change the computation class (still total, still bounded, still deterministic)."

**Why it does not hold as written.** `run(ctx: ReadOnlyFrame, args: BoundArgs): Effect | void` is ordinary JavaScript running in the host's process. Concretely, with nothing in the design stopping any of it: it can mutate the objects reachable through `ctx` (a `ReadOnlyFrame` type erases at compile time); it can `while(true)` or spin for 500 ms inside the room's transaction, breaking totality and holding the lock of finding 1; it can read `Date.now()`/`Math.random()`, breaking the determinism that understory.md §3.1 calls "not a style preference" but the security model; and it can **throw a non-`Fault` error**, which `packages/sprout/src/engine.ts:987,1023` (`if (!(err instanceof Fault)) throw err;`) rethrows past the fault machinery — so the turn 500s, the rollback is the host's problem, and §4.5-2's "a fault writes nothing but its action record" does not happen, meaning the incident is not even recorded. Separately, `pure: boolean` is declared **by the extension about itself** and is what decides whether the statement may appear in `describe` and consent guards, i.e. the one place sprout.md §2.12 requires read-only. A wrong or lying `pure` silently reopens the "looking at a thing changes it" hole.

Note also the trust framing is missing: builders cannot install extensions, only `use` them, so the real boundary is host↔extension-*author* — an npm supply-chain boundary under `@overstory/*`, exactly the shape that killed deploys on 2026-09-03 (CLAUDE.md). The document reads as though `run` were sandboxed.

**Fix.** Say plainly that an extension is host-trusted code, then name what core does to contain a buggy one: freeze/proxy the frame (`Object.freeze` on the view, accessors only, and a spec that asserts a mutating `run` throws); wrap every `run` in try/catch that converts any throw into a `Fault` with the extension's name; charge each `run` against the event budget and cap `effects` per turn (a `describe` over 2,000 objects can otherwise return 2,000 effects); and make `pure` *verified* — run every `pure: true` statement in describe-position against a frame whose write paths throw, in the extension conformance spec, rather than trusting the flag.

---

## 7. MUST-CHANGE — §3.2, §4.4: compile-at-load plus a builder-bumpable cache stamp is a CPU amplifier, and the caps do not cover a microworld

**Claim.** §3.2: "Parsing the whole of a capped microworld (a few hundred definitions, 64 KB each at most…) is milliseconds; the cache makes it rarer than the poll." The cache key is the `publishedStamp`, "bumped on publish and unpublish" (§4.1).

**Attack.** Three, in increasing order of nastiness.
1. *Stamp thrashing.* `unpublish` is the builder's, immediate, and not tick-gated. If it bumps the stamp unconditionally (the natural implementation — the doc says "bumped on publish and unpublish", not "on a change"), the builder calls `unpublish` on an already-unpublished unit in a loop. Every visitor's next turn recompiles the whole microworld. One cheap authenticated call invalidates an arbitrary number of expensive compiles across every warm instance. The "few hundred definitions × 64 KB" arithmetic is ~20 MB of source per compile.
2. *The caps are per definition, not per microworld.* §4.4's limits list rooms (16), objects (12×16), kinds and live instances — but §3.3 lets "a unit hold any number of `kind`, `room` and `object` definitions", and nothing caps the number of *units* or the total source bytes. Comments, whitespace and definitions that are legal but unreferenced all cost parse time and none of them count against the room/object caps.
3. *The save path is worse than the load path.* `saveDraft` "compiles the microworld's drafts with this unit replaced" and `checkDraft` is what an editor calls per keystroke. That is a full-microworld compile per keystroke, unrated, on the builder's own request. With no throttle (finding 1c) this is the cheapest CPU burn in the product.

Also: §3.2 promises no visitor sees a parse error, but §3.2's own compatibility rule — "core refuses to load a microworld compiled by a *newer* lang than itself" — is a load-path refusal that a visitor hits directly, e.g. after a rollback of the functions bundle.

**Fix.** Bump the stamp only on an actual change (compare the published version set); add explicit microworld limits for units and total published source bytes, and enforce them at `saveDraft`; debounce/rate-limit `checkDraft` and make it `compileUnit`-only (§3.3 already keeps `compileUnit` "for an editor's per-keystroke check" — say that the editor uses *only* that); and treat the newer-lang refusal as a closed door with operator alerting, not a visitor-visible error.

---

## 8. SHOULD-CHANGE — §4.3: `actor.name` as a free string is a confused deputy for `give … to <name>`, and the current handle-keyed design is safer

**Claim.** §4.3: "Each turn brings an id and a name; core writes the name on the actor's row and uses it for 'also here' and for `give the cup to Marta`."

**Attack.** Overstory's display name is user-chosen and not unique; the handle is. Today the parser is keyed on the handle — `packages/backend/src/understory/say.ts:62` builds `people: present.map(p => ({ handle: p.handle, id: p.id }))` and `packages/sprout/src/parser.ts:192-197` matches `phraseOf(person.handle)` and `'@' + handle`. If the host now supplies `name` and the obvious field is `displayName` (`packages/schema/src/common.ts:17-24` has both), then: Mallory enters a zone where Marta is standing, sets her display name to "Marta", and `give the brass key to Marta` binds to Mallory. Item theft is the small version; a builder-authored object that reacts to who holds it is the larger one. §4.3 gives core no tie-breaking rule for people (the parser asks "which do you mean" only on *objects*), so the collision resolves silently.

The name is also *stored* on the actor row and reused on later turns, so a name can persist past a rename, a ban or a departure; #272's banned/departing wall stops Mallory acting, but her stale row still names her in presence until `lastSeen` expires.

**Fix.** Three sentences in §4.3: the name the host supplies must be a stable, host-unique token within the microworld (Overstory supplies the handle; display names are decoration the host adds on the way out); the name must never be read off the wire — it is derived server-side from the authenticated mask, never from the request — which is the whole confused-deputy guard; and core must refuse or disambiguate duplicate names among present actors rather than picking one. On masks: because the id and the name both come from the same mask and core holds nothing else (§4.3's "no identity" invariant), masks stay unlinkable — that part is right and worth stating as an invariant with a spec, since it is one careless host field (`userId`, an avatar url) away from being false.

---

## 9. SHOULD-CHANGE — §4.1, §4.6, §5.2: memory is not scoped by realm, and the document layout's "one per actor's memory" is a cross-microworld leak waiting to be written

**Claim.** §4.6's port: `memory(actorId): Promise<MemoryRecord>` — no microworld parameter, relying on the enclosing `transaction(microworldId, …)`. §5.2's layout: "one per actor's memory", with no per-microworld qualifier, while every sibling document in the list *is* qualified (`microworld/<id>/live`, `microworld/<id>/draft/<actor>`).

**Failure.** Object ids are source identifiers (§1: "Objects are addressed by their source identifier within a microworld — `cellar`, `torch`"), which are *not* globally unique. A document adapter author reading §5.2 literally keys the memory document on the actor alone; `torch` in Priya's world and `torch` in Mallory's then share a memory blob, and understory.md §3.2's dangerous primitive — "the door recognises you" — starts recognising people across worlds they never connected. This is the leak the whole "no foreign key, opaque ids" story is supposed to prevent, and it is one under-specified key away.

Separately, memory is per actor per *microworld* with no **realm**: the builder's draft play (§4.4 `realm: 'draft:<actorId>'`) reads and writes the same memory rows as the live realm, so "reset the preview" (`sweep`, which §4.4 says leaves "memory untouched") cannot actually reset a draft that uses `remember`/`recall`, and a draft experiment permanently alters what the live world remembers about the builder. Once co-builders exist this stops being self-harm.

**Fix.** Put the microworld in the port signature (`memory(microworldId, actorId)`) even though the tx implies it — signatures are what adapter authors copy; fix §5.2's key to `microworld/<id>/memory/<actor>`; add "memory of microworld A is invisible in microworld B" and "draft-realm memory is separate from live" to the conformance suite, which is the only place an adapter's mistake can be caught. Decide and state whether `forget` clears both realms.

---

## 10. SHOULD-CHANGE — §4.4, §7.1: one `inspect` for "a builder's panel and a moderator" collapses two different audiences into one answer

**Claim.** §4.4: "`inspect(microworldId): MicroworldReport` — for a builder's panel and a moderator: units, versions, objects, actors present, faults, misses, limits."

**Why it matters.** understory.md §6 is explicit that these are two claims — sysmods "have the *authority* to see any space; the *workflow* is queue-driven" — and CLAUDE.md's own rule is the mirror image of what this does: "two answers to one question is a smell" cuts both ways, and one answer to two questions is how a builder ends up holding a moderator's view. The contents are not neutral: `faults` carry the last twenty **envelopes**, whose `value` payloads can contain text another visitor typed (sprout.md §2.5 — a broadcast carries a value, and a `say` line can reach one); `actors present` is a presence list; `misses` is the donated stream. Nothing in the type distinguishes what a builder may see from what only an operator may.

**Fix.** Two functions, or one with an explicit `as: 'owner' | 'operator'` that core honours by projecting different records — so the redaction lives in core beside the data rather than in each host's handler, where it will be forgotten by the second host. Whichever is chosen, the operator arm is a privileged read of someone else's space and therefore takes `writeAuditEntry` in the host (CLAUDE.md's checklist; understory.md §4.1's "mod aggregation is a privileged, audited query, not a page").

---

## 11. SHOULD-CHANGE — §4.1, §4.7, §5.1: donated misses keep the right invariant on the row and lose it to a join

**Claim.** §4.7: "the donated-miss text is kept only when the turn says `keepMissText` — the switch stays the host's, per actor, exactly as #346 built it." The row itself is right: §4.1's miss record is "the input, what could have been said and named, the room's state" — no actor, matching `misses.ts:53-62` and sprout.md §5.2 ("stored against the zone and never against the profile").

**Attack.** §5.1 then says "The action and miss tables are what a host's analytics read; their columns are the record fields and are versioned with the package" — and the action record (§4.1) carries the actor plus `missed` plus a timestamp, in the same store. `SELECT … FROM sprout_miss m JOIN sprout_action a ON a.microworld_id = m.microworld_id AND a.missed AND a.created_at BETWEEN m.created_at - '1s' AND m.created_at + '1s'` re-attributes every donated miss to the mask that typed it. The promise made to the visitor on the settings page — "never against the profile" — is true of the row and false of the database. This is latent today (`migrations/040_understory_actions.sql:16` has `profile_id`, `043` adds `missed`) but the current builder panel reads only `donatedMisses` (`misses.ts:66-92`); the proposal is what invites zone owners to read both tables, and §4-above would ship the join to them in a zip file.

**Fix.** Pick one and write it into §4.7: either the action record drops the actor entirely once presence/`lastSeen` covers what it was for (it is instrumentation — sprout.md §2.11's questions are `GROUP BY instigator` and depth quartiles, neither of which needs a person), or the miss row's timestamp is coarsened to the tick and its room recorded without ordering, or §5.1 states that a host must never expose action-level actor data and miss text to the same audience — and Overstory's `inspect` enforces it.

---

## 12. SHOULD-CHANGE — §4.4, §7.1: flag evidence can be deleted by the person being flagged

**Claim.** §7.1: "the evidence pins the microworld, the unit and its version, the definition identifier, and `core.snapshot`'s state." §4.1: minted versions are "Immutable once minted."

**Failure.** Immutable is not the same as retained. §4.4 also gives `deleteUnit(microworldId, unit, now)` and `destroyMicroworld(id)`, and says nothing about what happens to that unit's minted versions. The natural implementation — and the natural SQL, given `sprout_unit_version` keyed on the unit — deletes them. So: Mallory is flagged for an abusive room, sees the flag land (or simply tidies), calls `deleteUnit`, and the pinned version row is gone; the moderator opens the flag and finds an id. This is precisely the abuse understory.md §5 says tick-publishing closes "by construction" — "be abusive, get flagged, edit the room, mod finds a nice room about ferns" — reopened through a delete instead of an edit. `takedown.ts:14` states the current invariant that the proposal drops: "The version rows stay: they are the evidence."

A second gap: `snapshot(microworldId, room)` snapshots a **room**, but today's flag can target an item in the room or in the flagger's hands (`flag.ts:38-44`), and under microworld compilation a spawned `Torch#7`'s behaviour comes from a kind chain that may span several units. Pinning the room's unit version is not enough to reconstruct what the flagger saw.

**Fix.** Say in §4.4 that a version row pinned by a host reference is never deleted — `deleteUnit` is a tombstone (the unit stops being published and stops being editable; its versions stay), and `destroyMicroworld` must refuse or retain while flags reference it, which the host checks since core does not know about flags. Change `snapshot(microworldId, room)` to `snapshot(microworldId, objectId)` returning the object's state, its identifier, and **every unit version in its kind chain**.

---

## 13. SHOULD-CHANGE — §4.4: publish is all-or-nothing per microworld, which is a co-builder grief and a tick hazard

**Claim.** §4.4: "`publish(microworldId, now)`: every requested unit: mint a version, then compile the published set; refuse if it does not compile."

**Failure.** Today publish is per definition, so one broken room does not hold another back. Under the proposal, one unit that does not compile refuses the *whole* microworld's publish for that tick. Alone that is merely annoying (the builder broke their own thing). With co-builders — which understory.md §7 names as the eventual target and PRINCIPLES #12 makes the happy path — any co-builder, deliberately or not, can request publish on an unresolvable unit and block every other co-builder's work for a day, with no attribution in the refusal and no way for the others to un-request someone else's unit. That is a cheap, deniable grief, and the natural "fix" (letting anyone cancel anyone's publish request) is itself a privileged mutation of another member's standing and would need `writeAuditEntry`.

Second-order: §7.1's tick step runs `core.publish` "over every zone that qualifies and none depending on another". A *refusal* is fine; an unhandled *throw* from a pathological microworld would abort the loop and stall publication for every zone after it in the ordering — a builder can construct that deliberately.

**Fix.** `publish` mints what compiles and reports per-unit refusals, naming the unit (and, once there are co-builders, the requester); only a unit whose *published* text becomes unresolvable blocks, and then only that unit. And state that the tick's per-zone steps are individually error-isolated, each zone's failure recorded, none able to stop the next.

---

## 14. CONSIDER — §9 stage 5, §4: the consent closure disappears into a parenthesis

**Claim.** §9-5 defers, among "later" items, "portals between microworlds, which are a host concern with an opaque exit target in the language."

**Why it is worth a sentence.** That is true and also the most load-bearing "later" in the document. understory.md §4 spends a page on why portals are not an edge: fail-closed on graph change, transitive closure over the whole newly-reachable zone set, per-zone durable consent, the 14-tick provenance log as the mechanism most likely to actually catch a bad connection. None of that is host-trivial, and "an opaque exit target in the language" reads as though the language part were the hard part. Similarly, understory.md §7's v1 invariant — **foreign items are inert outside their home zone** — appears nowhere in the proposal, even though microworld-scoped objects and `importMicroworld` are exactly where it would be tested.

**Fix.** One paragraph in §7 or §9: the consent closure and the provenance log are the host's, they are unbuilt, and no portal ships before them; and a line in §4.1 stating that an object exists in exactly one microworld and no core API moves one between microworlds — so understory.md §7 holds by construction and a future `importMicroworld` cannot quietly break it.

---

## 15. NOTE — §7.2: the schema mirror is right, and worth one more sentence

§7.2 already gets the thing that has cost the product four incidents: "`realm`, `options`, a command's `args` — are `.nullish()` in that mirror, never `.optional()`… core's own TypeScript types may say `?` because nothing crosses a wire to reach them." That distinction is exactly right and is the sort of thing usually discovered in a journey instead. The sentence to add: `TurnInput` is a **discriminated union**, and `actions.spec.ts`'s walk must descend into every arm (#433 says it recurses through unions, so this should hold, but a union whose arms are added later by an extension is a new shape) — and a `.default()` in the mirror is the deliberate exception, not an accident, if one is used for `realm`.

---

## Verdict

The architectural call at the centre of this — core takes `(microworld, actor, input)` and the host owns permissions — is sound, and §4.3's "no identity in core" is a real invariant that keeps masks unlinkable by construction rather than by discipline. The security problems are not in that boundary; they are in the mechanisms the redesign *dissolves* without noticing they were load-bearing. Four of them are the same mistake in four places: per-definition publication became per-microworld compilation (so one take-down darkens a world, and one bad unit blocks a co-builder's day); per-room locking became per-microworld locking with the presence poll inside it (so one visitor can stop a zone, and there is still no rate limit anywhere in the understory); the published-definition media rule became the shelf (so drafts leak and take-down stops revoking); and foreign keys became "no foreign key to anything of the host's" (so wipeout no longer reaches a deleted mask's traces in other people's worlds). A fifth — `exportMicroworld` as one function for takeout, a CLI directory and a host-to-host copy — would hand zone owners a per-visitor dossier that understory.md §4.1 deliberately capped at fourteen expiring ticks. None of these needs the design to change shape: each is a named function's contract being written down more carefully, plus three additions the document should make explicit rather than assume — a host-side turn budget wired to `throttle.ts`, a `forgetActor` on the port, and a real (not type-level) containment story for extension `run`. I would not build stage 2 until findings 1–7 have answers in the document, since 1, 5 and 6 all land in 2a and are cheaper to decide than to retrofit.
