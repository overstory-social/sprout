# @overstory/sprout/lang

Sprout is a small language for interactive rooms and objects: the kind
of thing a text adventure is made of, written by the people who visit
it. A visitor types `light the torch with the flint`; the torch answers
for itself, tells the room, and the room decides what a light nearby
means. The whole action runs to completion inside one database
transaction, deterministically, with no model in the loop and nothing
leaving the server.

This package is the language on its own, MIT-licensed. It imports `zod`
and nothing else (`src/boundary.spec.ts` holds that line). The world it
runs in — who is standing where, what they may reach, how definitions
are published — belongs to the host. Overstory Social is the first host;
the design history is `sprout.md` at the repository root, and this
README is the language as it stands.

- [Using the package](#using-the-package)
- [The language](#the-language)
  - [Files, and where things sit](#files-and-where-things-sit)
  - [Names](#names)
  - [Rooms](#rooms)
  - [Objects](#objects)
  - [Kinds](#kinds)
  - [Making an object from a kind](#making-an-object-from-a-kind)
  - [Properties](#properties)
  - [What an object remembers about a visitor](#what-an-object-remembers-about-a-visitor)
  - [Messages, and the verbs a visitor can type](#messages-and-the-verbs-a-visitor-can-type)
  - [Handlers and hooks: how objects hear each other](#handlers-and-hooks-how-objects-hear-each-other)
  - [Containers are the bus](#containers-are-the-bus)
  - [Every move is a proposal](#every-move-is-a-proposal)
  - [`describe` is prose](#describe-is-prose)
  - [Extensions, and pictures](#extensions-and-pictures)
  - [Statements](#statements)
  - [Expressions](#expressions)
  - [Reserved names](#reserved-names)
  - [What the compiler refuses](#what-the-compiler-refuses)
  - [Limits, and what faults at runtime](#limits-and-what-faults-at-runtime)
  - [A worked example](#a-worked-example)
- [The definition format](#the-definition-format)
- [Compiling a microworld](#compiling-a-microworld)
- [Embedding the engine](#embedding-the-engine)
- [Typing to play: the command parser](#typing-to-play-the-command-parser)
- [What the host provides](#what-the-host-provides)

## Using the package

```ts
import {
  compileSprout, // one room's or object's source → a definition (an editor's page)
  compileSproutKind, // a kind's source → a kind definition
  compileFile, // a whole file: its `use` lines, then any number of definitions
  compileMicroworld, // an archive of files → a program (strict, or lenient with `absent`)
  printSprout, // a definition → Sprout, for an editor
  resolveDefinition, // fold an object's kind chain into one flat definition
  runVerb,
  runMove,
  describeWith, // the engine, over a Scene and a TurnContext
  parseCommand,
  complete,
  whatYouCanSay, // typed commands
  sproutSkill, // a generated reference that teaches the language
  tokenize, // the lexer, for an editor's highlighter
} from '@overstory/sprout/lang';

const { definition, problems, warnings } = compileSprout(source, {
  rooms, // Map<identifier, room id>, for `exit "…" to <identifier>`
  zoneMessages, // names other objects send, so unheard handlers can warn
});
if (!definition) throw new Error(problems.map((p) => `${p.line}:${p.column} ${p.message}`).join('\n'));
```

`compileSprout` returns a definition, or `null` and a list of problems
with a line and a column. `warnings` are advice: a `changed` hook for a
property nothing sets, a handler for a message nothing sends.

`sproutSkill()` renders a reference for people (or models) writing
Sprout. It is generated from the compiler's own definitions — the
well-known properties, the reserved names, the caps, and a worked
example the compiler compiled and printed itself — so it is always what
the compiler accepts. `skills/sprout/SKILL.md` in the Overstory repo is
its output, and the example at the end of this README is the same one.

## The language

### Files, and where things sit

A file holds any number of definitions, after its `use` lines; each
starts with one of these heads:

```sprout
room the_kitchen { … }            // a room
object oil_lamp in the_kitchen { … }        // an item, on its own, in that room
object oil_lamp: Lamp in the_kitchen { … }  // an item that is an instance of a kind
object coin in chest { … }        // an item inside a container object
kind Lamp { … }                   // behaviour and defaults, never placed
kind OilLamp: Lamp { … }          // a kind that inherits another
```

`in <identifier>` says where an object sits — a room, or a container
object, in the same microworld — and is resolved by the microworld
compile (below). A room is a place and a kind is never placed, so
neither takes `in`; an object with none sits nowhere, which a strict
compile names and a lenient one drops. The members inside the braces
may come in any order. An editor's page is ONE definition —
`compileSprout` refuses a second — and `compileFile` reads a whole
file; to read a file's heads before the rest of the archive is in hand,
`parseFile(source, { rooms: unresolvedRooms() })` accepts every exit as
written.

### Names

An identifier is `lower_case`: rooms and objects are identifiers, and
the display name is humanised from it (`the_kitchen` → "The kitchen")
unless `:name "…"` says otherwise. Kind names are `Capitalised`,
Ruby's constant convention, and the compiler enforces it so kinds and
objects never share a namespace. The words a visitor may _type_ for an
object come from `:names` (below), never from the identifier.

### Rooms

A room is an object of the built-in kind `Room`, which makes it a
container that may hold visitors and has exits. Inside `room name { … }`
you may write:

| member                                                        | meaning                                                                                                  |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `:name "The Kitchen"`                                         | display name (optional; humanised from the identifier otherwise)                                         |
| `:names ["kitchen", "back room"]`                             | what a visitor may call it                                                                               |
| `prose "…"`                                                   | the description `describe` falls back to (plain text; paragraphs are blank lines)                        |
| `exit "up the ladder" to the_loft`                            | an exit: a label the visitor may type, and the identifier of a room in the same zone. At most 8 per room |
| `:illuminated true`                                           | well-known on rooms: a dark room shows only its dark description, and nothing in it is addressable       |
| properties, `:remembers`                                      | as on any object                                                                                         |
| `describe { … }`                                              | its prose right now                                                                                      |
| messages, `on`, `changed`                                     | as on any object                                                                                         |
| `accept (item, from) { … }`                                   | the consent guard a room answers when something — a visitor included — proposes to enter it              |
| `release (item, to) { … }`                                    | the guard it answers when something proposes to leave                                                    |
| `on :entered (item, from) { … }`, `on :left (item, to) { … }` | the notices after a move; a room's `:entered` with `item == actor` is where arrival prose lives          |

A room is a container, so it may also carry `pass` rules; without
them it passes every broadcast _inward_ to what it holds and nothing
_outward_, since rooms are the top of the containment tree. `exit`
lines name rooms by identifier;
the compiler resolves them against the `rooms` map the host passes in,
and refuses a name it does not know.

### Objects

An item is `object name { … }` (its own anonymous kind: all of the
members below are allowed) or `object name: Kind { … }` (an instance of
a kind). Inside `object name { … }`:

| member                          | meaning                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `:name`, `:names`, `prose`      | as for rooms                                                                                         |
| properties                      | `:lit false`, `:fuel 3 min 0 max 10`, `:state one_of [wet, fired] default wet`                       |
| `:takeable true`                | well-known: may be picked up (default `false`)                                                       |
| `:hidden true`                  | well-known and stored, but **not yet acted on**: the engine still lists and addresses a hidden thing |
| `:scenery true`                 | well-known and stored, but **not yet acted on**: `take` asks only `:takeable`                        |
| `:remembers [seen: false]`      | per-visitor memory                                                                                   |
| `describe { … }`                | its prose right now                                                                                  |
| messages                        | what a visitor can do to it                                                                          |
| `on :m (from, value) { … }`     | handlers                                                                                             |
| `changed :p (value, was) { … }` | hooks                                                                                                |
| `depart (to) { … }`             | the guard it answers when something proposes to move it                                              |
| `release`, `accept`, `pass`     | only on a container (an object whose kind inherits `Container`)                                      |

**An instance of a kind is state, not behaviour.** Inside
`object name: Kind { … }` you may set property _initial values_,
`:name`, `:names`, `prose` and `describe` — and nothing else. Messages,
handlers, hooks, guards and rules belong to the kind; an instance that
wanted its own behaviour is a kind of one, so write the kind.

### Kinds

`kind Name { … }` is behaviour and property defaults with no place in
the world: it is what objects are instances _of_. `kind Name: Parent
{ … }` inherits the parent's properties (with their defaults) and every
member; a child that re-declares a property or a message overrides it,
by name. There is no `super`. A kind may hold everything an object may,
plus:

- `name (with: object) abstract` — a message the kind declares but does
  not define. Children must define it, and a kind with an abstract
  message cannot be instantiated: it is only ever a parent.
- `pass :message (expr)` and `pass any (expr)` — relay rules, only on a
  kind that inherits `Container` (see [Containers are the bus](#containers-are-the-bus)).

Three kinds are built in. `Container` is anything that holds things:
inherit it to make a chest, a shelf, a glass case. `Room` is what every
room is (rooms cannot inherit anything else). `Actor` is the visitor —
their hands are a container — and it cannot be inherited or placed.

A kind cannot inherit itself, or a kind that does not exist. In
Overstory a kind is drafted and published like everything else, and an
instance binds to its kind's published version; that versioning is the
host's, not the language's.

### Making an object from a kind

There are two ways, and they make the same thing: a row in the host's
world with a kind, a container, and a state.

**Placed.** Write the object in Sprout and let the host put it
somewhere:

```sprout
object old_torch: Torch {
  :names ["torch", "brand", "old torch"]   // adds to the kind's names
  :on_fire true                             // overrides the kind's default for this one
}
```

The state starts at the kind's defaults with these overrides. A
placed object is the initial state of the world; in Overstory it lives
in the room it was written in, and the host's sweep can put it back to
these values.

**Spawned.** Inside a message or a handler, `spawn Kind in <target>`
makes a new instance at runtime — the bag of clay spawns a `Lump` into
the actor's hands; the wheel, wired off, spawns a `Cup`:

```sprout
wire {
  grammar "wire [self] off"
  if (self.get(:stage) == :cup) {
    self.set(:stage, :bare)
    spawn Cup in actor
    say "You draw the wire under it and lift it off on its bat. Yours."
  } else { say "There is no cup to wire off." }
}
```

The target is `self`, `room`, `container`, `actor` (their hands) or a
named object in range, and it must be a container; a kind that still
has an abstract message cannot be made. The new instance starts at its
kind's defaults and immediately receives `spawned (from)`, so it can
adjust itself in a handler:

```sprout
kind Cup {
  :state one_of [wet, leather, bone_dry, bisqued] default wet
  on :spawned (from) { say "A cup, still wet, the rim just this side of true." }
}
```

`destroy self` is the other end: the object leaves the world and
whatever it held falls to its container. A spawned instance is the same
kind of row as a placed one, marked with what spawned it, so the host
can list and sweep them. Instances of one kind share the kind's
`:names`; when a typed noun matches several, the parser looks at
whether they _differ_: instances of one kind in equal state are
interchangeable and the first is taken without a question; if a
symbol-valued property differs, its values become adjectives ("the wet
cup or the bisqued cup?"). `x.is(Kind)` in an expression tests an
object's kind chain.

At most 8 spawns in one action, and at most 2000 live instances in a
zone; past either the action faults (below).

### Properties

A property is `:name <default>`, and its type is the type of the
default:

| declaration                              | type    | notes                                                           |
| ---------------------------------------- | ------- | --------------------------------------------------------------- |
| `:lit false`                             | boolean |                                                                 |
| `:fuel 3`                                | integer | `:fuel 3 min 0 max 10` clamps; `adjust` stays inside the bounds |
| `:label "…"`                             | string  | plain text; no markup, no concatenation                         |
| `:state one_of [wet, fired] default wet` | symbol  | one of a declared set, at most 12 options                       |

An extension the host installs may add types of its own, written with
the extension's keyword after the name — `:image media "m-…"` from the
media extension (see [Extensions](#extensions-and-pictures)).

`default` is optional sugar: `:takeable default true` and
`:takeable true` mean the same. Two objects may each declare `:lit`;
they are different properties on different objects. Reads
(`x.get(:p)`) may look at `self`, `room`, `container`, `actor`, any
argument or parameter, and any named object in range. **Writes
(`self.set`, `self.adjust`) may touch `self` only** — an object's state
changes only as its own answer to a message it received. The compiler
enforces this; it is not a runtime check. To change the room, send it
a message and let its handler decide.

Every object also has the **well-known properties**, without declaring
them, and redeclaring one with another type is refused where it
applies:

| property       | type    | default | applies to                                                           |
| -------------- | ------- | ------- | -------------------------------------------------------------------- |
| `:takeable`    | boolean | false   | items                                                                |
| `:hidden`      | boolean | false   | items — declared and stored; nothing acts on it yet                  |
| `:scenery`     | boolean | false   | items — declared and stored; nothing acts on it yet                  |
| `:illuminated` | boolean | true    | rooms                                                                |
| `:open`        | boolean | true    | containers (rooms, and kinds that inherit `Container`)               |
| `:capacity`    | integer | 8       | kinds that inherit `Container`; a room is unbounded whatever it says |

An installed extension may add to this table — the media extension adds
`:image` (media, none) on rooms, items and kinds.

A well-known property an object never declared may still be set
(`self.set(:hidden, true)`) and then lives in its state; unset, it reads
as its default and is never stored. Two of them are ahead of the engine:
`:hidden` and `:scenery` are reserved with their defaults and can be read
and written like any property, but nothing in the engine or the parser
consults them yet — a hidden thing is still listed and addressable, and
`take` asks only `:takeable`. Where a well-known name does not
apply — `:open` on a bucket that is not a container — the object may
declare its own property of that name with any type.

### What an object remembers about a visitor

`:remembers [seen: false, cups: 0 min 0 max 99]` declares per-visitor
memory: fields the object keeps _about each visitor_, separate from its
own state. `actor.recall(:seen)` reads the current visitor's value and
`actor.remember(:seen, true)` writes it. This is the only thing an
object may know about a person: the actor is opaque — no handle, no id
— and `x == actor` and `x.is(Actor)` are the only ways to tell a
visitor from a thing. The host shows a visitor what the objects
remember about them; the memory is theirs.

### Messages, and the verbs a visitor can type

A message is a named body an object answers:

```sprout
light { … }                          // no arguments
use (with: object) { … }             // one argument; arguments are always objects
open when (self.get(:state) == :centred) { … }   // offered only while the guard holds
use (with: object) abstract          // on a kind: children must define it
```

Every non-reserved message with a body is a **verb** the parser can
reach. Its grammar comes from `grammar` lines inside the body:

```sprout
use (with: object) {
  grammar "light [self] with [with]"
  grammar "use [with] on [self]"
  grammar "strike a match"          // [self] may be left out; the object is implied
  …
}
```

`[self]` is the object that owns the message and `[with]` an argument;
a slot may only be one of those. Without any `grammar`, the line is the
message's own name. At most 8 lines per message, each at most 80
characters, and 2 arguments; a chip-based client labels the verb with
its first grammar line. `when`
decides whether the verb is offered at all: a chip that is not there is
a better answer than one that says no, and a typed verb whose guard
fails is told "you can't do that right now".

The parser also knows the built-ins, which are not messages a builder
defines: `look`, `examine X`, `go <exit>` (or the exit's label), `take
X`, `drop X`, `give X to Y`, `put X in Y`, `inventory`, `wait`, `help`,
and the pronouns `it`, `them`, `him` and `her`, bound to the last noun. `take`,
`drop`, `give`, `put` and `go` _propose a move_; the consent guards
below are where a builder shapes them.

### Handlers and hooks: how objects hear each other

Two constructs, for two different things:

- `changed :p (value, was) { … }` is a **hook**: it runs on the object
  whose property `:p` just changed, after the write, with the new value
  and the old. It does not run when a value is set to what it already
  was, and it reaches nothing else unless it says so. It is where an
  object decides to tell the world.
- `on :m (from, value) { … }` is a **handler**: it runs when a message
  `:m` arrives — from `send`, from `broadcast`, or from the engine (the
  reserved messages). The receiver decides what, if anything, to change
  about itself. `_` leaves a parameter unnamed: `on :pong (_, value)`.

Sending: `send <target> :m` or `send <target> :m(expr)` reaches one
object in range; `broadcast :m` or `broadcast :m(expr)` hands the event
to the sender's container, which relays it. Every event is an
envelope — a name, a sender, a value, a depth, the depth-0 action it
descends from, and the containers that relayed it — whether or not the
handler looks at all of it. The visitor's own command is depth 0;
everything a handler emits is one deeper.

Inside a body, the scope objects are `self`, `room` (the room self is
in at that moment, however deep the nesting), `container` (what holds
self directly), `actor` (the visiting person, opaque), and each named
argument or parameter.

### Containers are the bus

Everything that holds things is a container: a room, the actor (their
hands), and any object of a kind that inherits `Container`. Delivery
follows the tree, and the _container_ owns the routing policy — an
item must not know whether it is in a glass box or a wooden chest.

1. `broadcast` hands the event to the sender's container.
2. A container that receives a broadcast delivers it to everything it
   directly holds except the sender; then, for each sub-container it
   holds, asks that sub-container's `pass` rule whether to carry the
   event inward; and asks its own `pass` rule whether to carry it
   outward to the container it sits in.
3. `pass :m (expr)` / `pass any (expr)` on a container kind is the
   rule, one line per event name or a default; the most specific line
   wins.

The built-in defaults: `Room` passes everything inward and nothing
outward; `Actor` passes everything both ways (a torch in your hand
lights the room; you hear the room); `Container` passes everything
while `:open` and nothing when closed.

```sprout
kind GlassCase: Container {
  :open false
  pass :illuminating (true)          // light crosses glass, open or shut
  pass any (self.get(:open))
}
```

"In range" — the reach of a broadcast, of `send`, of `get`, and of
`each` — is whatever the tree and the pass rules make reachable from
the sender. A closed chest's contents are not in range of the room; a
lit torch inside a glass case is. Delivery order is deterministic:
container first, then contents in id order, depth first. An object may
hear one event twice by two routes; that is the builder's to handle
(`if (value && !self.get(:glinting))`). The bound is depth and budget
(below), not a cycle rule.

### Every move is a proposal

Taking a key from a drawer ends with the key in the actor's hands, and
three parties have a say: the key, the drawer, and the hands. So `move
X to Y` — and the built-in `take`, `drop`, `give`, `put … in` and `go`,
with the actor as the thing moving — is one protocol:

1. **Ask**, in order: `depart (to)` on the thing moving; `release
(item, to)` on its current container; `accept (item, from)` on the
   destination. Each guard's body may only test, then `allow` or
   `refuse "…"` (the string is said to the actor). Guards read and
   never write, so a refused proposal has nothing to unwind.
2. **Defaults** where a guard is not written: `depart` allows unless
   the destination is an actor and the thing is not `:takeable`
   ("That is not something you can carry."); `release` allows while the
   container is `:open` (rooms and hands always); `accept` allows while
   `:open` and under `:capacity` (a room has no bound), and a room
   accepts an actor only
   through a declared exit from where they stand.
3. **Move.** If all three allow, the engine rewrites containment — one
   write, the engine's — then sends `left (item, to)` to the old
   container, `entered (item, from)` to the new one, and `moved (from,
to)` to the thing itself. A room's `entered` with `item == actor` is
   where arrival prose lives.

```sprout
room glaze_cupboard {
  :locked true
  accept (item, from) {
    if (item.is(Actor) && self.get(:locked)) { refuse "The cupboard door is locked." }
    else { allow }
  }
  on :entered (item, from) {
    if (item.is(Actor)) { say "The smell of raw glaze: chalk, ash, a little metal." }
  }
}
```

No verb ever rewrites containment behind a container's back, so "how
did the key get out of the locked case?" always has a one-line answer
in the case's `release`.

### `describe` is prose

`describe { … }` is the object's description right now. It may read
anything in range, walk a container with `each`, branch with `if`, and
use an extension's statement that is marked for describe (`show` a
picture); it produces `text "…"` lines (paragraphs) and nothing else. A
`set`, `adjust`, `remember`, `send`, `broadcast`, `move`, `spawn` or
`destroy` inside it is refused by the compiler: looking at a thing
changes nothing. Without a `describe`, `prose` is the description.
`examine` defaults to `describe`.

### Extensions

The language ends at the room's edge; what a host can do beyond it —
open a picture, play a sound — arrives as an **extension** the host
installs (`sprout({ extensions: [media] })`), and a source names the
ones it depends on at its top with `use <name>`. An extension may add
value types, well-known properties and statements; its words are
reserved only in a source that `use`s it, and a source that uses an
extension the host lacks does not compile ("This host has no extension
called …"). One rule keeps the language what it is: **an extension
statement records an effect; it never performs one** — what happens
because of the effect is the host's, after the action. The evaluator
hands an extension a frozen, read-only view of the frame, turns a throw
inside it into a fault naming the extension, and charges every run
against the event budget.

Pictures — the `media` value type, `:image`, `show` — are the first
extension, `@overstory/sprout/ext-media`; its README is where they are
described.

### Statements

| statement                                            | where                       | meaning                                                                 |
| ---------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------- |
| `if (expr) { … } else if (expr) { … } else { … }`    | anywhere                    | branching; a chain counts as one level of nesting                       |
| `self.set(:p, expr)`                                 | not `describe`, not a guard | write a property of self                                                |
| `self.adjust(:p, expr)`                              | same                        | add to an integer property of self, clamped to its bounds               |
| `say "…"`                                            | not `describe`              | a line to the actor                                                     |
| `text "…"`                                           | `describe` only             | a paragraph of the description                                          |
| `broadcast :m` / `broadcast :m(expr)`                | not `describe`              | an event, handed to self's container                                    |
| `send <target> :m` / `send <target> :m(expr)`        | not `describe`              | an event, to one object                                                 |
| `actor.remember(:p, expr)`                           | not `describe`              | write the visitor's memory on self                                      |
| an extension's statement (`show`, `show self :prop`) | as the extension declares   | record an effect for the host                                           |
| `move <what> to <target>`                            | not `describe`              | a proposal: the three guards are asked                                  |
| `spawn Kind in <target>`                             | not `describe`              | a new instance of the kind                                              |
| `destroy self`                                       | not `describe`              | self leaves the world; its contents fall to its container               |
| `each x in <target> { … }`                           | anywhere                    | the target container's direct contents; the only loop, and it is finite |
| `allow` / `refuse "…"`                               | guards only                 | the guard's answer                                                      |

Targets are `self`, `room`, `container`, `actor`, an argument or
parameter, or a named object in range. Every body terminates by
construction: there is no recursion and no loop but `each` over a list
the engine supplies.

### Expressions

Literals (`true`, `false`, integers, `"strings"`, `none`); symbols
(`:wet`); `target.get(:p)`; `actor.recall(:p)`; `target.is(Kind)`
(also `Actor`, `Room`, `Container`); `target.count` (direct contents);
a parameter's value by name (a handler's `value`, a hook's `was`); the
operators `! && || == != < <= > >= + -`; and parentheses. Integers
only, and strings are never joined — say what you mean in the string.

### Reserved names

The engine sends these; a message may not be named after one, and none
is a verb a visitor types: `describe`, `examine`, `spawned`, `depart`,
`release`, `accept`, `moved`, `left`, `entered`, `take`, `drop`, `give`,
`go`, `look`, `inventory`, `wait`, `help`. The built-in kinds are
`Container`, `Room` and `Actor`. Keywords cannot be message names.

### What the compiler refuses

A write to anything but `self`; a property self does not declare
(well-known ones excepted); a value of the wrong type; `adjust` on a
non-integer; `text` outside `describe`, and `say` or anything that
writes or sends inside it; `allow`/`refuse` outside a guard, or
anything else inside one; a grammar slot that is not `[self]` or an
argument; an abstract message on anything placed; behaviour on an
instance of a kind; `pass` off a container; a kind inheriting itself or
one that does not exist; `in` on a room or a kind; an exit to a room it does
not know; more than the caps below; nesting deeper than 8 (an `else if`
chain counts as one); a source over 64 KB. Every refusal names the line
and the column.

### Limits, and what faults at runtime

| cap                                                                          | value               |
| ---------------------------------------------------------------------------- | ------------------- |
| properties per object (`:remembers` fields too)                              | 16                  |
| messages per object                                                          | 16                  |
| handlers, hooks, pass rules per object                                       | 16 each             |
| statements in one body (a message, a handler, a hook, a guard, a `describe`) | 16                  |
| options in a `one_of`                                                        | 12                  |
| `:names` per object, words per name                                          | 8, 40               |
| grammar lines per message, characters                                        | 8, 80               |
| arguments per message                                                        | 2                   |
| exits per room, label characters                                             | 8, 40               |
| nesting depth                                                                | 8                   |
| a `say` line, a string value                                                 | 600, 80 characters  |
| a name, a prose block                                                        | 80, 4000 characters |
| a source                                                                     | 64 KB               |

At runtime an action **faults** — the transaction rolls back, the
visitor reads that nothing happened, and the builder gets a record of
the instigating event, the object that was running and the last 20
envelopes — past **20 events deep** or **256 events in one action**
(two objects answering each other forever is a fan-out, so the depth
cap alone would never catch it), more than **8 spawns** in one action,
or **2000 live instances** in a zone. The caps are one budget per
request, so describing forty items cannot cost forty ceilings.

### A worked example

A kind, an item of it, and a room — compiled and printed by the
compiler, and pinned to it by `src/readme.spec.ts`.

```sprout
kind Torch {
  :names ["torch", "brand"]
  :takeable true
  :on_fire false
  :illuminating false

  describe {
    if (self.get(:on_fire)) {
      text "A pitch torch, burning steadily."
    } else {
      text "A pitch torch, cold. It wants a light."
    }
  }

  use (with: object) {
    grammar "light [self] with [with]"
    grammar "use [with] on [self]"
    if (with.get(:on_fire)) {
      self.set(:on_fire, true)
      self.set(:illuminating, true)
      say "The pitch catches with a soft whump."
    } else {
      say "Nothing about that will light a torch."
    }
  }

  changed :illuminating (value) {
    broadcast :illuminating(value)
  }
}
```

```sprout
object torch: Torch {
  :name "Old torch"
  :names ["torch", "brand", "old torch"]
}
```

```sprout
room cellar {
  :illuminated false
  prose "Pitch dark. You can feel a wall, and cold air moving."

  describe {
    if (self.get(:illuminated)) {
      text "A vaulted cellar. Barrels along one wall; a stair up."
    } else {
      text "Pitch dark. You can feel a wall, and cold air moving."
    }
  }

  on :illuminating (from, value) {
    self.set(:illuminated, value)
  }

  accept (item, from) {
    if (item.is(Actor) && !self.get(:illuminated)) {
      refuse "Too dark to find the stair."
    } else {
      allow
    }
  }

  exit "up the stair" to hall
}
```

A visitor in the cellar holding the old torch and a lit candle types
`light the torch with the candle`: the torch's `use` runs, its
`:illuminating` changes, the hook broadcasts, the cellar sets
`:illuminated`, and the visitor reads the torch's line and the cellar's
new description — one block of text. The torch never touched the
cellar; each decided for itself what a light nearby means.

## The definition format

**Source is the truth** (stage 1b of the split, #523). What a host
stores, versions, diffs and moderates is the Sprout text as written;
the compiler produces a **definition** (`SproutDefinition` for a room
or an item, `KindDefinition` for a kind — zod schemas in `sprout.ts`)
from it every time a world is loaded, and a host caches that by the
hash of what went in. A definition carries the identifier its head
declared (`ident`; null on one built by hand) and `printSprout` turns a
definition back into canonical source — `compileSprout(printSprout(d))`
yields `d` — for an editor that wants to start from a name alone. The
properties, messages, handlers, hooks, guards and rules are plain data,
so a host can inspect a definition without running it, but it never
needs to keep one.

`LANGUAGE_LEVEL` is the language's version, an integer that steps when
a **policy** refusal is added — a rule about what a well-formed source
may say (`describe` may not write, a well-known property may not be
redeclared with another type). A source accepted at level _n_ is
stored with _n_ beside it; compiling it later with
`acceptedLevel: n` turns any policy refusal introduced after _n_ into a
**warning**, so an old text still loads under a stricter language
(`CompileResult.level` is the level it was compiled under, and each
problem carries the level that introduced it, or `null` for a
structural fault that no level forgives). The two schemas come in
layers — `RoomDefinitionShape` is the structural contract alone, and
`RoomDefinition` adds the language's checks — because the compiler
parses the shape and runs the checks itself, with the zone's kinds, the
host's extensions and the accepted level in hand.

`resolveDefinition(def, kinds)` folds an object's kind chain into one
flat definition — parents first, the child overriding by name; the most
specific non-empty `describe`, `:names` and prose win — and records the
chain for `is(Kind)`. `kindAsItem(kind, kinds)` is what a spawned thing
is. `sproutDefinitionProblems` and `sproutDefinitionWarnings` are the
compiler's checks on a definition that arrived some other way.

## Compiling a microworld

A **microworld** travels as an **archive**: `sprout.json` (the
`SproutManifest`: `format`, the `language` level it needs, the `entry`
room, the `extensions` it uses) beside any number of `.sprout` files.
`compileMicroworld(archive, { strict, ext })` compiles them together:

- Files are read in name order and their `use` lines unioned first, so
  every file compiles under ONE keyword set and one well-known table —
  `use` is an archive-level fact, and the manifest repeats it so a host
  can refuse before compiling.
- Identifiers resolve across files: `exit "up" to hall`, `object torch:
Torch in cellar`, `send bench :x`. Rooms and objects share one
  namespace; kinds are capitalised and apart. Every cross-definition
  check runs here with the whole microworld in view.
- **Strict** (a host's save and publish, the CLI's `check`, an editor):
  every unresolved reference is a `problem` naming its file, line and
  column, and the definition it is about. **Lenient** (a runtime's
  load): a definition that cannot be compiled or resolved is dropped
  into `absent` with its reason — a file that does not parse, a
  duplicate, an object of a missing kind, one placed in what holds
  nothing or never reaches a room — and an exit to a missing room is
  simply not there. The microworld keeps running minus the broken part,
  which is what makes a take-down safe.
- The **program** is what an evaluator and a matcher read: `kinds`,
  `rooms` and `objects` by identifier (objects folded through their kind
  chains, each with its `placedIn`), the `entry`, `order` — objects in
  declaration order, files by name and definitions in file order, which
  is the delivery order for a broadcast — `files` (what defined what),
  the complete tokenised `grammar` table per reachable message and the
  `builtins` a player may always type, `uses`, the `values` an
  extension's types are given in the text (a picture's id), and
  `absent`.

`compileFile(source)` is one file alone — what an editor checks per
keystroke — and `compileSprout(source)` one definition.

## Embedding the engine

A host plays a microworld through `@overstory/sprout/core` — `load` an
archive, then `turn` — and its README opens with the twelve-line
embedding. The engine underneath (`runVerb`, `runMove`, `describeWith`
on a `Scene` and a `TurnContext`) is described there too, for a host
that wants the evaluator without the runtime.

## Typing to play: the command parser

`parseCommand(ctx, text)` turns a typed line into a `Command` — a
message on an object with bound arguments, or one of the built-ins —
or a reply for the visitor. It is a classic interactive-fiction parser
in the Inform lineage, and its grammar is _data_: the `ParseContext` is
the scene plus the exits the actor may take and the people present, and
from it the parser builds a dictionary (every addressable object's
`:names`, its display name, its kind's name, a symbol-valued property's
value as an adjective, the exits' labels, the people by handle) and a
grammar table (every reachable message's lines with `[self]` bound,
plus the built-ins — the same `grammarLines`, `grammarTokens` and
`BUILTIN_VERBS` a program carries, from `grammar.ts`). Articles and
filler are dropped; slots are filled
longest noun first; ties on _which object_ ask "Which do you mean?"
unless the candidates are one kind in one state, when any will do; ties
on _which verb_ prefer the object's own message over a built-in. A miss
is spoken in Inform's words ("I only understood you as far as…") and
flagged `missed` so a host can learn from it.

`complete(ctx, prefix)` offers what could be typed next from the same
table, so a prompt can Tab-complete; `whatYouCanSay(ctx)` is `help`.
Because both come from the one match function, they can never suggest
something the engine would refuse.

## What the host provides

The language ends at the world's edge. A host supplies: identity (who
the actor is — the engine sees an opaque object); reachability (who may
enter whose rooms); storage for definitions and for the tree of
instances, and the transaction an action runs in; publishing
(Overstory drafts a definition and settles it at the daily tick, and
an instance binds to a published version); the media store behind
`:image`; and moderation. Overstory's runtime for all of that lives in
its backend; a second host writes its own against this package's
outcomes.
