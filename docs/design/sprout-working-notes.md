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

Each of these is referenced somewhere in the spec and defined nowhere. None is hard; all are load-bearing.

- **Which side of a verb knows the other.** The worked example's lock narrows `tool.is(Key)` and reads `:opens`, so the lock knows keys have wards. Pushing it to the key means reading `target.get(:ward)` instead: the coupling moves rather than going away, and nothing says which side should carry it by convention. The standard library will set the precedent either way.
- **The register of the stock lines.** `sprout.World` and `sprout.Actor` now speak for the engine — "You take the brass key.", "Nothing much comes of that." — and every line is a `default` passage, so a world replaces one by writing it and replaces all of them by composing a library that supplies them. The standard library's own lines will evolve; they were written quickly and should be written well, and voice libraries are the way to offer alternatives without touching them.

Found while building the foundations (B01), all four lexical and all four decided the narrow way, which is the way that can be widened later:

- **What a comment looks like.** The spec never says; its own examples use `//` to the end of the line, and that is what the lexer reads. The previous language also took `#`, which is gone.
- **What `:` means when no lowercase letter follows it.** `:season` is a property and `kind Creature: sprout.Actor` is a composition, and they share a character. The lexer reads `:` plus a lowercase letter as a symbol and a bare `:` as punctuation, so `kind Creature:sprout.Actor` written without the space would read `:sprout` as a symbol. Every example in the spec writes the space.
- **What a backslash means inside quoted text.** Prose has `{{` for a literal brace; a quoted string has nothing stated. `\"`, `\\` and `\n` are taken and anything else is refused, so an escape the language adds later is not already spelling something.
- **The gutter of a printed diagnostic.** The spec's three examples are hand-set and their gutters disagree by a column. A group is aligned to its widest location plus two spaces, which is what two of the three do.

Found while building the limits (B02):

- **What an unset host limit means.** Five static caps (places, objects, kinds, files, total source bytes) and the wall-clock backstop have no figure in the spec — "as the host says", "a backstop that should never fire" — and nothing says whether a host that sets none leaves a world unbounded or refuses to load it. Unset reads as unbounded, because a language library cannot invent a host's quota and the step budget is what actually bounds cost.
- **Where the three world-scoped budgets are counted.** Spawns per world per hour, live instances per world and pending wakes per object sit in the runtime-budget table, whose preamble says the budgets are per turn. They are not: they are per world and per object, and outlive any turn. The turn meter names them and does not hold them.

Found while building the closed bundle (B03):

- **Whether the file cap counts library files.** The exemption is stated for "the source and kind caps" and the file cap is not named. Blessed library files are exempt from it too, since "using the standard library costs an author nothing" is the point of the exemption; an unblessed copy counts, files and bytes alike.
- **Where a part's language level comes from.** A bundle's level is the highest of any of its parts, and *where each part declares its own* is now in the spec: the manifest for the world, alongside the source for a library. What is still unsaid is how a declared level is checked against the syntax actually used — “added syntax raises it” describes a derivation nothing can perform until there is a parser that knows which syntax raised it, so today a part's level is taken on trust.

The bundle carries two things the spec's list does not name: the size its source came to, so that what was counted against a cap and what was exempt is legible rather than re-derived; and the bundle's own hash, which the log already records beside every publish.

*Closed on 2026-09-21, by Eric, against B03:* **what a manifest holds.** It carries the world's name, its version, its author, its licence, the version and content hash of every library it vendored, and an enumeration of its own `.sprout` and `.prose` files — plus the language level it was written for and the extensions it pins. **The spec now says so**, in *The manifest*, under the world model, so none of this is a decision standing outside it any more.

This makes two checks possible before a line has parsed, and both are now made: what travelled is exactly what the manifest enumerates, and every vendored library's source hashes to the `sha` the manifest recorded. A library whose source is not the recorded source is not used at all — running a world against a library it did not mean to vendor would be worse than running it without one.

Still unsaid, and decided the narrow way: whether a version is semver or free text (free text, non-empty), and whether an author is a name or a structured record (a name). B12's `world` declaration will have to agree with the manifest's name, or replace it.

Found while building enums and the declaration parser (B05):

- **How an enum's options are separated.** The spec writes `enum Ward { oak, silver }` and never says whether the commas are required or whether a trailing one is allowed. They are required and a trailing one is refused: the narrow reading of the examples, and the easy one to loosen.
- **What bounds an enum.** The static caps table has no cap on options per enum, where the previous language had twelve. The silence sits beside an explicit "there is no limit on statements in a body", so it reads as deliberate and none is enforced. A one-option enum is accepted as an ordinary type with one value; a zero-option one is refused, since nothing could ever hold one.

Found while building property and message declarations (B06, B07):

- **Which literal a type can be taken from.** "The type may be written or taken from the literal" holds for a boolean, an integer and a string, each of which names its own type. It cannot hold for a bare option: `:ward iron` says nothing about which enum `iron` belongs to, and every example in the spec that defaults to an option writes the enum first (`:state Drying default wet`). A bare option with no written type is refused, saying so. The worked example's `:ward iron` is a RESTATEMENT of a property `Warded` already declared, which keeps the type and changes only the default — that path is B19's, and it is the only way a bare option stands alone.
- **Whether a default is optional.** "A property is a name, a type, and a default" reads as all three, and every example writes one. A written type with no `default` is refused: there is no null for a property to hold instead, so a type with no default would have nothing to start at.
- **Whether a list may hold a list.** A list is "a bounded, ordered collection of one element type", and nothing says whether that element type may itself be a list. `[[Ward]]` is refused, which is the narrow reading.
- **Where an integer's range may be written.** The spec shows only `:wear 0 min 0 max 99` — the literal form, min before max. Both bounds are accepted with a written type as well, each is optional on its own, and they may be written in either order, none of which the spec forbids.

- **Whether an enum's options are reserved words.** *Reserved names* reserves engine message names, engine verb names and the member words, and says nothing about an enum's options — so `enum Setting { boolean, custom }` is legal. But `boolean`, `integer`, `string` and `object` are read as types wherever a type may be written, so `:x boolean` meant as "default to the option" is refused. Writing the type out (`:x Setting default boolean`) works, so nothing is unreachable; the four words are simply not usable in the type-from-the-literal shorthand. Left as is rather than reserving them, because reserving words the spec does not is the larger change.
- **Whether a type can be taken from a list literal.** It cannot, for any list — not only an ambiguous one. `[]` says nothing about what it would hold, and a rule that infers from `[true, false]` and not from `[]` would be a rule an author has to remember the edge of. A list property writes its element type.

- **What "expression and block nesting" counts.** The static caps table caps nesting at 8 and does not say whether a list type or a list value is a thing that nests. The parser has to bound its own recursion either way — without a bound, seven thousand opening brackets crash the compiler instead of refusing — and it counts brackets against the host's `nesting` cap rather than a number of its own, because a limit the language invented would be the one thing Limits says the language never does.

One asymmetry worth writing down, since it is consistent in the spec and easy to get backwards: a symbol is written BARE in a declaration (`default wet`, `:ward iron`) and with a colon in an expression (`state == :wet`, `self.set(:cuff, :damp)`).

Found while building strict publish and lenient load (B04):

- **Which passage tells a visitor a world cannot admit them.** The absent table's row for a missing arrival place says the world "does not admit anyone, and says so", and — unlike the row above it, which names `displaced` — does not say through what. `displaced` is the obvious guess and the wrong one: "The place you were standing is gone" is not true of somebody who never stood anywhere. The row names no passage until this is answered. (The other two rows that tell somebody name passages the standard library declares: `displaced` and `missing`.)
- **What a static cap exceeded at load means.** The lenient rule is stated for "a file that is missing, withheld or broken" and says nothing about a cap. Refusing would darken a world that was accepted at publish, so a cap is a warning at load and the host decides whether to run it — the same shape as "a world accepted at one level keeps loading when the language tightens", and the decision B43 makes explicit.
- **Whether a withheld file changes the bundle's hash.** The log records a publish with the bundle's hash and a withholding as its own event. A load with a file withheld hashes what arrived, which is honestly not the published bundle; whether replay should read such a segment against the published hash or the loaded one is unstated. Withholding is also how the compiler learns a file is gone rather than never written: the source carries the withheld names, since a removed file and a withheld one differ only in whether the host still knows its name.

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
