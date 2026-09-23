# Sprout — working notes

2026-09-19 · @Someone

The inputs behind the design spec: four reviews reconciled, the prior art weighed, and the questions still open. This doc goes stale as the spec settles — the spec is the artifact, this is the reasoning behind it.

## Reviewer positions

Three reviews converge on eight findings, conflict on six, and between them correct two claims each of them made. Eric's own material is forward-looking — federating Sprout instances among other things — and is a separate input, not part of this reconciliation.

One decision governs everything below: **Sprout is unreleased, so backwards compatibility is not a constraint.** Every "do this before `LANGUAGE_LEVEL` 1 ships" argument collapses into "design it correctly." The policy-refusal versus added-syntax distinction stops governing sequencing; work is ordered by dependency alone. `LANGUAGE_LEVEL` remains as a forward mechanism for after launch.

### Where they converge

| Finding | Raised by | Status |
| --- | --- | --- |
| No prose interpolation | Claude, Gemini | Settled. Gemini sharpens it: with 16 statements per body and nesting capped at 8, an author cannot print a number above about 8 even by if-chain. |
| `:hidden` and `:scenery` are declared and ignored | Claude, Gemini | Settled. Gemini locates the consequence at `turn.ts:213` — scenery is regurgitated as "You can see bench, window, shelf here." |
| No time, clock, or daemons | Claude, Gemini, GLM | Unanimous. The only unanimous finding. |
| No local variables or intermediate computation | Claude, Gemini | Settled. Gemini adds that arithmetic is `+` and `-` only. |
| Single inheritance is too weak | Claude (no `super`), Gemini (no traits) | Same root, two proposed fixes. Resolved under Conflicts. |
| Multiplayer is architectural, not actual | Claude (no `tell`), Gemini (no push outbox), GLM (no ambient, coarse lock) | Three angles on one gap. |
| Author-facing tooling is effectively absent | GLM, Gemini | Settled, and Claude under-weighted it. GLM wants `lint`, `parse`, a test format; Gemini wants LSP, `fmt`, `test`. |
| Flat global namespace for rooms and objects | Gemini | Matches the repository's own "rooms as scopes" proposal. Settled as a real problem. |

### Where they conflict

**1. Is the parser a strength or the weak link?** GLM calls it "the weakest technical link — opaque, hard to extend, prone to surprising misses" and ranks making it inspectable fourth. Claude called grammar-as-data a top strength. Both are right about different things: the *design* — grammar authored in Sprout, one match function behind parse, complete and help — is sound and should survive. The *implementation* is unverifiable to the author, who cannot see what their world accepts without playing it. We take GLM's fix and reject GLM's framing: keep the design, add `sprout parse` and a grammar-table dump.

**2. Is the opaque actor a feature or a defect?** Gemini says it stifles storytelling — NPCs cannot greet by name, descriptions cannot acknowledge the player. Claude treated opacity as a privacy invariant on which the interpolation safety argument depends. This is a values conflict, not a technical one. The opacity is what lets the host promise a visitor that the memory panel shows everything any object knows about them. Position: keep the actor opaque by default; if a name is ever exposed it is a host-supplied presentation the visitor chose and the host can moderate, never an inventory or an identity the world can fingerprint. Carried to Open questions.

**3. Is the evaluator bounded?** Gemini calls it "mathematically sound, bounded, and secure by construction" and lists totality as strength 1.1. Claude found that `engine.ts:727` runs `each` with no accounting, so nested `each` is O(nᵏ) with no fault. Verified: the budget counts events, spawns and live instances, never statements. Gemini's claim is true of events and false of work. **Sprout is total but not cost-bounded**, and Gemini's strength 1.1 is half a strength.

**4. What does "everything is strings" mean?** GLM means the internals — properties, messages, grammar lines and effect kinds are stringly typed, and every consumer re-derives maps from raw definition arrays. Claude means the source language — symbols evaluate to their bare names and `==` is unchecked. Not a conflict; two distinct problems that share a smell. Both are in scope: source-level typing, and compiler-built typed maps the runtime consumes.

**5. Is the extension model right-sized or unfinished?** Gemini lists it as strength 1.5; GLM calls it "an interface, not a framework" and ranks clarifying it second. Both hold. The *invariant* — an extension records an effect and never performs one — is correct and stays. The *interface* is under-specified, which the repository's own `review-dx.md` finding 7 already said: four of its five fields are undefined. Keep the invariant, specify the interface.

**6. Is the per-microworld write lock right?** GLM says globally serialized write turns are wrong. Claude says the lock is a blast-radius control, so a pathological world only harms itself. Both are correct about their own objective. This is core's decision, not the language's, but the two interact: a step budget is what makes a coarse lock tolerable, because it bounds how long any one turn can hold it. Deferred to the spec's limits section.

### Found by one review only, and surviving

| Finding | Source | Why it holds |
| --- | --- | --- |
| All semantic errors report at line 1, column 1 | Gemini | Verified in `sprout-lang.ts`: `checkTree` defaults `at` to `{line: 1, column: 1}` and stamps every semantic problem with it. Decisive, and a prerequisite for any type checking. |
| Message arguments can only be `object` | Gemini | `SproutArg` is `z.literal('object')`. No `turn dial to 3`, no `type 1042 on keypad`, no `ask guard about rumors`. Claude missed this entirely. |
| Comparisons are untyped; symbols are strings | Claude | `engine.ts:1063` returns a symbol's bare name; `==` is `l === r`. A typo'd symbol compiles and is false forever. |
| `each` is uncharged | Claude | See conflict 3. |
| `send` to an unresolvable target or an unhandled message is a silent no-op | Claude | `engine.ts:723`. The repository's own worked example carries a live instance of the bug. |
| No author test format | GLM | `testWorld()` is a TypeScript helper. There is no way to write "after `light torch`, expect this text" in something an author reads. |
| `Runtime` does too much | GLM | Loading, turns, projection, parsing, store IO, logging, presence and view construction in one class. |
| Two-sided doors, supporters, wearables, equipment slots | Gemini (Claude had doors and supporters) | The standard IF world model, largely absent. |
| Dialogue and topics | Gemini | `ask X about Y` has no shape in the language. |

### What this review corrects

- **Claude's**, that every refusal names line and column. Half true: syntax errors carry real positions from the lexer, semantic problems do not.
- **Gemini's**, that the evaluator is bounded by construction. True of cascades, false of iteration.
- **Gemini's phasing** ("Weeks 1–2", "Weeks 3–5") does not apply. This is a design project before it is a build project, and the ordering that matters is dependency, not calendar.

## The reconciled critique

Everything wrong with the language as it stands, consolidated from four reviews and verified against the source, with where the spec answers it. This is the bridge: the backlog is this list ordered by dependency.

### Correctness

| defect | evidence | answered by |
| --- | --- | --- |
| Comparisons are untyped; symbols evaluate to bare strings, so a misspelled symbol is false forever | `engine.ts:1063`, `:1101`; the two shipped examples use different idioms | Properties and types |
| `each` is uncharged, so a total program can run effectively forever | `engine.ts:727`; the budget counts events, spawns and instances only | Limits — the step budget |
| A `send` to an unresolvable target or an unhandled message is a silent no-op | `engine.ts:723`; the worked example's `:struck` never depletes the matches | The compiler — symmetric warning |
| `isContainer` decides containment by comparing a kind name to a literal string | `engine.ts` | World model — `contains` |
| The spec said pass rules gate range; `contents()` performs no pass check, so `each` sees inside a shut chest | `engine.ts:1053` | World model — Range, which keeps the spec's version and adds the self-and-own-contents exception |

### Expressiveness

| defect | answered by |
| --- | --- |
| No prose interpolation at all; integers and counts cannot be printed | Prose |
| No bystander narration — `say` reaches the actor only, and engine notices cover arrivals and departures alone | Other people — `tell` |
| Nothing happens without a player action; no clock, no scheduled work | Time — ticks and wakes |
| No variation of any kind | Chance |
| Single inheritance, whole-member override, no `super`, no composition | Kinds — composition |
| Message arguments may only be `object`, and at most two | Verbs — roles, set roles, value roles |
| No local bindings, so a property read is repeated and re-read | Properties and types — `let` |
| Exits are free-text labels, so `go north` works by string coincidence | World model — directions and conditional exits |
| No way to reach space that does not exist yet | World model — `link` and `connect` |
| Flat global namespace for every identifier | Names — scope by container |

### Things that lie

| defect | evidence | answered by |
| --- | --- | --- |
| `:hidden`, `:scenery` and `:illuminated` are declared, stored, and consulted by nothing | half the well-known table | Kinds — no magic properties at all |
| Every semantic problem reports at line 1, column 1 | `sprout-lang.ts` `checkTree` defaults `at` | The compiler — a stated requirement |
| A false `when` guard makes a typed command produce nothing at all | `engine.ts:1277` | Verbs — `permit` refuses in the author's words; `when` and `otherwise` are gone |
| The statement cap exists to bound cost but is enforced where only review effort belongs |  | Limits — removed |

### Author experience

| defect | answered by |
| --- | --- |
| The extension interface is under-specified and lets extensions inject properties globally | Extensions |
| No author-facing test format; `testWorld()` is a TypeScript helper | **Unresolved** |
| No way to inspect what the parser will accept | **Unresolved** |
| No dialogue or topic model | Verbs — value roles, narrowed per object with `from` |
| No doors, supporters or wearables | Partly — the standard library; doors parked with federation |

### Not the language's

`Runtime` doing loading, turns, projection, parsing, store IO, logging, presence and view construction in one class is GLM's finding and a real one, but it is host-side. It belongs in the backlog, not the spec.

### What the spec adds that nobody asked for

Worth listing separately, because each is a new surface rather than a repair: per-world nicknames, passages as a member kind, static linking with content-hashed vendoring, library namespacing, world-level verbs with roles and their two passes, conjunctive composition, places as ordinary objects under a world root, and the explicit separation of what a client may render from what the log records.

## Prior art

Organised by the decision each system speaks to. Two of these confirm choices we made, two say we underpriced a cost, and one hands us a number.

### Combining multiple opinions: Inform 7

Inform sorts rules into rulebooks **by specificity** and runs them until one ends in success or failure; a rule ending in "no decision" lets the next one run. More specific beats less specific — a rule about an open container beats one about a container.

The cost of that convenience is documented at length. Inform's manual carries a chapter called *The Laws for Sorting Rulebooks*, admits that the mechanism "will sometimes get it wrong," and supplies `is listed before`, `is listed instead of` and `is not listed in any rulebook` so authors can override the sort. There are forum threads about rules that refuse to order correctly.

**This confirms refusing on collision.** Automatic precedence looks kinder than a compile error right up to the point where an author has to learn a sorting algorithm to find out which of their rules ran. Our answer — every contribution runs, any refusal decides, and a genuine conflict is a compile error the composer resolves — has no sort order to get wrong.

One thing to borrow: Inform's third outcome. Its "no decision" is our `allow`, so the shapes already match; what Inform has and we do not is a *name* for the common case of a rule that simply has no opinion.

### Who decides an action: TADS 3

TADS puts action handling on the objects, through `dobjFor(Verb)` and `iobjFor(Verb)` groups — so both the direct and indirect object get a say. Each group has phases: `verify()` first, then `check()`, then `action()`, then `report()`.

The split between the first two is the interesting part, and TADS has a whole technical-manual article on when to use which. `verify()` is side-effect-free and *ranks* — `illogical`, `illogicalNow`, `illogicalAlready`. `check()` vetoes with a message. `action()` performs.

**This confirms the read-only guard.** Our `depart`/`release`/`accept` are TADS's `verify` and `check` merged, and read-only for the same reason theirs is: a decision procedure that can change the world is a decision you cannot trust.

**But it names a capability we gave up.** `verify()` ranks candidates, so TADS disambiguates on *state*: with an open box and a closed box present, the open one wins for an action that needs one. Our typed slots disambiguate on *type* only. Ours is static, checkable and free; theirs is dynamic and strictly more expressive. If disambiguation turns out to need state, that is where the pressure will come from.

TADS also writes `preCond = (inherited() + touchObj)` to add to an inherited set and `preCond = (inherited() - objHeld)` to remove from it. We built the subtraction half as `without … from …` and dropped the addition half, because all-run composition makes adding implicit. Worth knowing the pair exists together in a mature library.

### Bounding cost: LambdaMOO

This is the direct precedent, and it is almost exactly what we designed.

LambdaMOO counts **ticks**: one for every expression evaluation other than a variable or literal, one for every `if`, `fork` or `return`, and **one for every iteration of a loop**. Foreground tasks get 30,000; background tasks get 15,000. There is also a seconds limit — five foreground, three background — which the manual notes is "in practice, rarely reached," because the tick count binds first. Nested verb calls are capped at 50 levels, and players have quotas on queued tasks.

So: a deterministic operation count as the primary bound, a wall clock as the rarely-reached backstop, a stack depth cap, and per-player quotas on scheduled work. Four for four.

It also hands us a starting number. We proposed 50,000 steps; LambdaMOO has run on 30,000 for decades, against a language with loops and recursion that Sprout does not have.

And a cautionary detail worth keeping: there is a real LambdaMOO bug report of a player whose *command parsing* exhausted the tick budget, because it had to check too many of their installed features. Type-constrained disambiguation makes our parse more expensive, on every keystroke for completion. Parsing must be charged too.

### Text variation: Ink

Ink has **four** kinds of alternative where we have one. Sequences run through their entries and stick on the last. Cycles loop back to the first. Once-only alternatives run through and then show nothing. Shuffles pick at random. They nest, and they can contain blank entries and diverts.

Our `{one of}` is Ink's shuffle, and it is the only one of the four that needs no state. The other three each require a counter — which element are we on — and that is a real design question we have not asked: **per object, or per visitor?** In a single-player medium the question does not arise. In a shared room it decides whether the second visitor to look sees the first line or the second.

This is the most actionable finding here, because "the first time, and thereafter" is arguably a more useful pattern in interactive fiction than randomness, and we have built the random one and not the sequential one.

### Composition: Evennia, and a warning

Evennia's typeclasses are Python classes, so composition is Python's multiple inheritance, and its own tutorial reaches for a `LivingMixin` while cautioning "one should not over-do multiple inheritance since it can also get confusing to follow the code." That is our legibility cost, observed in the wild.

More pointedly: Evennia's default game template ships **`ObjectParent`, an empty mixin class**, as the designated place to put behaviour common to everything. That is exactly the empty-kind-as-brand smell we rejected — and a mature system shipped one anyway, because the alternative was worse. Worth remembering when our own standard library wants one.

### Ambience in a shared world: Evennia

An Evennia community pattern for ambient messages runs a global script on an interval, determines **which rooms have players in them**, and triggers one message per occupied room; rooms collect candidate messages from their own contents.

We arrived at the same design independently — periodic, occupied rooms only, the room fanning out to what it holds. That is reassuring. What they have and we do not is **weighting**: their selection is weighted, so a common line and a rare one can sit in the same set. Our `{one of}` is uniform.

### The one nobody solves for us

The worked example found that a standard library kind cannot declare a property of a world-defined type. Neither precedent has this problem, and the reason is instructive.

TADS is dynamically typed, so the question never arises. Inform's Standard Rules are compiled together with the story rather than linked as a separate artifact.

And Inform solves lock and key directly: its standard rules give a lockable thing a **`matching key` property that holds another object**. That is precisely the stored object reference we refused, and refusing it is what forced our ward enum, which is what forced the matching logic out of the library and into every world.

So the standard library ceiling is not an independent problem. It is the downstream price of comparison-only identity, and it is larger than we priced it. That does not make the decision wrong — stored references cost dynamic reachability, dangling values and the return of null — but the trade should be re-argued knowing that the entire standard library thins out on the other side of it.

## Open questions

Two kinds: things the spec uses without defining, and decisions genuinely still to make.

### Holes in the spec

How this section works, for the agents that read it. **Open** comes first and holds every question still waiting on Eric, numbered as on his review doc (the "Sprout spec holes and decisions" artifact), which mirrors it. A hole found while building is built the narrow way, recorded under its item below, and, if it needs Eric, added to Open with the next number. When Eric answers, the entry leaves Open, the spec changes in a docs PR, and the item's entry is marked *Decided* with the date. Nothing open lives below Open.

**Open**, awaiting Eric:

- **7. The colon beyond composition.** Composition is written with `is`. Not decided: spell an option by its enum everywhere, `Ward.iron`, with the bare `:iron` kept only where the other operand fixes the enum; write a `:remembers` entry as a property is written, `:remembers [:visits 0 min 0 max 99]`. `:name` for properties and messages and the label in `act` stay.
- **10. Whether a withheld file changes the bundle's hash.** Deferred until the publish, share, repository and library-versioning story is settled.
- **35. Which kind a register library is composed onto.** A register composed onto the world replaces `sprout.World`'s lines and not `sprout.Place`'s or `sprout.Actor`'s, since a passage is the kind's. Left for the library work (#127).
- **50. `allow` in a `permit`.** Built: accepted, and it ends that `permit`, consenting, while every other `permit` is still asked; `refuse` and `allow` in a `do` are refused.
- **54. The register of the stock lines.** Long-term, not a blocker.
- **66. `finally destroy self`, the details.** The spec now has the form (Destroying). Chosen, to confirm: the destroy happens at the end of the turn's cascade, once every queued message is handled, not at the end of the cascade this body started; only `destroy self` may follow `finally`; written twice, or beside `destroy self`, it is once; a fault abandons the mark with the turn.
- **67. One kind per file.** Eric: "every kind definition needs to be a separate file." To confirm: whether the file must be named for the kind (`chest.sprout` for `kind Chest`), whether enums, verbs and messages may still share a file, and whether a library (the standard one has several kinds a file) is held to it. Not in the spec yet.
- **68. A kind's contents under composition.** The spec now lets a kind's body hold objects, which every instance starts with. Chosen, to confirm: every kind in the instance's closure contributes its contents, in closure order, before the object's own; a declared instance's kind-given contents have identifiers under it, as `cabinet.wick`; a spawned instance's have none. Built as chosen; what else it settled is under "Found while giving kinds their contents".
- **69. The names of the notices' messages.** Eric: every object in range of a place hears an actor leave or arrive, visitors by the place's `leaves` and `arrives` text and everything else "just get the notification". Named, to confirm: `:departed (actor, to)` and `:arrived (actor, from)`, sent to every object in range of the place but the visitors (who read the text) and the one who moved.
- **70. A name hiding one directly in the world.** The world's name is never a step of a path, so nothing inside a place can name an object directly in the world that one of its name hides. Built: the hiding warning says no path reaches it and suggests renaming. To decide: allow the world's name as a path's first step, or leave renaming as the answer.
- **71. Whether a refused `move` ends the body.** Built: it continues, so the library's `take` would say "You cannot carry any more." and then `taken`. Options: (a) a refused `move` ends the `do`; (b) it continues and the author guards what follows; (c) `move` yields whether it moved. Proposed: (a).
- **72. A destroyed declared object at the next load.** Load makes, at its defaults, every declared object it finds no stored record for, which is how a new world starts and how an object added to source appears; so a declared object that destroyed itself, and everything declared that it held, comes back the next time the world loads. Not built: the store needs to know it was destroyed, a record the spec does not name.
- **73. Whose kind may `act`.** What it refuses says "`act` in a body whose kind does not compose the visitor kind". Built: the kind that wrote the body, so a behaviour kind meant to be composed into an NPC's kind cannot act, though every object running it could. Options: (a) as built; (b) the kind of the object running the body, checked where the compiler can tell and faulted where it cannot; (c) allow `act` in any kind and refuse or fault where the actor turns out not to compose the visitor kind.
- **74. A value written out in an `act`.** Built: `act ask (target: guard, topic: :toll)` is refused, and a value role is filled only by a binding that holds one. A `symbol` role names no enum, so a literal cannot be checked where it is written. Options: (a) as built; (b) allow a symbol or integer literal, checked against nothing at compile time and bound or not by each role-player's `from`, as a typed value is; (c) allow a qualified option, `Topic.toll`, typed by its enum.
- **75. An NPC stored in something that no longer holds actors.** Load decodes a stored instance into the container its record names, so an NPC moved into a place whose kind has since stopped declaring `contains actors` is loaded standing where no actor may; the compile checks only where an object is declared. Visitors return to the arrival place in that case; the spec gives NPCs no rule. Not built: `here` for such an NPC is an engine error. Options: (a) at load it goes back to where it is declared, and a spawned one to the arrival place; (b) it is kept dormant until its container holds actors again; (c) load refuses the world.
- **76. What a spawned instance's contents are told.** Spawning names `:entered` for the container and `:spawned (from)` for the new object, and is silent on what its kinds give it. Built: nothing for the contents, neither `:entered` to what holds them nor `:spawned` to them, so a spawn tells what it always told. Options: (a) as built; (b) each content is sent `:spawned (from)` too, after the instance's, so a wick can light itself; (c) (b), and each holder `:entered` for what it was given.
- **77. Whether a kind's contents count against the `objects` cap.** Limits › Static caps counts "the `object` declarations in the world's body, at every depth", and the caps bound what a person must read. Built: every copy a declared instance is given counts, as an instance the host stores, so two lanterns and their wicks are four objects, and a copy that holds actors counts as a place. Options: (a) as built; (b) count only what is written in the world's body, which is the spec's sentence read literally and what an author reads, leaving stored instances to the host's live-instance bound; (c) count each kind's content once, as a declaration.

**Decided 2026-09-23, evening**, now in the spec:

- 13: names never change while a world runs; renaming anything in source, the world included, changes the ids under it, as the declared-path id already implies.
- 14: the visit is a UUID the host mints, keyed by the host's opaque id for the person, so a returning person finds it or starts a new one.
- 21: the only actors are visitors and NPCs; an object composing `sprout.Actor` that does not compose the visitor kind is refused, and so is a `spawn` of such a kind.
- 22: what objects remember about a visitor is opaque to that visitor (no memory panel; a future debugging view may show it to the author), and it is erased only when the visitor is deleted.
- 26, 27 and 55: what a destroyed object held is destroyed with it, all the way down, dormant instances included, with no `:entered`; a visitor anywhere inside faults the destroy. The `:entered` contradiction is gone with it.
- 42: the engine's cycle refusal speaks through a new `inside_itself` default on `sprout.World`, "{item} cannot go inside itself."
- 43 and 62: an actor is only ever inside something that declares `contains actors`; declaring an NPC elsewhere is refused, a move there is refused before any guard, a spawn there faults, and an exit to something that does not hold actors is a compile error.
- 44: see 69; the one who moved hears neither notice.
- 49: declared order for the two passes is as built.
- 53: an exit guard that reads out of range does not fault the poll; the exit does not apply.
- 56: `finally destroy self` is in the spec (details at 66).
- 57: the world's body is one block in one file, and a world whose file fails to compile admits no one (the kind-file rule is 67).
- 58: a kind's body may hold objects; each instance, declared or spawned, starts with its own copies (details at 68).
- 59: the standard library's default yields to another library's, and the world's own kinds count as another library.
- 60 and 61: an NPC's `say` is framed in fixed engine words, and an NPC's reading that says nothing has no output (`nothing_happens` answers only a person).
- 63: `as actor` only on a kind composing `sprout.Actor`, at level 1; a later level may relax it.
- 64: a `say` in a participant's `do` where the actor is an NPC goes to the NPC's audience, from the NPC.
- 65: the parser's module specs, reaching their module only through `parse.ts`, do not count as exercising it directly; they are to call the module's functions.

The code that differs is an issue each; see the items below.

**Decided 2026-09-23**, now in the spec:

- Range reads the path rule: an object reaches a target when nothing strictly between them on the tree refuses.
- Range goes nearest first, a ring at a time, breadth-first within a ring and each container's contents in its order; a broadcast delivers in that order.
- What a kind leaves out with `without` stays left out in every kind composing it; a copy of the member reaching the composer through another kind still runs.
- `visitors arrive at` never names the world, even one that declares `contains actors`.
- An object hiding one of its name further out is warned about at the inner declaration, naming the outer one's path; objects in sibling containers hide nothing.
- Composition is written with `is`, `kind Creature is sprout.Actor, Fragile`; the colon form is refused with the `is` form as the remedy. Built.
- Pending wakes per object is a host cap, 1 by default, and a `wake` past it faults as a `spawn` past live instances does.
- A library's `version` is semver.
- Objects are declared inside the body of what holds them; the parse tree is the containment tree; `in` and its refusals and the `container` absent row go. Built.
- An identifier belongs to the body it is written in and is seen from inside it at any depth, nearest wins; a dotted path names anything deeper, and the world's `visitors arrive at`, written in the world's body, names a nested place by one. Built for the tree and `visitors arrive at`; bodies resolve identifiers with B32.
- Kinds stay at a file's top level; an `object` at a file's top level is refused. The world's body is one block in one file, and a file holding only kinds and enums needs no world. (That a kind's body may hold objects was decided later the same day, above.) Built, a kind's objects refused as not read yet.
- Refused: an object inside something whose kind does not hold things; the world's name as a step of a path, or as an object's name; two objects of one name in one body. Built.
- What `objects`, `places` and `kinds` count, under Static caps.
- A `spawn` of `sprout.World`, or of a kind that composes it, is refused; so is `destroy self` in the world's own body.
- A destroyed object has no effects: messages queued to it, messages it sent that have not been delivered, engine messages naming it as their `from`, and its pending wakes are all dropped. (What it held was decided later the same day, above: destroyed with it.)
- A `spawn` whose target is out of range or does not hold things when it runs is a fault, never nothing, since there is no null to bind; a spawn into the world is allowed where the world is in range.
- The absent table has a row for a kind named in a `spawn`: the `spawn` faults when it runs.
- The host's live-instance bound counts every instance it stores, dormant ones included.

Range's path rule differs from what is built or being built, and the code catches up.

**Recorded since the sweep, awaiting Eric.** Found while building containment (B13), each decided the narrow way:

- **Whether `contains actors` implies `contains`.** The standard library's own `kind Place` declares only `contains actors` and holds a bench, so it implies it, and `contains` is true wherever either was written.
- **Whether writing either of them twice is worth saying anything.** *How members combine* calls both idempotent under composition; one body writing the same line twice is treated the same and nothing is said. A warning for a redundant one is B50's to add.
- **Whether a world may declare `contains actors`, and so be a place itself.** Nothing forbids the line, so it is accepted and the world is a place if it says it is. Decided 2026-09-23: the line is still accepted, but visitors never arrive at the world itself, whatever it declares; `visitors arrive at` naming it is refused in either mode, and the remedy names a place inside the world where there is one.
- **A block comment never closed, or inside another.** Decided 2026-09-22 and now under Lexical rules: refused at its opening; no nesting.
- **How a list of lists keeps its no-duplicates rule.** Decided 2026-09-22 and now under Lists: same elements in the same order, inside `add`, `remove` and `includes` only, never as an `==`.
- **A bundle with no `world` declaration, or two.** Decided 2026-09-22 and now under The manifest and the absent table: refused at publish; at load the world admits no one.
- Not a hole: a world is not refused for holding nothing, since `sprout.World` declares `contains` and every world composes it (explicitly, as of the sweep); a world composes like a kind, so it holds whatever anything it composes holds.

Found while building composition (B19), each decided the narrow way and awaiting Eric:

- **`object` is both a type name and a declaration word.** A type position that meets the start of a declaration (`object bench is …`) says the type is missing rather than reading the object as the type.
- **An object with no kinds, or no body.** One that names no kind is refused ("An object names its kinds and its container"); one with no body is allowed and has nothing of its own.
- **A kind's braces.** Required, even when empty: `kind Marker { }`.
- **An object's own name.** Any lower-case word; the reserved-word rule is read as covering options and bindings only.
- **A bare `World`.** Resolves as any bare kind name does, to the world's own `World` if it declares one and else to `sprout.World`, so on a kind or an object it is refused as `sprout.World` is; on a world it still does not count as writing `sprout.World`.
- **The closure's order.** Depth-first, left to right, each kind at its first appearance, the composer last (post-order): `D is B, C` with `B is A` and `C is A` runs `A, B, C, D`.
- **A kind that composes itself.** Refused once, at the kind as written that closes the loop, naming the kinds it runs through; the other kinds in the loop are said nothing more about.
- **The same kind twice in one composition list.** Refused at the second, rather than read as one path.
- **Who a restatement's origin is.** The restating kind becomes the property's origin, so composing `Crate is sprout.Container { :capacity 40 }` beside `sprout.Container` collides on `:capacity` again.
- **What counts as changing a property's type in a restatement.** A different integer range is a change, and so is remembered versus plain.
- **Origins that disagree in type.** Cannot be merged by restating; the refusal says to compose only one of them.
- **An object in a library.** Refused, as a world is: a library holds kinds for the world to make things of.
- **An object's anonymous kind.** Named for the object, in the world's library, and the origin of what its body declares.
- **A kind composing one that is absent at load.** It is not composed and its body is not read; the objects made of it are absent with no gap of their own beyond the `kind-in-composition` one.
- **What `without` may name.** Only the members whose several sources all run: `on :m`, `changed :p`, `depart`, `release`, `accept` and `as <role> for <verb>`. `from` names the kind that declares the member, which must be in the composer's closure and not the composer itself. Guards are read, so `without depart from X` works where `X` writes a `depart` itself; every other form is refused with "has no … to leave out" until B24 reads roles and B32 handlers and hooks.
- **Where a library lives on disk.** Still unspecified for any library's vendored copy in a world folder, so the CLI reads none from one. The CLI carries the standard library itself and sends it whenever the manifest names `sprout`, and `sprout init` pins it.

Found while building identifier scope (B14), each decided the narrow way and awaiting Eric:

- **Arriving somewhere that is not a place.** What it refuses does not list it. `visitors arrive at` naming an object whose kind does not hold actors is refused in either mode, at the path's last step, since nothing is missing: the spec's Places makes a place whatever declares `contains actors`, and visitors have to be somewhere they can stand.
- **An arrival place whose kind or container is absent.** It is the `place-of-arrival` row, the same as a name nothing answers to: refused at publish, and at load recorded, with the world admitting no one. At publish, where what left it absent has been refused already (its kind, or where it was put), that refusal is all that is said, as the tree says nothing more about what an absent object holds.
- **Identifiers in a named kind's body.** A kind has no place in the tree, so a name inside its body has no vantage until an instance does; B28 and B32 decide how exits and sends inside a kind resolve.
- **A binding and an object of one name.** Whether `let key = …` hides an object called `key` in reach, or is refused, is B23's and B32's.

Found while building range (B15), each decided the narrow way and awaiting Eric:

- **Crossing into the asker's own contents.** The spec says a container's other contents are crossed into where they pass, and says only that the asker reaches its own contents. Built uniformly: the asker's own contents are always reached, and what they hold only through their own rules, so a pouch in a visitor's hands keeps its gem out of range while it is shut.
- **What `get`, `each` and a command's nouns ask of a pass rule.** They carry no message, so they consult `pass any`.
- **What a broadcast leaves out of "the same walk".** Events, messages and the bus › Sending delivers to neither the sender nor a container outward that refuses, which the walk reaches only as a surface, so a reached node records how it was reached (`self`, `held`, `surface`, `passed`) and B32 drops the first and the third.
- **A visitor standing directly in a world that declares `contains actors`.** The world's rule refuses, so it reaches the world as a surface only, and nothing else in it.
- **"The container's order" for a moved or spawned object.** Declared objects keep their declared order; where a moved or spawned one goes in its container's order is B16's.
- **What a membership test costs.** Whether one object is in range of another is answered by the path between them, one step per node climbed, not by a whole walk.
- **`each` over a container that is in range but refuses, seen from outside.** Its contents are out of range, so it visits nothing.

Found while building the state model (B16), each decided the narrow way and awaiting Eric:

- **The minted id's form.** `<world>#<n>`, as `printers_shop#12`, from one persisted serial counter per world that spawns, arrivals and wakes all draw from, so no id is ever reused. A name never holds `.` or `#`, so a minted id and a declared path cannot collide.
- **A stored value carries the type key it was written under.** A property retyped from `string` to `Ward` falls to its default even when the stored text is one of `Ward`'s options, so a value is never reinterpreted under a type it was not written as.
- **A value outside a narrowed range.** Falls to the default, and is not clamped into the new range: the spec's "no longer fits" is read as no longer fitting, and `adjust`'s clamp is for a write, not for reading state.
- **A list that no longer fits.** Falls to the default whole, when any element misfits or it holds more than the host's current cap, rather than keeping the elements that still fit.
- **Times in stored state.** Whole host seconds, as `elapsed` is.
- **Pending wakes are stored as a list.** Decided 2026-09-23: how many an object may have pending is a cap of the host's, 1 by default, rather than one per object as a rule of the language; the stored form is a list bounded by that cap. `lastTick` is kept on every instance's record and stays null for anything that is not a place.
- **The container's order.** Declared objects still where they were declared come first, in declared order; then everything that arrived, in arrival order, each arrival drawing the world's next serial. So a declared key taken and put back goes last, and a spawn goes after what was there.
- **"Its kinds."** Stored as what the instance was made from: the world, a declared object, a visitor, or a spawn of a kind named by its qualified name. The closure is re-derived from the bundle at every load, never stored, so a kind that composes something new applies to instances already made.
- **A property no longer declared.** Dropped at load, and said so; it is not kept beside the declared ones.
- **A default changed in source.** Does not change existing instances: every instance holds every property it declares, so there is no unset value for a new default to show through. Only instances made after the change start at it.
- **A declared object moved at run time into something now absent.** It is unreachable with its container, and is not returned to its declared container; it comes back where it was when the container does.
- **A visitor's instance after `visitors are` changes.** Decoded against the world's current visitor kind, whatever it was made under, since a visitor records that it is a visitor and not which kind it was.
- **An instance whose container no longer declares `contains`.** Stays where it is; nothing is moved at load.
- **Which item puts the composed world and the visitor kind into the bundle.** *Answered by B17:* `compileBundle` composes the world and resolves `visitors are`, and the bundle carries both, so the world's instance holds its composed properties and a visitor's instance decodes; each is dormant only where a loaded world admits no one for want of it.

Found while building actors (B17), each decided the narrow way and awaiting Eric:

- **How the standard library travels.** From the CLI as one known copy, blessed, and pinned by `sprout init`; every manifest names it, and one that does not is refused for a missing `sprout.World`, with a remedy that names the library. Decided 2026-09-23.
- **What visitors are made of.** The visitor kind must compose `sprout.Actor` and be the world's own kind. `visitors are Hall`, where `Hall` is not an actor, is refused at the kind; so are `visitors are sprout.Actor` and any other library's kind, since the world's own kind is where "whatever this story needs a person to have" is written. Decided 2026-09-23, now under What it refuses.
- **A visitor kind absent at load.** The absent table has no row for it. It is treated as the `world` row's consequence: the world admits no one, and the gap is recorded under `world`. At publish it is refused, and not said while one of the world's own files was refused at the first tier, as for the arrival place. So is a kind the world composes that nothing declares. Decided 2026-09-23: the world admits no one, as for the arrival place, now a row of What absent means.
- **Where an NPC may be declared.** An NPC needs no place among its ancestors, and an actor may be declared inside something that does not hold actors (a cat in a basket); both are accepted, since where an actor may be moved is B22's and B42's. Decided 2026-09-23. *Decided 2026-09-23 (43, 62), the other way, and built:* an actor declared inside something that does not hold actors is refused.
- **Erasing what the world remembers about a visitor.** Not built: the spec gives only the memory panel, which lists everything every object remembers about an actor, dormant objects included, and only what was written, a remembered property never written about them reading as its default. Whether a visitor may erase it, and how, is open; Eric asked for more on the question, 2026-09-23. *Decided 2026-09-23 (22):* no memory panel; memory is opaque to the visitor and erased only when the visitor is deleted.
- **An actor that is not an NPC.** Whether an object composing `sprout.Actor` but not the visitor kind is an actor that cannot `act` is open; `isNpc` answers only whether an object composes the visitor kind. Eric leans to yes and asked for more on the question, 2026-09-23. *Decided 2026-09-23 (21), and built:* there is none; such an object is refused, and so is a `spawn` of such a kind.
- **`sprout.Actor` has no pass rule yet.** It writes its three guards, and until B32 lands it declares no `pass any (false)`, so a pocket is visible: what a visitor carries is in range of the people beside them. Accepted for now, 2026-09-23.

Found while building spawning and destroying (B18), each decided the narrow way and awaiting Eric:

- **A spawn target of the bare object type.** Accepted at compile and checked when the spawn runs, since the worked microworld writes `spawn Sheet in here` and `here` is the object type. A target known to be a value or a set is refused, and so is one whose kind does not write `contains`.
- **Spawning an actor.** An actor kind, or the world's visitor kind, may be spawned; the spec's Spawning names no exception.
- **Where `spawn` and `destroy` are refused.** What it refuses forbids both in a guard, a `permit` and `describe`; the items that read those bodies (B22, B24, B31) refuse them there, with a `let` naming a spawn.
- **The target's grammar.** `in` takes a binding or an identifier, or a dotted path to one, written without spaces around its dots as a dotted path elsewhere is. `destroy` takes only `self`, and anything else after it is refused once.
- **A dotted target.** Refused, as a name nothing in the body answers to, until identifiers inside bodies resolve (B32).
- **A message naming a destroyed object as `from`.** Dropped. Decided 2026-09-23: a destroyed object takes everything pending on it with it — messages queued to or from it, engine sends naming it as `from`, and its pending wakes.
- **The destroying body's own sends.** Dropped. Decided 2026-09-23: a destroyed object has no effects, so what it sent in the body that destroyed it goes with it.
- **What a destroyed object held.** Falls to its container without consent, as Destroying says, each thing placed last in that container in the order it was held, so the fallen keep their order after whatever was already there. Decided 2026-09-23 as the spec is written, until Eric confirms a change: his preference, pending, is that what it held is destroyed with it. *Decided 2026-09-23 (26), the other way, and built:* destroyed with it, all the way down.
- **The `:entered` for what fell.** One per thing, in falling order, `from` the destroyed object. The destroy returns them and the queue drops them under the no-effects rule above, since their `from` is gone, so the container is never told. Destroying still says the container receives `:entered` for each thing that fell, which that rule contradicts; the contradiction is recorded for Eric, and the rule lives in one place, the queue's, whichever way it goes. *Moot, 2026-09-23 (55), and built:* nothing falls, and a destroy sends nothing.
- **A visitor standing directly in a destroyed object.** A fault, whatever the object is. Decided 2026-09-23. A visitor further in — in a box in the room — moves with what holds them. *Decided 2026-09-23 (27), and built:* anywhere inside, now that contents are destroyed, checked before anything is removed.
- **`destroy self` on a visitor's own instance.** A fault. Decided 2026-09-23.
- **Spawning into the world.** Allowed where the world is in range of the spawner, which it is when every container between them passes. Decided 2026-09-23.
- **A spawn target out of range, or holding nothing, when the spawn runs.** A fault. Decided 2026-09-23. A target that is not live, the spawner's own self included, is out of range.
- **A kind absent at load named in a `spawn`.** The `spawn` faults when it runs. Decided 2026-09-23, as a new row of What absent means, which the spec and the compiler's absent table do not carry yet.
- **Dormant contents of a destroyed object.** Left where they are: a dormant record is kept untouched, so it still names the destroyed object as its container. When its kind returns it decodes into a container that no longer exists and is not live; where it goes then is open. *Decided 2026-09-23 (26), the other way, and built:* destroyed with it, its stored record removed.
- **How the host's bound reaches a turn.** As a number per turn, recorded with the turn (B40), not a callback into the host, so a replayed turn faults exactly where it did.
- **What a spawn tells.** The container `:entered (item, from)`, the new object as `item` and the spawner as `from`, then the new object `:spawned (from)`, in that order; the engine is the sender of both.
- **`destroy self` twice.** Is once: it takes effect when the body ends, and a second in the same body changes nothing.
- **Memory keyed by a destroyed NPC.** Kept: what an object remembers about an actor is its own, and a destroyed actor's id is never minted again, so the entry can name no one else.

Found while building passages (B20), each decided the narrow way and awaiting Eric:

- **A composer's own `default` beside a composed non-default of the same name.** How members combine says a composer's own exclusive member always replaces what it composes, and that a default yields to any passage of the same name from any other source; for this case they disagree. Built: the composer's own applies, and stays a default, so it still yields further up. Decided 2026-09-23, now under How members combine.
- **A default rewritten over a default.** `W: K, A` where `K: A` wrote its own default over `A`'s: two defaults from two origins reach `W`, and they collide, as a restated property from two origins does. Decided 2026-09-23. Where `A` is the standard library, the rule below would let `K`'s default win instead if the world's own kinds are read as another library; built as a collision until Eric confirms that reading, and the refusal says the standard library's yields to another library's.
- **Where a library's replacement lines go.** A register library composed onto the world replaces `sprout.World`'s lines but not `sprout.Place`'s or `sprout.Actor`'s, since a passage is the kind's; the spec's "a second library supplying the lines the first left out" says nothing about which kind it is composed onto. And a register that writes its lines as `default` collides with the standard library on every shared name, so under the rule as written a register replaces stock lines only by writing non-defaults. *Decided 2026-09-23, now under How members combine, and built:* the standard library's default yields to another library's, so a register's defaults replace the stock lines and still yield to the world's; two defaults from two other libraries still collide. Which kind a register is composed onto stays open until the library work.
- **A typo in an override.** `passage nothing_happen` in the world overrides nothing and is not refused; no warning is listed. Decided 2026-09-23: a warning, B50's, now under What it warns about.
- **After a refused collision.** The first contender in list order is kept, as the property collision keeps its first, so a kind composing the refused one hears nothing more about that line; and when non-defaults collide the refusal names only them, not the defaults that gave way.
- **`default` on an object's or the world's own passage.** Accepted and recorded, though nothing can compose it.
- **A passage's name.** Any lower-case word, as an object's name may be; only `default` in the name position is read as the keyword. A reserved word as a passage's name is not refused, as it is not for a message or a kind today; a verb's is.
- **A lone `}` in prose.** There is no way to write one: only `\{` is an escape, so an unmatched `}` closes the passage and `\}` is refused, stepped over with the character after it as a bad escape in quoted text is.
- **Quoted text in a slot.** Ends at its line with no refusal until B29 reads slots; in prose a quote is a character.
- **Where a passage's header may sit.** Its words on the `passage` line, the brace on that line or the next; a header left without braces then never takes the next member for its own.
- **`{item}` in `arrives` and `leaves`.** Untyped by the binding table until B29 and B42 say what a place's notices bind.
- **The standard library's `0.1.0`.** Stays `0.1.0` while its source changes before release. Decided 2026-09-23.
- **A world whose composed kinds lack an engine passage.** A forked standard library without `fault` or `displaced`: what the engine says then is B34's and B48's.

Found while building library namespacing (B21), each decided the narrow way and awaiting Eric:

- **A world namespaced as a library it pins.** Its own bare names and the library's could not be told apart, so the manifest is refused. The spec says only that a world's own declarations are unqualified.
- **A library's message written qualified.** Libraries namespace messages, but no syntax writes one qualified (`send x sprout.:m`?): a message name is a bare symbol wherever it is written, so a library's message is reachable only unqualified, and only when the world declares none of that name. Open until B32 reads sends.
- **What the shadowing warning covers.** Kinds, enums, messages and verbs, which is everything libraries namespace.

Found while reading, checking and composing the consent guards (B22), each decided the narrow way and awaiting Eric:

- **A guard's parameters.** Positional, named as the author chooses: one for `depart`, two for `release` and `accept`, and any other count is refused. `to` and `from` are reserved words, and the spec's own guards name parameters with them, so those two may name one and no other reserved word may. `_` for a parameter left unnamed waits for the lexer to read it, as a handler's does (B32); until then every parameter is named.
- **What follows `allow` or `refuse` in a block.** Accepted, and never runs; a warning for it is B50's.
- **A guard written twice in one body.** Refused at the second, as a passage written twice is, and the first kept.
- **`release` or `accept` on something that holds nothing, and `depart` on the world.** Accepted, and never asked, since nothing can leave or enter it and the world never moves.
- **How a `without` travels.** Decided 2026-09-23: a `without` follows the kind into its composers, and in a diamond it removes only the copy that came through the kind that wrote it; a copy of the same member reaching the composer by another path still runs. `KindRef.suppressed` holds a kind's own lines only, since a composed kind's have already shaped that kind's members.
- **Where `refuse <name>` looks.** At the passages of the kind that wrote the guard, composed ones included; the evaluator looks the passage up on the refusing instance's kind at run time, so a composer's own line replaces a library default.
- **What a guard may say as a statement.** A call that writes or remembers is refused as a write, and any other expression standing as a statement is refused as reading without doing, as everywhere. `say`, `tell`, `send`, `move` and `act` are not read as statements yet; in a guard they are refused as statements this compiler does not read, until the items that read them refuse them there by name.

Found while evaluating expressions and running a guard's body (B22), each decided the narrow way and awaiting Eric:

- **Whether `&&` and `||` short-circuit.** They do: a left side that decides leaves the right unevaluated and uncharged. An expression only reads, so the only difference an author can see is the steps a turn is charged.
- **`+` or `-` past the integer range.** The types give every integer the range −2,147,483,648 to 2,147,483,647 and say nothing of a sum outside it. It is a fault, as a `set` out of range is, rather than wrapped or clamped, since either would make a comparison quietly wrong.
- **An integer literal past that range.** Neither the parser nor the checker refuses one standing alone, as in `let n = 3000000000`; it evaluates to what it writes, and faults only when `+` or `-` is applied to it. Refusing it at compile is the checker's to add.
- **What one step is.** Every statement executed, every `else if` tested, and every expression node, which includes the `:p` a `get` or `recall` names and the kind an `is` or `count` names. `count(K)` looks through a container's contents without a step for each thing it looks at, since Runtime budgets lists no such charge.
- **A `get` through a binding out of `self`'s range.** Range is what an object may read with `get`, and a guard's `item`, `to`, `from` and `mover` may be out of range of the party asked. The evaluator reads through any binding without asking; whether such a read faults, as the exit's `when` question above has it for an identifier, is open.

Found while moving a thing through consent (B22), each decided the narrow way and awaiting Eric:

- **Whether composed guards run past a refusal.** Consent under composition and One rule for many opinions say every contribution runs and the first refusal speaks; The three roles says the engine stops at the first refusal. A guard only reads, so the two differ only in the steps a turn is charged and in a fault a later guard would raise. Built: the first refusal stops the poll, within one kind's list as between the three roles.
- **The engine's cycle refusal has no stock line.** After the move says a move that would make a container hold itself is refused before any guard, and gives no words. Built with fixed text, "{item} cannot go inside itself."; an `inside_itself` default on `sprout.World` is proposed, so a world can say it in its own voice. *Decided 2026-09-23 (42):* the `inside_itself` default on `sprout.World`; the code catches up.
- **An actor moved into something that does not hold actors.** Refused by the engine before any guard, as structural, with fixed text, "{item} cannot stand in {to}.", so a person is never carried in a hand or put in a basket. The world holds actors only where it writes `contains actors`. The alternative, allowing it and leaving it to a guard, is Eric's to choose. *Decided 2026-09-23 (43):* refused as structural, as built; and an exit to something that does not hold actors is a compile error.
- **What the engine's refusals name an object by.** Until B29 renders names: a declared object by its identifier, the world by its name, and anything made while the world runs, a visitor's instance included, by its kind's name.
- **A move that cannot be asked about.** A fault, writing nothing, as a spawn's is: the thing is the world, or a visitor who is away; the thing or the destination is not live or out of the mover's range; the destination holds nothing.
- **A move to the container the thing is already in.** A move like any other: the guards run, it goes last in that container under a new arrival, and all three messages are sent.
- **A place whose kind has no `leaves` or `arrives`.** One that holds actors without composing `sprout.Place` and writes neither: no notice for that side. The description is still sent.
- **When a place speaks.** Only when the thing is an actor and both the container it left and the one it entered hold actors. An actor moved out of a basket onto the floor of a room, or into a wardrobe from a box, is told nothing and nobody hears it, though After the move and Places each say only what happens between two places.
- **The description to the one who moved.** A `described` notice naming the new place and carrying no text until B31 describes.
- **Who hears `leaves` and `arrives`.** The actors directly in the place, not those inside something in it; the one who moved left out; NPCs included, though prose addressed to one goes nowhere; and a mover other than the thing hears as anyone there would. *Decided 2026-09-23 (44), wider:* every visitor in range of the place reads the text and every other object in range is sent a message (names at Open 69); the code catches up.
- **A destination out of range across places.** A move's destination must be in the mover's range, and while the world refuses one place is out of range of another, so a `move` from one place to another faults. How `go` crosses an exit to another place is B42's.
- **Where `refuse <name>` looks when it runs.** As recorded above, on the refusing instance's kind, so `good/consent`'s visitor kind says `hands_full` in its own words over `sprout.Actor`'s.

Found while reading a verb and checking it against itself (B23), each decided the narrow way and awaiting Eric:

- **`many` beside a kind.** `role tools: Rib many` is accepted, a set of things of one kind; `many` and `optional` follow the filler, in either order.
- **`optional` on a verb that has phrases.** Refused: the phrases decide which tools are optional, and `optional` is written only on a verb with none. Decided 2026-09-23, now under What it refuses.
- **A phrase that leaves out the target.** Refused: every phrase names the first role. Declaring a verb says a phrase "need not fill every tool", which is read as tools only. Decided 2026-09-23, now under Declaring a verb and What it refuses.
- **`many` on the target.** Accepted, as in `verb sort { role targets many  "sort [targets]" }`; the spec restricts `many` on value roles only. Decided 2026-09-23, now under Set roles.
- **`optional` on the target of a verb with no phrases.** Refused: the target is never optional, which is what the rule above means for a verb with phrases. `optional` on a value tool of such a verb is accepted, though every value tool is optional already. Decided 2026-09-23, now under Optional tools.
- **Two phrases that mean the same, and an empty phrase.** Refused. Two are the same when their words and slots are, however they are spaced: a run of words between slots is trimmed and its spaces made single.
- **What a slot holds.** Exactly one role's name in lower case: `[ target ]`, `[the target]` and `[Target]` are refused, and so is a `]` that closes no slot. A slot next to a slot, `"[a][b]"`, is accepted; which noun fills which is B27's.
- **The phrase cap.** Counts the phrase as it means, after escapes, in characters, since that is what a visitor types.
- **A verb with neither roles nor phrases.** `verb dance { }` is accepted: only `act` performs it, and only the actor plays it.
- **`exit` as a filler.** Read on any verb by the parser, and refused past the first tier on any verb but the standard library's `go`, at `exit`, in any library, the standard one included.

Found while resolving verbs across libraries (B23), each decided the narrow way and awaiting Eric:

- **Whose verb may take an engine verb's name.** Reserved names says a world's may not; built so that no library but `sprout` may either, since a pinned library's `look` would reach the world only qualified and would read as the engine's. Adding to or translating an engine verb's words is then only by forking the standard library.
- **A world's verb of a standard library verb's name.** A shadow, warned, as for kinds, enums and messages; not a refusal, since The engine verbs says a world that wants `take` to do something else writes its own. Which of the two a typed phrase then reaches, and whether both are offered, is B27's.
- **Writing a verb with its library.** Libraries and namespaces says the qualified name always reaches the library's, and no syntax writes one: `as target for` and `act` take a bare name. The shadow warning's remedy says to rename the world's verb rather than to write `sprout.take`, until B24 or B26 decides whether `as target for sprout.take` is a form.
- **Two verbs of one name in one library.** Refused at the second, the first kept, as for kinds, enums and messages; the words name the library as theirs do.
- **A role naming an enum.** Refused, with `symbol` and `from` as the remedy: Value roles says `symbol` says only that the role is filled by an option, and which enum is the role-player's to say.
- **A value role in the target's place.** Optional, as a value tool is: Value roles gives the reason for tools, that what a visitor types is never one of a closed set until checked, and it holds for the target as well. The first tier's rule that the target is never optional is about `optional` as written.
- **An `exit` role.** Optional only where a phrase leaves it out, as a thing role is, which the standard library's `go` never does: the directions and labels are a closed set.
- **A role whose kind was declared and could not be composed.** Nothing more is said of it, since the composition's refusal already has; the role fills nothing, as an absent kind's does.
- **`put` in the standard library.** It names `Container`, which no library file declares yet, so it waits for `sprout/container.sprout` (B48). `take`, `drop`, `give` and the engine verbs' phrases are there now, with nothing yet playing them; `ask` is in `sprout/talk.sprout`.

Asked ahead of building the two passes (B24), 2026-09-23:

- **Declared order.** The actor first, then the verb's roles as declared (the target, then the tools; a set role's fillers in typed order), and within one participant its kind's contributions in closure order, the composer's own last. Proposed; awaiting Eric, and built so, as The two passes, Set roles and How members combine read.
- **`allow` in a `permit`, `refuse` in a `do`.** Proposed: the first accepted, since a `permit` has a guard's shape; the second refused. Awaiting Eric.
- **An NPC actor's `say`.** Decided 2026-09-23, now under Acting: it comes from the NPC, heard by whoever would hear its `tell`, as *the cat says "miaow"*. How the line is framed (a stock passage on `sprout.World`, or fixed words), and whether `nothing_happens` is told the same way for an NPC's reading that said nothing, are open; B30 carries who hears it.
- **The warning for a verb no object plays a role for.** Waits for B48, which brings the library's role bodies, so it does not fire for `take`, `drop` and `give` in every world. Decided 2026-09-23.

Found while reading, checking and composing the roles a kind plays (B24), each decided the narrow way and awaiting Eric:

- **Where a verb is known before kinds compose.** A kind's play resolves its verb as it composes, and what fills a verb's role is a composed kind, so the two cannot wait on each other. Which verbs exist, and the roles each declares, are read from the declarations before any kind composes (`VerbNames`, keeping what the verb table keeps); fillers are still the verb table's, built after the kinds.
- **Which verb a bare name in a play reaches.** The play's own library's, then the standard library's, as for a kind. `as target for sprout.take` is still not a form.
- **`allow` in a `permit`, and `refuse` or `allow` in a `do`.** The Two passes calls a `permit` the same shape as a guard, so `allow` is accepted there. A `do` runs once every `permit` has allowed, so both `refuse` and `allow` are refused in one.
- **The role played, by its own name.** Not bound: inside `as target for unlock`, `target` is `self`, and a read of it says to write `self`. A set role is the exception, since Set roles binds the whole set in every participant's body, its own fillers' included.
- **A value tool with no `from`.** Unbound, and refused at a read or at `bound`, not at the play. An integer tool with no `from` is the same, as A role-player narrows its own options says.
- **What `from` may name.** A property of the role-player's, composed ones included, and not a remembered one, which is held about each actor rather than by the role-player. A `from` naming a role the verb lacks, or a role twice, is refused.
- **What may be played.** A role the verb declares, or `actor`. A value role or an exit is named by the visitor and played by nothing, so `as topic for ask` is refused. A play of an engine verb is accepted; what the engine does with one is B34's.
- **A kind playing a role its verb's filler does not name.** Accepted: the spec's own `sprout.Lockable` plays `target` for `open`, whose target is a `Container`, and composes no container, so its play contributes wherever a composer composes both. `self` in such a play is the kind that wrote it.
- **`as actor` on a kind that does not compose `sprout.Actor`.** Refused, from The actor's own part ("A kind composing `sprout.Actor` may play it"). By the `Lockable` reading above, a library kind adding to what every actor does would want the same latitude; this is the question to answer if it does. *Decided 2026-09-23 (63):* refused at level 1.
- **`actor` where the world names no visitor kind.** Of the object type, since that failure has been said where the world is declared.
- **`permit` or `do` twice in one play.** Refused at the second. A play with neither is refused at its head.
- **A play on the world's own body.** Accepted, though nothing fills a role with the world.
- **`bound`.** Read as a primary, the word and a name, so it binds tighter than any operator; Precedence does not list it. It narrows only as a whole condition, as `is()` does, so `bound tool && tool.is(Key)` reads `tool` unbound on the right.
- **An exit role inside a play.** Not bound; only the engine's `go` has one, and what an exit binds is B28's.
- **The two warnings.** A verb with phrases no participant `say`s for waits for B30, which reads what a body says to whom. A verb no object plays a role for waits for B48: it would fire for `take`, `drop` and `give` in every world until the library writes their plays.
- **A verb nothing declares, at load.** The absent table's `verb` row: a gap at the verb as written, and the play dropped.

Found while running a reading through the two passes (B24), each decided the narrow way and awaiting Eric:

- **How an NPC's line is framed.** Acting has the audience hear an NPC's `say` "as the cat speaking, _the cat says "miaow"_", and does not say whether that frame is a stock passage on `sprout.World` or fixed words. Built: the line is carried as written, to the audience, with the NPC as its speaker, and the framing is left to B29. *Decided 2026-09-23 (60):* fixed engine words; B29 and B30 render them.
- **`nothing_happens` for an NPC's reading.** Told the same way as its lines: to whoever would hear its `tell`, from the NPC, when its reading said nothing at all. *Decided 2026-09-23 (61), the other way:* no output; the code catches up.
- **A `say` in a participant's `do` that is not the actor's.** Reaches the actor, since Prose says `say` reaches the actor whoever's body it is in, with that participant as `self` when it renders; where the actor is an NPC it goes to the NPC's audience, from the NPC, as the NPC's own lines do. *Decided 2026-09-23 (64):* as built.
- **Who hears an NPC.** The actors directly in its place, NPCs among them, less the NPC and every participant, in contents order. What reaches an NPC and what reaches an occupant of something inside the place is B30's.
- **`here`.** The actor's nearest container that holds actors, so a wardrobe declaring `contains actors` is `here` for whoever stands in it. An actor with no such container, as an NPC in a crate in a world that holds only things, has the world as `here`; the spec does not say. *Moot, 2026-09-23 (62), and built:* every actor has a place, so `here` is the actor's container, and an actor found in something that holds no actors is an engine error.
- **`allow` in a `permit`.** Ends that `permit`, consenting; every other `permit` is still asked, as a guard's `allow` leaves the other parties to be asked.
- **A participant destroyed earlier in the effect pass.** `destroy self` takes effect when the `do` that ran it ends, so one is an object filling two roles, or one whose composed play destroyed it before its own ran. Its later `do`s, composed or own, do not run.
- **What a `do` does at this level.** `let`, `if`, `spawn`, `destroy self`, the four writes, `remember` and `say`. `tell`, `move`, `send` and `act` are not yet statements the parser reads; B30, B25, B32 and B26 bring them.
- **A world composing no `nothing_happens`.** An engine error, which B34 turns into a fault, as for the other engine passages a forked standard library leaves out.

Found while building `move` (B25), each decided the narrow way and awaiting Eric:

- **Whether a refused `move` ends the body.** Moving something says what happens on a refusal (nothing moves, the text is said) and not whether the body goes on. Built: it goes on, as it does after `destroy self`. This is the one most likely to need Eric: the standard library's own `take`, written as `move target to actor` then `say taken`, would say "You cannot carry any more." and then still say it was taken. The alternatives are that a refused `move` ends the `do` it stands in, or that a `move` yields whether it was made, for an `if` to read.
- **A refusal and `nothing_happens`.** A refused move's words count as said to the actor, so a reading whose only line is a refusal is not also answered with `nothing_happens`.
- **What effect a refusal is.** Said to the actor, marked as a refusal rather than a line a body said, in the one ordered list of what the effect pass says; B38 decides the effect's final shape.
- **Who hears a refusal when the actor is an NPC.** Whoever would hear its `tell`, from the NPC, as its `say` lines are.
- **What a refusal renders with.** A guard's: the refusing party as `self`, with `mover` and the guard's parameters bound; a `let` inside the guard is not carried. The engine's own ("{item} cannot go inside itself.") is fixed text from the world, with nothing bound.
- **What a `move` costs.** One step for the statement and one for each name it evaluates, then the range walks and the guards' own statements; the move charges nothing for itself.
- **A set or a value as the thing.** Both refused at compile, since a value is never moved and a `move` moves one thing; a set is moved one of its things at a time.
- **An identifier on either side.** `move item to cellar` is refused as a name nothing here answers to, as a spawn's dotted container is, until identifiers inside bodies resolve (B32).
- **`move x to x`.** The engine's refusal that a container may not hold itself, before any guard.
- **The world as the thing.** Refused at compile where the thing is known to be the world, as `self` in the world's own body; a `MoveFault` where it is found only at run time, as `here` in a world that holds no places.
- **A thing no longer live.** A `MoveFault`. `move self to c` before `destroy self` in one body moves, since the destroy takes effect when the body ends.
- **"The actor if there is one."** A `move` in a handler, a tick or a wake has no actor to say a refusal to. Only a `do` reads `move` today; B32 decides.
- **Order among a body's effects.** What its spawns, moves and destroys send, and what it says and has refused, keep the order the body did them in.
- **`move` where a value is wanted.** `let x = move a to b` is refused once, as `spawn` and `destroy` are, with both sides stepped over.
- **A move whose mover is not the actor.** `sprout.Actor`'s `depart` refuses when the mover is not itself, so `move actor to self` in a cart's `do` is refused by the actor; a person boards by moving themselves, in the actor's own part, as `good/move` does.

Found while refusing arrival at the world and warning on a hidden name, each decided the narrow way and awaiting Eric:

- **Which place the arrival refusal names.** The first place in the tree, shallowest first and in the order declared within a depth, by its path (`visitors arrive at kiln.back_room`). A world with no place in it is told to declare one.
- **Which hidden object the warning names.** Only the nearest one further out, since that is what the name meant there before; an object that hides several is warned about once.
- **A hidden object directly in the world.** No path reaches it from inside the hiding container, since the world's name is never a step of a path, so the warning says so instead of naming a path, and says to rename one if both are meant there.
- **An object whose kind is absent.** It is still placed, so it still hides one of its name further out and can be hidden itself, and the warning is said in either mode.

Found while destroying what a destroyed object held, each decided the narrow way and awaiting Eric:

- **The order things are destroyed in.** The object, then what it held, depth-first: each container's decoded contents in contents order, then its dormant records by id, each followed by what it holds. The queue sees them in that order; nothing observable depends on it yet.
- **A binding to something destroyed with its container.** Reads as the object itself does for the rest of the turn, holding the state it had, its container still the one destroyed around it; a participant destroyed so does nothing more in the reading.
- **A visitor kept dormant inside.** Faults the destroy as a live one does: a record kept for want of the visitor kind is still a person's. An away visitor is inside nothing and faults nothing.
- **Which visitor the fault names.** The first found in destroy order; the fault is about the object destroyed, and names one visitor in its detail.
- **Stored records that hold each other.** Records a store left holding one another in a loop are each destroyed once.
- **A destroyed declared object at the next load.** Not decided here: load makes every declared object it finds no record for, so one destroyed comes back at its defaults. It is Open 72.

Found while building `act` (B26), each decided the narrow way and awaiting Eric:

- **Where `act` stands today.** Only in a `do`, since handlers, hooks, ticks and wakes are not yet read; the spec's own cat, which acts in `on :stir`, waits for B32. In a guard or a `permit` it is refused as the other effects are.
- **Whose kind must compose the visitor kind.** The kind that wrote the body, as What it refuses words it ("a body whose kind does not compose the visitor kind"), not the object running it. So a behaviour kind written to be composed into an NPC's kind, `kind Purring { as target for pet { do { act purr () } } }` with `kind Cat: Creature, Purring`, is refused, though every object running it could act. A real question for Eric: it decides whether reusable NPC behaviour can live in a kind of its own. Open 73.
- **What fills a role.** A name in scope: `self`, `actor`, `here`, a role, a `let`. An identifier or a dotted path is refused as a name nothing here answers to, as `move`'s are, until bodies resolve identifiers (B32). A value written out, `act ask (target: guard, topic: :toll)` or `number: 7`, is refused: a value role is filled only by a binding that holds a value. A real question for Eric: a symbol role names no enum (the role-player's `from` does), so a literal cannot be checked where it is written, and the only way to hand one on today is a value tool already bound. Open 74.
- **What each role takes.** A role naming a kind takes a binding known to be one, so the bare object type is refused with the `is()` narrowing to write; an open role takes any thing; a set role takes a set whose kind composes its own, or one thing as a set of one; a `symbol` role takes any value of an enum, and an `integer` role any integer, which the role-player's `from` then hears or not; an exit role takes nothing an author can name, so `act go` waits for B28.
- **What may be left out.** An optional tool, every value tool, and a set role, which is then the empty set; never the target or a tool that is not optional, as Acting says. A set target may be left out, since a set role is never missing.
- **How the verb is named.** By its name alone, reached from the body's own library and then the standard library's, as a play reaches one; `act sprout.take (…)` is refused as `as target for sprout.take` is. The brackets are always written, `act purr ()` for a verb with no roles; a comma may follow the last role, as after an enum's last option; `target:p`, which the lexer reads as a name and a symbol, means `target: p`.
- **What the actor may name.** Every thing an `act` fills a role with must be live and in the actor's range, or the turn faults (`ActFault`), as a `move` of something out of range does: a person names only what is in range, and Acting says every rule that governs a person governs an NPC. The range walk is charged to steps.
- **Cascade depth.** An `act` runs one deeper than the reading it stands in, a typed command's being 0, so at the default of 20 a turn's `act`s nest twenty deep; it is checked with the same meter a message's depth will be. How deep an `act` in a handler runs, one deeper than the event it handles, is B32's.
- **What an `act`'s reading says, and `nothing_happens`.** Its lines, heard from the NPC by whoever would hear its `tell`, less the participants of its own reading, join the reading it stands in, in body order, with what it sends and destroys. It is never answered with `nothing_happens` itself; only a person's own command is, so a person who acts through `act` in their own `do` is answered once, by their command. Decision 61, that an NPC's reading which says nothing has no output, is built here with it.
- **A refused `act`.** Its consent pass's refusal is said as its actor's reading's whole output: from the NPC, to whoever would hear its `tell`, which leaves out the participant that refused. The body that ran it goes on, as after a refused `move`; whatever Open 71 decides for `move` should decide this too. The refusal carries the refusing play's `actor`, `here` and roles for its slots, a `let` inside the `permit` not among them, and a typed command's refusal now carries them too.
- **An actor its own `act` destroyed.** The body that ran the `act` ends there, since its `self` is gone; nothing after it runs, and a `destroy self` it asked for is not done twice.
- **What an `act` costs.** One step for the statement and one for each name it evaluates, then the range walks, then its reading's own statements; the `act` charges nothing for itself.

Found while refusing actors where actors cannot stand, each decided the narrow way and awaiting Eric:

- **Where the refusals are said.** At the object's name, all three: an actor that is not an NPC; an NPC written in the body of something that holds no actors, as for something that holds nothing; and one written directly in the body of a world that holds no actors, pointed to the first place in the tree, as the arrival refusal is. An object told it is not an NPC is not also told where it stands.
- **What is absent decides nothing.** With no visitor kind (refused or absent), an actor is not told it is not an NPC, and is still refused where it cannot stand; one in a container whose kind is absent, or directly in a world whose kind is absent, is told nothing.
- **In either mode.** Both refusals are refusals at load too, as the refusal of an object in something that holds nothing is.
- **A spawn the compiler can see is wrong.** A spawn of an NPC kind into something whose kind the compiler knows holds no actors is not refused at compile; the spec lists it only as a fault, and it faults when it runs (`holds-no-actors`), checked after a container that holds nothing.
- **An exit to something that does not hold actors.** Not built: exits are not read yet, so B28 refuses it beside the exit on something that is not a place.
- **`here`.** The actor's container, which holds actors; an actor found in one that does not is an engine error, which nothing but a stored state can make (Open 75). A move of an actor is between two places, so the notices are spoken for every one.

Found while nesting objects and composing with `is`, each decided the narrow way and awaiting Eric:

- **The spec's leftovers of `in`.** Identifiers and scope still read an object's `in` from inside the world and stated the hiding rule twice, and What absent means kept a row for a container in an object's `in`; both went with this change, since Objects already says a declaration never names its container.
- **An `object` at a file's top level.** Read whole, so what its body gets wrong is said too and nothing in it is taken for the next declaration, and refused by the parser at `object` and its name, with the remedy to move it into the world's braces or its container's. The file is then one that does not compile: at load it reads as absent, as any such file does. The same holds in a library's files, so the second-tier refusal of an object in a library goes; a world in a library is still refused, and what its body holds is not read.
- **An object in a kind's body.** Parsed as a member, and read: every instance of the kind is given a copy (Open 68, and "Found while giving kinds their contents" below).
- **An object that still names its container.** `object cushion is Bench in hall.bench` is read, refused at `in` with the remedy to take the `in` out and write the object inside the braces of what it named, and kept; a path after the `in` that is itself malformed is refused as well.
- **The colon written for `is`.** The kinds after it are read and kept, and the colon is refused at itself with the whole line written with `is` as the remedy; where what follows it is not a kind, that is said too, and the remedy writes `<Kind>`.
- **A path's dot at the end of a line.** A dot followed by a word on a later line ends the path, refused as a dot left over, since in a body the next line is the next member: `visitors arrive at kiln.` does not take the `visitors` below it as a step.
- **A stray `}` in a nested object's body.** It closes the object, and what follows is read by the body around it, where it is kept; only a top-level body names members written after its `}`, since after an object's `}` the members of the body around it follow as a matter of course.
- **Which world's body holds the objects.** The first `world` the world's own files declare, whatever its name; a second is refused (or a gap at load) and what it holds is not read.
- **The arrival refusal beside a refused file.** Said at publish even where another of the world's own files was refused, since the world's body is one block in one file and the refused file cannot be where the place is; two corpus worlds that arrived at a place they never declared now declare it.
- **Orders.** The tree places shallowest first and in the order written within a depth, which is the order its `placed` map keeps and the arrival remedy's "first place" reads; the bundle's objects are listed in the order written, each before what it holds.
- **Nesting depth.** Each object body is one level of the parser's own depth bound, as a block's braces are, so a nest past it is refused once as too deep; the tree itself is placed by a loop.
- **What `sprout check` counts.** Its summary counts every object in the world's body among the world's declarations, so a world says the same number it did when objects stood at the top level.

Found while giving kinds their contents, each decided the narrow way and awaiting Eric:

- **Where a content's own mistakes are said.** Once, at the content in the kind's body, whatever holds the kind: an object in a kind that holds nothing, or inside a content that holds nothing, is refused with the words for something in the body of what holds nothing, naming the kind or the content; two of one name in one kind's body are two of one name there, at the second. What is refused is given to no instance.
- **A content made of a kind it is already inside.** `kind Box { contains object inner is Box }` would give every box a box without end, and so would a loop through several kinds. The spec is silent; refused at the content that closes the loop, "`inner` is made of `Box`, which it is already inside, so every `Box` would hold another without end", with the remedy to take it out or make it of kinds that do not compose `Box`, and cut, so what is left is finite in either mode.
- **Where a clash of names is said.** A name the instance's own body also uses, or that two kinds in its closure both give, is refused per declared instance at the second declaration in closure order, with today's words naming the instance's path: at the instance's own object where it is its own, and at the second kind's object where two kinds clash. A kind whose closure clashes and that no declared instance is made of is not refused; a spawn of it makes both, since a spawned instance's contents have no identifiers.
- **What each instance is told about its copies.** The hidden-name warning and the actor refusals are said for each declared instance at the kind's object declaration, naming that instance; words that come out the same for two instances are said once.
- **A content whose kind is absent.** A declared instance's copy is placed without a kind, as a declared object of an absent kind is, so what it holds keeps its place; a spawn makes neither it nor what it holds.
- **What a spawn makes.** The instance, then each content after what holds it, what a holder's kinds give before what its own body holds; each takes a minted id and one arrival, in that order. Each is charged against the turn's spawn budget and counts against the host's live-instance bound, and the spawn makes all of it or, faulting, none. An actor the contents would stand in something that holds no actors faults the spawn as `holds-no-actors`, naming the spawn's container. Nothing is sent for the contents (Open 76).
- **How a spawned instance's content is stored.** As made `given`, with the kind whose body writes it and its path there, `{ from: given, kind: printers_shop.Lantern, path: [wick] }`, under a minted id. At load it is read against what that body writes at that path now, and kept dormant where it writes nothing there.
- **What is counted.** The `objects` cap counts each copy a declared instance is given, and `places` each copy that holds actors (Open 77). `sprout check`'s summary counts declarations written, where a kind's contents are part of the kind, and not one per instance. The compiler bounds the copies only by the host's `objects` cap, so a world whose kinds nest many contents in many instances is as large as the host lets it be.
- **What a kind's body is checked as.** Each content's body is checked once, against its own anonymous kind composed in the library that wrote it, however many instances are given it, and a content no instance is given is checked all the same.
- **Naming a content from the kind's own bodies.** `wick` inside `Lantern`'s handlers resolves with identifiers inside bodies, B32's; until then it is refused as a name nothing answers to, as a dotted target is.

**Decided, and different from what was built.** Each has an issue, so the code catches up rather than the spec drifting.

- A comment is also `/* … */`.
- The escapes are `\"`, `\\`, `\n` and `\{`, in quoted text and in a passage alike; `{{` is gone.
- A world's `version` is semver.
- An enum's options take an optional trailing comma, are capped at 100 by the host, and may not be reserved words; the reserved words are now listed under Lexical rules.
- A default option may be written qualified, `:ward Ward.iron` or `:ward sprout.Ward.iron`, and bare in a restatement, where the type is already known.
- A list's element type may be a list.
- Two lists are not compared with `==`; set and ordered equality are a later level's, and the runtime's `equals` goes.
- There is no nesting cap. The parser still has to bound its own recursion, and whatever it does about that is the compiler's own affair rather than a host limit.
- `chance(n)` is one in n and `random(n)` is 0 to n − 1.
- `sprout.World` is written on every world (`world w is sprout.World { … }`), as that literal and not an unqualified `World`, refused when missing, and refused on anything but a world. Eric restated this on 2026-09-22 after first deciding the opposite: level 1 is explicit wherever it could have defaulted, since a later level can relax a requirement and never add one.
- The manifest has an optional `namespace`, falling back to `name`, and the one `world` declaration repeats `name`; none, two, or another name is refused.
- A static cap exceeded at load refuses the world, unless the host has recorded an exception for it.
- Spawns per world per hour is gone; live instances per world is the host's storage decision, faulting a `spawn` when it is reached, rather than a figure in the table.
- The claim that a `let` costs fewer steps than the reads it replaces is gone; a `let` is charged as a statement.

**Confirmed as built**, with the spec now saying so where it did not: which side of a verb knows the other is the author's choice; an unset host limit is unbounded; blessed libraries are exempt from the file cap as well; a part's language level is declared, not derived; an author is text; a default is always written; `min` and `max` may be written in either order; `[]` is a fine default for a list that wrote its element type; `count` on a list; the list cap is a refusal when written and a fault when grown past; adding a held element to a full list does nothing; where a `let` may be written; `let x = spawn …` waits for B18; a world must say what its visitors are and where they arrive; `pass any (false)` is the language's default; what a world holds is a property like any other; a missing arrival place is the host's to refuse; the diagnostic gutter is the tool's; `$first` and `$last` are boolean, `$index` and `$count` integer; precedence is the conventional order, now written down; a `set` whose value is only known at run time faults rather than being refused.

Two things worth keeping from the earlier sweeps, because they read like holes and are not: two object bindings of different kinds may be compared, since asking whether the mover is the actor is the point; and `chance` and `random` are not read until B33, whose reachability rules are the whole of what makes them safe.

One future thought recorded on the way, for the registry discussion in the backlog: a host may one day decline to store a vendored library whose hash matches one it already holds, and serve the shared copy instead.

*Closed on 2026-09-20, against the five reviews:* an open role, a handler's sender and an unfiltered loop variable are of the bare object type and are read only through `is()`; `each` is defined; `:remembers` uses the property declaration syntax; NPCs compose the visitor kind, have a name, read nothing, act with `act`, and do not keep a place ticking.

*Closed: range and visitors are in the world model; `let` is specified; type parameters, stateful alternatives and stored references were all decided against; listing contents needs no convention, since `{thing}` renders an object's name; `look` and `examine` render a `describe`, and `text` is the statement that writes inside one.*

### Decisions

**Type parameters for standard library kinds — decided against.** Roles dissolved the case. A library kind carries the verb, the role and the state it can name itself; the world composes in a second `permit` that reads its own enums. Both run, either may refuse, and neither kind mentions the other's types. Locks, vending and growth stages all split the same way, so the pattern is general: *the library supplies behaviour, the world supplies vocabulary.* Generics would have touched composition, property merge, `is()`, disambiguation and the printer, for a benefit we can no longer name. *Revisit only if the standard library draft produces a kind that must itself read or write a world-typed value.*

**Roles bind objects only — closed by value roles.** A verb's roles were filled only by things in the world, so `ask [target] about [topic]` had no shape: a topic is not an object. That was the dialogue gap the reviews raised, with a precise cause. A role that binds a symbol from a declared enum, or an integer in a range, answers it and covers `set [dial] to [number]` too; the spec's Value roles section is the result. *Closed.*

**Stateful text alternatives — decided against.** Ink's other three forms (sequence, cycle, once-only) each need to remember where they got to, and that counter would be undeclared state: missing from the property map a moderator reads, keyed to a source position that moves when an author adds a paragraph, and multiplied per visitor if it is to mean "the first time *you* saw this."

The explicit form is also more correct, which settled it. A sequence advances on each *render*, and a description renders on every poll, so "the first time" would be spent by a poll caused by somebody else acting in the room. Authors mean the first *visit*, and only a counter they wrote can say that. A counter in `:remembers`, incremented in `on :entered`, is three lines and says what it means. *Revisit only if authors keep writing the same counter.*

**Weighted variation.** Evennia's ambient messages weight their random selection so a common line and a rare one can share a set. `{one of}` is uniform. *Small, probably worth it.*

**Disambiguation on state.** TADS ranks candidates at runtime through `verify()`, so an open box beats a closed one for an action needing an open container. Our typed slots rank on type only. Static and checkable against dynamic and more expressive. *Deferred until a world wants it.*

**Stored object references — comparison-only stands, with links as the exception.** The prior-art case against us dissolved: Inform's `matching key` holds one specific key, and roles express "any key cut for brass wards" better than a pointer can. Most other reference-wanting cases turn out to be queries or flags — who is It is `:team` on the visitor, not a pointer to a player — and a flag survives its referent being destroyed where a pointer does not.

Only dynamic topology was irreducible, and it is answered by `link` and `connect` rather than by general references. A link's destination is write-only from the language's side: assignable from a binding, never readable into an expression, so no null is observed, nothing dangles, and nothing can `get`, `send` or `each` through it. The map grows and the message graph does not. *Closed.*

**Nickname reservation expiry.** Reclaimable nicknames mean a world's namespace grows with every unique visitor it has ever had. Whether reservations lapse is host policy, but a popular world eventually runs out of good names.

**The eight-role cap.** Untested — the worked example never needed more than two roles on a verb. It is the cap most likely to be wrong in one direction or the other. Like every limit it is now a host default, so being wrong costs a configuration change rather than a language change.

**The step budget's number.** The spec's default is 50,000. LambdaMOO has run foreground tasks on 30,000 for decades, against a language with real loops and recursion. Ours is probably generous; instrument before fixing it, and remember it is the host's number.

**Actor-less turns — decided for a static rule with an escape hatch.** Two of the reviews wanted opposite fixes: refuse `actor` statically wherever a body is reachable from a tick or a wake, or let it be a runtime no-op. Reachability would have forbidden `actor` in every `:entered` handler, since an NPC can arrive on a tick; a runtime no-op is a silent lie. The spec does neither. `actor` is bound by *member kind* — role bodies and `describe` — and never in handlers, hooks, ticks or wakes, which is static, exact and needs no reachability. What handlers lost they get back two ways: `tell <x>` addresses any actor they have bound, and `act` lets an NPC start a reading in which it *is* the actor, so "the cat licks you" is an ordinary verb with a real actor and a real target. The `:entered` idiom becomes `item.adjust(:visits, 1)`, keyed on the thing that arrived rather than on an actor that may not exist.

**Silence — decided against, everywhere.** A reading that says nothing to the actor is answered with `nothing_happens`; the compiler warns about a verb nobody `say`s for; built-ins are library verbs with passages; arrival renders the description; refusals always have text. The reviews' worst transcript had sixteen silent turns, and every one of them now prints something.

**Typing — exact, at the cost of `is()`.** The union rule over role-players was computable and fragile; declaring a kind on every role brought brand kinds back. The bare object type is the third way: an open role is an object, and reading anything through it requires narrowing. One `if` per cross-kind read, and no read is ever unchecked. Messages declare their carried type for the same reason.

**The poll is a turn.** Read-only, snapshot-isolated, own step budget, no seed, no log, cacheable by world version. Making views a by-product of write turns was the cheaper runtime and the worse language: it would have charged a busy room's every action for every bystander's view. A poll that is a turn has a budget the host sets and a fault the author owns.

### Not language questions, but blocking

Author-facing tests and a way to inspect what the parser will accept. Both are real gaps from the reviews, neither is answered by the spec, and both are what an author reaches for the first time something does not work. (The dialogue model is answered by value roles; the view's exported readings are most of what a parser inspector needs to show.)
