# Sprout design spec — Reviewer 5: Engineer ergonomics

Target: `/home/eslinger/code/sprout/docs/design/sprout-design-spec.md` (line numbers are from `cat -n` of that file). The build backlog was read for order; the working notes for context only. Where the notes already list something as an open hole (`describe`/`examine`, the `:remembers` syntax, NPCs) I do not repeat it.

## The shape I would build

So the findings have something to push against:

- **Parser** → per-file AST with spans, lenient (a file that fails yields an `absent` marker, not a crash).
- **Linker** → closed bundle: kinds, enums, verbs, extensions, files; composition flattened per kind into member tables (properties by origin, handler lists, guard lists, role lists, one `describe`, one pass table); noun table; grammar table; the "who can fill role R of verb V" table; the kind-disjointness matrix.
- **Checker** → nominal types over the flattened tables; purity classes per body (describe / guard / permit / tick / ordinary); chance-reachability over passages.
- **Runtime store** (per world) → an *instance table*: `{id, kinds, props: flat map, parent: id | none, links: {dir → id}, pendingWake: {due, requestedAt} | none, lastTick}`; a *visitor table*: `{visitId, nickname, instanceId}`; a *memory table* keyed `(instanceId, visitId) → flat map`.
- **Evaluator** → a turn is `{kind: command | tick | wake | maintenance, visitor?, text?, seed, elapsed?}` run inside a transaction over a copy of the store; a step counter; a BFS message queue where each entry carries its cascade depth; the three-guard poll; a range walker; a passage renderer; the output collector keyed by recipient.
- **Poll** → a read-only evaluation that returns `{description, exits, affordances}` for one visitor, no transaction, no log entry.
- **Host boundary** → turn in, `{lines per recipient, effects, spawn count, wake schedule, fault?}` out; plus the compiled noun set and the tokenizer.

The spec fights this shape in the places below.

---

## The three findings that matter most

### 1. Two verb mechanisms are both still in the spec — **contradiction**

*Verbs and the grammar a visitor types* (lines 544–566) is unambiguous: "Verbs are declared by a world or exported by a library, never by an object", "Object-level grammar is about nouns … World-level grammar is about verbs. Neither reaches into the other." A verb is roles plus phrases; an object plays a role with `as <role> for <verb>`.

Yet the spec's own examples keep an object-level verb mechanism alive: `throw { grammar "throw [self]" … }` (line 163), `examine { grammar "look into [self]" … }` (line 912), `pull { grammar "pull [self]" … }` (line 992), `fire { grammar "fire [self]" … }` (line 1057), and typed message arguments `dip (into: sprout.Container)` / `throw (tools: {ericworld.ThrowingTool})` (lines 469–470, 506). The misplaced paragraph at line 1370 talks about `"unlock [on] with [self]"` phrases whose "slots must match the arguments of the message it points at". The reserved-names list (line 779) and the composition table's "a message — refuse" (line 222) also only make sense if named messages with grammar are members.

For the implementer this is the difference between one grammar table and two, and between one callable surface (verb → roles → `permit`/`do`) and three (that, plus grammar-bearing messages with typed argument lists, plus `on :m` handlers). It also decides whether `[self]` is a slot syntax the parser must support, and whether a message body can `refuse` (the `throw` example at line 506 has neither `permit` nor `do`, so where does refusal go?).

**Change:** delete the object-level `grammar "…"` message form and typed message argument lists everywhere, and rewrite the four examples as verbs with roles. Say explicitly that `on :m` handlers are the only named bodies besides roles, guards, hooks and `describe`. If `examine` is to remain engine-sent, say what it takes.

### 2. The persisted state is not "one flat map per object", and the engine has no stable identity to key it by — **gap** (with a contradiction inside it)

*Properties merge; they never shadow* (line 254): "State is one flat map per object, and that map is both the persisted format and what a moderator reads." *Storage* (line 1344): "The host persists each object's state as the flat property map." *Object identity* (line 530): "Nothing in state points at an object."

What the rest of the spec requires the runtime to persist, none of it a property:

- the containment parent of every object (line 57: "the containment tree is the one piece of state no object owns" — but it is state, and it must be stored);
- the destination of every `link` (line 763 — a stored object reference by any other name, exactly what line 530 says does not exist);
- the pending wake and its request time (line 1070, 1072);
- the last-tick time per place (line 1047, `elapsed` is "since the last tick this place actually received");
- per-visitor `:remembers` values (line 534), keyed by *object and visit*, which are not in any object's map;
- a visitor's "no container while away" state and where they rejoin (line 156).

To key any of that the store needs a stable instance id. The spec gives source objects a container-scoped identifier (line 369) and spawned objects none (line 171). Neither works as a persistence key: two `key` objects declared in two chests can end up in the same chest after a move, and a spawned Sheet has nothing to be keyed by at all. So the engine must mint ids — fine — but then the spec must say how a *source-declared* object is re-associated with its stored state when the world reloads (line 1256: "rebuilt from source every time a world loads"). If the answer is "by declared path", renaming `composing_room` or moving its declaration into another container silently orphans its state, its contents, and every visitor standing in it. If the answer is "by a persisted path→id map", say so.

Two consequences the spec also leaves open:

- **No entry point.** Nothing declares where a visitor appears on first entry. The world in every example declares `contains`, not `contains actors`, so a visitor placed at the root has no place, hears no `tell`, receives no tick, and `go` has no exit to start from. Line 156 says a returning visitor "rejoin[s] a place" without saying which, and whether entry runs the consent poll (`accept` on the place) and sends `:entered`.
- **Lenient loading has no reference-site semantics.** Line 189 / 1268: a broken file "reads as absent; what referred to it keeps compiling". But `object brass_key: Key` referencing an absent `Key` is an "unknown kind" refusal (line 1279). Define what `absent` means at each site: an object composing an absent kind (drop the object? drop the member?), a role for an absent verb, an exit to an absent place, a stored instance of an absent kind, contents of an absent container, and a visitor whose place is absent. Until then "the rest of the world keeps running" is not implementable.

**Change:** replace the "flat map is the persisted format" sentence with an actual state model (the instance table above), say that the engine mints ids and how source objects are re-bound on reload, add a `visitors enter at <place>` (or equivalent) declaration to the world, and write an "absent" table with one row per reference kind.

### 3. Actor-less turns reach actor-using code, and the static rule only covers the tick handler — **gap**

*Other people* (line 1008): "A tick has no acting visitor, so `say` has nobody to speak to and `{actor}` has nothing to render. Both are refused in a tick handler." Line 1704 repeats it.

But a tick handler may `broadcast :gust` (line 1038), and `on :gust { say "…" }` is a perfectly legal handler on some other object, written for the case where a visitor caused the gust. The same handler runs in a tick turn, a wake turn, or a maintenance turn. Likewise: a `:woke` handler that `destroy self`s drops its contents to the container, which receives `:entered` (line 889), whose handler in every example calls `actor.remember` (line 1116, 1502). `{actor}` in a passage invoked from any of those. `actor.recall` in a hook fired by a wake's `self.set`. None of this is a `:tick` handler, so the compile-time refusal cannot catch it, and the spec says nothing about what the evaluator does when `say`, `{actor}`, `actor.recall` or `actor.remember` execute with no actor bound.

Options, each with a cost: (a) fault the turn — then a wake that destroys a crate in a room whose `:entered` touches `actor` faults *every time*, and per the next finding a faulting wake is re-delivered forever; (b) silently drop `say`/`{actor}`/`remember` and have `recall` return the default — deterministic, cheap, but `actor.recall` returning a default in a world that wrote "the first visitor" logic is a silent lie; (c) make `actor` a typed-where-bound binding that is simply *not in scope* in bodies reachable from tick/wake, computed by the same whole-bundle reachability the spec already uses for `chance` (line 1137). (c) is the only one consistent with "every binding is typed where it is bound", and it also forces `:entered`-style handlers to test `item.is(sprout.Actor)` and use `item` rather than `actor`, which is what they should do anyway.

**Change:** pick (c), state that `actor` is unbound in any body reachable from `:tick`, `:woke`, `:spawned`, or a move caused by `destroy`, and that the compiler refuses references to it there; state (b) as the runtime behaviour for whatever the reachability misses.

---

## Everything else

### Types and bindings

**Untyped roles are not typed where they are bound — contradiction.** Line 32/464: "every binding's type is known where it is bound." Line 565: "Left open, a role is filled by anything that declares it." Then in `Warded` (line 1523) `tool.get(:opens)` where `tool` is the *untyped* `role tool` of `sprout.unlock` (line 1430). The only way that checks is if `tool`'s type is the intersection of the property sets of every kind in the bundle declaring `as tool for unlock` — a whole-bundle computation, and one that changes whenever anyone adds a role-player. A library kind whose `permit` reads a role property can be broken by a world that adds a second tool kind lacking that property; the diagnostic would land in vendored library source. Worse, line 1700 says the same role can be a *value* role on one player (`topic from :knows`) — so whether `topic` is an object or a symbol is decided per object, not per verb, and the parser needs a per-object, per-verb, per-role kind-or-value table. **Change:** roles declare their shape at the verb — `role tool: Kind`, `role topic: enum`, `role n: integer` — and `from` on a player only narrows. A stdlib verb wanting a world enum declares `role topic: enum` and the player's `from` supplies which. That keeps the parser's reading shape fixed per verb.

**Integer ranges in expressions — gap.** Line 37 promises "bounded integers"; properties carry `min`/`max`; but `actor.recall(:visits) + 1` (line 1116), `elapsed > 7200` (line 1664), `random(6)`, and `let` results have no stated range or overflow behaviour. Say: expression integers are 32-bit (or whatever), overflow is a fault, `elapsed` has a declared range, and `set` of an out-of-range integer into a ranged property is a compile error where the range is static and a fault (or clamp — pick one; `adjust` clamps, `set` is unsaid) where it is not.

**Which literals are prose — gap.** `say "…"` and `tell "…"` carry slots and `{one of}` (lines 996, 1587). `refuse "…"` presumably too (line 1391 takes a passage). `name "…"`, `nouns "…"`, exit labels and string *values* (`self.set(:note, "…")`, `{actor.recall(:note)}` "the string as written", line 946) presumably not. The parser needs the list. Also `{{` is the literal brace in passages (line 938) — is it in `say` strings too, and is `{` legal in a string value?

**`changed` hooks: inline or queued, and coalesced or not — gap.** Line 806: "runs after `self.set` actually changed the value." Line 783: "within one body your own state holds still." If a body sets `:lit` true then false, do two hooks queue with two `was` values, one, or none? If the hook runs inline it violates the still-state invariant; if queued, the body's later `get` sees the new value while the hook has not run. Say "queued, one per actual change, `was` captured at the change", and test it.

**`let` cost (line 524) and the step budget** are both fine, but "every expression node evaluated" (line 1226) means a `let` costs *more* nodes, not fewer, unless the charge model is stated. Define the tariff (statement 1, node 1, range step 1, queue pop 1, passage line 1) in the spec since it is the determinism-bearing limit and authors will write to it.

### The runtime, transactions and the queue

**Faulting ticks and wakes have no defined disposition — gap.** Line 1200: on a fault "the turn is abandoned, the world is left exactly as it was, and the visitor is told plainly." A wake turn has no visitor. Abandoning the transaction restores the *pending wake*, which is then due, which fires again, which faults again — an infinite loop billed to the host. Same for a tick that faults every interval and for a maintenance turn that faults "before the arriving visitor is admitted" (line 1332), which locks everyone out of the world. **Change:** a faulting wake is consumed, not restored (the object's wake is cleared and the fault logged); a faulting tick is dropped; a faulting maintenance turn admits the visitor anyway with the catch-up abandoned.

**Runtime failures the spec does not name.** For each I would need a decision on transaction / queue / screen:

- `send oak_door :m` when `oak_door` is out of range *now* (range is dynamic, the identifier is static, line 788). Fault, or silent drop? Silent drop matches "no return channel"; say so.
- A queued message whose target was destroyed earlier in the same drain. Drop, presumably.
- `destroy self` followed by statements in the same body that read `self`.
- `spawn K in t` where `t` does not declare `contains` (compile-time), is at `:capacity` (runtime — does spawn respect the engine's default `accept`? line 169 says no consent), or is out of range. And `spawn` in a `permit` (refused — fine) or in `describe` (should be, unlisted at line 1273 — "spawn" is listed; fine).
- A move that would create a containment cycle (`put box in box`, `put chest in key` when the key is in the chest). Nothing in the consent protocol prevents it and the tree walker would loop. This must be an engine refusal *before* the poll, with engine text.
- A `go` whose destination refuses (`accept` on the place) — which is fine — but also `go` from a place whose exit target is a non-place (a compile error? the spec says exits are only *declared* on places, not that they only *lead* to places).
- `random(0)` is excluded by "positive literal"; `chance(150)`? Clamp or refuse.
- `:capacity` of a visitor kind that does not declare `contains` (`visitors are Ghost`) — `take` has nowhere to put things. Make `contains` on the visitor kind a compile rule.
- A refused reading (first `permit` refusal): is it logged? It writes nothing, but moderation wants "what the player tried". Say it is logged as a turn with no state delta.

**Effect-pass interleaving — gap.** Line 603: "The effect pass runs every `do`." Each `do` is a body; line 783 says the queue drains after a body. Does it drain after *each* `do` or after *all*? Decides whether the target's `do` observes state written by handlers the tool's `do` triggered. Pick "after all `do`s, then drain" (matches "the reading" being one action) and test it.

**Spawn cap: "per action" vs "per request" vs "per turn" — gap.** Lines 1226–1231 use all three words. A `go` that triggers `:entered` handlers that spawn — is that one action? Use one word and define it as the turn.

**Ticks: one turn per occupied place, or one turn per world — gap.** Line 1030 says each occupied place "receives `:tick`"; line 1045 says "a tick is a turn". If one turn per place, the step budget is per place and the log has N entries per interval; if one turn per world, a busy world's ambience shares one budget. The log format and the `elapsed` bookkeeping differ. Say which.

### Purity rules that are static in name but dynamic in fact

**`say` inside `describe` is both used and refused — contradiction.** Line 1273 refuses "`say`, `tell`, or any write … in `describe`"; lines 78, 1121, 1498 all write `describe { say arrival }`, and line 201 uses `text`. Pick `text` (or make `say` legal in `describe` and refuse only `tell`), and make the reachable-passage check the same for both.

**`chance` reachability through `{item.greeting}` — testable but expensive.** Line 1137: "the compiler checks reachability across the closed bundle." `{item.greeting}` where `item` is a `for` variable over a container's contents is typed only as "anything that could be in this container", i.e. every kind in the bundle (there is no container element type). So the reachable set of passages from any `describe` that lists contents is *all passages named `greeting` on any kind*. The check is sound only by being very conservative; a single `{one of}` in any `greeting` anywhere refuses every `describe` that loops over contents. Either accept that and say it, or drop cross-object passage invocation from `describe`.

**`tell` "dropped during catch-up" (line 1006, 1078)** is a runtime flag on the turn, not a language rule — the evaluator needs `turn.kind == maintenance` from the host. Add it to the turn request shape.

### The host interface, as an interface

Line 1316 chooses obligations over an interface. As the person on the other side of the seam I need at least these shapes stated, since each is a test fixture:

- **Turn request:** kind, visit id, raw text, seed, `elapsed` (for tick/wake), maintenance flag, and *which object* is being woken (a wake is per object, so the request names one).
- **Turn result:** lines per recipient (visit id → ordered lines), effects, state delta or new store, wake schedule delta, spawn count (for the per-visitor limiter, line 1356), fault or refusal with its text and the recipient.
- **Poll:** what a client calls to render a place. Line 710 ("evaluated on every poll") and line 899 ("re-run on every poll") name it; nothing defines it. It must return the description, the applicable exits, and the affordance table (verbs whose roles are fillable in range, with value-role options narrowed per object — line 680). It reads state, so it needs the lock or a snapshot; it costs steps but is not a request, so it has no budget (line 1226 says "per request"); it is not logged. Say: a poll is a read-only evaluation against the last committed state, with its own step budget, never logged, never emitting effects.
- **Effects from `describe`.** Line 1182 implies an extension statement can appear in `describe` ("A `describe` whose only output is an effect"); line 1162 says effects are "appended to the turn's outcome". A poll is not a turn. Where does a describe-time effect go? Either forbid extension statements in `describe`, or define poll output as carrying effects.
- **Rendered prose vs effects.** Line 1340: "The log stores effects, not rendered output. Rendering happens at read time." Prose cannot be rendered at read time — a passage evaluated against later state gives different text, and nicknames may have changed. So `say`/`tell` lines must be rendered at turn time and stored as text (with a per-recipient key). The sentence should say "the log stores rendered lines and structured effects; *effects* are rendered per client."
- **The tokenizer.** Nickname admission (line 1322) checks "any token of any noun". The host needs the same case-folding, punctuation and Unicode rules the parser uses. Either the compiled noun set ships pre-tokenized and the host tokenizes candidates with a function the language package exports, or the check is done by the language. Say which.
- **Log completeness for the determinism claim.** Line 21 and 1338 say replaying the log reproduces the world. It only does if the log also carries: visitor entry and exit (they change range and the tree), nickname admissions (they change noun resolution), bundle publishes (source edits change everything; line 1344 says mismatched stored values are dropped on load, which is a state change replay must reproduce), and moderation withholdings (a withheld file changes behaviour mid-log). Add these event kinds, and say the log pins a bundle hash per segment.

### Complexity that buys little

- **Order-free slot binding by kind disjointness (line 621).** Computing "nothing in the bundle composes both" across visitors' kind and every spawnable kind, and then explaining to an author why `throw a and b` bound the way it did, costs a table and a diagnostic for a benefit the spec itself says is mostly already given by connector words. Position decides; drop the disjointness rule.
- **"An exit guard that can never be true" warning (line 1284).** Requires constant folding at best and is undecidable in general. Say "a guard that is the literal `false`" or drop it.
- **`{n:mouse/mice}` and `{self.count:pots}` (line 945).** A pluralization mini-language inside slots, English-only, for a language whose thesis is "the author supplies the sentence". `{if self.count == 1}one pot{else}{self.count} pots{/if}` already works. Drop it.
- **Language levels from day one (line 1306).** "Refusals introduced later apply as warnings" means every diagnostic carries the level that introduced it, and the parser keeps every superseded syntax alive. It is the right long-term mechanism, but the spec should say it starts at level 1 with no downgrade table, so the first implementation does not build the machinery.
- **Three budgets where one holds (line 1226–1229).** Events and cascade depth are both bounded by steps if a queue pop costs a step and depth is capped by the 8-deep nesting × queue. The spec says steps are "the one that matters"; keep the event cap as a step tariff rather than a separate counter and fault message.

### What breaks under change

- **Property names are persistence keys (line 254).** Renaming `:state` to `:drying` loses every Sheet's state; line 1344 confirms it is dropped. Say it plainly in the authoring docs, and consider logging a `rename` in the bundle so the host can migrate.
- **Source identifiers as state keys** (finding 2). Every rename of an object or a container path orphans state unless the engine keeps an id map.
- **The noun set as a nickname invariant (line 407, 1322).** Adding an object called `marta` to a running world invalidates a visitor named Marta whose reservation is "soft" — what happens to her stored visit state and the `:remembers` entries keyed to it? Say the visit id survives a rename, and the nickname is what is re-negotiated.
- **Property merge by origin (line 256).** Any published world that later composes a new library kind declaring a property it already has must restate it. Acknowledged at line 266; the practical effect is that the standard library can never add a property to an existing kind without every composer re-publishing. That is a reason to keep stdlib properties few, which the spec says, but also a reason the spec should allow `use :open from sprout.Container` for properties as it does for members (line 230 shows `use` for members only).
- **Engine default reads `:capacity` — contradiction with "no magic property names" (line 308).** Line 866: "a container … accepts what fits within `:capacity`." That is an engine-known name. Either the engine's default `accept` is simply `allow` and every container kind (including `sprout.Actor`, line 1383, which currently relies on the default) writes its own, or `:capacity` is admitted as the one structural property beside `contains`. The former keeps the promise and costs the stdlib two lines.
- **Pickpocketing by default — judgement.** `sprout.Actor` declares `contains` and no pass rule (line 1383), and "no rule means no policy" (line 842) — so every visitor's inventory is in every other visitor's range, `take key` resolves into Marta's pockets, and the hands' `release` defaults to allow (line 866). Give `Actor` a `pass any (false)` — its own contents are still reachable to it by the self-and-contents rule (line 108) — or state that this is intended.
- **`Lockable` differs between line 324 and line 1434** (one has a pass rule, one does not), and the cabinet comment at line 1535 and the claim at line 1698 depend on the version with one. Also `Press` (line 1630) is never declared and `:names [...]` (line 199), `{thing.short}` (line 969) are pre-grammar-block leftovers. Small, but a model reading this spec as its reference will reproduce them.

### Testability, briefly

Rules I can see no test for as written: "an exit guard that can never be true"; disjointness-based order freedom (no oracle for "the bundle composes both"); "disambiguation is only needed between things a visitor could tell apart" (line 171 — what makes two objects indistinguishable? same kind and name, or same state? and when two Sheets answer to `sheet` and one is wet, does the engine pick deterministically by containment order and let the wet one refuse, or try each?); the diamond rule at line 228 (testable — but write the canonical example with expected order in the spec); the "first refusal in run order" (line 236) across composed guards *and* the three roles — write the full order as one list: thing's guards in composition order, then source's, then destination's. Everything else has an oracle once the tariff, the queue drain point and the hook semantics above are fixed.
