> **Design history.** The language proposal as written inside Overstory
> Social's repository (2026-09-05) and revised there; the README in
> `sprout/lang` is the language as it stands. Where the two disagree, the
> README wins.

# Sprout — the language (proposal, 2026-09-05)

This supersedes understory.md §3.2 ("the language") and amends §3.1
where it says so below. The design is evolving (Eric, 2026-09-05):
where this document and understory.md disagree, this one wins, and
understory.md carries a pointer. Revised the same day after Eric's
second pass (events as envelopes with depth, containers as the message
bus, containment as a proposal, kinds and instances, a bounded shared
world): §2.5–§2.8 and §2.11 are the result, and §1's table records
where the second pass overrode the first.

**Where it lives (2026-09-16):** `packages/sprout` — `@overstory/sprout`,
MIT — holds the language on its own: the definition format and its caps
(`definitions.ts`, cut out of the understory schema at the seam between
the language and the product), the written language and compiler
(`sprout.ts`, `sprout-lang.ts`), the skill (`sprout-skill.ts`), the
engine and the command parser (`engine.ts`, `parser.ts`, out of the
backend). It imports zod and nothing else; Overstory plugs it in through
`@overstory/schema`. Stage 1 of the split; stages 2 (the runtime's
ports) and 3 (the frontend library) are not started.

**Proposed 2026-09-17:** `design/proposals/2026-09-17-sprout-split.md`
— the runtime split (`lang` / `core` / store adapters / a CLI), source
text as the stored truth in place of §4's stored AST, media as the first
language extension, and the Understory as a host. Where that proposal
and this document disagree, the proposal wins once Eric accepts it; §8
of it lists each amendment.

What v0 has today: an AST authored in a form — declared fields, views
as guard → prose, verbs as guard → effects, handlers for named
messages, a small effect vocabulary (`set`, `adjust`, `set_visitor`,
`say`, `send_message`, `branch`) — validated by zod at the boundary and
run by one server-side evaluator inside the room's transaction. The
computation class (total, bounded cascades, deterministic order) is
the part worth keeping exactly. Everything about how a builder writes
it, and half of what an object may reach, changes here.

---

## 1. What is being asked for, and what it changes

Eric's brief, in his words where it matters:

- A real DSL, "somewhat like ruby": messages defined on objects
  (`torch.light`), some taking other objects (`torch.useWith(flint)`).
- A `room` object dynamically scoped at execution time
  (`torch.light { room.set(:illuminated, true) }`).
- Well-known properties the language defines (`:takeable`), and
  properties an object defines for itself.
- Inheritance with abstract messages (`object usable: inherit none {
use (with: object) abstract }`).
- One vocabulary for property changes and broadcasts: `on :illuminating`
  fires when the property changes on self, and `broadcast :illuminating`
  reaches everything "in range" — a tool may glint in the light.
- Prose stays plain text. Media, when it comes, is closed by default
  and opens in a lightbox on examine / enter / a language-driven cue.
- The default way to play is to **type**: "use the flint and steel to
  light the torch", and read a block of text back. Links and chips
  become an alternate, easier mode.

Three of those override understory.md as written, and the design is
updated accordingly:

| understory.md said                                                                    | Sprout 1 says                                                                                                                                                                                                                                                                                                                                                  | Cost, and the guardrail that pays it                                                                                                                                                     |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §3.1: "no object may change another object's state" — objects only send messages      | **Kept, and now uniform** (second pass). The first pass let anything write the room (`room.set`); Eric's second pass models every property change as the object's own answer to a message it received, and the room is a container with handlers like any other — so `send room :illuminating(true)` and the room decides. Writes are `self` only, everywhere. | The one cost is one more line in the room (`on :illuminating (from, value) { self.set(:illuminated, value) }`), which is also the line a reviewer reads to learn what lights the cellar. |
| §3.1 corollary: guards read only `self` and `visitor`                                 | Declared properties are **readable by anything in range** (`flint.get(:onFire)`) — the same reach a broadcast has (§2.5). Writes stay `self`.                                                                                                                                                                                                                  | Reads leak nothing (no visitor identity lives in properties) and make `use (with:)` possible at all.                                                                                     |
| §3.1: cascades stop at depth 6 and an object is never delivered to twice on one chain | An **event envelope** carries `depth` and `instigator` (§2.5); the cap is 20 and a per-action event budget; the cycle rule is dropped because containers legitimately relay the same event twice. Exceeding either aborts the action and records a fault.                                                                                                      | Depth alone is not the guard against runaway — a fan-out is; the budget is. Both are instrumented from day one (§2.11) so the caps are set from measurements, not guesses.               |
| §3.2: "store the AST, not text"; the form is the only surface                         | **Both.** Source text is what the builder writes; the compiled AST is what runs. See §4.                                                                                                                                                                                                                                                                       | The boundary compiles; the runtime still never parses untrusted text.                                                                                                                    |

Kept exactly, because they are what make the thing moderatable and
cheap to run: totality (no unbounded loops, no recursion), bounded
cascades under a depth cap and an event budget (§2.5), deterministic delivery order, one
evaluator on the server inside the room's transaction, per-visitor
memory made legible, nothing reaching outside the room, nothing
becoming feed content.

---

## 2. The language

### 2.1 At a glance

```sprout
kind Usable {
  :takeable true
  use (with: object) abstract
}

kind Torch: Usable {
  :names ["torch", "brand", "stick"]
  :onFire false
  :illuminating false

  describe {
    if (self.get(:onFire)) { text "A pitch torch, burning steadily." }
    else { text "A pitch torch, cold. It wants a light." }
  }

  use (with: object) {
    if (with.get(:onFire)) {
      self.set(:onFire, true)
      self.set(:illuminating, true)
      say "The pitch catches with a soft whump."
    } else {
      say "Nothing about that will light a torch."
    }
  }

  changed :illuminating (value) { broadcast :illuminating(value) }
}

kind BrassKey: Usable {
  :names ["key", "brass key"]
  :glinting false
  on :illuminating (from, value) {
    if (value && !self.get(:glinting)) {
      self.set(:glinting, true)
      say "Something glints in the new light."
    }
  }
  describe {
    if (self.get(:glinting)) { text "A brass key, catching the light." }
    else { text "A brass key." }
  }
}

room cellar {
  :illuminated false
  describe {
    if (self.get(:illuminated)) {
      text "A vaulted cellar. Barrels along one wall; a stair up."
    } else {
      text "Pitch dark. You can feel a wall, and cold air moving."
    }
  }
  on :illuminating (from, value) { self.set(:illuminated, value) }
  exit up to hall
}

object torch: Torch in cellar
object key: BrassKey in cellar
```

A player in the cellar, holding the torch and the flint, types
`light the torch with the flint`. The parser (§5) resolves `light` to
`use` on the torch with `with` = the flint (§2.7), the torch's `use`
runs, its `:illuminating` property changes, its `changed :illuminating`
hook broadcasts an event carrying the new value, the cellar (the
torch's container, and so the bus) relays it to the key and handles it
itself, all in the same transaction, and the player reads back the
torch's `say`, the key's `say`, and the cellar's new description — one
block of text. The torch never touched the key or the cellar: each
decided for itself what a light nearby means.

### 2.2 Objects, kinds, properties

- `kind Name: Parent { … }` defines a **kind** (behaviour and property
  defaults; capitalised, Ruby's constant convention, enforced by the
  compiler so kinds and objects never share a namespace);
  `object name: Kind in <container> { … }` places an **instance** with
  its own state (§2.8); `room name { … }` a room, which is an instance
  of the built-in kind `Room`. Names are identifiers; the player-facing
  words come from `:names`.
- A **property** is declared `:name <value>` with a literal default:
  `true`/`false`, an integer, a string, or a symbol from a declared set
  (`:state one_of [wet, leather, fired] default wet`). Integers may
  carry `min`/`max` (`:tame 0 min 0 max 3`); `adjust` clamps, as now.
  `default` is optional sugar (`:takeable default true` and
  `:takeable true` mean the same).
- **Well-known properties** the language defines, with defaults every
  object inherits without declaring them:

  | property                 | default                      | meaning                                                                                           |
  | ------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------- |
  | `:names`                 | the object's name, humanised | the words the parser accepts for it                                                               |
  | `:takeable`              | `false`                      | may be picked up (replaces v0's `portable`)                                                       |
  | `:hidden`                | `false`                      | not listed, not addressable, until something un-hides it                                          |
  | `:scenery`               | `false`                      | listed in the room's prose only; `examine` works, `take` says so                                  |
  | `:image`                 | none                         | a media id; §2.9                                                                                  |
  | `:illuminated` (rooms)   | `true`                       | dark rooms show only their dark description; nothing in them is addressable except by touch words |
  | `:open` (containers)     | `true`                       | a closed container relays nothing and releases nothing by default (§2.5, §2.6)                    |
  | `:capacity` (containers) | none (rooms), `8` (hands)    | how many things `accept` admits by default (§2.6)                                                 |

  Everything else is the object's own. Two objects may each declare
  `:onFire`; they are different properties on different objects. A
  well-known name applies only where the table says — `:open` and
  `:capacity` to containers, `:illuminated` to rooms — so a bucket that
  is not a container may declare its own enum `:open` (the seeded glaze
  buckets do); where it applies, redeclaring it with another type is
  refused (#337).

- **Reads** (`x.get(:p)`) are allowed on `self`, the `room`, the
  `actor`, any argument, and any named object in range. **Writes**
  (`x.set(:p, v)`, `x.adjust(:p, n)`) are allowed on `self` only — an
  object's state changes only as its own answer to a message it
  received (Eric's second pass; §1's table). The compiler enforces
  this; it is not a runtime check.

### 2.3 Messages

- `name { … }` defines a message with no arguments; `name (with: object) { … }`
  one that takes an object. Arguments are typed `object` in v1
  (`integer`/`text` arguments are a later addition, needed for
  "turn the dial to 3").
- `name when (expr) { … }` is offered only while `expr` holds: easy
  mode's chips leave it out, the parser answers "you can't do that
  right now" (v0's verb guard, kept in #337 because a chip that is not
  there is a better answer than one that says no).
- `abstract` on a kind's message means "children must define this";
  a kind with an abstract message cannot be placed in a room.
- **Reserved messages** the engine sends: `describe` (produces the
  object's current prose via `text`), `examine` (defaults to
  `describe`), `spawned (from)` on a freshly made instance (§2.8), and
  the containment protocol's guards and notices — `depart`, `release`,
  `accept`, `moved`, `left`, `entered` (§2.6; `entered (actor)` on a
  room is what v1's `enter` was). `take`, `drop`, `give (to: object)`
  and `go` are not messages a builder defines: they are the built-in
  verbs that _propose a move_, and the protocol's guards are where a
  builder shapes them. The default behaviours are the language's, not
  the builder's, so a room that does not mention `release` still lets a
  takeable thing be taken.
- **Scope objects** inside a body: `self`, `room` (the room the
  receiving object is in _at execution time_, however deep the nesting
  — a torch in a box in the cellar still has `room` = the cellar),
  `container` (what holds `self` directly: the box), `actor` (the
  visiting profile, as an opaque object: `actor.remember(:met, true)`,
  `actor.recall(:met)`; nothing else about them is readable — not a
  handle, not an id; `x == actor` and `x.is(Actor)` are the only ways to
  tell an actor from a thing), and each named argument.

### 2.4 Statements and expressions

```
member     := property | message | handler | hook | rule | consent | exit
message    := ident params? ( block | 'abstract' )
handler    := 'on' symbol params? block             -- a message arrived (§2.5)
hook       := 'changed' symbol params? block        -- a property of self changed (§2.5)
rule       := 'pass' ( symbol | 'any' ) '(' expr ')'  -- container relay rule (§2.5)
consent    := ( 'depart' | 'release' | 'accept' ) params block   -- containment guard (§2.6)

statement  := if | set | adjust | say | text | broadcast | send
            | remember | show | move | each | spawn | destroy
            | allow | refuse
if         := 'if' '(' expr ')' block ( 'else' ( if | block ) )?
set        := 'self' '.' 'set' '(' symbol ',' expr ')'
adjust     := 'self' '.' 'adjust' '(' symbol ',' expr ')'
say        := 'say' string                          -- to the actor
text       := 'text' string                         -- describe's output
broadcast  := 'broadcast' symbol ( '(' expr ')' )?  -- handed to self's container, which relays (§2.5)
send       := 'send' target symbol ( '(' expr ')' )? -- to one object in range
remember   := 'actor' '.' 'remember' '(' symbol ',' expr ')'
show       := 'show' target? symbol?                -- open media in the lightbox (§2.9)
move       := 'move' target 'to' target             -- a containment PROPOSAL (§2.6), not a write
spawn      := 'spawn' Kind 'in' target              -- a new instance of Kind (§2.8)
destroy    := 'destroy' 'self'                      -- self leaves the world; its contents fall to its container
each       := 'each' ident 'in' target block        -- bounded: the target container's contents
allow      := 'allow'                               -- consent guards only
refuse     := 'refuse' string                       -- consent guards only; the string is said to the actor
expr       := literal | symbol | target '.' 'get' '(' symbol ')'
            | 'actor' '.' 'recall' '(' symbol ')'
            | ident                                 -- a parameter's value: a handler's `value`, a hook's `was`
            | target '.' 'is' '(' Kind ')' | target '.' 'count'
            | expr op expr | '!' expr | '(' expr ')'
op         := '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||' | '+' | '-'
target     := 'self' | 'room' | 'container' | 'actor' | ident   -- an argument, a parameter, or a named object in range
```

Strings are plain text (no markup — the prose rule). Integers only; no
floats, no strings concatenation in v1 (say what you mean in the
string). `each` is the only iteration and it walks a finite,
engine-supplied list, so every body terminates by construction —
totality is a property of the grammar, not a budget.

### 2.5 Events: envelopes, hooks, and containers as the bus

The first pass unified "my property changed" and "something near me
happened" under one `on :name`. Eric's second pass found the imprecision
in that: two different things were sharing a word. They are now two
constructs, and a broadcast carries a value.

**Two constructs.**

- `changed :p (value, was) { … }` is a **hook**: it runs on the object
  whose property `:p` just changed, after the write, with the new value
  and the old one. It does not run when the value is set to what it
  already was. It is the only place a property change is observable,
  and it reaches nothing else unless it says so — the torch's
  `changed :illuminating` is where the torch decides to tell the world.
- `on :m (from, value) { … }` is a **handler** (`_` leaves a parameter
  unnamed: `on :pong (_, value)`): it runs when a message `:m` arrives — from `send`, from `broadcast`, or from the engine
  (the reserved messages, §2.3). The receiving object decides what, if
  anything, to change about itself. The torch cannot set the key's
  `:glinting`; it can say that it is illuminating, and the key decides.

The compiler warns when a `changed :p` exists for a property nothing
sets, and when an `on :m` exists for a message nothing in the zone
sends or broadcasts and the engine does not send either.

**The envelope.** Every event is a record, whether or not the handler
looks at all of it:

```
{
  id:         event#404200
  name:       :illuminating
  from:       torch#4334        // sender (an instance id; `from` in the handler)
  value:      true              // the payload, if any
  depth:      1                 // 0 = the actor's own action
  instigator: event#32201       // the depth-0 event this descends from
  path:       [cellar#12]       // the containers that relayed it (so a container relays each event once)
}
```

The actor's typed command is the depth-0 event. Everything a handler
emits while running an event at depth _n_ is stamped _n_ + 1 and the
same instigator. Two limits, both engine constants and both revised
from measurements (§2.11): **depth ≤ 20** (`UNDERSTORY_CASCADE_DEPTH`,
6 today), and an **event budget per action** (256 to start) — because
the sorcerer's-apprentice case is a fan-out, not a deep chain, and a
depth cap alone never catches it. Exceeding either is a **runtime
fault**: the action's transaction rolls back (partial state from a
truncated cascade would be worse than nothing), the visitor reads
"Something in here tangles itself up, and nothing happens.", and the
builder gets a fault record naming the instigator, the last twenty
envelopes, and the object that was running (§2.11). In the early beta
the caps sit high and faults are meant to be seen, most likely as two
objects answering each other forever.

Built in #339 (`packages/backend/src/understory/sprout/engine.ts`):
`UNDERSTORY_CASCADE_DEPTH` 20, `UNDERSTORY_EVENT_BUDGET` 256, a fault
record of the last `UNDERSTORY_FAULT_CHAIN` (20) envelopes; the
callable abandons its transaction on a fault, writes the
`understory_action` row in one of its own, and answers `aborted` with
the visitor's line. The builder's preview says the fault's own words
instead (it is debugging, and writes nothing). Until #340, "in range"
is everything loaded with the room — the room and the items in it or
in the actor's hands — and `move`, `spawn`, `destroy` and `show`
fault as "not in the world yet". A well-known property an object never
declared may still be set (`self.set(:hidden, true)`) and then lives in
its state; unset, it reads as its default and is never stored.

The v0 cycle rule (an object already on the chain is not delivered to
again) is **dropped**. It would make containers wrong — the room
relays `:noisy` up to the box, which opens and relays `:illuminated`
back down through the room — and depth plus budget is the honest bound.
An object hearing the same event twice by two routes is now possible
and is the builder's to handle (`if (value && !self.get(:glinting))`).

**Containers are the bus.** Everything that holds things is a
container: a room, the actor (the hands are a container), and any item
of a kind that inherits `Container`. Delivery follows the tree, and the
_container_ owns the routing policy — not the item, which must not
know whether it is in a glass box or a wooden chest:

1. `broadcast :m(v)` hands the event to the sender's container.
2. A container that receives a broadcast (as relay, or as its own
   handler's `broadcast`) **delivers** it to every object it directly
   contains except the sender, then, for each sub-container it holds,
   asks that sub-container's `pass` rule whether to carry the event
   inward; and asks its own `pass` rule whether to carry it outward to
   the container it sits in.
3. `pass :m (expr)` / `pass any (expr)` on a container kind is the
   rule, one line per event name or a default; the most specific line
   wins. The built-in defaults: `Room` passes nothing outward (rooms
   are the top of the tree) and everything inward; `Actor` passes
   everything both ways (a torch in your hand lights the room; you hear
   the room); `Container` passes everything when `:open` and nothing
   when closed.

```sprout
kind GlassCase: Container {
  :open false
  pass :illuminating (true)              // light crosses glass, open or shut
  pass any (self.get(:open))
}

kind Chest: Container {
  :open false
  on :noisy (from) {
    if (!self.get(:open)) { self.set(:open, true); say "Something inside the chest thumps, and the lid jumps its catch." }
  }
}
```

"In range" — the reach of a broadcast, of `send`, of `get`, and of
`each` — is whatever the tree and the pass rules make reachable from
the sender. A closed chest's contents are not in range of the room; a
lit torch inside a glass case is.

**Rooms, actors, and traversal in the same model.** A room is a
container with two extra facts: it may contain actors, and it has
exits. The actor is an object (kind `Actor`, engine-defined, not
placeable) and a container (their hands). "Leave through the beaded
curtain" is the actor proposing to move from one container to another,
and that proposal is §2.6.

Built in #340: the world the engine runs is a tree — the room, the
actor (kind `Actor`, engine-defined), and everything either holds at
any depth, each object naming its container. A broadcast is delivered
container-first, then contents in id order, depth first, with a
sub-container's contents right after it; the hands come after the
room's contents and pass everything both ways, but are never
themselves a recipient (they only carry). `path` is the list of
containers that relayed. `room` resolves through nesting;
`container` is what holds self; `each`/`count` walk direct contents.
Position is stored on `understory_item_state` as `carried_by`,
`contained_in` (migration 041) or `located_room_id`; the instance
table (#341) replaces the three. A visitor sees what the room holds
and what OPEN containers in it hold (`ItemView.inside` names the
container); a shut chest keeps its contents to itself.

### 2.6 Containment: every move is a proposal

Taking a key from a drawer ends with the key in the actor's hands.
Three parties have a say: the key (is it `:takeable` right now?), the
drawer (does it release things while shut?), and the hands (are they
full?). Eric's second pass asks for a proposal with consent from each,
and notes that room-to-room travel is the same proposal with the actor
as the thing moving. So `move X to Y` — and the built-in `take`,
`drop`, `give`, `put … in`, and `go` — is one engine protocol:

1. **Ask.** In order: `depart (to)` on the thing moving; `release (item,
to)` on its current container; `accept (item, from)` on the
   destination. Each guard's body ends in `allow` or `refuse "…"`
   (the string is said to the actor). Guards read; they do not write —
   the compiler refuses `set` inside one, so a refused proposal has no
   side effects to unwind.
2. **Defaults** when a guard is not defined: `depart` allows unless the
   destination is an actor and the thing is not `:takeable` ("That is
   not something you can carry."); `release` allows when the container
   is `:open` (rooms and hands always); `accept` allows when `:open`
   and under `:capacity`, and a room accepts an actor only through a
   declared exit from where they stand.
3. **Move.** If all three allow, the engine rewrites containment (one
   write, the engine's, not a builder's) and then sends, in order:
   `left (item, to)` to the old container, `entered (item, from)` to
   the new one, `moved (from, to)` to the thing itself. These are the
   `contentsChanged` notices: a room's `entered (item, from)` with
   `item == actor` is where arrival prose lives, and its default is to
   `describe`.

```sprout
room glaze_cupboard {
  :locked true
  accept (item, from) {
    if (item.is(Actor) && self.get(:locked)) { refuse "The cupboard door is locked. There is a keyhole." }
    else { allow }
  }
  entered (item, from) {
    if (item.is(Actor)) { say "The smell of raw glaze: chalk, ash, a little metal." }
  }
}

kind Lump: Usable {
  :names ["lump", "clay"]
  :isClay true
  depart (to) {
    if (to.is(Actor) && actor.recall(:hands_wet) == false) { refuse "It would stick to dry hands. Wet them first." }
    else { allow }
  }
}
```

The thing this buys is that no verb ever rewrites containment behind a
container's back, so an `each item in self` in the chest is always
true, and the moderator's question "how did the key get out of the
locked case?" has a one-line answer in the case's `release`.

Built in #340: `take`, `drop`, `give` and `go` are `runMove` in the
engine — one proposal each, logged as an action — and `move` in a verb
body is the same call. The built-in refusals: "That is not something
you can carry.", "<Name> is shut.", "There is no room in <name>.",
"Nothing goes in there.", "It cannot go inside itself." A refusal is
spoken to the actor and, from a built-in verb, answered as
`failed-precondition` with those words. A `go` locks both rooms in id
order and loads the destination as `elsewhere`; its `entered` runs
with the actor as `item`, and what it says is the arrival narration.
`give` loads the receiver's hands the same way, so full hands refuse.
The engine-sent notices carry the thing moving as `from` and the
other party as `value`, so `on :entered (item, from)` binds both as
objects. `put … in` has no chip yet (#344); the engine supports it.

### 2.7 Verbs: how a message becomes something a player can type

Every non-reserved message with a body is a verb the parser can reach.
The grammar comes from the message's signature and an optional
`grammar` line:

```sprout
use (with: object) {
  grammar "use [self] with [with]"
  grammar "light [self] with [with]"
  grammar "use [with] on [self]"
  …
}
```

Without a `grammar`, the default is `"<name> [self]"` plus
`"<name> [self] with [<arg>]"` for each argument. A line may leave
`[self]` out — `grammar "kick the wheel"` — and then the object is
implied; two objects in range offering the same phrase make the parser
ask. Every v0 verb upgrades to exactly that: its label as the one line. Grammar lines are
what the parser (§5) matches and what the easy mode renders as chips
("light the torch with…" then a pick). The parser also knows the
built-ins: `look`, `examine X`, `go <exit>` / the exit's label / compass
words if the exit declares one, `take X`, `drop X`, `give X to Y`,
`inventory`, `wait`, `help`, and pronouns (`it`, `them`) bound to the
last noun.

### 2.8 Kinds and instances

Eric's second pass: the cup from the examples is not one object — there
can be four wet cups, one behaviour, four states. So the language has
**kinds** (behaviour, property defaults, messages, handlers, hooks,
rules, guards) and **instances** (a kind, a container, and a state).

- `kind Name: Parent { … }` defines a kind. `inherit` takes the parent's
  properties (with defaults) and members; a child re-declaring either
  overrides it. `super` is not in v1. A kind cannot be placed; an
  abstract message makes that explicit for kinds that are only ever
  parents.
- `object name: Kind in <container> { … }` is a **placed instance** —
  the initial state of the world. The body may override property
  _initial values_ and `:names`, and may add `describe`; it may not add
  messages or handlers (an instance with its own behaviour is a kind of
  one — write the kind). `object name in cellar { … }` with no kind is
  sugar for an anonymous kind, which is what every v0 item is (§6).
  `room name { … }` is `object name: Room`, with `exit` lines.
- `spawn Kind in <target>` makes a **dynamic instance** at runtime: the
  bag of clay spawns a `Lump` into the actor's hands; the wheel, wired
  off, spawns a `Cup`. The new instance starts at its kind's defaults
  and receives `spawned (from)` so it can adjust itself. `destroy self`
  is the other end (the lump becomes the cup). A dynamic instance is
  the same row as a placed one (§2.11) with a `spawned_by` — the
  builder's world panel lists them and can sweep them.
- **Names and the parser.** Instances of one kind share the kind's
  `:names`; a placed instance may add its own. When one noun matches
  several instances the parser (§5) looks at whether they _differ_: if
  they are of one kind with equal state, any one will do and the first
  is taken without a question — four wet cups, "take cup", you have a
  cup. If they differ, the differing symbol-valued properties become
  adjectives ("the wet cup or the bisqued cup?"), and the player may
  use those adjectives up front. Eric's "does it matter? maybe not" is
  the rule: it matters exactly when the player could tell them apart.
- **Kinds are versioned like everything else** (understory.md §3.3,
  unchanged): a kind is drafted and published at the tick; an instance
  binds to a kind's published version; in v1 a zone has one owner so
  republishing a kind re-binds its instances automatically, and that
  becomes a prompt only when kinds are shared across zones (deferred
  with §7).

Built in #341: kinds are rows (`understory_kind`, drafted and
published at the tick, versioned), written in Sprout and compiled at
the boundary against the zone's other kinds — the builder's world
panel has the text box, until #343's editor. `resolveDefinition` folds
a chain into one flattened definition at load (parents first, the
child overriding by name; the most specific non-empty `describe`,
`:names` and prose win) and records the chain for `is(Kind)`; a spawned
thing is its kind as an item (`kindAsItem`). Live state moved into one
`understory_instance` table (migration 042): a placed room or item is a
row keyed by its own id, absent = at home at its defaults; a spawned
thing is a row of its own, its kind as `source_id`; `destroyed` keeps a
placed item away until the sweep. The seeded shed's bag of clay is the
first thing in the seeds written in Sprout: `spawn Lump in actor`.

**The universe is capped.** A zone's live instances (placed plus
spawned) may not exceed `UNDERSTORY_MAX_INSTANCES` (2,000 to start);
one action may spawn at most 8. A `spawn` past either cap is a runtime
fault like a depth overrun (§2.5): the action rolls back and the
builder is told. A zone may also declare `sweep at_tick` so the tick
restores its published initial state — spawned instances gone, placed
ones back to their defaults — "the studio is swept every noon", which
is both a story rule and the memory bound for a busy zone. Sweeping
never touches what objects remember about a visitor (that is the
visitor's, understory.md §3.2).

### 2.9 Media, closed by default

- `:image <media-id>` on any object (the uploader mints the id; the
  editor picks from the profile's own media — the media-plan rules are
  untouched: opaque ids, bytes through the backend, signed on the way
  out).
- Nothing shows an image on its own. `show` is the statement that opens
  the lightbox: `show` (self's `:image`), `show self :blueprint` (a
  named media property), `show room`. The natural places are
  `describe` (examine opens it) and `enter` (arriving opens the room's
  view) — both under the builder's control, so a room can be entered
  quietly and reveal its picture only when a lamp is lit.
- The telnet transcript prints `[a picture opens]` and the lightbox
  sits beside the text, never over it; easy mode does the same with a
  thumbnail.

Built in #345: a **media property** is a fourth field type — `:image
"m-…"` (an id the uploader minted) or `:image media` (none yet), set at
runtime with `self.set(:image, "m-…")` or `none` — and `:image` is
well-known on rooms, items and kinds. `show` reads the target's media
property (`:image` unless named) and the action's answer carries the
ids (`RoomView.shown`); `describe`'s `show` runs on `look` and
`examine` (`describeWith`). Bytes go through the media service as
everywhere, signed against the one audience rule, which gains an arm:
a media id a PUBLISHED understory names — a room's, an item's or a
kind's published version holding it anywhere — is as open as the door
it stands behind, to any signed-in visitor. The builder uploads in the
world panel ("Pictures") and pastes the id; nothing lists the
profile's older media yet.

### 2.10 A longer example: the shed's wheel and cup, rewritten

```sprout
room wheel_corner {
  :names ["wheel corner", "corner"]
  :turning false
  describe {
    if (self.get(:turning)) {
      text "The kick wheel is turning, the flywheel humming under the bricks, a lump going steadily nowhere on the head."
    } else {
      text "A kick wheel on a plinth of bricks, a stool, a slop bucket with a sponge afloat in it."
    }
  }
  on :wheel_on { self.set(:turning, true) }
  on :wheel_off { self.set(:turning, false) }
  exit "back through the sacking" to shed
  exit "into the glaze cupboard" to glaze_cupboard
}

kind KickWheel {
  :names ["wheel", "kick wheel"]
  :scenery true
  :stage one_of [bare, centred, open, cup] default bare

  describe {
    if (self.get(:stage) == :cup) { text "A cup rises from the wheel head, walls thin, rim just this side of true." }
    else if (self.get(:stage) == :open) { text "The lump is opened: a thick-walled little well." }
    else if (self.get(:stage) == :centred) { text "A lump sits centred on the wheel head, still as a stone." }
    else { text "A kick wheel, the head scraped clean, waiting." }
  }

  centre (with: object) {
    grammar "centre [with] on [self]"
    grammar "throw [with]"
    if (self.get(:stage) != :bare) { say "There is already something on the wheel." }
    else if (!with.get(:isClay)) { say "You could centre that, but it would not thank you." }
    else {
      self.set(:stage, :centred)
      send room :wheel_on
      say "You kick the flywheel up to speed, wet your hands, and lean on the lump until it stops arguing."
    }
  }

  open {
    grammar "open [self]"
    grammar "open it up"
    if (self.get(:stage) == :centred) { self.set(:stage, :open); say "Thumbs in the middle, down to a finger's width from the bat, and out." }
    else { say "Nothing to open yet." }
  }

  pull {
    grammar "pull up a cup"
    grammar "pull [self]"
    if (self.get(:stage) == :open) { self.set(:stage, :cup); say "Two pulls and a third for luck." }
    else { say "You need an opened lump for that." }
  }

  wire {
    grammar "wire [self] off"
    grammar "wire it off"
    if (self.get(:stage) == :cup) {
      self.set(:stage, :bare)
      send room :wheel_off
      spawn Cup in actor
      actor.remember(:cups, actor.recall(:cups) + 1)
      say "You draw the wire under it, let the wheel slow, and lift it off on its bat. Yours."
    } else { say "There is no cup to wire off." }
  }
}

kind Cup: Usable {
  :names ["cup", "pot"]
  :state one_of [wet, leather, bone_dry, bisqued, glazed, fired] default wet
  :glaze one_of [none, tenmoku, celadon, shino] default none
  on :fired {
    if (self.get(:state) == :bone_dry) { self.set(:state, :bisqued); say "The cup comes out bisqued, pink and ringing." }
    else if (self.get(:state) == :glazed) { self.set(:state, :fired); say "The cup comes out alive, the glaze gone to glass and cracked like ice." }
  }
  use (with: object) {
    grammar "dip [self] in [with]"
    if (self.get(:state) == :bisqued && with.get(:isGlaze)) {
      self.set(:state, :glazed)
      self.set(:glaze, with.get(:colour))
      say "In, count three, out. Wipe the foot."
    } else { say "That does nothing for the cup as it is." }
  }
}

object wheel: KickWheel in wheel_corner
```

Note what became possible: the wheel checks the lump _is clay_ by
reading the argument's property; the cup reads the bucket's `:colour`
instead of carrying three dip verbs; the room is told, never written;
and wiring off makes a new cup each time, so four cups on the shelf are
four instances of one kind, each with its own glaze.

### 2.11 World state: shared, persistent, bounded

Eric's second pass asks two things of the world: that it be **shared**
(several actors in one room at once, acting on the same things) and
**persistent** at least for a session, and that the Postgres decision
be pressure-tested as the state gets more nested. Where this lands:

**The state is a tree of instance rows, in Postgres.** What v0 stores
as `understory_room_state` + `understory_item_state` + `carried_by`
becomes one `understory_instance` table: `id`, `zone_id`,
`kind_version_id`, `container_id` (another instance, or null for a
room), `state jsonb`, `spawned_by` (null for placed), `placed_from`
(the definition it came from, for sweeping). Rooms are rows in it too.
An action locks the actor's current room row `FOR UPDATE` as today, and
a move that crosses rooms locks both in id order. Per-visitor memory
stays its own table (it is the visitor's, and it is what the legibility
panel reads). This is normalised enough to query for moderation and
takeout, and nested enough for the tree.

**Why not one JSON document per zone, Firestore, RTDB, or Redis** — the
options Eric names, weighed:

| store                      | what it would buy                                          | what it costs here                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| one `jsonb` world per zone | one read, one write, trivially consistent                  | serialises the whole zone on every action; a busy zone's document grows without bound; moderation and takeout read blobs                                                      |
| Firestore as the truth     | fan-out to clients for free; nested documents feel natural | two sources of truth (the tick, flags, versions, takeout are SQL); transactions are per-document-set, not "the room"; the one evaluator would run against a second data model |
| Firebase RTDB              | the cheapest real-time channel we already pay for          | as a truth store, the same objection; as a **channel** for "also here" and other actors' transcript lines it is the right tool, later                                         |
| Redis in a container       | fast ephemeral state, pub/sub                              | a new always-on service beside a db-f1-micro project, nothing else uses it, and the state is not ephemeral — Eric wants it shared and kept                                    |

So: Postgres is the truth, rows not blobs, and **real-time is a
separate, later question** answered by a channel (RTDB or polling every
few seconds — presence in a room is a slow signal) that carries what
Postgres already committed. Nothing in the language depends on which.

**Measure from the first day, so the caps are set from data.** Each
action writes one `understory_action` row: `instigator` (the depth-0
event id), zone, room, visitor, the command, `events` (count),
`max_depth`, `spawned`, `faulted`, and the last twenty envelopes when
faulted. Eric's two questions — how many events does a root action
trigger, and what are the quartiles of depth — are one `GROUP BY
instigator` and one `percentile_cont` away. The tick trims rows older
than thirty days. The builder's world panel shows their zone's faults.

**The pressure-test triggers** — revisit the store when any of these
is true, and not before: a zone's live instances pass ~10,000; an
action's p95 inside the transaction passes ~300 ms; a room routinely
holds more than ~10 actors at once; or visitors need to see each
other's lines in under ~2 s (which is the channel question, not the
store's).

### 2.12 `describe` is prose (decided 2026-09-08, #441)

Looking at a thing changes nothing. `describe` may read anything in
range — `self`, `room`, `container`, another object's properties, what
the actor recalls, `count`, `is` — and it may `show` a picture and walk
a container with `each`; it produces `text` and nothing else. A `set`,
`adjust`, `remember`, `send`, `broadcast`, `move`, `spawn` or `destroy`
in a `describe` is **refused by the compiler** (§3), so the builder
learns at save, not when a visitor looks.

Why: `describe` runs outside the action path. `look` and `examine` run
it once; every projection of a room runs it once per visible item, and
the easy mode's poll runs the projection every few seconds. Nothing in
that path settles state, drains a queue, or records an action, so a
write there was a phantom (seen by whoever looked, gone for everyone
else), a `send` there was silently dead, and each item's `describe`
drew on a budget of its own. The rule is the same one the consent
guards already carry (§8-4): a body that answers a question does not
change the world.

Two mechanical consequences: the engine **skips** a mutating statement
that reaches a `describe` anyway (a definition saved before the rule
— none exist; there are no Understories in production yet) so the text
around it still prints and the world does not move; and the event,
spawn and instance caps are **one budget per request** rather than one
per interpreter run, so describing forty items cannot cost forty
ceilings, and a "take all" of nine things is nine moves against one
allowance.

The future path, if a room ever needs a trap that springs on
examination: the engine emits an `on :describe` event on the bus
(§2.5) that the object — or anything in its container — may answer in
a handler, with the ordinary action semantics: settled, drained,
recorded, budgeted. Not built; not needed until someone asks for it.

---

## 3. The compiler, and what it refuses

Compilation happens at the boundary (the save call), never at runtime.
It produces an AST (§4) and a list of problems; a definition with
problems is not saved, exactly as `sproutProblems` refuses today.
Built in #338 (`packages/schema/src/sprout-lang.ts`): a hand-written
lexer and recursive-descent parser — one source is one object, `room
<ident> { … }` or `object <ident> [: Kind] { … }`, with `:name "…"`
when the display name is not the identifier humanised, `prose "…"`
for the plain fallback, and `exit "label" to <room-ident>` resolved
through a map the saver supplies — and a printer back, canonical
enough that print → compile is the identity on the tree (the seed
proves it over both studios on every PR). Syntax problems carry a
line and column; the semantic ones point at the head. `#` and `//`
start comments. Message names may not be keywords (`if`, `say`,
`describe`, `exit`, `on`, `pass`, …); parameter names may be anything
else, `to` and `item` included.

Refused at compile time:

- a write to anything but `self`; any `set`/`adjust`/`spawn`/`move`
  inside a consent guard; a read of an undeclared property (on self:
  undeclared; on another object: not declared by any kind in the zone
  — a hint, since the target is only known at runtime);
- a property set to a value of the wrong type or outside its declared
  set;
- a message body over the node-depth cap (8 — an `else if` chain counts
  as one level, as it reads), a definition over 64 KB, more than 16
  properties / messages / handlers per object;
- `each` over anything but `room` or `actor`; any construct the grammar
  above does not name (there is no loop to refuse);
- a kind that is placed in a room, an object that inherits a kind with
  an abstract message it does not define, an instance body that
  declares a message or handler, a lower-case kind or a capitalised
  object, a `spawn` of a kind with an abstract message, a `pass` rule
  on a kind that is not a `Container`;
- a grammar line that names a slot that is not `[self]` or an
  argument; `allow`/`refuse` outside a consent guard; `text` outside
  `describe` and `say` inside it; a well-known property redeclared with
  another type where it applies (§2.2);
- anything in `describe` that writes or sends — `set`, `adjust`,
  `remember`, `send`, `broadcast`, `move`, `spawn`, `destroy` (§2.12,
  #441): describe reads.

Warned (saved, shown in the editor): a `changed :p` for a property
nothing sets; an `on :m` for a message nothing sends, broadcasts, or
the engine emits; a `:names` collision between instances of different
kinds in one room (the parser will ask "which one?", which may be
intended); a kind that `spawn`s itself (legal, and the first thing to
check when a zone faults its budget).

Runtime faults (the compiler cannot see them; §2.5, §2.8): depth over
20, the per-action event budget, the per-action spawn budget, the zone
instance cap. Each rolls the action back and records the envelope chain.
The budgets are one per REQUEST (§2.12): every interpreter run inside
one call draws on the same allowance.

---

## 4. Storage and execution: the three options, weighed

**(a) Interpret Sprout text at runtime.** Store the text; parse it on
every `look`/verb. Simplest to build first. Against it: untrusted text
in the hot path on every interaction; every version is a string, so
"what changed" for a moderator is a text diff; a parse error surfaces
to a visitor, not the builder; no static checks, so `room.set` from an
item that should not have it is caught (if at all) by a runtime
sandbox we would then have to write. This is the shape the appendix's
JavaScript-in-a-sandbox had, one language over.

**(b) Compile to a JSON AST at save; store the AST; regenerate text for
editing.** What §3.2 already decided, with a printer added. The runtime
stays exactly what it is: an evaluator over validated structure, no
parsing. Moderators diff structure. The form editor and a Blockly
adapter are two more views of the same tree. Against it: comments and
the builder's formatting do not survive a round trip through the
printer — the builder types a tidy file and gets back a canonical one.

**(c) Store both: the source as written, and the AST it compiled to.**
The AST is the executable truth (what runs, what is versioned, what a
flag pins, what the form and blocks edit); the source is the builder's
own text, kept beside it so opening the code editor shows what they
wrote, comments included. When the form editor changes the AST, the
printer regenerates the source and the comments in that message are
lost — the editor says so before it does it. Cost: one more column, and
one rule (the AST is authoritative; if source and AST ever disagree,
the source is stale, and the editor shows the printed AST).

**Recommendation: (c).** It is (b) plus one text column, and it is the
difference between a language people are willing to write in and one
they tolerate. The compiler and printer are the same ~600 lines either
way. Runtime interpretation (a) is refused for the reason §3.2 gave and
one more: the parser (§5) will need the _grammar_ of every message in
the room on every keystroke for autocomplete, and that is a query over
structure, not text.

Format (#337, `packages/schema/src/sprout.ts`): the v1 AST is a
superset of v0's — `format: 2`, still **one definition per object
row** (a room or an item, drafted and published on its own, as v0
stores them): the object's header (`name`, `names`, `prose`, exits,
`inherit`, `source`) and its kind body (`properties` — v0 `fields`
renamed, plus the well-known ones — `remembers`, `describe`,
`messages` — v0 `verbs` with `args`, `grammar` and `when` —
`handlers`, `hooks`, `passRules`, `consents`), with an `expr` node type
for the new expressions. With `inherit` null the body is an anonymous
kind of one; naming a kind makes it an instance's overrides. Kinds as
rows of their own, and a zone-wide file that declares several objects,
arrive with #341. A v0 definition upgrades mechanically (`format: 1 → 2`,
each item becomes an anonymous kind plus one placed instance,
`verbs → messages` with no args, `views → describe` with an if-chain,
`portable → :takeable`), and the printer turns it into readable Sprout
— so every room built so far opens in the code editor as code. The zod
schema in `@overstory/schema` grows accordingly; `sproutProblems`
becomes the compiler's checks.

---

## 5. Typing to play: the parser

### 5.1 The approaches

| approach                                                                | how                                                                                                                                                                                                                                   | for                                                                                                                                                                                                                                                                                                                                                                                                                    | against                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Regex / keyword spotting**                                            | `^(light                                                                                                                                                                                                                              | use) (the )?(\w+)( with (the )?(\w+))?$` per verb                                                                                                                                                                                                                                                                                                                                                                      | an afternoon                                                                                                                                                                                                                                                                                                                     | falls over on "light the brass torch with the flint and steel"; no disambiguation, no pronouns, no "which do you mean?"; every builder writes their own regexes badly |
| **A classic IF parser, written by us** (Inform 6 / TADS lineage)        | tokenise; strip articles; match the input against grammar lines whose slots are filled from a dictionary built from the room's `:names`, the actor's hands and the exits; score matches; ask on ties; pronouns bound to the last noun | deterministic, cheap (~700 lines + tests), runs in the same transaction as the verb so "what could you say here" is exactly "what the engine would accept"; the _grammar lines are authored in Sprout_, so builders extend the parser by writing the phrases they want; forty years of known good behaviour to copy (Inform's "which do you mean, the brass key or the iron key?", "I only understood you as far as…") | it is a parser: someone has to write it and keep it honest; every builder's phrasing is one grammar line at a time                                                                                                                                                                                                               |
| **Run Inform itself**                                                   | compile worlds to a Z-machine story and run them under a JS interpreter (Quixe, ZVM)                                                                                                                                                  | the best parser there is, for free                                                                                                                                                                                                                                                                                                                                                                                     | the world would have to be written in Inform 7, not Sprout; the runtime is a VM with its own state model, no room transaction, no per-visitor memory, no moderation surface; a dead end for us                                                                                                                                   |
| **A parser library** (Chevrotain, Ohm, peggy) for the _Sprout language_ | grammar-driven parser generator                                                                                                                                                                                                       | the right tool for §3 (the DSL), and what I would use there                                                                                                                                                                                                                                                                                                                                                            | not for player commands: the command "grammar" is data (the room's objects), which is a matching problem, not a parsing one                                                                                                                                                                                                      |
| **An LLM for intent**                                                   | send the input plus the room's affordances to a model; get back `{verb, object, with}`                                                                                                                                                | handles "could you light the torch for me using that flint thing"; no grammar lines to write                                                                                                                                                                                                                                                                                                                           | non-deterministic (the same words giving different answers is exactly what §3.1 refuses); 300–1500 ms per command against a five-second game loop; a third party reads every line a visitor types; cost per keystroke of play; cannot run inside the transaction; a model that "helpfully" infers a verb the builder never wrote |
| **Hybrid: the IF parser first, an LLM only to rephrase a miss**         | the deterministic parser runs; on no match, a model turns the input into a _suggested_ command the player confirms ("Did you mean: light the torch with the flint?")                                                                  | keeps determinism (nothing runs without the parser accepting it) and gets the forgiveness                                                                                                                                                                                                                                                                                                                              | still ships text off-site; still a cost; only worth it once misses are measured                                                                                                                                                                                                                                                  |

### 5.2 Recommendation

**Write the IF parser, in the engine, grammar from Sprout.** It is the
approach that makes "our reach is our imagination" true: a builder who
wants "sing to the robin" to work writes `grammar "sing to [self]"` on
the robin and it works, in every client, deterministically, inside the
room's transaction, with no model in the loop and nothing leaving the
server. The Inform lineage is a _solved problem_ in the only sense that
matters — the behaviours a player expects (articles ignored, adjectives
disambiguate, "it" means the last thing, "all" in `take all`, a
question when two things match, a polite sentence when nothing does)
are documented and stable, and copying them is design work we do not
have to do.

The shape, concretely:

1. **Dictionary.** For the current room: every addressable object's
   `:names` (multi-word, so "flint and steel" is one noun), the exits'
   labels and compass words, the actor's carried items. Rebuilt from
   the world the engine already loads for a verb; nothing new is read.
2. **Grammar table.** Every reachable message's grammar lines (§2.7),
   with `[self]` bound to the object that owns the message and `[arg]`
   slots typed `object`, plus the built-ins. Grammar lines are parsed
   at compile time (§3) into token lists — literal words and slots.
3. **Match.** Tokenise the input, drop articles and filler ("the", "a",
   "please", "to" where not meaningful), then for each grammar line try
   to align literal words and fill slots from the dictionary, longest
   noun first. Score: literal words matched, slots filled, whether the
   `[self]` object is present. Best score wins; ties on _which object_
   ask "Which do you mean, the brass key or the iron key?" and remember
   the question for the next input; ties on _which verb_ prefer the
   object's own message over a built-in.
4. **Run.** The winning line names a message on an object with bound
   arguments — exactly `doUnderstoryVerb`'s input today, plus `args`.
   Everything after that is the engine as it stands.
5. **Answer.** The transcript block: the `say` lines in order, then, if
   the room's description changed or the actor moved, the new
   description; a `[a picture opens]` line when `show` fired.
6. **Miss.** "I only understood you as far as wanting to light
   something." (Inform's phrasing works because it tells the player
   which part landed.) The easy-mode chips are the same grammar lines
   rendered as buttons, so "what can I say here?" is always one
   keystroke away (`help`, or tab in the prompt).

Built in #342 (`packages/backend/src/understory/sprout/parser.ts`,
`say.ts`): `sayUnderstory` takes one line, parses it in the engine
against what is here — the visible objects' `:names`, their display
names and any one word of them, their kinds, a symbol-valued
property's value as an adjective ("the wet cup"), the open exits by
label or any content word of it, the people present by handle — and
runs it through the same performers the chips use. A v0 verb's label
is its line and may be said with or without the object ("light",
"light the lantern"). Ties on which object ask; one kind in one state
is taken without asking; "it" is the visitor's last noun, kept on
their row and cleared when they move rooms; "take all" is everything
here, each its own proposal. A miss is spoken in Inform's words and
recorded as an action with `missed` (migration 043), so the zone's
miss rate is a number on the world panel — the text with room state is
#346, by opt-in. `completeUnderstory` offers what could be typed from
the same grammar; `previewUnderstorySay` types in the builder's
preview. The prompt itself is #344.

**Autocomplete is the bridge between telnet and easy.** The prompt
completes from the grammar table — type `li` and see `light the torch
with…`, tab through the nouns — which is what makes typing not a wall
for a newcomer while still being _typing_. It is computed by the same
match function on a prefix, so it can never suggest something the
parser would then refuse.

**Misses are counted for everyone and donated by choice.** The engine
counts parser misses per zone (a number, no text) so the miss rate is
known. A visitor may opt in — a checkbox in their understory settings,
off by default, plainly worded — to **donate miss logs**: the input as
typed, the grammar table and dictionary at that moment, and a snapshot
of the room's state, stored against the zone and never against the
profile. That stream is how the real missing gestures and words are
found (Eric, 2026-09-05); if it grows large it is sampled and trimmed
fast, and the tick trims it regardless.

Built in #346: the switch is per profile (`profile.understory_donate_misses`,
migration 044), on the settings page under "The Understory", off by
default and worded to say what is kept and for whom. A miss from a
donating visitor writes an `understory_miss` row against the zone —
the line, what could have been said and named at that moment, the
room's and items' state — with no profile on it; the builder reads them
in the world panel ("What visitors gave you"); the tick trims by age
and keeps a zone to `UNDERSTORY_MISSES_PER_ZONE`, newest first.

**The LLM rephrase (hybrid) is a later, measured addition, off by
default.** If the miss rate on real zones is high after the grammar
lines, the donated logs and autocomplete have been worked through,
offer the rephrase as a _zone option the builder turns on_, with the
visitor told a model is reading. It never executes anything; it
proposes a command the parser then parses. My expectation is that the
miss rate with autocomplete is low enough that this never ships.

### 5.3 The two modes

- **Telnet (default):** a transcript column and a prompt. Arriving
  prints the room; every command appends the command and its answer;
  the prompt has history (↑), completion (tab), and `help`. Presence
  ("also here: @marta") is a line, not a panel. Media opens beside the
  transcript in a lightbox (§2.9). Exits are named in the prose and
  taken by name or compass word.
- **Easy mode (toggle, remembered per visitor):** what v0 has —
  description, exits as buttons, objects as chips that open their
  grammar lines as buttons, arguments as a pick. The same engine, the
  same grammar, the same transcript underneath (easy mode's clicks are
  typed commands, echoed).
- **The builder's preview** runs either mode against the draft with
  scratch state, as now.

Mobile is the open question it already was (§10.7-3); telnet with
completion may be _better_ on a phone than chips, since the keyboard is
the one control that fits, but that is a thing to try, not to assume.

Built in #344 (`transcript.component.ts`, `understory.page.ts`):
typing is the default; "Chips instead" is remembered per browser
(`understory.mode`). Arriving prints the room — its name, its prose,
"You can see … here" (what open containers hold named "inside …"),
"Also here", and the ways on as buttons that echo a typed `go` — and
every line typed appends itself and the answer; the room prints again
only when it changed. ↑ ↓ walk the history; Tab completes from
`completeUnderstory`, one option filling the prompt and several
offered as a keyboard-navigable list; `?` is help. The builder's draft
walk has a prompt above its chips (`previewUnderstorySay`). The chips'
journey asks for chips; the typing one is `understory-telnet.spec.ts`.

---

## 6. Migration from v0

> **2026-09-17 (#523, stage 1b of the split):** this section is history.
> The form builder, `format: 1` and the upgrade to `format: 2` went
> together; what is stored now is the Sprout SOURCE, compiled at load
> (`packages/backend/src/understory/compiled.ts`), and the two seeded
> studios are archives of `.sprout` files under `packages/sprout-examples`.
> See the split proposal, `design/proposals/2026-09-17-sprout-split.md` §3.2.


- `format: 1` definitions stay valid: the loader upgrades them to
  `format: 2` on read (mechanical, §4), and the printer shows them as
  Sprout. Nothing in the two seeded studios needs rewriting; both will
  open in the code editor as code and keep working under easy mode
  unchanged. Their grammar is the default (`"<verb name>"`), so typing
  the verb's label as written works in telnet mode from day one.
- The form editor keeps working as a view of the AST, minus the parts
  the new grammar makes plain-text (`grammar` lines are edited as
  text).
- `portable` → `:takeable`; `visitorFields` → `actor.remember`/`recall`
  (declared as `:remembers [thrown: 0 min 0 max 99]` on the kind, so
  the legibility panel still knows the shape); the v0 `enter` handler
  → `entered (item, from)` guarded on `item.is(Actor)`; v0 `send_message`
  to an item → `send`, to the room → `send room`, to every item →
  `broadcast` — which now reaches the room as well, so a room handling
  a message an item used to send only to its siblings will hear it
  (neither seeded studio does); a v0 room-state write from an item
  (there are none; the engine never allowed one) has no translation.
- Live state: a one-off migration folds `understory_room_state`,
  `understory_item_state` and `carried_by` into `understory_instance`
  rows (§2.11); the old tables are dropped in the same migration.

---

## 7. Build order

Each step ships behind the flag and leaves the last green. Filed
2026-09-05 under the `understory` label: step 1 #337, step 2 #338,
step 3 as #339 (events) / #340 (containers) / #341 (instances), step 4
#342, step 5 #343, step 6 #344, step 7 #345, step 8 #346, step 9 #347.

1. **Schema `format: 2` + the upgrade from 1** (S). AST types, zod,
   `sproutProblems` → compiler checks that do not need the parser
   (write targets, types, caps, abstract).
2. **The Sprout compiler and printer** in `@overstory/schema` (M; one
   grammar-driven parser, Chevrotain or a hand-written recursive
   descent — the grammar in §2.4 is small enough to write by hand and
   read in a spec). Round-trip specs: parse → print → parse is
   identity on the AST; every construct in §2 has a spec; the two
   seeded studios print and re-parse.
3. **Engine: expressions, arguments, hooks and envelopes, containers
   and pass rules, the containment protocol, kinds and instances,
   `spawn`/`destroy`, `each`, `show`** (L; the biggest step, and the one
   that replaces the state tables — §2.11's `understory_instance` and
   `understory_action` land here). The engine spec grows around the new
   cascade rules: depth 20, the event budget, no cycle rule, a fault
   rolls back; the two seeded studios run unchanged under it.
4. **The IF parser** in the engine, with the grammar table from
   definitions and the built-ins (M). Specs are the Inform test cases
   in miniature: articles, adjectives, two keys, "it", "take all",
   partial understanding.
5. **The code editor** in the builder — a text area with syntax
   colouring and the compiler's problems inline; the form editor stays
   and reads the same AST (S–M). Blockly adapter later (M), once the
   AST has stopped moving. _Built in #343, with one narrowing: the
   form stays the editor of v0 drafts and shows them as printed Sprout
   ("Write it in Sprout"); a draft saved as Sprout is `code` from then
   on — the form cannot hold what the language can say, so there is no
   way back to it. The boundary compiles against the zone (rooms by
   the identifier of their name, `_2` on a collision; the zone's kinds;
   sibling names), `compileUnderstorySource` checks without saving,
   and the editor is CodeMirror 6 (`sprout-code-editor.component.ts`,
   the colouring in `sprout-language.ts`). It began as a textarea over
   a coloured shadow, no dependency; Eric's recording of 2026-09-05
   showed the pair drifting a line apart at every blank line, the caret
   and the colours disagreeing about where the text was — the class of
   bug that trick always has, so one widget owns the text and the view
   now: caret, undo, soft wrap, line numbers, the compiler's problem
   lines marked in place. Its content is a labelled contenteditable
   textbox, which is what the screen reader and the journeys type
   into._
6. **Telnet mode** as the default visitor surface, easy mode as the
   toggle; autocomplete from the grammar (M).
7. **Media**: `:image`, `show`, the lightbox, through the existing
   uploader and signing (S–M).
   _Reshaped after Eric's walk of 2026-09-05 (#360, #361): the page's
   left column had grown Rooms, Kinds, Pictures, The world and What
   tangled all at once, and the code editor was boxed into `main`'s
   46rem. Now the builder has three tabs — Rooms, Kinds, Controls — and
   all Sprout is written in the **workspace**
   (`sprout-workspace.component.ts`): a full-viewport dialog, rooms with
   their items beneath and kinds down the left with a way to add each,
   a wide soft-wrapping editor on the right, Check and Save beneath;
   unsaved changes are asked about before anything else opens. A room
   or item written in Sprout shows its source on the page and opens
   there. Rooms and items compile at the boundary; a kind's Check runs
   the compiler in the browser, its save is the authority._

Steps 1–4 are the language and can land with easy mode still the
only surface; 5–6 are where it becomes what Eric described; 7 is
independent of all of them. Step 3 is split three ways when filed:
hooks + envelopes + budget first (the seeds keep working), then
containers + the protocol, then instances + spawn.

After the language settles, two more (Eric, 2026-09-05):

8. **Miss donation** (§5.2): the per-zone miss counter, the opt-in, the
   donated-log table with sampling and trimming, and a builder-facing
   view of their zone's misses.
9. **An exportable `SKILL.md`** a builder can hand to an LLM of their
   choosing to help them write Sprout. It carries the grammar, the
   well-known properties and reserved messages, the compiler's
   refusals, and a worked example — and it tells the model, firmly, that
   the builder writes the prose and describes the interaction; the
   model's job is syntactically correct Sprout around the builder's
   words, never the words themselves. It is generated from the same
   grammar the compiler uses so it cannot drift. _Built in #358:
   `sproutSkill()` in `packages/schema/src/sprout-skill.ts` renders it
   from `SPROUT_WELL_KNOWN`, `SPROUT_RESERVED_MESSAGES`, the caps and a
   worked example the compiler compiles and prints before it goes in;
   the checked-in copy is `skills/sprout/SKILL.md` (`npm run
   sprout:skill` regenerates it; its spec fails if the two differ);
   the code editor offers it as a copy and as a download._

---

## 8. Calls made here, for the record

Where the brief overrode understory.md, this document did the
overriding (§1's table). Two further calls this document makes, both
reversible, both worth knowing about:

1. **Reads are public in range; writes are self only.** The first
   pass allowed `room.set`; the second pass's "an object's state
   changes only as its answer to a message" is cleaner and the room
   loses nothing by being told. Item-to-item writes stay out because
   they are the one thing that makes a room unreadable in review (to
   know what the key does, you would have to read the torch).

2. **No LLM in the play loop.** §5.1 says why; the hybrid stays on the
   shelf until a measured miss rate asks for it.

3. **A fault rolls the action back** rather than truncating the
   cascade. Eric's note said "stop passing events further"; stopping
   mid-cascade leaves a half-lit cellar with an un-glinted key, and no
   builder can reason about that state. Rolling back plus a fault
   record is one rule and it is legible.

4. **Consent guards cannot write.** A refused `take` must leave the
   world exactly as it was, so `depart`/`release`/`accept` are read-only
   by grammar. A builder who wants "the chest bites you" writes it in
   `left`/`entered`, or in a verb.

5. **Postgres stays the truth; real-time is a later channel** (§2.11).
   The pressure-test triggers are written down so the decision is
   revisited on evidence.

6. **Instances may override values and prose, not behaviour.** It keeps
   "what does this cup do?" answerable by reading one kind.

7. **`describe` reads and never writes** (Eric, 2026-09-08, #441;
   §2.12). A trap that springs on examination, if ever wanted, is an
   `on :describe` event on the bus, not a write in the prose.

If any reads wrong, say so and the document changes; the plan in §7
does not depend on them beyond step 3.
