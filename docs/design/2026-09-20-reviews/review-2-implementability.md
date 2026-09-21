# Review 2 — Implementability

Target: `docs/design/sprout-design-spec.md` (line numbers from `cat -n`). Working notes and backlog read for context only.

## The three that matter most

### 1. The poll is where the cost lives, and nothing bounds, serializes or budgets it — **gap, expensive**

Sections: *Range* (l.104–114), *An exit may be conditional* (l.710), *Prose* (l.899), *Chance* (l.1127, 1135), *Runtime budgets* (l.1226–1234), *Storage* (l.1344).

> "they are evaluated on every poll to build what a visitor can see and say" (l.710)
> "`describe` is an object's portrait of itself, pure and re-run on every poll" (l.899)
> "steps — 50,000 per request" (l.1226)

Every runtime bound in the spec is attached to a *turn* or *request*: steps, events, output, cascade depth, spawns. But the spec also defines a second execution path — the poll — that runs authored code and is not a turn: it has no seed, takes no write lock, is never logged, and is never said to draw from any budget. What a poll runs, per visitor, is: a range walk from the visitor's place evaluating every `pass` expression on the way (l.106, 114); every exit guard on the place (l.710); the place's `describe`, which is a passage that may `{for thing in self}` over the whole place and invoke other objects' passages to depth 8 (l.954, 985); and the verb table — for every verb, every role, which in-range object plays it, plus `from :knows` list reads for value roles (l.611, 680). The `describe` reads `actor.recall`, so it is per-visitor and cannot be shared. Cost per poll interval is therefore *occupancy × (range + exits + describe + verbs × range)*, and the spec's "cost follows occupancy" argument (l.1240–1246) only counts ticks and `tell`.

Three concrete things an implementer has to invent:

- **Budget.** Is a poll a "request" with 50,000 steps? If a describe's loop over a 2,000-object place exhausts it, what does the visitor see — the place is not "abandoned" (nothing was written) but there is no text either. Range is said to be "charged to the step budget like any other work" (l.114) but no budget is named for the context in which range is most often computed.
- **Isolation.** "Write turns are serialized" (l.1246, 1344). Polls are reads and are not said to be serialized with them. A poll that runs concurrently with a write turn reads a half-committed tree unless the store gives snapshot reads, which is not stated. A range walk that sees an object in two containers is a bug the spec's determinism story cannot explain, because polls are not in the log.
- **Rate.** Nothing bounds how often a client polls. The working notes' own LambdaMOO caution (parsing per keystroke) applies here at higher order.

**Cheapest fix.** Make the view a product of the turn, not of the poll: after every write turn, derive the view once for each visitor present (range, exits, chips, description) inside the turn's own budget, stamp it with the world version, and let polls read the stored view. The world only changes on write turns, so a poll can never observe anything a per-turn derivation would not, and the cost collapses from *occupancy × poll rate* to *occupancy per write turn*. If a live per-keystroke derivation is still wanted for completion, run it against the stamped snapshot with its own small budget and a stated fault behaviour ("show the last good view").

### 2. "There is no unknown receiver" is false for four bindings, and the rule that would make it true is unstated — **contradiction / gap, fatal to exact checking as written**

Sections: *Where types come from* (l.464–476), *Receiving* (l.804), *Handlers do not refuse* (l.816), *Playing a role* (l.565, 595), *Slots* (l.947, 969), *What the compiler checks* (l.494).

> "There is no unknown receiver anywhere in the language." (l.464)
> "a handler's sender — the object it names" (l.473)
> "`from.get(:opens)` reads the sender's declared properties" (l.804)

The table at l.466 says the sender is "typed by the object it names". That is circular: the object that sends `:unlock_attempt` is decided at runtime. The same applies to:

- **Open roles.** `role tool` with no kind (l.1429) is "filled by anything that declares it" (l.565), and `Warded` reads `tool.get(:opens)` (l.1523). Roles do not appear in the "where types come from" table at all.
- **Handler value parameters.** `on :illuminating (from, value) { self.set(:illuminated, value) }` (l.798). `value`'s type is nowhere declared; bus messages like `:illuminating` and `:unlock_attempt` have no declaration form, only `send`/`on` sites.
- **Prose loop variables.** `{for thing in self}` binds `thing` with no kind, and `{thing.short}` / `{item.greeting}` (l.947, 969) select a passage on it.

The only computable rule in a closed bundle is a *union*: the type of `from` in `on :m` is the set of kinds whose bodies syntactically `send … :m` or `broadcast :m` (plus the engine for reserved messages); the type of an open role is the set of kinds declaring `as r for v`; `x.get(:p)` is legal iff every member of the union declares `:p` at one type. That is decidable and cheap, but it is not what the spec says, and it has consequences the spec must own: adding a second sender of `:unlock_attempt` that lacks `:opens` breaks the lock's handler; and "same property at the same type on two unrelated kinds" is exactly what l.256 calls two claims on one slot, so the union rule has to say whether it compares by name+type or by origin.

For prose loop variables the union is *every kind in the bundle* (anything can be moved into a container), so `{thing.greeting}` is checkable only as "every kind declares `greeting`" — which l.1706 already recognises is unreasonable, while l.947 and l.969 still show the form. The `chance` reachability check (l.1137) inherits the problem: reachability through `{thing.greeting}` from a `describe` must include every `greeting` passage in the bundle, so one describe with a loop poisons `{one of}` in every same-named passage anywhere.

**Cheapest fix.** State the union rule explicitly for senders, open roles and handler values, and add a declaration form for bus messages carrying values (`message :illuminating (value: boolean)`) so `value` has one declared type. For prose, require a kind on any loop variable whose passage is invoked (`{for pot: Vessel in self}{pot.greeting}`), mirroring `each pot: Vessel in self` (l.471), and allow only `{thing}` on an unfiltered variable. Then reachability is over a named kind and is cheap.

### 3. The executor has entry points the spec never defines: message-level grammar, an authored `move`, and refusal or destruction mid-effect-pass — **contradiction / gap, fatal until resolved**

Sections: *Spawning* (l.163–167), *Passages* (l.912–916), *Other people* (l.992–997), *Wakes* (l.1057–1062), *Verbs* (l.544–565), *Guards are read-only* (l.877), *What it refuses* (l.1273), *The two passes* (l.597–605).

> "Verbs are declared by a world or exported by a library, never by an object." (l.563)
> `throw { grammar "throw [self]" spawn Cup in actor }` (l.163–167)

Four examples (l.164, 913, 993, 1058) declare a phrase on a *message* with `[self]`, and l.480 says "typed arguments also constrain the parser" for `dip (into: sprout.Container)`. That is an object-declared verb with a body and no `permit`/`do` split — a second command path with a different execution model from world-level verbs. The parser must merge two phrase sources, disjointness (l.621) must be computed over both, and the consent pass does not exist for the second. Either the examples are stale or l.544–565 is wrong; the implementer cannot build both under "one mechanism per job" (l.33).

Second, a `move` statement is named as forbidden in guards, `let`, and `describe` (l.522, 877, 1273) but is never given syntax or semantics. If authored bodies can move things, then: the three-party consent poll runs *inline* inside a `do` or handler (guards are read-only, so that is safe), but what happens on refusal? A `permit` refusal halts the reading with the refusal text as the entire output (l.601) — but a refusal inside the *effect* pass comes after other `do` bodies have already written. The turn cannot be "abandoned" without discarding those writes, and cannot continue without a refusal-text channel the effect pass does not have. Silent no-op, fault, or emit-the-text-and-continue are three different worlds.

Third, `destroy self` (l.181) and `spawn` are legal in `do`. If the target's `do` destroys it, the tool's `do` in the same reading still has `target` bound (l.595). What does `target.get(:x)` return on a destroyed object? "No reference dangles" (l.530) is argued from *storage*, but bindings within a reading outlive destroys. Likewise a queued message whose sender was destroyed before delivery binds `from` to nothing.

**Cheapest fix.** Delete message-level `grammar` from the examples (or delete l.544–565's claim). Define `move <binding> to <binding>` as an effect-pass statement whose consent poll runs inline; on refusal the statement does nothing and the refusal text is emitted as a `say` — no abandonment, no fault. State that a destroyed object's bindings remain readable for the rest of the turn (its last state) and that queued messages to or from it are dropped, so no null is observed.

## Everything else

### Decidability

**`actor` and `say` in handlers reached from actorless turns — gap, must choose.** *Other people* (l.1006–1008) refuses `say` and `{actor}` in a `:tick` handler because "a tick has no acting visitor". But a tick handler may `broadcast :gust` (l.1038), and `on :gust` — also reachable from a typed command — may `say` or `actor.remember`. The static check on the tick body does not cover this; extending it via bus reachability across the closed bundle would forbid `actor` in any handler for any message a tick can send, which is most of them. Wakes have the same hole and the spec contradicts itself there: l.1078 says a catch-up wake's `say` is *dropped*, implying a live wake's `say` reaches someone, yet a wake has no acting visitor any more than a tick does. Also `on :entered` (l.1114) uses `actor.remember` and would run for an NPC arriving on a tick. Fix: define at runtime that in a turn with no acting visitor `say` is a no-op, `{actor}` renders nothing, and `actor.recall/remember` fault; drop the static tick-body refusal or keep it as a warning.

**"An exit guard that can never be true" — expensive as stated.** *What it warns about* (l.1284). Guards are boolean expressions over bounded integers, enums, 16-element lists and `includes`. Unsatisfiability is decidable (finite domains) but exponential; with nesting 8 and a handful of list properties it is not free per keystroke. Narrow the warning to syntactic cases (`when (false)`, a `==` against an option not in the enum, which is already an error).

**"A `describe` whose only output is an extension effect" — underspecified.** l.1182, 1278. Path-sensitive or syntactic? `if (x) { text a } else { effect }` is empty on one path. Pick syntactic (no `text` anywhere) and say so.

**Disambiguation "between things a visitor could tell apart" — undecidable for the engine.** *Spawning* (l.171). Two spawned `Sheet`s, one `:wet` and one `:cured`, are distinguishable in prose but the engine cannot know which properties an author surfaces. And "any of them will do" must be *deterministic* for replay, which needs a defined contents order — never stated (see below). Also "disambiguation prompts" (l.397) imply a question that spans turns, i.e. state that outlives a turn and is not in the log. Fix: rule = same kind and identical property map are interchangeable, tie-break by contents order; otherwise the command fails with a listing and no pending question.

**Single-definition tier cannot type `self` — contradiction.** *Two tiers* (l.1260 vs 1262). "every expression rooted at `self`" is claimed checkable alone, but `self` is "typed by the composed kind" (l.468) and composition is whole-bundle (l.1262). `cabinet`'s `self.get(:locked)` needs `Warded → Lockable`. State that the per-keystroke tier has the bundle's kind table resident.

**Identifier resolution inside kind bodies — gap.** *Identifiers and scope* (l.366–369). `send oak_door :unlock_attempt` (l.788) appears in a kind-style body. A kind "has no place in the world" (l.193), so which container's scope does `oak_door` resolve in? Only world-level identifiers can be visible from a kind. And l.366's "because" — "range never leaves the container" — is false (objects move; l.106 says range goes outward). Further: an identifier resolves statically but the object may be *out of range* at runtime (the key was carried to the yard). `send` to a resolved-but-unreachable identifier: fault, no-op, or warning? Unstated. Fix: kind bodies see world-scoped identifiers only; runtime out-of-range `send` is a no-op recorded in the transcript.

### Phase ordering

I found no genuine circularity: role types come from `as r for v` sites (syntactic), sender types from `send`/`broadcast` sites, disjointness and the noun set from resolved composition, value-role types from `from` properties. One ordering the spec should state: a value role's type is *per target object* (`topic from :knows` on one kind, `from :moods` on another, l.1700), so slot typing for `ask [target] [topic]` happens *after* target resolution, and a mixed role — narrowed with `from` on one player, played as an object role on another — must be refused at compile time. Neither is said.

### Cost

**Self-rescheduling wakes are an unbounded background loop — expensive.** *Wakes* (l.1070). `on :woke { wake in 1 seconds }` is legal; 2,000 instances doing it is 2,000 serialized turns per second on one world, each with a fresh 50,000-step budget, forever, with nobody present if the host runs wakes while empty. Every turn terminates; the world never does. Fix: a minimum wake interval (60 s is plenty for fiction) and a per-world pending-wake count that the host may refuse beyond.

**Spawns in ticks and wakes have no visitor to charge — gap.** l.1231, 1252, 1356. The per-visitor spawn limit covers typed commands only; `on :woke { spawn X in self; wake in 1 minutes }` fills the 2,000 cap with no one to throttle. Charge actorless spawns to the world with its own rate.

**Absent visitors count against live instances forever — cost.** *Visitors* (l.156). A departed visitor "keeps their state" and their inventory; every visitor a world has ever had, plus what they carried, is live state under the 2,000 cap (l.1232). A popular world fills up with ghosts. Say whether absent visitors' objects count, and if so, that the host may evict.

**Parsing is uncharged — gap.** *Set roles* (l.643) says cost is linear in command length, but each noun resolves against every noun of every object in range, longest-first, and each verb's phrases are tried in turn: O(range × nouns + verbs × phrases) per keystroke for completion. The backlog says "charge parsing too"; the spec's step definition (l.1226: statements and expression nodes) does not include it. Add parse and noun-resolution work to the step count.

**`tell` recipient discovery.** l.1002: recipients are visitors whose nearest `contains actors` ancestor is this place. Without an index that is a walk over every visitor per `tell`. Minor; keep a per-place occupant set.

### Atomicity and ordering

**Contents order is undefined — gap, breaks replay.** `{for thing in self}` (l.954), `each` (l.471), and "any of them will do" (l.171) all depend on the order of a container's contents, which is never defined (list order is, l.456). Replay and prose both require it. State: arrival order, moved-to-end on entry, spawn appends.

**Visitor admission and departure are not in the log — gap, breaks replay.** *The log* (l.1338) lists commands, ticks, wakes, seeds, effects. Joining and leaving cause `:entered`/`:left`, change range, and change parsing (nicknames are nouns, l.413). They must be logged events, and so must nickname assignment. Also unstated: which place a returning visitor rejoins (l.156), what happens if that place was destroyed or its `accept` refuses, and whether re-entry runs consent at all.

**Ticks: one turn per place or one per world? — underspecified, behaviour differs.** *Ticks* (l.1030, 1045) and *Host/Time* (l.1330). If each occupied place is its own tick turn, N places' ticks race for the lock and drop *each other* every interval. If one turn covers all places, one place's handler exhausting the step budget faults and rolls back ambience for every place ("the world is left exactly as it was", l.1200). Pick per-place turns, spaced by the host, with the drop rule applying only against non-tick turns.

**Wakes: drop or queue when the lock is held? And "at most one" is the wrong direction — gap / judgement.** l.1076: "guarantees only that at most one wake per object is delivered". Read literally, zero deliveries satisfies it and the kiln never cools. If the intent is "at most one per object during catch-up, then live", say so; also say whether a wake due while the lock is held waits (it should — it is a process, not ambience, l.1026) and in what order overdue wakes are delivered in a maintenance turn. Without "one per object per catch-up", `wake in 1 seconds` after a year's absence is 31 million catch-up deliveries before admission (l.1332).

**When does the queue drain relative to the effect pass? — underspecified, transcript order differs.** l.783 "the sending body runs to completion, then the queue drains" vs l.1143 "bodies run to completion, then the queue drains". With several `do` bodies in one reading, A-drain-B-drain and A-B-drain produce different narration order. Say which (the latter matches l.1143). Also say whether `changed :p` hooks (l.806) are queued events (charged to the 256, delivered after the body) or run inline; "runs after `self.set`" is ambiguous and "your own state holds still within one body" (l.783) only holds if they are queued.

**Broadcast relay algorithm is ambiguous about the sender's own container — gap.** *Sending* (l.793) vs *Range* (l.106–108). Per l.793 a container "hears it, delivers it to what it holds, carries it into sub-containers that pass it, and — if it passes it outward — on". Delivery to own contents is unconditional in that sentence, so the world's `pass any (false)` (l.55) would gate nothing — a broadcast from place A reaches the world, which delivers to every place. But l.55 and l.112 say the world's rule walls places off. So a container's pass rule must also gate delivery to its own contents when the message arrived from below — which then means a key inside a shut chest cannot reach its siblings, and l.108's exception (self and *own* contents) does not cover siblings. Write the algorithm as pseudocode: where the message entered the container (from above / from below / from self), and which of the three onward directions each entry point gates.

**"The hands carry without hearing" vs visitors with handlers — contradiction.** l.793 vs l.129–141. `Player` declares `on :m` handlers and `as target for tag`; a visitor is "an object" (l.118). If the visitor object does not hear broadcasts it relays, tag-yard designs that broadcast `:round_over` to players do not work. Pick: a visitor is an ordinary container that hears.

**Engine default `accept` reads `:capacity` by name — contradiction.** l.866 vs l.308 ("There are no magic property names"). If the engine's default accept consults `:capacity`, a kind declaring `contains` without it (e.g. `Place`, l.1378) has an undefined default. The stdlib listing already writes `accept` explicitly on `Container` (l.1409); make the engine default `allow` and add an `accept` to `Actor` (l.1383), which as listed has a `:capacity` nothing reads.

**Can the visitor kind write guards? — contradiction.** l.866 "nobody writes the hands' guards" vs l.205 (a kind body may declare consent guards) and l.129 (`Player` is an authored kind). Say whether `Player`'s `accept` runs for `give`.

**Rollback scope on fault — unstated but implied.** l.1200, 1344. Scheduled wakes, spawns, link connects and recorded effects from a faulted turn must all be discarded. Also per-object state outside the "flat map" — pending wake, link destinations — exists (l.1070, 767) despite l.254 saying the flat map *is* the persisted format; the store needs runtime object ids for spawned instances and link targets, never mentioned, and the log needs them for replay across a republish (which bundle version each event ran under is not recorded, l.1338).

**Republish under live state — gap.** l.1256 "rebuilt from source every time a world loads"; l.189 an absent file "reads as absent". What happens to instances of a kind whose file is absent, objects declared in it, or a visitor standing in an absent place? Say: instances of an absent kind are inert (no handlers, no nouns) and keep their state; an absent place is a locked door for `go` and its occupants are moved to the world's entry place with a notice.

### Underspecification an implementer must resolve

- **`say` in `describe`** — l.1273 refuses `say` in `describe`; l.78, 1121, 1498 all write `describe { say arrival }`; l.201 uses `text`. Contradiction; pick `text`.
- **`spawn` as an expression** — l.753 `let cell = spawn …` vs l.522 "an initializer is an expression, a `let` cannot write … which is why it is allowed everywhere". Either `let` in `permit`/`describe` must forbid `spawn` initializers, or `spawn` is a statement with a binding form.
- **`examine` is reserved (l.779) and declared as a message (l.912).**
- **`Lockable` has a `pass any` at l.326 and none at l.1434**, yet l.1535 and l.1698 rely on the collision.
- **`each … in X` — direct contents or range through X?** l.104 ("walk with `each`" as one of range's three uses) vs l.973 ("walks contents").
- **Passages under composition** are missing from the member table (l.211–223) though `refuse immovable` (l.1391) depends on composer-replaces-library resolution (l.1685) — the one virtually-dispatched member in the language, and never named as such.
- **Integer default range** — `elapsed > 7200` (l.1664), `adjust(:since_gust, elapsed)` (l.1034): what is an unannotated integer's range, and `elapsed`'s?
- **`self.count` on a container** (l.870, 944) is used but the check table (l.494–497) types `count` only on sets.
- **Nickname collision against phrase literals and directions** (l.405–413): a nickname "With" or "North" is not a noun token and is accepted, then breaks `unlock door with with`. Exclude every phrase literal, direction, article and connector.
- **`spawn K in <target>` and `accept`** (l.169): does the destination's `accept` run for a spawn into a full container? For `spawn Cup in actor` with hands at capacity, nothing says.
- **"objects bound by one set role: 8"** sits under static caps (l.1211) but is a runtime property of what the visitor typed.
- **"request", "turn", "action"** are used as three budget scopes (l.1226–1231) without definition; say they are one thing, and whether a poll is one.

### Where I found little

Composition resolution (diamonds, first-appearance order, exclusive-member collisions) is fully decidable and cheap in a closed bundle; the property-merge-by-origin rule is well specified. The step budget as the primary bound is right and implementable in the evaluator. The nickname-against-noun-set check is a lookup as claimed. Static linking makes every whole-bundle check exact; the spec's confidence there is warranted.
