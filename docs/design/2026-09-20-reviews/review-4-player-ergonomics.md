# Review 4 — Player ergonomics

Target: `docs/design/sprout-design-spec.md` (line numbers from `cat -n`). Played: the printer's shop in "A worked microworld" (lines 1366–1708), as two visitors, Marta and Bob, on a phone and on a screen reader.

## The three findings that matter most

### 1. The default experience of a Sprout world is silence. — **gap**, with a **contradiction** underneath it

Sections: "Built-in verbs" (775), "Prose does not compose" (272), "The two passes" (603), "After the move" (889), worked example throughout.

Quotes: "`take`, `drop`, `give`, `put … in` and `go` are not authored messages. Each is one proposal — move a thing into a container — and is answered by the consent guards" (775). "Standard library kinds therefore carry no prose at all — no `describe`, no `:prose`, no `:name`" (272). Container's `as target for open { … do { self.set(:open, true) } }` (1415–1418); Lockable's `do { self.set(:locked, false) }` (1440).

What is wrong. Put the rules together and trace what a successful turn prints:

- `take brass key` — all three guards allow by engine default (866). The move commits, `:left`/`:entered`/`:moved` are queued (889), nobody handles them. **Nothing is printed.** The spec never says the engine writes "Taken." and the principle at line 29 ("Nothing concatenates descriptions on an author's behalf") implies it does not.
- `open cabinet`, `close cabinet`, `unlock cabinet with shop key` — the stdlib `do` bodies write state and say nothing, by rule (272). **Nothing is printed** unless the author adds a second `do` with a `say` on every object that composes a stdlib kind. The example adds none.
- `go out` — press_yard has no `describe`, its `press_yard.prose` is referenced (1617) but not in the corpus (so "reads as absent", 189), and "A place's `:entered` … is where arrival prose lives" (889) — press_yard has no `:entered`. **Nothing is printed** on arrival. The spec nowhere says the engine describes a place when you enter it.
- `look at cat`, `examine cabinet`, `x key` — no object in the example but the room has a description. What the engine answers when `examine` reaches an object without one is unstated.

So a first-time player types four plausible commands and the only one that produces text is the one that fails. On a phone with chips this is survivable because the chips change. On a screen reader or a terminal it is indistinguishable from the world having crashed.

The contradiction underneath: the spec's own stdlib *does* carry prose — `sprout.Fixture` ships `passage immovable { {self} is not something you can pick up. }` (1395) and the text at 1685 celebrates that an object's own passage of the same name replaces it. That mechanism is exactly the fix for silent success, and line 272 forbids it.

What I would change. (a) Reverse 272: stdlib kinds carry *replaceable* passages for their outcomes — `opened`, `shut`, `unlocked`, `taken`, `dropped` — in the plain register Fixture already uses, overridden per object by declaring the same passage name. (b) State that the engine renders a place's `describe` to a visitor on arrival (and on `look`), and that `:entered` is for *additional* prose. (c) State what `examine` does for an object with no `describe`: at minimum the name, in the article the author declared, plus contents if it is an open container. (d) State that a turn that changed state and emitted nothing to the actor gets a host-supplied, localisable acknowledgement. Without (d), an author who forgets a `say` ships a world that looks broken.

### 2. A visitor is an ordinary object, and the built-in verbs treat them as one: they can be picked up, carried away, pickpocketed and stuffed. — **gap** (arguably **contradiction** with 771)

Sections: "Visitors" (118), "The three roles" (866), "Containers route" (842), "Range" (106), "Built-in verbs" (775), worked example `kind Printer: sprout.Actor` (1477) and `kind Actor { contains :capacity 8 }` (1383).

Quotes: "A visitor is an object. It sits in the tree, holds what it carries" (118). "Where a guard is not written, the engine answers: a thing allows its own departure, a container releases what it holds and accepts what fits within `:capacity`. … nobody writes the hands' guards, so the engine answers for them" (866). "A kind that declares `contains` and no pass rule relays everything" (842). "Destroying a place with a visitor standing in it is a fault, because the alternative is moving someone silently" (771).

What is wrong, traced through the rules with Marta and Bob in the composing room:

- **Kidnapping.** Marta types `take bob`. Bob's nickname is matched like a noun (413), Bob is in range. `depart`: Printer/Actor declares none, so the engine allows (866). `release`: Place declares none, engine allows. `accept`: Marta's hands, engine answers within capacity 4. Bob is now in Marta's hands. Marta types `go out`; Bob's place becomes the press yard (84: "nearest ancestor declaring `contains actors`"). Bob was moved silently — the exact thing 771 calls a fault. `put bob in cabinet` also works while the cabinet is open.
- **Pickpocketing, including by accident.** Marta and Bob both type `take brass key` at the same moment. Turns are serialised (1246); Marta's runs first and succeeds. Bob's runs second: range is "inward through what they hold, following pass rules" (106), Marta is an Actor with `contains` and no pass rule (1383, 842), so the key *in Marta's hands* is still in range for Bob. `release` on Marta's hands is answered by the engine: "a container releases what it holds." Bob's `take brass key` succeeds by taking it out of Marta's hands. Neither is told. Two people trying to pick up the same thing at once resolves as theft, silently.
- **Stuffing.** `give brass key to bob` — Bob's hands accept anything within capacity, by engine default, with no consent from Bob's person. Four items later Bob cannot take anything and does not know why.

Why it matters: this is the only object in the tree with a person behind it, and it is the one whose guards "nobody writes." Every other object's author can refuse; the visitor cannot. In a shared world "everyone" plays in, this is the griefing surface, and it is on by default in the spec's own example.

What I would change: the engine answers the hands' guards, so it should answer them on the person's behalf — a visitor refuses `depart` unless the mover is itself (`go`), refuses `release` unless the actor is itself (`drop`, `give`, `put`), and its `accept` is a `give` the *recipient* confirms (or, simpler: `give` to a visitor is refused unless a host-side handshake says yes). Also make a visitor's hands `pass any (false)` for range purposes so what you carry is not nameable by others. Then say so in "Visitors", not in the host contract.

### 3. Chips are offered on fillability, refusals are unspecified for the misses, and the worked example is a closed room of things that will never work. — **judgement** plus **gap**

Sections: "Word order stops mattering" (611), "Slots" (619), the example's cabinet (1529–1542) and press (1630–1649).

Quotes: "A verb is offered when its roles can be filled; `permit` decides what happens when it is tried … Possibility is the chip's business and permission is the prose's" (611). "When nothing present can fill a required role, the phrase does not match, and the command falls through to the world's answer for words it cannot place" (619).

What is wrong, played:

- The cabinet composes `sprout.Container` (`:open true`, 1404) and `Warded` → `Lockable` (`:locked true`, 1435) and restates neither. So it is **open and locked**. `open cabinet` → "It is already open." (1416). `take shop key` → the shop key is out of range (`pass any (open && !locked)`, 1536) → the "words it cannot place" answer. The player has been told the cabinet is open and that the thing they can see the chip for does not exist.
- `unlock cabinet with brass key` → Warded refuses "It goes in, and turns nothing." (1524). That reads as *wrong key, find the right one*. The right key is `shop_key`, which is **inside the cabinet** (1563). And both keys have `:quenched false` (1548) with nothing in the world that sets it, so even the shop key would refuse "The key sprouts a hundred tentacles" (1554). The cabinet can never be opened.
- `work press` → "Dry type. It would print nothing but a bruise." (1639). Nothing inks the press. `ink press` → no such verb → unknown. `go up` in the paper store → `ladder_down` is false forever (1514) and the exit "is not offered, not traversable and not mentioned" (708), and `drying_loft` does not exist in the bundle.

Every one of these is offered as a chip, because the roles fill. Every one refuses. Line 31 promises "a client's buttons stay honest" but honest here only means *parseable*, and a button that always says no is not honest to the people this brief assumes.

The refusals also cannot distinguish the three states a player needs to tell apart: *impossible* (there is no ink), *not yet* (the sheet is wet), *misworded* (`ink press`). "It goes in, and turns nothing" and "Dry type" are the same shape as "not yet," and the unknown-words fallback (619) is the same for "shop key" (exists, unreachable) and "banana" (does not exist).

What I would change. `permit` is already required to be read-only and chance-free (601, 1133) — the spec made it poll-safe and then declined to poll it. Evaluate `permit` on poll exactly as exit `when` guards are (710) and export the refusal text with the chip, so a client can grey a chip and show why, and `help` can list "unlock the type cabinet with the brass key — It goes in, and turns nothing." The step cost is the same cost exit guards already pay. Separately, specify three engine answers for the miss cases (unknown verb; known verb, noun not in range; noun in range but no phrase fits) and make the middle one honest: "You can't reach a shop key from here" beats pretending it does not exist, and it leaks nothing that the compile-time noun set has not already leaked to the nickname checker (407). And fix the example so at least one thing in it can be done.

## Transcript

Marta and Bob enter the printer's shop. (Where? The spec declares no starting place — see "Dead ends" below. I assume `composing_room`.) What the world answers is derived from the rules cited; "—" means the spec gives no text.

```
[Marta enters]
> (arrival)
   :entered increments :visits (1500–1504). describe { say arrival } — a `say`
   in describe is refused by the compiler (1273, 1137), so as written this
   world does not compile. Assuming `text arrival` was meant and that the
   engine shows a place on arrival (unstated), Marta reads:

   Lead and lamp oil. The composing frames take the long wall, and the
   cabinet stands where the light is worst, which is either carelessness
   or the opposite.
   You have not stood in here before, and the room somehow knows it.
   The type cabinet, a brass key, the paper store, the apprentice, the shop cat, Marta.
                                                    ^ (1605 loops over all contents;
                                                      Marta is in the room; 949 capitalises)
> look
   reserved built-in (779); behaviour unspecified. Assume: same text again,
   minus the second sentence? No — visits is 1, "<= 1" (1601) still holds.
> l
   — abbreviations unspecified.
> x cabinet
> look at the cabinet
> examine cabinet
   `examine` is engine-sent (779); cabinet has no describe and no examine.
   Answer: — (unspecified).
> open cabinet
   "It is already open." (1416) — the cabinet is locked (1435) and its
   contents are out of range (1536).
> look in cabinet
   — no such phrase.
> take key
   only brass_key is in range; resolves. Guards all allow (866). Moved.
   Output: — (nothing; finding 1).
> i
> inventory
   reserved (779); format and wording unspecified.
> unlock cabinet with key
   target permits in composition order: Lockable ok (locked), Warded refuses:
   "It goes in, and turns nothing." (1524). The tool's tentacle refusal
   (1554) never runs — first refusal halts (601).
> unlock cabinet
   phrase not in this world's stdlib (1427–1432): falls through (619). —
   (Had it been present, Warded's permit reads `tool.get(:opens)` with no
   tool bound (561) — unspecified; a fault would tell Marta "plainly" (1200)
   that her command broke the turn.)
> unlock the cabinet using the brass key
   "using" not a declared connector. —
> ask apprentice about the press
   value role; whether "the press" matches option `the_press` (1467) is
   unstated (humanising is defined for output only, 943). If yes:
   "Bar's stiff, he says. Mind your knuckles." (1576)
> ask boy about press
   article-optional applies "wherever a noun is expected" (395); a value
   role is not a noun. — or the same answer; unspecified.
> ask apprentice about the cellar
   `the_cellar` is not in :knows (1571); "only the options in it match"
   (676): phrase does not match → falls through (619). Marta cannot tell
   "he doesn't know" from "I typed it wrong".
> talk to apprentice
> hello
> say hi to bob
   No verb; no free text anywhere by design (649). — 
> pet cat
   —
> take cat
   cat is an Actor with no depart guard (1582); engine allows (866). The cat
   is now in Marta's hands. Output: —.
> drop cat
   Moved back. Output: —.

[Bob enters; nickname "Bob" is checked against the noun set (405–409)]
   Marta reads an engine arrival notice — wording unspecified (1012, 397).
   Bob reads the arrival passage; the contents line now ends
   "…, the shop cat, Marta, Bob."

> (Bob) take brass key
   In range through Marta's hands (106, 842). Marta's hands release by
   engine default (866). Bob has the key. Neither is told. (finding 2)
> (Marta) take bob
   Bob is an object with nouns (413), no depart guard (1477). Bob is in
   Marta's hands. Output: —.  (finding 2)
> (Marta) go out
   Exit `out` (1491). depart/release/accept all allow. Marta is in the
   press yard, with Bob. press_yard has no describe, no :entered, and its
   prose file is absent (189). Marta reads: —. Bob reads: —.
> (Marta) go to the press yard
> (Marta) out to the press yard
   The chip label (1491) is not typeable; place nouns are out of range
   (world `pass any (false)`, 1461). —
> (Marta) work press
   "Dry type. It would print nothing but a bruise." (1639)
> (Marta) ink press
   —
> (Marta) pull the bar
   "bar" is not a noun. —
> (Marta) wait
   reserved (779); there is no clock to advance (19, 1072). —
> (Marta) in
> (Marta) go in
   Exit `in` (1615). Back in the composing room; visits is now 2, so the
   second sentence drops. Contents line: "The type cabinet, the paper
   store, the apprentice, the shop cat, Marta." — Bob is still in Marta's
   hands and is not listed, because the loop is one level deep.
> (Marta) drop bob
   Bob is on the floor of the composing room. Output: —.
> (cat's :tick)
   Never fires: ticks reach the place and no further (1043) and
   composing_room does not forward. Both players hear nothing, ever.
> (Marta) go in
   Into the paper store. No describe. —
> (Bob) close paper store
   Target in range from the room; Container permit ok; open := false.
   Output: —. Marta, inside, now has range that "outward through its
   containers" stops at a `pass any (false)` (106). Whether she can still
   name the store to open it is ambiguous (108 vs 106). `go out` is an
   exit, not a noun, so probably still works — the spec does not say.
> (Marta) go up
   `ladder_down` is false (1514); exit not offered, not mentioned (708). —
   Whether "no exit that way" is distinguishable from an unknown word: —.
```

Sixteen of Marta's turns produce no text at all under the spec as written. Three produce refusals that point at things that do not exist.

## Everything else, grouped

### Commands typed and not understood

- **Synonyms and abbreviations** — **gap**. "Built-in verbs" (775) and "Reserved names" (779) name `take`, `drop`, `give`, `put … in`, `go`, `look`, `inventory`, `wait`, `help` and nothing else. No `get`, `pick up`, `grab`, `x`, `l`, `i`, `n`/`s`/`e`/`w`, bare `out`, `leave`, `exit`, `put … into`, `put … on`, `insert`. Thirty years of IF players type these reflexively; new players type `pick up the key`. Specify the built-in phrase table in the spec (it belongs to the language because the world's verbs must not collide with it), and require a bare direction to mean `go <direction>`.
- **Pronouns** — **gap**. `take it`, `open it`, `ask him about the press`. Nothing in the spec supports a pronoun and the parser is stateless per turn (635). This is the single most common thing a new player types after any successful action. It needs no world state: the *host* can keep the last-resolved noun per visitor. Say which side owns it.
- **`all`** — **gap**. `take all`, `drop everything`. Set roles exist for authored verbs (626) but the built-ins are single-object proposals (775).
- **Politeness and filler** — **gap**. "please open the cabinet", "open the cabinet please", "can I open the cabinet", "unlock the cabinet with my key" (`my` is not an article, 395). Phrase matching is literal template matching as far as the text says. Either tolerate leading/trailing filler and a determiner class wider than `a/an/the`, or say the engine answers with the matched-nearest phrase so the player learns the shape.
- **Value roles have no input spelling** — **gap**. "A role-player narrows its own options" (674–682) defines how options are offered and compared, never how one is typed. Is `the_press` typed as "the press", "the_press", "press"? Is the article rule (395) in force for a value that is not a noun? Line 943 humanises symbols on output only.
- **Chip labels are not typeable** — **gap** / seam. "The label is what the visitor reads on a chip" (695). A screen reader reads the label aloud; the user echoes it back — `out to the press yard` — and is refused, because place nouns are out of range (112) and the label is not grammar. Every exported affordance should carry a canonical typeable phrase, and the label should be accepted as an alias for it.
- **Nicknames collide with grammar words, not just nouns** — **gap**. Line 405–409 checks nouns and noun tokens only. A visitor may be called "In", "Out", "With", "And", "All", "It", "Open". `give key to in`, `take key and and`. The check must also cover directions (695), connectors, the built-in verbs and every phrase's literal words. Conversely "the" is a token of `"the composing room"` (1488), so "The Baron" is refused for a reason no player will understand.

### Dead ends

- **No starting place** — **gap**. Nothing in the world model, `world` block (1457–1462) or host contract says where a first-time visitor arrives. "rejoining a place when they return" (156) presumes a first place that is never declared.
- **Impossible vs not-yet vs misworded** — see finding 3. Also `wait` (779): the world's time is wall-clock (1072); the sheet cures in forty real minutes (1661). A player who types `wait` expects it to do something. Specify it as a no-op that re-describes, or drop it.
- **Shut in** — **gap**. A visitor inside a `sprout.Container` place whose lid another visitor closes (paper store, 1507). Whether the occupant can name the container from inside is ambiguous between "An object always reaches itself and its own contents" (108, which says nothing about the container) and "outward through its containers … following pass rules" (106). If they cannot, the only way out is an exit, and if the exit is `when (self.get(:open))` there is no way out and no way to ask.
- **Dangling exit target** — **gap**. `-> drying_loft` (1511) names a place that is not in the bundle. "What it refuses" (1270) lists unknown kind/enum/property/message/extension, not exit target. If it reads as absent (189), the player has a chip-less, silent direction and no explanation.

### Honesty of affordances and engine-written text

- **A whole class of player-facing text is unspecified and unlocalisable** — **gap**. The spec says the engine writes "chips, disambiguation prompts, arrival notices" (397), arrival and departure announcements (1012), "the visitor is told plainly" on a fault (1200), the unknown-words answer (619), the missing-extension notice (1176), `inventory`, `help`. None of these has a wording, an owner (engine, host, world?) or a language. A Spanish world will refuse in Spanish and acknowledge in English. Add a `world { messages { … } }` block (or a stdlib-style replaceable passage set) for the engine's stock lines, with host defaults.
- **Disambiguation has no protocol** — **gap**. "disambiguation prompts" (397) exist, but a command yields "one reading" (599) and the parser has no cross-turn state. What does the player type in reply — `brass`? `the brass key`? `1`? And in a shared room the answer turn resolves against fresh range: if Bob took the brass key while Marta was being asked, her reply `key` is now unambiguous and silently takes the shop key. State whether the client re-submits the expanded command (right seam) or the engine holds a pending reading (wrong: hidden state).
- **"the the composing room"** — **contradiction** in the example. `name "the composing room"` with `article the` (1488–1489, also 71–72) renders as "its article and name" (942): *the the composing room*, in every chip, notice and disambiguation prompt. The cabinet (1530) does it the other way. Pick one and have the compiler refuse a name that begins with an article.
- **Silent success on stdlib verbs** is finding 1; note it also breaks the `tell` side: nobody in the room learns the cabinet was unlocked, because Lockable's `do` (1440) tells nothing and the world's Warded adds only a `permit` (1521–1526).

### Multiplayer

- **No way to talk** — **judgement**. Line 649 rules out string roles because "a string role would be the one place unmoderated player text enters a world," and 1018 makes nicknames the only visitor text rendered to a third party. So two people in the same room cannot say anything to each other, and the spec never says whether the host provides chat beside the world. For an audience of "everyone," co-presence without speech is a lobby, not a shared world. Either state that chat is a host feature outside the log (and then say how a client shows it alongside world text), or admit a `say`-to-others built-in with the same moderation story as nicknames. The reasoning at 649 is right for *world* text and does not follow for *player-to-player* text, which never enters a world's state.
- **Presence** — **gap**. Whether anyone else is here is visible only if the author's description happens to loop over contents (1605). press_yard does not, so Bob learns Marta is in the yard only when she acts. No `who`, and arrival notices (1012) are unspecified. The engine knows the occupants; a built-in `who`/presence line costs nothing.
- **Concurrent takes resolve as theft** — finding 2.
- **`describe` re-runs "on every poll" and a poll happens "because somebody else acted in the room"** (1127) — **gap**. What a poll *is* and whether the client re-shows the description when it changes is unstated. If a busy room re-renders the room text at every bystander's action, a screen-reader user hears the room every few seconds; if it does not, state changes made by others are invisible until you `look`. The seam (client decides) is right only if the exported data marks *what changed*.
- **Crowd-scaled faults land on the actor** — **judgement**. `tell` is "charged against the turn's output budget per recipient" (1022) and exhausting a budget faults the whole turn (1200). So `pull lever` succeeds in a room of five and fails, state untouched, in a room of five hundred — and the person told "plainly" is the one who pulled it, who did nothing wrong. Cap occupancy at the host, or charge fan-out to the host rather than to the turn.
- **Ambience frequency is not the author's** — **judgement**. The tick interval is deliberately unnamed (1030); the cat's `chance(8)` per tick (1586) means "every 25 seconds" on a two-second host and "every twelve minutes" on a one-minute host. The spec's own better example accumulates `elapsed` (1033). Either the tick handler receives no `chance` or the generated skill should steer authors to `elapsed`. (And the cat's handler never runs — see next section — so the example does not show this.)

### Prose quality under the rules

- **The contents line** (1605): `{for thing in self}{thing}{if $last}.{else}, {/if}{/for}` yields "The type cabinet, a brass key, the paper store, the apprentice, the shop cat, Marta." — a verbless comma list that includes a sub-place, two NPCs, and *the reader*. Worse than the old "You can see bench, window, shelf here" the working notes deride, because it also lists you. The rules make this the *idiomatic* form (951: "Listing what a place holds is therefore a loop over its contents and nothing more"). Passages cannot filter by kind unless `{if thing.is(K)}` is allowed in a slot condition, which "Conditionals and loops" (959–979) does not say. Say it is, and bind `$self`/`actor` exclusion, or the worst plausible output is the one the spec itself writes.
- **Whitespace and paragraphs** — **gap**. Passages are hard-wrapped in source (1597–1599); nothing says whether newlines are reflowed, whether a blank line is a paragraph, or what a false `{if}` block on its own lines leaves behind. On a phone, source-wrapped 72-column lines are ragged; on a screen reader, stray blank paragraphs are pauses.
- **The cat's tick is dead code** — **contradiction** in the example. "The tick reaches the place and no further" (1043) and composing_room does not forward; the cat's `on :tick` (1585) never runs. The one piece of ambience in the example never happens.
- **Capitalisation** (949) is the only engine-written typographic rule. Nicknames like "de Vries" and names beginning with a lowercase brand will be capitalised at line start; fine, but say it applies to nicknames.

### Accessibility

- **Effect kinds are not enumerated** — **gap**, and it is the accessibility path. "The log stores effects, not rendered output … a screen reader … is simply another client" (1340). For a screen reader to be a client it must know whether a line is *your* result, someone else's action, ambience, an engine notice, or a re-render of the room — that is the difference between `aria-live="assertive"`, `polite`, and not announcing at all. The spec lists what an extension effect must declare (1170) but never the core effect kinds. Enumerate them: `said`, `told`, `described`, `notice`, `refused`, `fault`, with source object and, for `told`, the acting visitor.
- **Discovery is chips-only** — **judgement**. Every affordance question is answered "the chip's business" (611, 680). `help` is reserved (779) and unspecified. A text client, a terminal, a screen reader with chips off, all need the same affordance set as text. Make `help` (or bare `?`) the text rendering of the chip derivation, specified in the language, so the two can never disagree.
- **Real-time waits with no indication** — the sheet's forty minutes (1661) and the kiln's three hours (1060) are opaque to a player who cannot read the source; "The ink is still wet" does not say *how long*. Authors should be able to write `{self.remaining}` or similar for a pending wake; today they cannot, because a wake is write-only.
- **Nothing assumes sight** beyond chips, which is good; nothing assumes speed. Direction words (`north`, `southwest`, 695) with no map are hard on a phone; labels mitigate this only if they are typeable (above).

### Where the spec pushes to the client — seam or evasion?

- Rendering, chip layout, asking target-then-topic (680): **right seam**. The language exports the data.
- Disambiguation replies, pronouns, and `it`: **unassigned**, not pushed. Assign them to the host/client explicitly, since the language's stateless parser cannot do them.
- Affordance content — whether an offered verb will refuse: **evasion**. The language has the pure `permit` and declines to run it on poll. See finding 3.
- Engine stock text and its language: **evasion**. Neither the language nor the host contract owns "Taken.", "Which do you mean?", or "You can't see that." Somebody must.
- Chat: **unaddressed**. See Multiplayer.

### Smaller things

- `describe { say arrival }` (78, 1121, 1498) is refused by "What it refuses" (1273); the example does not compile. The `text` form (201) is presumably meant.
- `examine { grammar "look into [self]" … }` (912), `throw { grammar "throw [self]" … }` (163), `pull { grammar … }` (992), `fire { grammar … }` (1057) and `"unlock [on] with [self]"` (1370) are object-owned grammar, which "Verbs and the grammar a visitor types" (546, 563) says does not exist. As a player I cannot tell whether "look into the mirror" is a thing this language accepts.
- `examine` is both "engine-sent" and a message an object declares (912) and a name "a message may not take" (779).
- A `tell` inside a `permit` is refused (1006) and a `permit` has "no voice beyond its refusal text" (879) — good; but the *bystanders* never learn that Marta tried and failed. In a shared room, watching someone rattle a locked cabinet is part of the scene. A judgement call; I'd allow a `refuse` to carry a `told` form.
- The visitor's `:capacity 4` (1478) refusal text on the fifth `take` is the engine's (866) and unspecified.
- `:remembers` on the *room* counts visits (1496) but "You have not stood in here before" also shows to a visitor who was carried in (finding 2) — `:entered` runs for them too, so the count is honest; noted only because it shows how many rules kidnapping touches.
