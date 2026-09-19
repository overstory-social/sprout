---
name: sprout
description: Write Sprout, the language of Overstory's Understory — rooms, items and kinds with properties, messages, handlers and guards — around the builder's own prose. Use when someone is building an understory and wants help with the syntax, the shape of a kind, or why the compiler refused something.
---

# Sprout

Sprout is the small language that makes an Understory move: what a room, an item or a kind holds, shows and does when a visitor types "light the torch with the flint". This skill is generated from the compiler's own definitions (its well-known properties, its reserved names, its caps, and a worked example the compiler compiled and printed itself), so what it says is what the compiler accepts.

## Your job, and the builder's

**The builder writes the prose and describes the interaction. You write Sprout around their words.** Every `say`, `text`, `prose` and `refuse` string is theirs: ask for it, quote it back, keep it exactly. Never invent a room's description, an item's line, or a refusal's wording. If they say "the lamp should light when you use the flint on it, and say something about the smell of oil", the sentence about the smell of oil is for them to write; the `use (with: object)` message and its guard are for you.

When the compiler refuses something, read its message: it names the line and column, and it says what the language can and cannot do. Fix the Sprout; do not change their words to make it fit.

## The shape

One object per source. A source starts with one of:

- `room <name> { … }` — a room. Rooms have `exit "label" to <room_name>` lines; room names are the identifier of the room's name (`the_kitchen`).
- `object <name> { … }` or `object <name>: <Kind> { … }` — an item, on its own or an instance of a kind. An instance may set property values, `:name`, `:names`, `prose` and `describe` — not messages or handlers; those belong to the kind.
- `kind <Name> { … }` or `kind <Name>: <Parent> { … }` — behaviour and defaults, never placed. Kind names are capitalised; object and room names are lower_case.

Inside the braces, in any order:

- `:name "Display name"` (optional; the name is humanised from the identifier otherwise), `:names ["torch", "brand"]` (what a visitor may call it), `prose "…"` (what `describe` falls back to).
- Properties: `:lit false`, `:fuel 3 min 0 max 10` (an integer clamps), `:state one_of [wet, fired] default wet` (a symbol from a set), `:label "Sold out"` (a short text). An extension the host installs may add more (below).
- `:remembers [seen: false, cups: 0 min 0 max 99]` — what the object remembers about each visitor, read with `actor.recall(:seen)`, written with `actor.remember(:seen, true)`.
- `describe { … }` — the object's prose right now, with `text "…"` lines (paragraphs). Describe READS — anything in range — and never writes or sends: no `set`, `adjust`, `remember`, `send`, `broadcast`, `move`, `spawn` or `destroy` in it (only `if`, `text`, `each`, and an extension's statement marked for describe).
- Messages: `name { … }`, `name (with: object) { … }` (an argument is always an object), `name when (expr) { … }` (offered only while it holds), `name (with: object) abstract` (on a kind: children must define it). `grammar "light [self] with [with]"` lines inside the body are what a visitor may type; without any, the name itself is the line.
- Handlers: `on :message (from, value) { … }` runs when a message arrives; `changed :property (value, was) { … }` runs when self's property changed. `_` leaves a parameter unnamed.
- Containers: `pass :message (expr)` / `pass any (expr)` on a container kind decides whether a broadcast carries through it (rooms pass inward, never out; a container passes while `:open`).
- Consent guards: `depart (to) { … }` on the thing moving, `release (item, to) { … }` on where it is, `accept (item, from) { … }` on where it goes — bodies may only test, `allow` or `refuse "…"`.

## Statements

`if (expr) { … } else if (expr) { … } else { … }`; `self.set(:p, expr)`; `self.adjust(:p, expr)`; `say "…"` (to the actor); `text "…"` (describe only); `broadcast :m` or `broadcast :m(expr)` (to everything in range, through containers); `send <target> :m` or `send <target> :m(expr)` (to one object); `actor.remember(:p, expr)`; `move <what> to <target>` (a proposal: the three guards are asked); `spawn Kind in <target>`; `destroy self`; `each x in <target> { … }` (a container's direct contents); `allow` / `refuse "…"` (guards only).

**Only `self` may be written.** To change the room, `send room :message` and let the room's handler decide. Targets are `self`, `room`, `container`, `actor`, an argument or parameter, or a named object in range.

## Expressions

Literals (`true`, `false`, integers, `"strings"`, `none`), symbols (`:wet`), `target.get(:p)`, `actor.recall(:p)`, `target.is(Kind)` (also `Actor`, `Room`, `Container`), `target.count`, a parameter's value by name, `! && || == != < <= > >= + -`, parentheses. Integers only; no strings are joined — say what you mean in the string.

## Well-known properties

Every object has these without declaring them, with these defaults; declaring one with another type is refused where it applies.

| property | type | default | applies to |
|---|---|---|---|
| `:illuminated` | boolean | true | rooms |
| `:open` | boolean | true | containers (rooms, and kinds that inherit Container) |
| `:capacity` | integer | 8 | containers (rooms, and kinds that inherit Container) |
| `:image` | media | none | rooms, items and kinds |
| `:takeable` | boolean | false | items |
| `:hidden` | boolean | false | items |
| `:scenery` | boolean | false | items |

## Extensions

A source may begin with `use <name>` lines naming extensions the host installed; each adds value types, well-known properties and statements. An extension's statement records something for the host to act on after the action (a picture to open) and never changes the world itself. A source that uses an extension the host lacks does not compile.

### `use media`

Pictures. A `media` property holds an id the host's uploader minted, or none (`:image media "m-…"`, `:image media`); it may be set at runtime (`self.set(:image, "m-…")`, or `none`). Nothing shows a picture on its own: `show` opens self's `:image`, `show self :blueprint` a named media property, `show room` the room's. Inside `describe`, `examine` and `look` open it; inside a handler, only that action does. What the id means, and who may see the bytes, is the host's.

- `:name media ["…"]` — a media property.

- `show [<target>] [:property]` — anywhere but a guard.

## Reserved names

The engine sends these; they are never verbs a visitor types, and a message may not be named after one: `describe`, `examine`, `spawned`, `depart`, `release`, `accept`, `moved`, `left`, `entered`, `take`, `drop`, `give`, `go`, `look`, `inventory`, `wait`, `help`. Built-in kinds: `Container`, `Room`, `Actor` (`Actor` cannot be inherited). Keywords cannot be message names.

## What a visitor can always type

The built-in verbs, in every microworld, tried after a message's own grammar lines: `look`, `examine [x]`, `inventory`, `take [x]`, `drop [x]`, `put [x] in [y]`, `give [x] to [y]`, `go [x]`, `wait`, `help`. `[x]` is a thing in reach — one in the hands for `drop` and `give`, an open container for `put … in`, an exit's label for `go`, someone present for `give … to`.

## What the compiler refuses

A write to anything but `self`; a property self does not declare (well-known ones excepted); a value of the wrong type; `adjust` on a non-integer; `text` outside `describe`, and `say` or anything that writes or sends inside it; `allow`/`refuse` outside a guard, or anything else inside one; a grammar slot that is not `[self]` or an argument; an abstract message on anything placed; behaviour on an instance of a kind; `pass` off a container; a kind inheriting itself or one that does not exist; more than 16 properties or 16 messages per object; nesting deeper than 8 (an `else if` chain counts as one); a source over 64 KB.

At runtime, an action **faults** and is rolled back past 20 events deep or 256 events in one action (two objects answering each other forever), more than 8 spawns in one action, or 2000 live things in a zone.

## A worked example

A kind, an item of it, and a room — compiled and printed by the compiler.

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

A visitor in the cellar holding the old torch and a lit candle types `light the torch with the candle`: the torch's `use` runs, its `:illuminating` changes, the hook broadcasts, the cellar sets `:illuminated`, and the visitor reads the torch's line and the cellar's new description — one block of text.
