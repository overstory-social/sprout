# Sprout — build backlog

2026-09-20 · @Someone

What needs doing, in the order it needs doing. Each item names what it changes and what it blocks; the argument for any item is in the working notes, and the end state is in the design spec.

## Before any code

Sprout is unreleased, so nothing here is sequenced by compatibility. The only ordering that matters is dependency.

**The design gate is closed.** All six items that had to be settled before implementation have been, and three of them went the opposite way from where they started — type parameters, stateful text alternatives and stored object references were all decided against, each because a decision made for other reasons already covered the case. Roles covered type parameters; purity and `:remembers` covered alternatives; write-only links covered topology.

The 2026-09-20 reviews (`2026-09-20-reviews/`) reopened it, and the spec was revised against them the same day: the actor model, `act`, `move`, `mover`, message declarations, the poll as a turn, the built-ins as library verbs, and every limit as a host default. What remains unsettled is smaller and none of it blocks a start: which side of a verb should carry knowledge of the other by convention, and the register of the standard library's stock lines. Each can be decided against a real implementation rather than ahead of one.

## The backlog

Ordered by dependency, and numbered so the order is discoverable: an item's number is its place in the sequence, and each names the items it depends on. Sizes are rough and unvalidated. Each item is also a GitHub issue carrying the same number in its title, and the tracking issue lists them in this order; work an item only when everything it depends on is closed.

Every item names the sections of the design spec it implements. The spec is the end state; where an item and the spec disagree, the spec wins and the item is wrong.

### 0 — Foundations

| # | item | depends on | spec | size |
| --- | --- | --- | --- | --- |
| B01 | Position spans on every AST node, so every diagnostic names a line and column | — | The compiler › Diagnostics | M |
| B02 | Runtime budgets as host configuration with the spec's defaults: steps (parsing, range walks and `each` charged), output per recipient, events, cascade depth, passage depth, spawns per turn, wake floor, poll steps, wall-clock backstop | — | Limits | M |
| B03 | Closed-bundle compile: vendored libraries, content hashing, whole-bundle checking, and the bundle artifact carrying the word set, level, pinned extensions, library hashes and the caps checked against | B01 | Kinds › Libraries and namespaces; The compiler › Two tiers, What compiling produces | L |
| B04 | Strict publish and lenient load: any problem refuses at publish; at load a broken or withheld file reads as absent with exactly the behaviour in the absent table, and stored state for absent objects is kept | B03 | The compiler › Strict and lenient, What absent means | M |

### 1 — The type system

| # | item | depends on | spec | size |
| --- | --- | --- | --- | --- |
| B05 | Enums as library-exportable declarations; option literals checked against the operand's enum; humanised spelling on input and output | B03 | Properties › Enums | S |
| B06 | Property declarations: type from literal or written, `default`, integer `min`/`max` and the default range, the five value types, `:remembers` in the same syntax | B05 | Properties › The types, Declaring a property, Per-actor memory | S |
| B07 | Message declarations with an optional carried type; sending or handling an undeclared message is a refusal | B05 | Events › Declaring a message | S |
| B08 | Typed bindings, exactly as the table: `self`, `actor` as the visitor kind, `here`, `mover`, roles by kind or value type or the bare object type, set roles, `from`-narrowed roles, `each` and `{for}` variables by kind filter, handler senders as objects, handler values by declaration, `was`, `elapsed`, `let` | B03 B05 B06 B07 | Properties › Where types come from | M |
| B09 | Expression checking: the checker table in full, `is()` narrowing as the only read through the object type, `holds`, `count`, `includes`, memory `recall`/`remember`/`adjust`, literal range checks, no truthiness or coercion | B08 | Properties › What the compiler checks | M |
| B10 | Lists: ordered, no duplicates, `add`/`remove`/`includes`/`count`, host-capped, full-list fault | B06 | Properties › Lists | S |
| B11 | `let`: single assignment, no shadowing, allowed wherever an expression is, `let x = spawn …` only where `spawn` is | B09 | Properties › Naming a value | S |

### 2 — The world model

| # | item | depends on | spec | size |
| --- | --- | --- | --- | --- |
| B12 | The world root: one tree, world properties, `pass any (false)` unless written, `visitors are`, `visitors arrive at`, the world composing kinds, `sprout.World` written on every one | B03 | The world model; Places | M |
| B13 | `contains` and `contains actors` as declared capabilities; a place is whatever declares the latter; exits only on places | B12 | The world model › Places; Containment is a declaration | S |
| B14 | Identifier scope: an identifier belongs to its container and is visible from inside it at any depth, nearest wins; dotted paths for exits; compile-time resolution with run-time range | B12 | Names › Identifiers and scope | M |
| B15 | Range: self, own contents, the surface of the own container, then outward through pass rules crossing into sub-containers that pass; charged to steps | B13 B02 | The world model › Range | M |
| B16 | Instance ids and the persisted state model: declared-path ids, minted ids for spawns, container, link destinations, pending wake, per-actor memory, last tick per place, visitor records; a stored value that no longer fits its type falls to the default | B12 | The runtime › State | M |
| B17 | Actors: `sprout.Actor` with its guards (`mover == self`) and `pass any (false)`; the visitor kind; NPCs as objects composing it; the per-world visitor store; per-actor memory keyed by actor id | B13 B16 | The world model › Actors and visitors, What a world may know | L |
| B18 | Spawning and destroying: `spawn` as statement and binding, `:spawned`, no consent but `:entered`; `destroy self` at body end with contents falling, bindings readable to turn end, queued messages dropped, place-with-visitor fault; the spawn cap per turn; a `spawn` faults when the host will not hold another instance | B17 | The world model › Spawning, Destroying | M |

### 3 — Kinds and composition

| # | item | depends on | spec | size |
| --- | --- | --- | --- | --- |
| B19 | Composition: the member table, the four rules, the diamond rule, all-run ordering, exclusive collisions refused, property merge by origin with restatement, `without`, composer's own replaces | B03 | Kinds › How members combine, Consent under composition, Suppressing, Properties merge | L |
| B20 | `default` passages: yield to any non-default source without collision; two defaults collide | B19 | Kinds › How members combine; Prose does not compose | S |
| B21 | Library namespacing: `sprout` unqualified, world shadowing with a warning, kinds/enums/verbs/messages namespaced and properties not, blessed hashes exempt from caps | B03 B19 | Kinds › Libraries and namespaces | M |

### 4 — Verbs, grammar and prose

| # | item | depends on | spec | size |
| --- | --- | --- | --- | --- |
| B22 | The consent protocol: `depart`/`release`/`accept` in order with `mover` bound, allow on fall-through, engine allows where unwritten, containment-cycle refusal, the single write, `:left`/`:entered`/`:moved`, and the `leaves`/`arrives`/description notices for actors moving between places | B17 B19 | Movement and consent | M |
| B23 | World-level `verb`: roles by kind, `symbol`, `integer`, open, `many`; phrases; a verb with no phrases; reserved names | B08 | Verbs › Declaring a verb, Set roles, Value roles, Reserved names | L |
| B24 | `as <role> for <verb>` and `as actor for <verb>`: the consent pass and the effect pass in declared order, first refusal as the whole output, roles composing, `from` narrowing, `nothing_happens` when nothing was said to the actor | B22 B23 | Verbs › Playing a role, The actor's own part, The two passes, Roles compose, A role-player narrows | L |
| B25 | `move x to c`: the guards inline with `mover`, refusal said to the actor if any, allowed contexts | B24 | Verbs › Moving something | M |
| B26 | `act <verb> (role: binding, …)`: a reading run inline with `self` as actor, legal only where `self` composes the visitor kind, counted against cascade depth | B24 | Verbs › Acting | M |
| B27 | The parser: grammar blocks (`name`, `article`, `nouns`, defaults, no leading article), optional articles and determiners, longest-first nouns and nicknames, positional slots, set-role runs on `and` and commas, value-role options per target, engine verbs with library phrases, directions with abbreviations and labels as aliases, disambiguation by kind and name then `which` with a re-submitted command, parse charged to steps, `unknown` and `unreachable` answers | B23 B15 | Names › Addressing and display, Articles, Nicknames; Verbs › Slots, Set roles, Engine verbs | L |
| B28 | Exits, conditional exits with `when`, `link` and `connect`, dotted destinations, unset and absent links not applying, `go` as an engine verb proposing a move | B27 B22 | Verbs › Exits, An exit may be conditional, Places inside places, Links | M |
| B29 | Passages and `.prose` files: the slot table, `{for}` over contents, kind-filtered contents, lists and set roles, `{if}` conditions, reflow and paragraphs, the escapes of quoted text with `\{` as the literal brace, strings as one-line passages, a passage using the invoking body's bindings checked by reachability, second-person rendering of the recipient, line capitalisation | B09 | Prose › Passages, Slots, Conditionals and loops, Bounds | L |
| B30 | The three audiences: `say`, `tell`, `tell <x>`, `text`; where `actor` and `here` are bound; participants excluded from bystanders; the refusals in the compiler's list; the no-`say` warning | B29 B24 | Prose; Other people › Who hears it | M |
| B31 | `describe` and the engine verbs `look`, `examine`, `inventory`, `wait`, `help`; `unremarkable` for an object with no description; a `describe` with no `text` refused | B29 | Prose; Verbs › Engine verbs | M |
| B32 | Events: `send` to an identifier or binding, the broadcast algorithm, `pass :m` and `pass any`, breadth-first drain after the effect pass, `changed` hooks queued once per change, event and cascade budgets, the unsent/unhandled warnings | B15 B07 | Events, messages and the bus | M |
| B33 | Chance: `{one of}`, `chance`, `random`, the per-turn seed in the log, refusal in `describe`/`when`/guards/`permit` with exact reachability through typed slots | B29 B34 | Chance | M |

### 5 — Time and the runtime

| # | item | depends on | spec | size |
| --- | --- | --- | --- | --- |
| B34 | Turns: the five kinds, the write lock and transaction, the fixed order within a command turn, faults abandoning the transaction | B24 B32 | The runtime › Turns, Faults | L |
| B35 | Ticks: one turn per occupied place, skip rather than queue, `elapsed` folding skipped intervals, faulting tick dropped | B34 | Time › Ticks | M |
| B36 | Wakes: `wake in`, the host floor, one pending per object, consumed on fault; absence and the maintenance turn delivering one wake per object oldest first with `tell` dropped | B34 | Time › Wakes, Absence; Host › Time | M |
| B37 | The poll as a read-only turn and the view: snapshot isolation, own step budget, no seed, no log; description, exits, occupants, inventory, every buildable reading with its consent-pass result and value-role options; caching by world version; `unseen` on fault | B34 B31 B27 | The runtime › Turns, The view | L |
| B38 | Effects: the enumerated kinds with source, actor and recipient, rendered lines stored | B30 | The runtime › Effects | M |
| B39 | Cost that scales with people: per-recipient output, occupancy cap, tick cost following occupied places | B34 B02 | Limits › Cost that scales with people | S |

### 6 — The host

| # | item | depends on | spec | size |
| --- | --- | --- | --- | --- |
| B40 | The event log: every write turn with inputs and seed, entries, exits, nicknames, publishes with bundle hash, withholdings, effects; replay across republish | B34 | The runtime › The log; Host › What the host may not do | L |
| B41 | Nickname admission against the bundle's word set (nouns, tokens, directions, articles, connectors, phrase words, other nicknames), moderation, length cap, soft reservations, re-asking after a republish | B27 | Names › Nicknames; Host › Admission and identity | M |
| B42 | Arrival: `visitors arrive at`, last place if it still exists and accepts, entry as a move with `accept`, `:entered`, `arrives` and the description; `displaced` for an absent place | B17 B22 | Host › Admission; The compiler › What absent means | S |
| B43 | Host limit configuration: every number in Limits settable, recorded caps honoured or refused at load | B02 B03 | Limits; Host › Enforcement | S |
| B44 | Blessed-library hash set; exemption granted at publish and recorded in the bundle | B21 | Host › Two decisions | S |
| B45 | Extensions: value types with equality and rendering declared, statements with a describe-allowed flag, effect schema, transcript line, major-version pin, `missing` notice on entry | B38 | Extensions | M |
| B46 | Conversation between visitors as a host feature beside the world, never in the log | B38 | Other people › Talking to each other; Host › Conversation | M |
| B47 | Client capability negotiation and effect rendering, including a screen-reader client driven by effect kinds | B38 | Extensions › Effects are additive; The runtime › Effects | M |

### 7 — The standard library and tooling

| # | item | depends on | spec | size |
| --- | --- | --- | --- | --- |
| B48 | The standard library in Sprout: `World` and its stock lines, the engine verbs' phrases, `Place`, `Actor` with `take`/`drop`/`put`/`give` and its passages, `Fixture`, `Container`, `Lockable`, `ask`; every stock line `default` | B24 B25 B20 B31 | A worked microworld › The standard library it needs | L |
| B49 | The worked microworld as a fixture: compiles, and every chain in it is playable end to end | B48 B37 | A worked microworld | M |
| B50 | Diagnostics: line and column on the token, messages for non-programmers that say what to write instead, the warning list | B01 B09 | The compiler › Diagnostics, What it warns about | M |
| B51 | `sprout parse` and a view inspector: what a world accepts, and what a visitor would be offered where they stand | B37 | — (working notes: Not language questions, but blocking) | M |
| B52 | An author-facing test format | B49 | — (working notes) | M |
| B53 | The generated skill from the compiler's own tables, ordered for an author | B48 | The compiler › The generated skill | S |

## Deferred

Parked deliberately, with what brings each one back.

### Federation and border crossing

**Parked** because it is a design area in its own right, not a feature. **Comes back** once the item model and the movement protocol are settled in the spec, since the crossing manifest can only be expressed in terms of them.

What was settled before parking, so it is not re-derived:

- **Nothing executes across a boundary.** Sprout's safety story rests on the evaluator only running definitions the host compiled and accepted. If an item carried its behaviour from world A into world B, B would be running A's author's code, and totality, budgets, write scoping and moderation would all become claims about a world B's host does not control. A crossing is therefore a *message*: A describes what left, B instantiates its own kind from that description. The portal carries state, never definitions.
- **This dissolves kind identity.** A's `BrassKey` and B's `BrassKey` never have to be reconciled. The portal declares a vocabulary, each side maps its own kinds onto it, and neither author reads the other's source.
- **The door is a contract with three parts:** who may cross (a relation check, host territory); what of the visitor crosses (the nickname question); and what of their belongings crosses (a manifest of vocabulary terms and the state fields each carries).
- **Both sides declare their half, matched at publish time,** not at crossing time. That keeps cross-world checking out of `lang`, which still imports only zod, and gives authors a compile error rather than a runtime surprise.

The four hard problems, in the order they will shape the design:

| problem | why it is hard |
| --- | --- |
| Transitive correlation | Per-world nicknames deny builders a join key. A portal carrying the nickname re-creates one, scoped to the portal graph. A → B → C leaks the A name to C, and a hub world portalling to fifty others is a correlation clearinghouse by design. **Settled: crossings use a passport** — the portal declares what it requests and the visitor consents per crossing. Federation is designed around that rather than reopening it. |
| Conservation | **Settled: crossing is despawn-then-spawn, and conservation is abandoned rather than achieved.** Leaving despawns the actor, optionally keeps the visitor object, and serialises what travels. Entering spawns a new actor, attaches its own local visitor object, and deep-copies the inventory as fresh objects carrying only the arrived state. **State crosses; prose and behaviour never do.** An object entering a world must work entirely from Sprout already present there, which in practice means both worlds share a library holding the mobile kinds. That is checkable rather than aspirational: libraries are statically linked and content-hashed, so sharing one means sharing a hash, and a portal contract verifies it at publish rather than at the door. The entering world may refuse or delete any of it. Despawning first makes duplication impossible and loss possible, which is the right direction — a world that mints items by walking back and forth is broken, one that occasionally drops a sponge is disappointing. On failure the visitor is nowhere, which is the harness's problem and not the language's: a crash back to the menu, from which they re-enter either world. "In transit" therefore needs no expression in the language at all. |
| Liveness | The far world may be down, deleted, or have withdrawn its portal since publish. A dead portal reads as a locked door with a stated reason, the way a missing file reads as `absent`. Never a fault. |
| Versioning | When B changes its manifest, every world with a portal into B holds a contract that no longer matches. The same problem `LANGUAGE_LEVEL` solves for the language, one level up, and probably wanting the same shape: a versioned contract that degrades rather than breaks. |

Related and already decided: **visitors have a per-world nickname**, not a global display name. Settled for its own reasons (a global name is a cross-world join key), and it is the visitor-facing half of any future portal contract. This lands in the spec's names section.

### Package registry and third-party distribution

**Parked** as a future discussion. **Comes back** once the namespace and import syntax are in the spec and the stdlib exists to distribute.

Settled around it: **libraries are statically linked.** A published microworld vendors every library it uses, so distribution is a build-time concern only and a world is fully self-contained at runtime. Nothing resolves, fetches or versions while a world is running.

That decision closes several problems by construction. A library author can no longer change behaviour under worlds that already shipped. A withdrawn or deleted library cannot take live worlds with it, so `absent` never has to cover a missing import. Replay stays exact forever, because a world's behaviour is a function of its own bundle. And the reviewable artifact is complete — a moderator never has to ask what `sprout.Container` meant at the time.

When the registry discussion resumes: a well-known public repository, or piggybacking an existing package host, both look viable. The registry only has to serve builds, never runtimes, which makes it a much smaller problem than a conventional package manager.
