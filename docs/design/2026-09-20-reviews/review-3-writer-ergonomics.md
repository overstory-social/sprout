# Sprout design spec — Reviewer 3: writer ergonomics

Target: `docs/design/sprout-design-spec.md` (line numbers from `cat -n`). Read cold, in full, before anything below was written. The world I produced is in §2; the notes I kept while writing it are in §3.

## 1. The three findings that matter most

### 1.1 The spec teaches two incompatible ways to make a thing respond to a verb — **contradiction**

Section "Verbs and the grammar a visitor types" (l. 542–616) says verbs are declared by the world (`verb ring { role target "ring [target]" }`) and objects opt in with `as target for ring { permit {…} do {…} }`. It is explicit: "Verbs are declared by a world or exported by a library, never by an object" (l. 563), "Object-level grammar is about nouns … World-level grammar is about verbs. Neither reaches into the other" (l. 546).

But the shortest, most copyable examples in the document do the other thing — a message body that carries its own phrase:

- l. 163–167 `throw { grammar "throw [self]" spawn Cup in actor }`
- l. 912–916 `examine { grammar "look into [self]" say greeting }`
- l. 992–997 `pull { grammar "pull [self]" self.set(:thrown, true) say … tell … }`
- l. 1057–1062 `fire { grammar "fire [self]" … wake in 3 hours … }`

And the first paragraph of "A worked microworld" (l. 1370) is a stale note from that earlier design: "`Key` now declares `"unlock [on] with [self]"` in one place and its body is a single `send` … A phrase's slots must match the arguments of the message it points at". Nothing in the worked example does this.

A writer who wants "when you pull the lever, X happens" will find `pull { grammar "pull [self]" … }` first (it is five lines, in one place, and reads like English) and will write it. By the Verbs section it is illegal. Worse, `examine` at l. 912 is a message named with a reserved engine name (l. 779: "A message may not take one of these names"), so that example is refused on two counts.

**Change:** delete the message-with-`grammar` form from every example (Spawning, Passages, Other people, Wakes) and rewrite them as `verb` + `as … for`, or bless the short form as sugar for a one-role verb and say so in the Verbs section. Delete l. 1370. Either way the document must show exactly one way to do the most common thing a writer does.

### 1.2 `say` inside `describe` is both the idiom and a compile error; `text` is never defined — **contradiction / gap**

- l. 78 `describe { say arrival }`, l. 1120–1123 `describe { if (…) { say first_sight } else { say familiar } }`, l. 1498 `describe { say arrival }` (the worked example's own composing room).
- l. 1137: "the compiler checks … that `say` never appears in a description". l. 1273: it refuses "`say`, `tell`, or any write … in `describe`".

Meanwhile `text` appears twice (l. 201 `describe { text "Slat-sided…" }`, l. 934 "`say greeting` and `text greeting` take a passage where they would take a string") and is otherwise undefined: no section introduces it, the Prose section's opening (l. 899) lists three ways text reaches a visitor and `text` is not among them, and it is absent from the compiler's tables.

A writer copying the worked example's room gets a refusal on the first line that produces any prose. A writer who finds `text` cannot tell whether it is allowed in a `do`, in a handler, or only in `describe`, or whether it goes to the actor or to everyone.

Closely related and equally unsaid: **what a visitor's `look` and `examine bell` actually print.** `describe` is "an object's portrait of itself, pure and re-run on every poll" (l. 899); `examine` is an engine message (l. 779); `look` is a reserved verb. Nowhere does the spec say that `examine X` renders `X`'s `describe`, or that `look` renders the place's. I guessed. A writer will guess too, and if `describe` on a non-place object is in fact something a client shows on hover rather than the answer to `examine`, every object in my world is mute.

**Change:** pick one output word for `describe` (I would keep `say` and drop `text`, since a description is said to the polling visitor), fix l. 1137/1273 to match, and add two sentences to Prose: "`look` renders the place's `describe`. `examine <thing>` renders the thing's."

### 1.3 Naming a place — the first thing every writer does — has three incompatible spellings in the spec's own example, and the wrong ones fail silently — **contradiction / silent failure**

`{thing}` renders "its article and name" (l. 942). The defaults table (l. 385–389) says `article` defaults to `a` and `name` defaults to the humanised identifier. Then the examples:

- l. 71–72 and 1488–1489: `name "the composing room"` **and** `article the` → renders "the the composing room".
- l. 1509: `name "the paper store"` with no article → renders "a the paper store".
- l. 1569, 1583: `name "the apprentice" article none`, `name "the shop cat" article none` → article baked into the name, article suppressed. Works, but by a different rule.
- l. 1631: `name "the press" article the`. Doubled again.
- l. 1561: `object brass_key: Key … { grammar { name "brass key" } }` — a name identical to the default, four lines "of naming around nothing" as l. 1370 admits.

No compile error catches any of these; the doubled article appears in the contents list of the room, in chips, in arrival notices. A writer cannot tell from the document whether `name` includes the article. I chose "name never carries an article" and wrote `name "lamp room" article the`, and I am not sure I am right.

Downstream, it also makes `nouns "composing room", "room"` (l. 73) mandatory boilerplate: the default nouns are "the full name and its head word" (l. 388), so with "the" baked in, the visitor could type `room` but not `composing room` unless the author repeats it.

**Change:** state that `name` never contains an article; default `article` to `the` for anything declaring `contains actors` and for anything composing `sprout.Fixture`; fix every example. Define "head word" (last word? every word?).

## 2. The world I wrote, using only the spec

Lighthouse: two places (lamp room, gallery), three objects (a telescope you can carry, a fog bell that answers `ring`, a candle that burns out ten minutes after it is lit).

```sprout
// world.sprout
world lighthouse {
  contains
  visitors are Keeper
  pass any (false)
}

kind Keeper: sprout.Actor {
  :capacity 4
}

verb ring  { role target  "ring [target]"  "strike [target]" }
verb light { role target  "light [target]" }
```

```sprout
// lamp_room.sprout
object lamp_room: sprout.Place in lighthouse {
  grammar {
    name    "lamp room"
    article the
    exit out "out onto the gallery" -> gallery
  }

  describe { text portrait }

  passage portrait {
    The great lens fills the middle of the room like a held breath of glass.
    {if candle.get(:lit)}
    A tallow candle burns on the sill, not much against the dark.
    {else}
    A tallow candle sits cold on the sill.
    {/if}

    {for thing in self}{thing}{if $last}.{else}, {/if}{/for}
  }
}

object telescope in lamp_room {
  grammar { name "brass telescope" }
  describe { text "Dented at the eyepiece, from being dropped exactly once." }
}

object candle in lamp_room {
  grammar { name "tallow candle" nouns "candle" }
  :lit false

  describe {
    if (self.get(:lit)) { text "It burns with a small, unsteady flame." }
    else                { text "Cold, with a blackened wick. Someone has lit it before." }
  }

  as target for light {
    permit { if (self.get(:lit)) { refuse "It is already lit." } }
    do {
      self.set(:lit, true)
      wake in 10 minutes
      say  "The wick catches on the second try."
      tell "{actor} lights the candle."
    }
  }

  on :woke (elapsed) {
    self.set(:lit, false)
    tell "The candle gutters and goes out."
  }
}
```

```sprout
// gallery.sprout
object gallery: sprout.Place in lighthouse {
  grammar {
    name    "gallery"
    article the
    nouns   "railing", "walk"
    exit in "back into the lamp room" -> lamp_room
  }

  describe { text portrait }

  passage portrait {
    An iron walk around the outside of the tower, with a railing you trust
    less the longer you look at it. Below, the sea, doing what it does.

    {for thing in self}{thing}{if $last}.{else}, {/if}{/for}
  }
}

object bell: sprout.Fixture in gallery {
  grammar { name "fog bell" nouns "bell" }
  :rung 0 min 0 max 999

  passage immovable { The bell hangs from an iron bracket and weighs more than you do. }
  describe { text "Green with weather. There is a striker on a chain." }

  as target for ring {
    do {
      self.adjust(:rung, 1)
      say  "You swing the striker. The note goes out over the water and does not come back."
      tell "{actor} rings the fog bell."
    }
  }
}
```

I do not know whether this compiles. The specific doubts are in §3.

## 3. Notes kept while writing it

Each is a point where I searched, guessed, or reread.

1. **`contains` and `pass any (false)` on the world.** l. 55 says the world's pass rules "default to refusing", yet every world example (l. 48–52, 123–127, 1457–1462) writes `pass any (false)`. l. 842 says "no rule means no policy" (relay everything) for kinds. I copied both lines without knowing whether either is needed. *Boilerplate or a gap, depending on which sentence is true.*
2. **`visitors are Keeper`.** Is it required? What happens without it? Can I write `visitors are sprout.Actor` and skip declaring a kind that adds nothing? Unsaid. I declared an empty-ish kind to be safe.
3. **Can an object have no kind?** l. 100: "An object names its kinds and its container". l. 453 `object skeleton_key: Key { … }` has no container; nothing shows a kindless object. I wrote `object telescope in lamp_room` and hoped.
4. **Is the telescope carryable?** Searched "take". Found `sprout.Takeable` at l. 198, 238, 308, 449, then l. 1452 "There is no `sprout.Takeable`: things are carryable unless they say otherwise", then l. 1675 "`sprout.Takeable` cannot work". Four references to a kind that the same document says cannot exist. I trusted the worked example. *Contradiction.*
5. **What does the engine say when the telescope is taken?** Nothing in the spec. `:moved (from, to)` is sent to the thing (l. 889), so I could say something there, but distinguishing take from drop from put-in-box requires `if (to.is(sprout.Actor))`. Left it to the engine, whose default output is unstated. *Gap.*
6. **How does the candle burn without anyone lighting it?** My first instinct was `on :tick` on the candle. l. 1043: the tick "reaches the place and no further". Then `wake in`, but a source-declared object has no start event: `:spawned` is only for runtime spawns (l. 169), and there is no `:created`/`:started`. So a declared candle that should be burning from the first moment has no way to ask for its first wake except through a verb, a `:entered` on the room, or a room tick that forwards. I changed the design of my world to fit the language (the candle starts cold and must be lit). *Gap: no start hook for declared objects.*
7. **`tell` in `on :woke` — allowed?** l. 1006 lists where `tell` may appear (handlers are included), l. 1078 says a wake's "`say` and `tell` are dropped" during catch-up, which implies `say` is otherwise allowed in a wake. But a wake has no acting visitor any more than a tick does (l. 1008). I used `tell` only. *Gap: who `say` addresses in `:woke`.*
8. **Property syntax.** Never stated as a rule; inferred from `:capacity 4`, `:team Team default hider`, `:opens [Ward] default [oak]`, `:wear 0 min 0 max 99`, `:remembers [visits: 0 min 0 max 99]`. Is `:lit boolean default false` legal? What is the range of an integer declared `:capacity 4` with no `min`/`max`? Unsaid. I wrote `:lit false` and `:rung 0 min 0 max 999` by pattern-matching.
9. **Can the room's passage read the candle's state?** l. 104 says range is "what it may read with `get`", l. 366 says "every object reference is a target", l. 528 lists the bindings that evaluate to an object and identifiers are not among them. No example anywhere reads `identifier.get(:p)`. I wrote `{if candle.get(:lit)}` in the room's passage; I would not bet on it. If it is illegal, the natural thing — "the room description mentions the candle is lit" — has no route short of duplicating the state on the room. *Gap.*
10. **Conditions in passages.** l. 975: "Conditions take no parentheses" in slots, parentheses required in bodies. Two spellings of `if` for one idea. I wrote both and rechecked twice.
11. **`describe` body vs passage.** `describe { if (…) { text … } else { text … } }` is a statement body; a passage has `{if}…{/if}`. Two ways to branch prose, in two syntaxes, one of which (`text`) is undefined (see §1.2). I used a passage for long text and `text` literals for short, and do not know if `text` is legal inside an `if` in `describe`.
12. **`permit` without `allow`.** Consent guards in examples end `else { allow }` (l. 869–873, 1390–1393, 1538–1541); role `permit` blocks never write `allow` (l. 1416, 1438, 1552). l. 866: "A guard ends in `allow` or `refuse`". So does falling off the end of `depart` allow or fault? I wrote no `depart` at all rather than find out. *Gap/inconsistency.*
13. **`{for thing in self}` lists the visitor to themselves.** Visitors are objects in the place (l. 118), the loop walks contents (l. 973), `{thing}` renders a visitor's nickname (l. 949). So the spec's own listing idiom (l. 954, 1605) prints "Marta, a brass telescope, a tallow candle." to Marta. To exclude the actor I would need `{if thing != actor}` inside the loop — and the separator/`$last` logic then breaks (the last item may be the one skipped). Whether `!=` on objects is even legal inside a slot is unstated ("no arithmetic in slots", l. 979 — is comparison arithmetic?). This is the most common line in any world and the document's version is wrong for the person reading it. *Silent failure.*
14. **`elapsed` in seconds vs `wake in 2 hours`.** l. 1664 `if (elapsed > 7200)`. Time goes in with units and comes out as a number the writer converts by hand. *Judgement: allow `elapsed > 2 hours`.*
15. **Where is `each`?** It is named at l. 104, 471, 476, 520, 528, 641, 1236 and defined nowhere — no syntax, no example of a body using it. If I had wanted "every candle in the room goes out" I could not have written it. *Gap.*
16. **How is a message declared?** `send oak_door :unlock_attempt` (l. 788) and `on :unlock_attempt (from)` (l. 815), but l. 1279 refuses "an unknown … message" and l. 205/220 speak of "messages" as kind members that collide. The only message declarations shown are the old `name { grammar … }` bodies. Under the verb/role design I cannot find the syntax that declares `:unlock_attempt` so that it is not "unknown". *Gap.*
17. **The worked example does not compile by the spec's own rules.** `object press: Press, sprout.Fixture` (l. 1630) — `Press` is declared nowhere. `-> drying_loft` (l. 1511) — no such place. l. 1279 refuses an unknown kind. A writer using the worked example as a template inherits both.

## 4. Everything else, grouped

### 4.1 Contradictions

- **`sprout.Takeable`** — see note 4. l. 198, 238, 308, 449 vs l. 1452, 1675. Remove it from Declaring and composing, Consent under composition, The standard library is written in Sprout, and Lists, or reinstate it.
- **Arrival prose lives in two places.** l. 86: "its `:entered` is where arrival prose lives". l. 889 repeats it. The worked example puts arrival prose in `describe { say arrival }` (l. 1498) and uses `:entered` only to count. If `:entered` narrates *and* `describe` is polled on arrival, the visitor reads the room twice. Say which one is the arrival text and what the engine prints on `go`.
- **Visits counter faults on the 100th visit.** l. 1112/1496 `:remembers [visits: 0 min 0 max 99]` with `actor.remember(:visits, actor.recall(:visits) + 1)`. `adjust` clamps (l. 492); `set`/`remember` with an out-of-range value is unstated but by contrast presumably a fault, and a fault abandons the turn and "the visitor is told plainly" (l. 1200). The spec's recommended idiom (l. 1108 "Write the state instead") blows up on a regular. Either `remember` clamps, or there is an `actor.adjust`, or the example needs `if`.
- **Worked example uses `role topic` untyped in the stdlib `ask`** (l. 1444–1449) while the Value roles section shows `role topic: Topic` and says a value role "may declare a value type". l. 1700 acknowledges the type must be optional. Fine — but the rule in the main text (l. 649, 656) should say so, not the postscript.

### 4.2 Gaps

- **Default output of built-in verbs.** `take`, `drop`, `give`, `put`, `go`, `look`, `inventory`, `wait`, `help` — nothing says what any of them prints on success, or what the visitor sees for "words it cannot place" (l. 619). A writer cannot judge the voice of their world without knowing what the engine's voice is. (Also: does a text client print the exit list? l. 695 says the label is "what the visitor reads on a chip"; nothing about a client with no chips.)
- **Which standard verbs exist and what their roles are called.** l. 563: "The standard library ships the common ones". The worked example shows `open`, `close`, `unlock`, `ask`. A writer wanting `rub`, `ring`, `read`, `light`, `push`, `climb` needs to know whether to declare or compose. A list, with role names, is the single most useful page this spec could contain and it is absent.
- **When is `describe` polled relative to the turn?** The `<= 1` at l. 1121 only works if the description is rendered after `:entered` drains. l. 1127 says polls happen "because somebody else acted in the room". The writer needs a plain statement: "after every turn, every visitor in the place re-reads its description".
- **`actor` inside handlers reached from a tick or wake.** A tick that broadcasts, causing a move, causing `:entered`, whose handler calls `actor.remember(…)` — there is no actor. l. 1008 covers `say` and `{actor}` in a tick handler only. Runtime fault? Compile error? Silent?
- **"Head word"** (l. 388) is undefined. "jar of nails": is `jar` a noun, or only `nails`? A writer finds out when `take jar` fails, with no error anywhere.
- **Integer default range; unary minus.** `self.adjust(:remaining, -elapsed)` — is `-x` an expression? Only binary `+ -` are listed (l. 488). What is the range of `:capacity 4`?
- **A `place` made from scratch.** l. 61: "A place is any object that declares `contains actors`". `sprout.Place` also writes `accept (item, from) { allow }` (l. 1380), and the engine's default `accept` "accepts what fits within `:capacity`" (l. 866). A writer who follows l. 61 literally and does not compose `sprout.Place` gets a place with no `:capacity` — does the engine default refuse everyone? Nothing says.
- **Empty `permit`/omitted `allow`** — note 12.
- **`each`** — note 15. **Message declaration** — note 16. **Start hook** — note 6.

### 4.3 Silent failures (no error, no visible effect, or a wrong effect)

1. Article doubled or wrong (§1.3). Renders wrong; no diagnostic.
2. The room lists the reader to themselves (note 13).
3. A place whose passage omits the `{for thing in self}` loop: objects are present and addressable but never mentioned. l. 951 makes the loop the author's job with no warning if it is absent.
4. `on :entered (item, from)` without `if (item.is(sprout.Actor))`: every dropped key counts as a visit. The spec's idiom includes the guard; nothing enforces or warns.
5. Head-word nouns (above): `take jar` silently unmatched, falls through to "words it cannot place".
6. A `tell` in a wake after absence is dropped by design (l. 1078). Correct policy, but a writer testing alone, leaving and returning, will conclude their wake never fired.
7. Restating a property to merge it (l. 258): a writer who declares `:open` on a book that also composes `sprout.Container` for its pages has, by restating, told the compiler the two are one slot. The compiler reads the restatement as consent. The writer read it as declaring a property.
8. `chance(8)` in a tick that also does nothing else (l. 1585): 92% of ticks are silent, by design. Fine — but the writer has no way to know a tick happened at all, and l. 1030 refuses to name an interval. During authoring, "is it working?" has no answer.

### 4.4 Concepts that assume programming

Unavoidable given the design, but each is a wall for the stated audience, and the document does not mark which ones a writer of a simple world can skip:

- `self.get(:x)` / `self.set(:x, v)` for one's own state, with the `:` sigil. Every condition a writer forms in English ("if the candle is lit") becomes `if (self.get(:lit))`. **Avoidable:** let a bare `:lit` read self's property in expressions and slots. That removes ten characters from every condition in the language and the word `self` from most bodies.
- The symbol/string distinction (`:closed` vs `"closed"`, l. 1293). The diagnostic is kind; the concept is still one a writer must hold to read it.
- `==`, `!=`, `!`, `&&`, `||`, and the difference between `=` (nowhere) and `==`. **Partly avoidable:** `and`, `or`, `not`, `is` would cost nothing.
- `let` and no-shadowing (l. 503–524). Only needed for `count` comparisons; a writer can skip it — but nothing says so.
- Nominal vs structural matching (l. 476–480). A library author's concern in the middle of the types section.
- Queue semantics: "queued, never called … breadth-first" (l. 783). What a writer needs is "your `say` lines come out before anything you `send` triggers". Say that instead.
- Range, relay paths, pass rules, walls in both directions (l. 102–114, 830–842). A writer of two rooms never needs it, but must read through it to find `tell`.
- The composition table and diamond rule (l. 209–232), `use … from`, `without … from`. Unavoidable for library authors; a writer should be told they can skip it.
- `enum` (l. 431). The idea (a fixed set of options) is not a programming idea; the word is.
- Budgets, steps, faults, cascade depth. A writer needs one sentence: "if your world does too much in one turn the visitor sees an error; here is what too much means".

### 4.5 Distance from intent to syntax

| the writer wants | what it takes | must first understand |
| --- | --- | --- |
| "A telescope on the table you can carry." | `object telescope in lamp_room { grammar { name "brass telescope" } }` — 1 declaration, 3 lines (or 1 with defaults). Cannot say what taking it prints without `on :moved (from, to) { if (to.is(sprout.Actor)) { say … } }`. | object, `in`, grammar block, default carryability (which the doc contradicts itself on) |
| "The bell is bolted down; say so." | `object bell: sprout.Fixture in gallery { passage immovable { … } }` — 2 lines. Good, **if** the writer finds `Fixture`, which lives only in the worked example; the main text says `Takeable`. | composition, that a passage named `immovable` overrides the library's |
| "Ring the bell; everyone hears it." | `verb ring { role target "ring [target]" }` in the world file + `as target for ring { do { say … tell "{actor} …" } }` on the bell — 2 places, ~7 lines. | verb, role, `target`, `as … for`, `do`, say vs tell, `{actor}` |
| "The candle burns out ten minutes after it's lit." | `:lit false`, `wake in 10 minutes` inside a `do`, `on :woke (elapsed) { self.set(:lit, false) tell … }`, plus a branching `describe` — ~10 lines. If it should be burning from the start: impossible without a place tick or an entry hook (note 6). | wake/woke, elapsed, set, describe branching, that ticks stop at the place |
| "Say something different the first time you enter." | `:remembers [visits: 0 min 0 max 99]`, `on :entered (item, from) { if (item.is(sprout.Actor)) { actor.remember(:visits, actor.recall(:visits) + 1) } }`, `{if actor.recall(:visits) <= 1}` in the passage — ~8 lines. Faults on visit 100. | remembers/recall/remember, `:entered`, `item.is`, `sprout.Actor`, why `<= 1` and not `== 0` (poll timing) |

The last row is the one that hurts. "The first time" is the most-wanted sentence in interactive fiction and it costs eight lines, five concepts, a range you must pick, and a timing fact the spec never states. `:remembers [seen: false]` + `{if !actor.recall(:seen)}` + one `actor.remember(:seen, true)` in `:entered` would be six lines and no arithmetic; the spec should show the boolean form first and the counter second.

### 4.6 Names

- **`grammar { name … article … nouns … exit … }`** — a writer looking for where to name a thing will not look under "grammar", and an exit is not grammar in any sense a writer knows. `called { … }` or splitting `name`/`article`/`nouns`/`exit` out as bare members would read better. (l. 88 argues exits are "surface"; that is a compiler's reason.)
- **`actor` / `visitor` / `Actor` / `visitors are`** — the prose says visitor forty times; the language says `actor`, `contains actors`, `sprout.Actor`, `{actor}`. Pick one word. `visitor` is the one the audience already uses.
- **`tell`** — in English you tell *someone* something. Here it means "everyone else present". `others "…"` or `tell others "…"` would say what it does; a writer will try `tell marta "…"`.
- **`permit`** — the block where you refuse. `unless { refuse … }` or `check` would be honest; `permit` reads as the opposite of what is written inside it.
- **`pass any (false)`** — "pass" is acceptable; the parenthesised expression after it is not a writer's shape. `walls` / `open` / `lets through nothing` — anything.
- **`spawn`** — game jargon. `create Cup in actor` or `make`.
- **`enum`** — `options Ward { oak, silver }` or `choice`.
- **`contains` / `contains actors`** — good. **`depart` / `release` / `accept`** — good. **`refuse "…"` / `allow`** — good. **`wake in 3 hours` / `on :woke`** — very good. **`:remembers` / `recall` / `remember`** — very good. **`describe`, `say`, `passage`, `prose`, `exit`, `link`, `connect`, `{one of}…{or}`** — good.
- **`text`** — undefined, and if it survives it needs a name that says who reads it.
- **`on :tick`** — a clock word. `every so often` is too cute; `on :tick` is tolerable if the document explains it once in plain words, which it does (l. 1026).

### 4.7 Boilerplate

- `contains` + `pass any (false)` on every world when the default is already refusing (note 1).
- `visitors are X` requiring a kind that adds nothing.
- `article the` when the name already has it; `nouns "composing room", "room"` restating the defaults (§1.3).
- `grammar { name "brass key" }` restating the humanised identifier (l. 1561; the spec admits it at l. 1370).
- `else { allow }` in every guard, if it is required (note 12).
- `if (item.is(sprout.Actor))` in every `:entered` that cares about people, which is all of them. A `:visitor_entered` or an `arrived` handler would delete it.
- `(item, from)` on a guard that uses neither (l. 1380).
- `self.get(` on every read of one's own state (§4.4).
- `describe { text portrait }` + `passage portrait { … }` — two members to attach one paragraph. `describe { … prose … }` as a passage body directly would be one.

### 4.8 One structural judgement

The document is ordered for someone checking the design (guarantees, world model, composition, names, types, verbs, events, movement, prose, others, time, chance, extensions, limits, compiler, host, example). A writer needs the reverse: the worked example first, then places/objects/naming/describe, then verbs, then time, and the composition table and range walk at the back marked "for library authors". As it stands the two things a writer does first — name a place and make it say something — are on l. 71 (wrong) and l. 78 (refused by l. 1273), and the correct forms are nowhere.
