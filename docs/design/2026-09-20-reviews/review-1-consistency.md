# Review 1 — Internal consistency

Line numbers are from `docs/design/sprout-design-spec.md` unless prefixed `notes:` or `backlog:`.

## The three that matter most

### 1. `say` is refused in `describe`, and every `describe` in the document uses it — **contradiction**

- "Where chance is forbidden" (l.1137): "the compiler checks reachability … the same way it checks that `say` never appears in a description."
- "What it refuses" (l.1273): "`say`, `tell`, or any write, send, move, spawn or destroy in `describe` or in a consent guard."
- "Passages" (l.934): "`say greeting` and `text greeting` take a passage where they would take a string" — `text` is the describe-side statement, and l.201 uses it: `describe { text "Slat-sided…" }`.

Against that, `describe { say arrival }` at l.78 and l.1498 (the worked example), and `describe { if (…) { say first_sight } else { say familiar } }` at l.1121. Three of the four `describe` bodies in the spec, including the worked example's only one, are compile errors by the spec's own refusal list. `text` is used once and never introduced.

Why it matters: this is the statement every world writes first, and the generated skill (l.1312) is built from the compiler's tables — whichever the compiler implements, the other half of the spec teaches the wrong thing.

Fix: pick `text` for `describe` (it is the form the refusal list and l.934 already imply), state it in "Prose" as the third output statement beside `say` and `tell`, and change l.78, l.1121, l.1498.

### 2. The object-level message form — `name { grammar "…[self]" … }` — survives from the previous design and contradicts the verb/role model — **contradiction, survival**

"Verbs and the grammar a visitor types" is unambiguous: "Verbs are declared by a world or exported by a library, never by an object" (l.563); "Object-level grammar is about nouns… World-level grammar is about verbs. Neither reaches into the other" (l.546); `when`/`otherwise` "are gone" (l.611). Yet the old form is still the example in four later sections:

- "Spawning" l.163: `throw { grammar "throw [self]" spawn Cup in actor }`
- "Passages" l.912: `examine { grammar "look into [self]" say greeting }` — and `examine` is a **reserved name** (l.779: "A message may not take one of these names")
- "Other people" l.992: `pull { grammar "pull [self]" … }`
- "Wakes" l.1057: `fire { grammar "fire [self]" … }`
- "Naming a value" l.506: `throw (tools: {ericworld.ThrowingTool}) { … }` — a message with a typed set argument, the brand kind that l.1696 says "Roles killed … entirely".
- "Where types come from" l.469–470: "a message argument — `dip (into: sprout.Container)`", "a set argument — `throw (tools: {…})`"; "Object identity" l.528 lists "a message argument, an `each` variable, a handler's sender".
- The stray paragraph under `### kinds.sprout` (l.1370): "`Key` now declares `"unlock [on] with [self]"` in one place and its body is a single `send`… A phrase's slots must match the arguments of the message it points at". This is the previous design verbatim, sits under a heading with no code, precedes the example's own introduction, and describes a `Key` that the code four screens later writes as `as tool for unlock`.

The consequence is that "message" now means two things: the queued event received by `on :m` (l.783), and the typed-phrase member above. The composition table ("a message | refuse", l.222), the members list (l.205), the exclusivity refusal (l.1276) and "`tell` is available… message bodies" (l.1006) are all ambiguous as a result — and the worked example, which is meant to exercise everything, declares no member of the second kind at all.

The same survival leaves a real hole: the "Where types come from" table names no **role binding**. Roles are the only bindings the worked example uses, and the type of an open role is nowhere stated. `tool.get(:opens)` (l.343, l.1523) and `from.get(:opens)` (l.816) read a property declared only on `Key`, through a binding whose role is untyped (`role tool`, l.1429) — an unknown receiver, which l.464 says does not exist "anywhere in the language". Either an open role's type is "the join of every kind that declares `as tool for unlock` in the bundle" (computable, since the bundle is closed — say so), or the reads must narrow with `is()`.

Fix: delete the four old-form examples (rewrite `throw`/`pull`/`fire`/`examine` as verbs with roles, or as handlers), delete the l.1370 paragraph and its heading, rewrite the l.466–475 table with rows for "a role binding" and "a set role", and say what type an open role has. Decide whether "message" means only the queued event, and use "verb" for the other everywhere.

### 3. The worked example does not compile, and does not run, under the spec's own rules — **contradiction**

It says it is "written to use every construct in this document" (l.1372). Checked line by line:

- `object press: Press, sprout.Fixture` (l.1630, l.1680): **`Press` is never declared.** "An unknown kind" is a refusal (l.1279).
- `exit up … -> drying_loft` (l.1511): **`drying_loft` is never declared.** Same refusal.
- `describe { say arrival }` (l.1498): refused, per finding 1.
- The cat's `on :tick` (l.1585) **never runs**. "The tick reaches the place and no further. A place that wants its contents to stir sends or broadcasts onward" (l.1043). The cat is an object *in* `composing_room`, and `composing_room` forwards nothing. The only tick handler in the example is dead code.
- `sprout.Fixture` carries `passage immovable` (l.1395). "Standard library kinds therefore carry no prose at all — no `describe`, no `:prose`, no `:name`" (l.272). Either the rule is wrong or the library is.
- The cabinet's comment "Container and Lockable would each supply a pass rule; the composer settles it" (l.1535) and the surfaced finding "Both supply `pass any`" (l.1698) are false against the stdlib written directly above it: `Lockable` at l.1434 declares **no** pass rule (the body-text `Lockable` at l.326 does). One of the two `Lockable`s must go.
- Names carry their own article and also declare one: `name "the composing room" article the` (l.1488), `name "the press" article the` (l.1631). `{thing}` renders "its article and name" (l.942), so the listing at l.1605 prints "the the press". `paper_store` has `name "the paper store"` and the default article `a` — "a the paper store". `apprentice` works around it with `article none` (l.1569). Pick one convention; the l.387 default ("`oak_door` becomes 'oak door'", article separate) is the right one.
- The contents loop `{for thing in self}{thing}…` in `arrival` (l.1605) lists everything the room holds — including the visitor reading the description, by nickname. Nothing in "Slots" or "Range" excludes `actor` from `self`'s contents. The spec presents this loop as "the whole of it" (l.1706); it is not.
- It cannot be played: every `Key` has `:quenched false` (l.1548) and nothing ever sets it, so `as tool for unlock` refuses forever ("sprouts a hundred tentacles"); and the only key whose `:opens` includes `iron` (`shop_key`, l.1563) is inside the iron-warded cabinet it opens. No `Rib` or `Sponge` object exists, so `work [target] with [tools]` can never be filled.
- "Every construct": not exercised — `send`, `broadcast`, any authored `on :m`, `changed` hooks, `without`, `destroy self`, `each`, `pass :m`, `release`, `random`, `{for … of}`, integer value roles, `spawn … in actor`, `{item.passage}`. The spec admits only `link`/`connect` (l.1708).

Fix: declare `Press` and `drying_loft` (or drop them), route the tick (`on :tick … broadcast :tick`? — which itself needs the spec to say whether a re-broadcast `:tick` is legal, since `:tick` is engine-sent), choose one `Lockable`, strip articles from names, give `quenched` a verb, put a rib in the yard, and either exercise the missing constructs or weaken the claim at l.1372.

## Everything else

### Survivals from the previous language

- **`sprout.Takeable`** — used as a real kind at l.198, l.238, l.308 ("`sprout.Takeable` is a property and a `depart` guard"), l.449 (`kind Key: sprout.Takeable`). The worked example: "There is no `sprout.Takeable`" (l.1452); "`sprout.Takeable` cannot work" (l.1675). **contradiction.** Replace with `sprout.Fixture` or a kind that exists.
- **`:names ["crate", "box"]`** (l.200) — a naming *property*, in the first kind example. "Naming is part of the grammar block, not a set of properties" (l.373); stdlib kinds carry "no `:name`" (l.272). **contradiction.** Write `grammar { nouns "box" }`.
- **`{thing.short}`** (l.969) in "Conditionals and loops". l.1706: "The earlier draft invoked `{thing.short}`… `{thing}` renders". **survival.**
- **`use dry from sprout.Openable`** (l.230) — a `use … from` construct that appears once, is never defined, and names a kind that exists nowhere. `without … from` (l.246) is defined. **gap.** Either define `use` beside `without` or delete the clause.
- **`role tool: sprout.Keylike`** (l.565) — a marker kind, after l.1696 says "the objection to marker kinds stops applying anywhere in the language" because roles replaced them. **survival.**
- **Spawned places** (l.173): "spawned places stay unreachable unless the language gains stored references." "Links" (l.735–771) exists precisely to reach spawned places, and l.767 argues it does *not* reopen stored references. **contradiction.** Rewrite l.173 to point at links.
- **"What it surfaced" is out of date against the body it surfaced into.** l.1702 "An unfilled set role is an empty set… it needs saying" — l.635 says it. l.1704 "`say` has no recipient inside a tick… the spec says neither" — l.1008 says both. Meanwhile l.1700 ("a role's type must be optional, and where a `from` narrows it, the property supplies it") is **not** in the body: "Value roles" (l.649) still says "A role may declare a value type", and nothing says an untyped role becomes a value role when a player narrows it with `from`. Fold l.1700 into "Value roles", and cut the two bullets the body already covers.
- **`when` "gone" but kept.** l.611: "`when` and `otherwise`, which are gone." `when` is the exit-guard keyword at l.703, l.725, l.1511, and "a `when` guard" at l.1133, l.1274; backlog:63 "Delete `when` and `otherwise`". **contradiction in wording.** Say "the `when` guard on a message is gone; `when` survives only on exits."

### Rules the spec states and then breaks

- **"no mutable collections"** (l.37) vs "A list is a **set**, and it may change" with `add`/`remove` (l.456–460). Also "list | a fixed sequence" (l.427, l.446) vs mutable. **contradiction.** And "set" now means three things: a list-as-set, a set role, and `self.set`. Say "list" for the property type, "role set" for the turn-bound binding.
- **No magic property names** (l.308: "`:open` and `:capacity` belong to `sprout.Container`… a kind that does not compose it has those names free") vs the engine's default `accept`: "a container… accepts what fits within `:capacity`" (l.866). The engine reads `:capacity` by name. `sprout.Place` has no `:capacity` and writes `accept { allow }` — presumably to escape a default the spec says does not exist. **contradiction.** Either the default accept is "always allow" and capacity lives entirely in `sprout.Container`'s guard (which the worked example already writes, l.1409), or `:capacity` is engine-known and l.308 is wrong.
- **"the hands carry without hearing"** (l.793) vs `sprout.Actor { contains :capacity 8 }` (l.1383) with no pass rule, and "A kind that declares `contains` and no pass rule relays everything" (l.842), and "Containers hear what they relay" (l.793). By the stdlib-is-ordinary-Sprout rule the hands hear everything. **contradiction.** Either give `Actor` a pass rule or drop the sentence.
- **World pass default.** "Its pass rules default to refusing" (l.55, l.112) vs "no rule means no policy" = relay everything (l.842); every world example writes `pass any (false)` anyway (l.51, l.126, l.1461). **contradiction.** If the world is special-cased, say so in "Containers route"; if not, delete "default to refusing".
- **`let` initializers are pure** — "Because an initializer is an expression, a `let` cannot write, send, move or narrate, which is why it is allowed everywhere an expression is… in `permit`… and in `describe`" (l.522) — vs `let cell = spawn MazeCell in self` (l.753, l.763: "`spawn` yields an ordinary object binding"). Spawn is an effect (l.877 lists it with write/send/move/destroy). **contradiction.** Either `spawn` is a statement that also binds (`spawn MazeCell in self as cell`) or the l.522 claim needs an exception and `let … = spawn` must be refused in `describe`/guards.
- **`say` in a wake.** "A wake delivered after an absence applies its state changes and its `say` and `tell` are dropped" (l.1078) implies `say` is legal in `on :woke`. But "A tick has no acting visitor, so `say` has nobody to speak to… refused in a tick handler" (l.1008) — a wake has no acting visitor either. **contradiction.** Refuse `say` and `{actor}` in `:woke` too, and make l.1078 say only `tell`.
- **Guards must end in `allow`?** "A guard ends in `allow` or `refuse "…"`" (l.866); every `depart`/`accept` example dutifully writes `else { allow }`. Every `permit` (l.329, l.573, l.750, l.1416, l.1438, l.1522…) falls off the end with no `allow`. **gap.** State once that falling off the end allows, for all four, and drop the boilerplate — or require it for `permit` too.
- **Composer's own vs "no member silently shadows another at any depth"** (l.232). l.1685: "A composing kind's own member is simply the one that applies — collisions arise only between two *sources*, neither of which is the composer — so the author's line replaces the library's with nothing suppressed." That *is* shadowing at depth one, and the composition table header says "several sources | refuse" for `describe`/message/pass without excluding the composer. It is also the mechanism the whole `Fixture` argument rests on, and it is stated only in the appendix. Passages are absent from the members list (l.205) and the composition table (l.211–223). **gap.** Add a row for passages, and make rule 1 say explicitly that the composer's own exclusive member overrides one inherited source without a collision.
- **"nobody writes the hands' guards"** (l.866) vs the visitor kind is author-written (`kind Player: sprout.Actor`, l.129) and a kind body may declare consent guards (l.205). Can `Printer` declare `accept` to refuse a `give`? **gap.**
- **Place identifiers "world-wide… an exit can name one from anywhere"** (l.369) vs nested places need a path (`-> bedroom.wardrobe`, l.733) and `paper_store` sits inside `composing_room`. **contradiction** (l.369 overstated).
- **Reserved names** (l.779) omit `tick` and `woke`, which the engine sends (l.1030, l.1064). And "The engine sends `describe`" — `describe` is a member with a block (l.205, l.899), not a message anyone handles with `on :describe`. **gap / drift.**
- **Value-carrying syntax**: `send from :unlock_failed with 2` (l.789) vs `broadcast :illuminating(true)` (l.790). Two spellings. And "A handler binds the sender and the carried value" (l.804) does not describe `on :entered (item, from)`, `on :moved (from, to)`, `on :tick (elapsed)`, where the first parameter is not the sender. **contradiction.** Pick one syntax; say that engine messages have their own declared parameter lists.
- **"consent guard" vs `permit`.** The refusal list (l.1273–1274) forbids writes and chance "in a consent guard"; "consent guards" elsewhere means `depart`/`release`/`accept` (l.205, l.601). `permit` is named for `tell` at l.1006 but not in the refusal list or in "Where chance is forbidden" (l.1133). **gap.** Say "consent guard" includes `permit`, once.
- **Exclusive-member refusal** (l.1276) lists `describe`, a message, a `pass` rule; the table (l.219) also has `name`, `article`. **gap.**
- **Visitor readability.** "It [the nickname] is the only thing about a visitor any object can read" (l.403); "`{actor}` is also the only thing about a visitor any object can read; nothing else… in prose or in an expression" (l.1014). Against "A property on the visitor is the world's **public record**: anything in range can read whether you are It" (l.154) and `self.get(:team)` on `Player`. **contradiction.** l.403/l.1014 mean "the only thing *from the account*"; say that.
- **Budget vocabulary**: steps "per request" (l.1226), events "per request" (l.1228), output "per turn" (l.1227), spawns "per action" (l.1231, l.177), effects "per action" (l.1190), "the action's budget" (l.846). Three words for one unit. **drift.** "Turn" is what "Time" and "The host contract" use; make it the only one.

### Constructs used without a definition

- **`each`** — referenced at l.104, l.471 (`each pot: Vessel in self`), l.641 (`each … of`), l.1236; no section defines it, its syntax, its body, or whether it is a statement. **gap.**
- **Property declaration syntax** — the types table says integer is "written `integer`, optionally `min`/`max`", boolean "`boolean`", string "`string`" (l.423–425). No declaration in the document writes any of those words; every example infers from a literal (`:open true`, `:wear 0 min 0 max 99`) or writes `Type default v`. Where is a string property declared? **gap.**
- **`count` on a container** — l.870 `self.count`, l.944 `{self.count}`, l.1411; the checker table (l.496) only admits `x.count(K)` with "`x` a set". **gap.**
- **`refuse <passage>`** — `refuse immovable` (l.1391); l.866 says `refuse "…"`, l.934 lists only `say`/`text` as taking a passage. **gap.**
- **Verb namespacing** — `sprout.ask` (l.1700) implies verbs are library-scoped; "Libraries namespace kinds" (l.296) and the scope table (l.365: kinds, enums) say nothing about verbs. If two libraries declare `verb open`, which one does `as target for open` play? **gap.**
- **Spawn and consent** — does `spawn Sheet in press_yard` (l.1644) run the target's `accept`? l.169 says it "makes a new instance… and sends it `:spawned`"; the move protocol is silent on creation. **gap.**
- **Parse cost** — notes:152 "Parsing must be charged too", backlog:24 "Charge parsing too". The spec charges range walks (l.114) and loops (l.985) but never says the parse is charged. **gap** (spec should carry it, since the backlog says it is a foundation).
- **`set`/`remember` out of range** — `adjust` clamps (l.458, l.492); what `actor.remember(:visits, actor.recall(:visits) + 1)` (l.1116) does at `max 99` is unstated. **gap**, small.
- **Kind members list** (l.205) omits `passage` and `prose "file"`. **gap.**
- l.187 "A place to a file is the convention" — presumably "a place per file". Typo, but it is the only sentence about file layout.

### Working notes contradicting themselves or the spec on *current* state (not history)

- notes:205 "**Roles bind objects only — a new gap.** … `ask [target] about [topic]` has no shape… *Open.*" and notes:227 "a dialogue model… none is answered by the spec" — vs notes:105 "No dialogue or topic model | Verbs — value roles, narrowed per object with `from`" and the spec's "Value roles" (l.645–682) with exactly that `ask` verb. **contradiction** inside the notes' own open-questions list. Close it.
- notes:221 "**The two-argument cap.** Untested… the cap most likely to break first." There is no two-argument cap; the spec allows eight roles (l.637). **survival.**
- notes:197 and notes:199 are two overlapping "*Closed:*" lines. Merge.
- backlog:24 "Start near 30,000 steps" vs spec l.1226 "50,000 per request" and notes:223 "Ours is probably generous; instrument before fixing it". Not a size guess — a target the spec sets differently from the plan. Pick one; the spec is authoritative, so the backlog should say 50,000 or the spec should say "start at 30,000, instrument".
- backlog:13 lists "whether a missing passage renders empty or is a compile error" as open; the spec's refusal list (l.1279) refuses an unknown "property, message or extension" and omits passages, which is consistent with it being open — but "Files" (l.189) already says a missing `.prose` file "reads as absent". A missing *file* and a missing *passage name* need separating in the spec.

### Terminology to settle (one word each)

- **message**: queued event only. The typed-phrase member is a verb/role now.
- **set**: role set vs list. Stop calling a list "a set".
- **turn** for the budget unit; drop "request" and "action".
- **consent guard**: `depart`/`release`/`accept` *and* `permit`, or say "guard" for all four and "consent guard" for the three.
- **`Place`** vs **`sprout.Place`**: l.64–69 writes `kind Place` and `: Place`; everywhere else `sprout.Place`. Since a world kind named `Place` shadows with a warning (l.295), the l.64 example reads as a world defining its own. Qualify it.
