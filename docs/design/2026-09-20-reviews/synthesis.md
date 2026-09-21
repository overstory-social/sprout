# Synthesis of the five reviews

Written after reading all five reports, by the session that ran them. Where
this disagrees with a report, the report is the primary source. Line numbers
are the spec's on 2026-09-20.

## Where they converge

Ranked by how many reviewers found it independently, then by weight.

### Found by all five

**1. Two verb mechanisms are both in the spec.** "Verbs are declared by a
world or exported by a library, never by an object" (l.563) — yet Spawning
(l.163), Passages (l.912), Other people (l.992) and Wakes (l.1057) each show
an object-level `name { grammar "… [self]" … }` message body, the typing
table (l.469–470, 506) shows typed message arguments, and the stray paragraph
at l.1370 under `### kinds.sprout` describes the previous design verbatim.
R3 adds that `examine` at l.912 is also a reserved name (l.779), so that
example fails twice. R5: this decides one grammar table vs two and one
callable surface vs three. R2: the second path has no consent pass at all.
Every reviewer's fix is the same — delete the old form from the four
examples, rewrite them as `verb` + `as … for`, delete l.1370, and reserve the
word "message" for the queued event received by `on :m`.

**2. `say` in `describe` is both the idiom and a compile error.** Refused at
l.1137 and l.1273; used at l.78, l.1121 and the worked example's only
`describe` at l.1498. `text` (l.201, l.934) is the apparent alternative and is
never introduced anywhere. Also unsaid: what `look` and `examine X` actually
render (R3), and what `examine` answers for an object with no `describe`
(R4). Minor conflict on the fix: R1/R2 say pick `text`; R3 says keep `say`
and drop `text`. Either way, one word, defined in Prose as the third output
statement.

### Found by four

**3. The worked example does not compile and cannot be played.** `Press`
(l.1630) and `drying_loft` (l.1511) are undeclared. The cat's `on :tick`
(l.1585) is dead code — "the tick reaches the place and no further" (l.1043)
and `composing_room` forwards nothing. `Lockable` at l.326 has a pass rule and
at l.1434 does not, and l.1535/1698 depend on the version that does. Every
`Key` is `:quenched false` (l.1548) and nothing sets it, so `as tool for
unlock` refuses forever; the only key for the iron ward is inside the
iron-warded cabinet, which is open *and* locked because it restates neither
default. No `Rib`/`Sponge` exists, so `work … with [tools]` can never fill.
The claim at l.1372 to "use every construct" is false — `send`, `broadcast`,
authored `on :m`, `changed`, `without`, `destroy`, `each`, `release`,
`random`, integer roles are all absent. (R1, R3, R4, R5)

**4. `actor` is reachable from actor-less turns.** l.1008 refuses `say` and
`{actor}` in a `:tick` body only. A tick may `broadcast :gust` (l.1038); the
`:gust` handler may `say`. A wake that `destroy self`s drops contents into a
container whose `:entered` handler — in every example — calls
`actor.remember`. l.1078 says a catch-up wake's `say` is *dropped*, implying a
live wake's `say` reaches someone, but a wake has no actor either. The spec
says nothing about what the evaluator does. (R1, R2, R3, R5) **The reviewers
disagree on the fix** — see Conflicts.

**5. Visitors' hands are open to everyone.** `sprout.Actor` (l.1383) declares
`contains` and no pass rule; "no rule means no policy" (l.842); so what a
visitor carries is in every other visitor's range, and the hands' `release`
is answered by the engine default (l.866) — allow. Two people typing `take
brass key` in the same moment resolves as the second silently taking it out
of the first's hands. R4 extends it: visitors themselves have engine-default
`depart`, so `take bob`, `go out`, `put bob in cabinet` all succeed — the
silent move that l.771 calls a fault. R1/R2 add the contradiction with "the
hands carry without hearing" (l.793). (R1, R2, R4, R5)

### Found by three

**6. Open roles, senders and loop variables have no stated type**, so "there
is no unknown receiver anywhere in the language" (l.464) is false for the
bindings the worked example actually uses. `role tool` (l.1429) is untyped,
`tool.get(:opens)` (l.1523) reads through it; `from.get(:opens)` (l.816)
reads through a runtime-decided sender; `{thing.greeting}` reads through a
contents loop. The only computable rule in a closed bundle is a union over
declaring/sending kinds — decidable, cheap, unstated, and with a consequence
the spec must own: a world adding a new role-player can break a library
kind's `permit`. The `chance` reachability check (l.1137) inherits this — one
loop-bearing `describe` poisons `{one of}` in every same-named passage.
Both R2 and R5 propose roles declare their shape at the verb (`role tool:
Kind`, `role topic: enum`) and `from` only narrows; R2 also wants typed loop
variables. (R1, R2, R5)

**7. Engine default `accept` reads `:capacity` by name** (l.866) against "no
magic property names" (l.308). `sprout.Place` has no `:capacity` and writes
`accept { allow }` to escape a default the spec says doesn't exist. (R1, R2,
R5)

**8. Article doubling.** `{thing}` renders "its article and name" (l.942);
`name "the composing room" article the` (l.71, l.1488) renders "the the
composing room"; `name "the paper store"` with the default article renders
"a the paper store"; `apprentice` works around it with `article none`. Three
spellings in one example, none caught by the compiler. (R1, R3, R4)

**9. `{for thing in self}` lists the reader to themselves** — visitors are
contents, `{thing}` renders a nickname, and l.1605/1706 present this loop as
the idiomatic contents line. Nothing says `{if thing.is(K)}` or `!= actor` is
legal in a slot condition. (R1, R3, R4)

**10. Budget vocabulary.** "per request" (l.1226, 1228), "per turn" (l.1227),
"per action" (l.177, 846, 1190, 1231) — three names, no definition, and no
answer to whether a poll is one. (R1, R2, R5)

### Found by two

- **Persisted state is not "one flat map per object"** (l.254, l.1344).
  Containment, link destinations (a stored object reference, against l.530),
  pending wakes, last-tick times, per-visitor memory and an absent visitor's
  rejoin place all live outside it. Nothing mints a stable instance id;
  spawned objects have no identifier; how a source object re-binds to stored
  state on reload is unsaid. (R2, R5)
- **No starting place.** Nothing declares where a first-time visitor arrives;
  l.156 presumes one. (R4, R5)
- **Visitor admission and departure are not in the log** (l.1338), yet they
  fire `:entered`/`:left`, change range and change parsing. Replay cannot
  work without them. (R2, R5)
- **Ticks: one turn per occupied place or per world?** l.1030 vs l.1045 —
  budget, log shape and fault blast-radius all differ. (R2, R5)
- **Queue drain point.** l.603 vs l.783 vs l.1143 — after each `do` or after
  all; decides whether the target's `do` observes handler writes triggered by
  the tool's `do`. And whether `changed` hooks are inline or queued, coalesced
  or not. (R2, R5)
- **Contents order is undefined**, and `{for}`, `each` and "any of them will
  do" (l.171) all depend on it for determinism. (R2, R5)
- **Nickname collision** (l.405–413) checks nouns only; "In", "With",
  "North", "All", "Open" pass and break parsing. Conversely "the" is a noun
  token of `"the composing room"`, so "The Baron" is refused. (R2, R4)
- **Lenient loading has no reference-site semantics** — "reads as absent"
  (l.189) vs "unknown kind" refusal (l.1279). Objects of an absent kind,
  exits to an absent place, a visitor standing in an absent place. (R2, R5)
- **`sprout.Takeable`** is used at l.198, 238, 308, 449 and declared not to
  exist at l.1452 and l.1675. (R1, R3)
- **`each`** is referenced seven times and never defined. (R1, R3)
- **`let cell = spawn …`** (l.753) vs "an initializer … cannot write"
  (l.522). (R1, R2)
- **Guards falling off the end.** l.866 "a guard ends in `allow` or
  `refuse`"; every `depart`/`accept` writes `else { allow }`; every `permit`
  falls off the end. (R1, R3)
- **`:remembers [visits: 0 … max 99]` + `recall + 1`** faults on the 100th
  visit unless `remember` clamps — unstated. (R1, R3)
- **Wakes run away.** A faulting wake is restored on abandon, is still due,
  fires and faults forever (R5). `on :woke { wake in 1 seconds }` on 2,000
  instances is 2,000 turns/second forever; a year's absence is 31M catch-up
  deliveries before admission unless "at most one" (l.1076) means what it
  probably means (R2).

## Findings from one reviewer that carry their own weight

**The default experience is silence** (R4, its first finding). Trace a
successful `take brass key`, `open cabinet`, `unlock cabinet with shop key`
or `go out` through the rules: built-ins are unauthored (l.775), stdlib kinds
carry no prose (l.272), `press_yard` has no `describe` or `:entered`, and
nothing says the engine describes a place on arrival. Sixteen of the imagined
transcript's turns print nothing; the only one that prints is the one that
fails. On a terminal or screen reader this is indistinguishable from a crash.
Meanwhile `sprout.Fixture` *does* ship `passage immovable` (l.1395) and
l.1685 celebrates overriding it — the exact mechanism l.272 forbids. Related:
every engine-written line (arrival notices, "which do you mean?", unknown
words, faults, `inventory`, `help`) has no wording, owner or language.

**The poll is where the cost lives and nothing bounds it** (R2, its first
finding). Every budget is per turn; the poll is not a turn — no seed, no
lock, no log, no budget — and it runs the range walk, every exit guard, the
place's `describe` (per visitor, since it reads `actor.recall`) and the
whole verb table. Cost is *occupancy × (range + exits + describe + verbs ×
range)* per poll interval, unserialized against write turns, so it can read
a half-committed tree. Fix: derive the view once per visitor present at the
end of every write turn, inside that turn's budget, and let polls read the
stored view. R5 makes the adjacent point that `say`/`tell` prose must be
rendered at turn time — "rendering at read time" (l.1340) cannot work against
moved state and changed nicknames.

**Chips are offered on fillability and every chip in the example refuses**
(R4). `permit` is already required to be pure and chance-free (l.601,
l.1133) — poll-safe — and the spec declines to poll it. Run it on poll as
exit guards are, export the refusal text with the chip, and specify three
engine answers for the miss cases (unknown verb / known verb, noun out of
range / noun in range, no phrase fits) so a player can tell impossible from
not-yet from misworded.

**`move` is named as forbidden in guards, `let` and `describe` and never
given syntax or semantics** (R2). If authored bodies can move things, a
refusal lands mid-effect-pass after other `do` bodies have written; silent
no-op, fault and emit-and-continue are three different worlds. Same hole for
`destroy self` while the tool's `do` still has `target` bound.

**No start hook for source-declared objects** (R3). `:spawned` is for runtime
spawns only; a candle that should be burning from the world's first moment
has no way to ask for its first wake. R3 changed the design of their world to
fit the language.

**No way for two visitors to talk** (R4). l.649's argument against string
roles is right for *world* text and does not follow for player-to-player
text, which never enters world state. Say whether chat is a host feature and
how a client shows it beside world text.

**Core effect kinds are not enumerated** (R4). For a screen reader to be
"simply another client" (l.1340) it must know whether a line is your result,
a bystander's action, ambience, an engine notice or a re-render — that is the
difference between assertive, polite and silent.

**Writer-facing friction** (R3, in aggregate): `self.get(:lit)` for every
read of one's own state; `grammar { … }` as the block where you name a thing
and declare exits; `actor` in the language vs "visitor" in the prose; `tell`
meaning "everyone else"; `permit` as the block where you refuse; two `if`
syntaxes (parenthesised in bodies, bare in slots); `{for}`/`describe`/
`passage` needing three members to attach one paragraph; and the document
ordered for a design checker rather than a writer — the two things a writer
does first (name a place, make it say something) are on l.71 (wrong) and
l.78 (refused).

## Where the reviewers conflict

**Actor in actor-less turns.** R5 wants a *static* refusal: `actor` is out of
scope in any body reachable from `:tick`, `:woke`, `:spawned` or a
destroy-caused move, computed by the same reachability the spec already uses
for `chance`. R2 wants a *runtime* rule — `say` is a no-op, `{actor}` renders
nothing, `recall`/`remember` fault — and to demote the static tick-body
refusal to a warning, because bus reachability would forbid `actor` in most
handlers (any `:entered` handler is reachable from an NPC arriving on a
tick). Both are right about the other's cost. The decision is whether
"typed where bound" is worth losing `actor` in `:entered`; R2's runtime rule
with a static *warning* is the cheaper first move and does not preclude
R5's rule later.

**Stdlib prose.** R1 reports `sprout.Fixture`'s `passage immovable` as a
violation of "standard library kinds carry no prose" (l.272). R4 reports
l.272 as the rule to reverse, because replaceable stdlib passages
(`opened`, `taken`, `unlocked`) are the cheapest fix for silent success.
Same fact, opposite fixes. R4's direction dissolves R1's finding and the
silence finding at once.

**Which word for `describe` output.** R1/R2 say `text`; R3 says `say` (a
description is said to the polling visitor). Cosmetic, but it must be one.

**Chance reachability through loop variables.** R2 and R5 both find that
`{item.greeting}` from an untyped contents loop makes the reachable set
"every `greeting` in the bundle". R2 fixes it by typing the loop variable;
R5 fixes it by dropping cross-object passages from `describe`. R2's is
the smaller change.

## Suggested order of repair

*Status: all nine steps applied to the spec, notes and backlog on 2026-09-20, under four directions from the author: limits are the host's; every action is answered; typing is exact; actor-less turns may narrate and change state. Line numbers in the reports and above predate the rewrite. Where the reviewers conflicted, the working notes' Decisions record what was chosen and why.*

Ordered by what blocks the most downstream work, not by how many found it.

1. **Purge the previous design's survivals** (convergence 1, 2, 3 plus
   `Takeable`, `:names`, `{thing.short}`, `sprout.Keylike`, `use … from`,
   l.1370, the two `Lockable`s, the stale "What it surfaced" items). This is
   mechanical, and until it is done a model reading the spec as reference
   will reproduce the old language. Fix the worked example so it compiles and
   at least one thing in it can be done.
2. **Define the poll** — budget, isolation, cadence, and whether views are
   derived per write turn (R2). This is architectural and decides the
   runtime's shape.
3. **Decide who owns engine-written text and what a successful built-in
   prints** (R4 silence; stdlib replaceable passages; stock lines with host
   defaults; effect kinds enumerated). This decides what the product is.
4. **Close the typing holes** — union rule for open roles, senders, handler
   values and loop variables, or shape-at-the-verb roles (convergence 6). This
   decides whether "exact checking" survives or becomes best-effort.
5. **Give the visitor its guards** — a visitor refuses `depart` unless the
   mover is itself, refuses `release` unless the actor is itself, `accept`
   on `give` is the recipient's; hands `pass any (false)` for range
   (convergence 5).
6. **Write the state model** — runtime ids, what is persisted beyond the
   property map, how source objects re-bind on reload, what the log must
   contain for replay (admissions, nicknames, publishes, bundle hash), and an
   "absent" table with one row per reference kind.
7. **Pick a rule for actor-less turns** (convergence 4; see Conflicts) and
   for faulting/runaway wakes.
8. **Settle the smaller decidable gaps in one pass**: `each` syntax, `move`
   syntax, message declaration form, property declaration syntax, integer
   default range, contents order, drain point, `changed` hook timing, guard
   fall-through, `remember` out of range, spawn-and-`accept`, ticks per place
   or per world, nickname check over all grammar tokens, starting place,
   start hook for declared objects, `wait`, pronouns and synonyms table, one
   word each for turn/request/action, message/set, consent guard/permit,
   `Place`/`sprout.Place`.
9. **Then reorder the document for the writer** (R3 §4.8) — worked example
   first, composition and range at the back marked for library authors.
