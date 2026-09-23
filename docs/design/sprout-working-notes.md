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

Swept on 2026-09-22. Eric answered every hole Phases 0 and 1 had recorded, in comments on the review page, and the spec now says what he decided; the entries below are what remains, then what changed under code already built, then what only confirmed it. A hole found from here on is recorded here and swept the same way, rather than accumulating.

**Still open**

- **The colon does too much.** `:season` is a property, `:remembers [visits: 0]` a key and value, `act nuzzle (target: p)` a label, and an option is `wet` in a declaration and `:wet` in an expression. Composition is decided, below: it is written with `is`. The rest of the proposal is not decided: keep `:name` for properties and messages, since that is the spelling authors read most; spell an option by its enum everywhere, `Ward.iron`, with the bare `:iron` kept only where the enum is already known from the other operand; and write a `:remembers` entry exactly as a property is written, `:remembers [:visits 0 min 0 max 99]`, which removes one use of the colon outright. The label in `act` stays, since a space after the name already keeps `target: p` from lexing as a symbol.
- **Roles.** Being settled one question at a time with Eric, 2026-09-22 onward. *Settled so far:* the word for a non-target role is a tool; a verb may have no tools or no roles; a tool some phrase leaves out is optional and is read only under `if (bound x)`, with no value standing for an unbound one (the spec's Optional tools); a `symbol` tool with no `from` is never bound for that role-player and may not be read at all; every value tool is optional, since a typed value outside the offered options (*ask the guard about potatoes*) or an integer outside its range, or any value tool with no `from`, arrives unbound — which closes the first two of the three questions. *Closed 2026-09-22:* `many` on a value tool is refused at level 1; a later level may add a set of values bound as a list, all or nothing, and the four points that shape (no per-value participant, no `each` over a list, partial runs, the run-splitting rule) are the page to write then. The roles hold is lifted: B23, B24, B26 and B27 may start.
- **Whether a withheld file changes the bundle's hash.** Deferred until the publish, share, repository and library-versioning story is settled.
- **The register of the stock lines.** Long-term, and not a blocker.
- **Whether a world's body may be continued across files.** The world's body is one block in one file, so every object is declared in the file that declares the world, and a file holding only kinds, enums, verbs and messages needs no world. Whether a large world may split its body across files, and how, is open; so is what lenient loading makes of a world file that fails to compile, since every object is in it and the world then admits no one.
- **Whether a kind may declare initial contents for every instance.** Not now: a kind has no instance of its own to hold objects, so an `object` in a kind's body is refused and what a thing starts holding is written in its own declaration.
- **Contents of a destroyed object:** fall (as written) or destroyed with it; Eric prefers destroyed, pending the visitor rule (a visitor anywhere inside would then fault the destroy).
- **`finally destroy self`**, a one-shot form whose cleanup runs after the body's sends resolve: proposed, #141.
- **The `:entered` for what falls out of a destroyed object.** Destroying says the container receives `:entered` for each thing that fell, and that message names the destroyed object as its `from`; the same section drops every engine message that names the destroyed object as its `from`. The spec states both until Eric says which gives way.
- **Found by the 2026-09-21 review.** A symbol literal on the left of `==` is refused by the checker; the spec now says either side, and #86 brings the code to it. *Decided 2026-09-22, now in the checker table:* an integer literal outside the other operand's range in a comparison is refused, on either side and for every comparison operator, because the answer is known before the world runs; #86 brings the code to it. An exit's `when` guard may `get` through an identifier, a `get` through one out of range is a fault, and guards run on every poll, so a poll can fault through a guard; the unset-link rule (does not apply) is the likely answer.

**Decided 2026-09-23**, now in the spec:

- Range reads the path rule: an object reaches a target when nothing strictly between them on the tree refuses.
- Range goes nearest first, a ring at a time, breadth-first within a ring and each container's contents in its order; a broadcast delivers in that order.
- What a kind leaves out with `without` stays left out in every kind composing it; a copy of the member reaching the composer through another kind still runs.
- `visitors arrive at` never names the world, even one that declares `contains actors`.
- An object hiding one of its name further out is warned about at the inner declaration, naming the outer one's path; objects in sibling containers hide nothing.
- Composition is written with `is`, `kind Creature is sprout.Actor, Fragile`; the colon form is refused with the `is` form as the remedy.
- Pending wakes per object is a host cap, 1 by default, and a `wake` past it faults as a `spawn` past live instances does.
- A library's `version` is semver.
- Objects are declared inside the body of what holds them; the parse tree is the containment tree; `in` and its refusals and the `container` absent row go.
- An identifier belongs to the body it is written in and is seen from inside it at any depth, nearest wins; a dotted path names anything deeper, and the world's `visitors arrive at`, written in the world's body, names a nested place by one.
- Kinds stay at a file's top level and hold no objects: an `object` inside a kind's body, or at a file's top level, is refused. The world's body is one block in one file, and a file holding only kinds and enums needs no world.
- Refused: an object inside something whose kind does not hold things; the world's name as a step of a path; two objects of one name in one body.
- What `objects`, `places` and `kinds` count, under Static caps.
- A `spawn` of `sprout.World`, or of a kind that composes it, is refused; so is `destroy self` in the world's own body.
- A destroyed object has no effects: messages queued to it, messages it sent that have not been delivered, engine messages naming it as their `from`, and its pending wakes are all dropped. Its contents still fall to its container, and a visitor standing directly in a destroyed place still faults the destroy.
- A `spawn` whose target is out of range or does not hold things when it runs is a fault, never nothing, since there is no null to bind; a spawn into the world is allowed where the world is in range.
- The absent table has a row for a kind named in a `spawn`: the `spawn` faults when it runs.
- The host's live-instance bound counts every instance it stores, dormant ones included.

Composing with `is`, refusing arrival at the world, the shadowing warning, range's path rule and declaring an object in the body of what holds it differ from what is built or being built, and the code catches up.

**Recorded since the sweep, awaiting Eric.** Found while building containment (B13), each decided the narrow way:

- **Whether `contains actors` implies `contains`.** The standard library's own `kind Place` declares only `contains actors` and holds a bench, so it implies it, and `contains` is true wherever either was written.
- **Whether writing either of them twice is worth saying anything.** *How members combine* calls both idempotent under composition; one body writing the same line twice is treated the same and nothing is said. A warning for a redundant one is B50's to add.
- **Whether a world may declare `contains actors`, and so be a place itself.** Nothing forbids the line, so it is accepted and the world is a place if it says it is.
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

- **How the standard library travels.** From the CLI as one known copy, blessed, and pinned by `sprout init`; every manifest names it, and one that does not is refused for a missing `sprout.World`, with a remedy that names the library.
- **What visitors are made of.** The visitor kind must compose `sprout.Actor` and be the world's own kind. `visitors are Hall`, where `Hall` is not an actor, is refused at the kind; so are `visitors are sprout.Actor` and any other library's kind, since the world's own kind is where "whatever this story needs a person to have" is written.
- **A visitor kind absent at load.** The absent table has no row for it. It is treated as the `world` row's consequence: the world admits no one, and the gap is recorded under `world`. At publish it is refused, and not said while one of the world's own files was refused at the first tier, as for the arrival place. So is a kind the world composes that nothing declares. Proposed as a row, or as part of the `world` row's wording.
- **Where an NPC may be declared.** An NPC needs no place among its ancestors, and an actor may be declared inside something that does not hold actors (a cat in a basket); both are accepted, since where an actor may be moved is B22's and B42's.
- **Erasing what the world remembers about a visitor.** Not built: the spec gives only the memory panel, which lists everything every object remembers about an actor, dormant objects included, and only what was written, a remembered property never written about them reading as its default. Whether a visitor may erase it, and how, is open.
- **An actor that is not an NPC.** Whether an object composing `sprout.Actor` but not the visitor kind is an actor that cannot `act` is open; `isNpc` answers only whether an object composes the visitor kind.
- **`sprout.Actor` has no guards or relays yet.** Until B22 and B32 land, it declares no `depart`, `release` or `accept` and no `pass any (false)`, so a pocket is visible: what a visitor carries is in range of the people beside them.

Found while building spawning and destroying (B18), each decided the narrow way and awaiting Eric:

- **A spawn target of the bare object type.** Accepted at compile and checked when the spawn runs, since the worked microworld writes `spawn Sheet in here` and `here` is the object type. A target known to be a value or a set is refused, and so is one whose kind does not write `contains`.
- **Spawning an actor.** An actor kind, or the world's visitor kind, may be spawned; the spec's Spawning names no exception.
- **Where `spawn` and `destroy` are refused.** What it refuses forbids both in a guard, a `permit` and `describe`; the items that read those bodies (B22, B24, B31) refuse them there, with a `let` naming a spawn.
- **The target's grammar.** `in` takes a binding or an identifier, or a dotted path to one, written without spaces around its dots as a dotted path elsewhere is. `destroy` takes only `self`, and anything else after it is refused once.
- **A dotted target.** Refused, as a name nothing in the body answers to, until identifiers inside bodies resolve (B32).
- **A message naming a destroyed object as `from`.** Dropped. Decided 2026-09-23: a destroyed object takes everything pending on it with it — messages queued to or from it, engine sends naming it as `from`, and its pending wakes.
- **The destroying body's own sends.** Dropped. Decided 2026-09-23: a destroyed object has no effects, so what it sent in the body that destroyed it goes with it.
- **What a destroyed object held.** Falls to its container without consent, as Destroying says, each thing placed last in that container in the order it was held, so the fallen keep their order after whatever was already there. Decided 2026-09-23 as the spec is written, until Eric confirms a change: his preference, pending, is that what it held is destroyed with it.
- **The `:entered` for what fell.** One per thing, in falling order, `from` the destroyed object. The destroy returns them and the queue drops them under the no-effects rule above, since their `from` is gone, so the container is never told. Destroying still says the container receives `:entered` for each thing that fell, which that rule contradicts; the contradiction is recorded for Eric, and the rule lives in one place, the queue's, whichever way it goes.
- **A visitor standing directly in a destroyed object.** A fault, whatever the object is. Decided 2026-09-23. A visitor further in — in a box in the room — moves with what holds them.
- **`destroy self` on a visitor's own instance.** A fault. Decided 2026-09-23.
- **Spawning into the world.** Allowed where the world is in range of the spawner, which it is when every container between them passes. Decided 2026-09-23.
- **A spawn target out of range, or holding nothing, when the spawn runs.** A fault. Decided 2026-09-23. A target that is not live, the spawner's own self included, is out of range.
- **A kind absent at load named in a `spawn`.** The `spawn` faults when it runs. Decided 2026-09-23, as a new row of What absent means, which the spec and the compiler's absent table do not carry yet.
- **Dormant contents of a destroyed object.** Left where they are: a dormant record is kept untouched, so it still names the destroyed object as its container. When its kind returns it decodes into a container that no longer exists and is not live; where it goes then is open.
- **How the host's bound reaches a turn.** As a number per turn, recorded with the turn (B40), not a callback into the host, so a replayed turn faults exactly where it did.
- **What a spawn tells.** The container `:entered (item, from)`, the new object as `item` and the spawner as `from`, then the new object `:spawned (from)`, in that order; the engine is the sender of both.
- **`destroy self` twice.** Is once: it takes effect when the body ends, and a second in the same body changes nothing.
- **Memory keyed by a destroyed NPC.** Kept: what an object remembers about an actor is its own, and a destroyed actor's id is never minted again, so the entry can name no one else.

Found while building passages (B20), each decided the narrow way and awaiting Eric:

- **A composer's own `default` beside a composed non-default of the same name.** How members combine says a composer's own exclusive member always replaces what it composes, and that a default yields to any passage of the same name from any other source; for this case they disagree. Built: the composer's own applies, and stays a default, so it still yields further up.
- **A default rewritten over a default.** `W: K, A` where `K: A` wrote its own default over `A`'s: two defaults from two origins reach `W`, and they collide, as a restated property from two origins does.
- **Where a library's replacement lines go.** A register library composed onto the world replaces `sprout.World`'s lines but not `sprout.Place`'s or `sprout.Actor`'s, since a passage is the kind's; the spec's "a second library supplying the lines the first left out" says nothing about which kind it is composed onto. And a register that writes its lines as `default` collides with the standard library on every shared name, so under the rule as written a register replaces stock lines only by writing non-defaults.
- **A typo in an override.** `passage nothing_happen` in the world overrides nothing and is not refused; no warning is listed. A warning for a passage nothing invokes would be B50's.
- **After a refused collision.** The first contender in list order is kept, as the property collision keeps its first, so a kind composing the refused one hears nothing more about that line; and when non-defaults collide the refusal names only them, not the defaults that gave way.
- **`default` on an object's or the world's own passage.** Accepted and recorded, though nothing can compose it.
- **A passage's name.** Any lower-case word, as an object's name may be; only `default` in the name position is read as the keyword. A reserved word as a passage's name is not refused, as it is not for a verb, a message or a kind today.
- **A lone `}` in prose.** There is no way to write one: only `\{` is an escape, so an unmatched `}` closes the passage and `\}` is refused, stepped over with the character after it as a bad escape in quoted text is.
- **Quoted text in a slot.** Ends at its line with no refusal until B29 reads slots; in prose a quote is a character.
- **Where a passage's header may sit.** Its words on the `passage` line, the brace on that line or the next; a header left without braces then never takes the next member for its own.
- **`{item}` in `arrives` and `leaves`.** Untyped by the binding table until B29 and B42 say what a place's notices bind.
- **A world whose composed kinds lack an engine passage.** A forked standard library without `fault` or `displaced`: what the engine says then is B34's and B48's.

Found while building library namespacing (B21), each decided the narrow way and awaiting Eric:

- **A world namespaced as a library it pins.** Its own bare names and the library's could not be told apart, so the manifest is refused. The spec says only that a world's own declarations are unqualified.
- **A library's message written qualified.** Libraries namespace messages, but no syntax writes one qualified (`send x sprout.:m`?): a message name is a bare symbol wherever it is written, so a library's message is reachable only unqualified, and only when the world declares none of that name. Open until B32 reads sends.
- **What the shadowing warning covers.** Kinds, enums and messages, being what libraries namespace today; verbs join when B23 declares them.

Found while reading, checking and composing the consent guards (B22), each decided the narrow way and awaiting Eric:

- **A guard's parameters.** Positional, named as the author chooses: one for `depart`, two for `release` and `accept`, and any other count is refused. `to` and `from` are reserved words, and the spec's own guards name parameters with them, so those two may name one and no other reserved word may. `_` for a parameter left unnamed waits for the lexer to read it, as a handler's does (B32); until then every parameter is named.
- **What follows `allow` or `refuse` in a block.** Accepted, and never runs; a warning for it is B50's.
- **A guard written twice in one body.** Refused at the second, as a passage written twice is, and the first kept.
- **`release` or `accept` on something that holds nothing, and `depart` on the world.** Accepted, and never asked, since nothing can leave or enter it and the world never moves.
- **How a `without` travels.** What `B` leaves out stays left out in `D: B`, even where `D` reaches the source another way (`D: B, C` with `C: A`): suppressions accumulate through the closure, and `KindRef.suppressed` holds a kind's own and every one it composed. Answers "A `without` in a kind that is itself composed" in the B19 list above.
- **Where `refuse <name>` looks.** At the passages of the kind that wrote the guard, composed ones included; the evaluator looks the passage up on the refusing instance's kind at run time, so a composer's own line replaces a library default.
- **What a guard may say as a statement.** A call that writes or remembers is refused as a write, and any other expression standing as a statement is refused as reading without doing, as everywhere. `say`, `tell`, `send`, `move` and `act` are not read as statements yet; in a guard they are refused as statements this compiler does not read, until the items that read them refuse them there by name.

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
