# Language reference

This chapter describes the whole of Sprout, language level 1, as
implemented by Sprout 0.1. It is written to be looked things up in, and
assumes you have read the [Quickstart](03-quickstart.md).

Contents:

1. [A world on disk](#1-a-world-on-disk)
2. [Lexical rules](#2-lexical-rules)
3. [The world](#3-the-world)
4. [Objects and kinds](#4-objects-and-kinds)
5. [Names](#5-names)
6. [Places, exits and links](#6-places-exits-and-links)
7. [Properties, types and values](#7-properties-types-and-values)
8. [Expressions](#8-expressions)
9. [Bodies and statements](#9-bodies-and-statements)
10. [Verbs](#10-verbs)
11. [Moving things, and consent](#11-moving-things-and-consent)
12. [Messages](#12-messages)
13. [Range](#13-range)
14. [Prose](#14-prose)
15. [Actors, visitors and characters](#15-actors-visitors-and-characters)
16. [Time](#16-time)
17. [Chance](#17-chance)
18. [Spawning and destroying](#18-spawning-and-destroying)
19. [Composition in detail](#19-composition-in-detail)
20. [The standard library](#20-the-standard-library)
21. [What the compiler checks](#21-what-the-compiler-checks)
22. [Limits](#22-limits)
23. [How a world runs](#23-how-a-world-runs)
24. [Extensions](#24-extensions)
25. [The command line](#25-the-command-line)

---

## 1. A world on disk

A world is a folder holding a manifest, `sprout.json`, and the `.sprout`
and `.prose` files it names.

```text
printers_shop/
  sprout.json
  printers_shop.sprout     the world, and every object in it
  creature.sprout          kind Creature
  key.sprout               kind Key
  composing_room.prose     passages
  tests/                   the world's own tests (not listed in the manifest)
```

### The manifest

```json
{
  "name": "printers_shop",
  "version": "0.1.0",
  "author": "Marta",
  "license": "MIT",
  "level": 1,
  "extensions": [],
  "libraries": [
    {
      "name": "sprout",
      "version": "0.1.0",
      "sha": "35c43958326d038a89ab01513ae2177fbfb263bac32b870ff899d05dc16f5cff"
    }
  ],
  "files": ["printers_shop.sprout", "creature.sprout", "key.sprout", "composing_room.prose"]
}
```

| field        | holds                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `name`       | the world's name: lower case, letters, digits and `_`. The `world` declaration must repeat it. |
| `namespace`  | optional; the namespace the world's own declarations live in. Defaults to `name`.              |
| `version`    | this world's version, as [semver](https://semver.org).                                         |
| `author`     | who made it, as free text.                                                                     |
| `license`    | the terms it is offered under.                                                                 |
| `level`      | the language level it was written for. Currently `1`.                                          |
| `extensions` | extensions it uses, each `{ "name": …, "major": … }`. See [Extensions](#24-extensions).        |
| `libraries`  | every library it uses, by name, version and the SHA-256 hash of its source.                    |
| `files`      | every `.sprout` and `.prose` file that makes up the world.                                     |

`sprout init` writes a manifest for you, with the standard library
already pinned. Every file you add must be added to `files`; a file that
is listed but missing, or present but not listed, is reported.

### Which file holds what

Files and folders are yours to arrange.

- **The world** is declared once, in whichever file you like; `sprout
  init` calls it after the world, as `printers_shop.sprout`. An object is
  declared inside the body of what holds it, or in a file of its own
  that says where it sits (see [Objects](#objects)).
- **Kinds, enums, verbs and messages** may go in any `.sprout` file,
  several to a file, alone or beside the world. Two files may even
  declare kinds of one name; a file that needs both imports one under
  another name.
- **Passages** may be written inline in a body, or in a `.prose` file that
  a body points at with `prose "name.prose"`.

A file names what another file declares only by importing it:

```sprout
import {Chest as Box} from 'things/chest'
import {cellar} from 'rooms/cellar'
import * as sprout from 'sprout'
```

- The text after `from` is a file's path from the world's folder,
  without `.sprout`, or a library's name.
- `as` gives a name another name in this file. A namespace import makes
  everything a library declares writable as `sprout.Container`.
- A name may be imported once per file, and not under a name the file
  itself declares. The world's own name is never imported.
- An object another file declares is named from the world instead, as
  `printers_shop.hall`, unless it is written in a file of its own and
  imported.
- Imports may go anywhere at the top level of a file; at the top is
  easiest to read.

Nothing is in scope without an import: not the standard library, and
not what your other files declare. Forget one and the compiler says
which name, where it is declared, and the line to write. The engine's
own messages, `:entered`, `:tick` and the rest, are never imported, and
every verb any file declares is typeable whether or not a file imports
it.

Examples in this reference are excerpts: a file that writes
`sprout.Place` has imported `* as sprout from 'sprout'`.

### Libraries

A library is a set of kinds, enums, verbs and messages, written in
Sprout, that a world can use. The standard library, `sprout`, is imported
like any file, by its name: `import {Container} from 'sprout'`, or
`import * as sprout from 'sprout'` for all of it as `sprout.Container`. A library's full source travels with every world that uses it,
checked against the hash in the manifest, so a world never changes
because a library changed somewhere else.

---

## 2. Lexical rules

**Comments** are `//` to the end of the line, or `/* … */`, which may span
lines and does not nest.

**Quoted text** is written in double quotes and takes the escapes `\"`,
`\\`, `\n` and `\{` (a literal brace). Any other backslash is an error.

**Symbols.** A colon directly followed by a lower-case letter is a
_symbol_: `:lit`, `:stir`, `:oak`. Symbols name properties, messages, and
enum options inside expressions. A colon anywhere else is punctuation,
which is why labels are written with a space: `act nuzzle (target: p)`.

**Identifiers** for objects, properties, messages, passages, roles and
enum options are lower case with `_` between words (`brass_key`).
Kinds and enums are capitalised (`PrintedSheet`, `Ward`).

**Reserved words** cannot name an enum option, a role, a `let`, or any
other binding:

```text
boolean integer string object symbol true false
accept act actors allow any are arrive article as at bound broadcast
changed connect contains default depart describe destroy do each else
enum exit finally for from grammar hours if in kind let link many max
message min minutes move name nouns of on optional pass passage permit
prose refuse release remembers role say seconds send spawn tell text to
verb visitors wake when with without world
```

In addition, no message or verb may be called `describe`, `depart`,
`release`, `accept`, `permit`, `do`, `passage` or `prose`; no message may
take the name of one the engine sends (see [Messages](#12-messages)); and
no verb may take the name of an engine verb (`go`, `look`, `examine`,
`inventory`, `wait`, `help`).

---

## 3. The world

```sprout
world printers_shop is sprout.World {
  visitors are Visitor
  visitors arrive at composing_room
  :season Season default autumn

  object composing_room is sprout.Place { … }
  object press_yard is sprout.Place { … }
}
```

A world is one tree. The world is its root; every other object is inside
it, or inside something inside it. The source is written in the same
shape: the world's body holds the objects directly in the world, and each
object's body holds the objects directly inside it.

- A world must compose `sprout.World`, written exactly so. It may compose
  other kinds beside it, which is how a world takes on a library of stock
  lines in another voice: `world shop is sprout.World, victorian.Voice {
  … }`. Nothing but a world may compose `sprout.World`.
- `visitors are K` names the _visitor kind_: what every visitor is made
  of. It must be one of the world's own kinds, and must compose
  `sprout.Visitor`.
- `visitors arrive at p` names the place where new visitors appear. It is
  written in the world's body, so a place directly in the world is named
  bare, and one deeper by its path: `visitors arrive at kiln.back_room`.
- The world may declare properties, passages, handlers and anything else
  a body may hold, except a `grammar` block and a `describe`.
- There is exactly one `world` declaration, its name is the manifest's
  `name`, and no kind may share that name.

The world is the one object with no container. It cannot move, and cannot
be spawned or destroyed. Unless it says otherwise, it passes nothing
between the places inside it (`pass any (false)`), so one place cannot hear
or reach another unless the world lets it.

---

## 4. Objects and kinds

### Objects

An object is a thing in the world. It is declared inside the body of what
holds it, names its kinds after `is`, and may have a body of its own:

```sprout
object cabinet is sprout.Container, Warded, sprout.Fixture {
  grammar { name "type cabinet" article the nouns "cabinet", "type" }

  :open     false
  :capacity 12

  passage immovable { It is a cabinet. It stays where it is. }

  object shop_key is Key {
    grammar { name "shop key" nouns "iron key" }
    :opens [brass, iron]
  }
}
```

- An object always names at least one kind. `object brass_key is Key` with
  no body is fine.
- Its body works like a kind made just for this one object: it may add
  properties, passages, handlers, a `describe`, verb roles and so on, and
  may restate a property its kinds declare to change its starting value.
- It may hold other objects only if something it is made of declares
  `contains` (see [Containment](#containment)).
- An object may instead be written at the top of a file of its own, if
  it says where it sits. Either name what holds it with `in`, a path from
  the world's body:

  ```sprout
  object shed is sprout.Place in printers_shop { … }
  object ladder is sprout.Fixture in composing_room.paper_store
  ```

  or import it where it sits and write it there with no kinds and no
  body, a _stub_:

  ```sprout
  import {cellar} from 'rooms/cellar'

  world printers_shop is sprout.World {
    object cellar
  }
  ```

  An object in its own file is placed exactly once, by one of the two.

### Kinds

A kind is a reusable description of a sort of thing. It has no place in
the world of its own; objects are made of it.

```sprout
kind Crate is sprout.Container {
  :capacity 20
  grammar { nouns "box" }
  describe { text "Slat-sided, heavier than it looks." }
}
```

- Everything after `is` is _composed_. A kind may compose any number of
  kinds, or none, in which case `is` is left out: `kind Marker { }`.
- Composing is always written with `is`. `kind Crate: sprout.Container` is
  an error.
- A kind may hold objects in its body, and every instance of the kind gets
  its own copy of each: `kind Lantern is sprout.Container { object wick is
  Wick }` gives every lantern a wick.

### What a body may hold

A body is what lies between a declaration's braces. Kinds, objects and the
world all have one.

| member                                   | what it is                                                     | kind or object | world |
| ---------------------------------------- | -------------------------------------------------------------- | :------------: | :---: |
| `:lit false`                             | a property                                                     |      yes       |  yes  |
| `remembers { :visits 0 min 0 max 99 }`   | properties kept separately for each actor                      |      yes       |  yes  |
| `contains`, `contains actors`            | it holds things; `contains actors` holds people too            |      yes       |  yes  |
| `grammar { … }`                          | its name, article and nouns, and a place's exits and links     |      yes       |   —   |
| `describe { … }`                         | what someone looking at it reads                               |      yes       |   —   |
| `passage name { … }`                     | a named piece of writing                                       |      yes       |  yes  |
| `prose "file.prose"`                     | a file of passages belonging to this body                      |      yes       |  yes  |
| `depart`, `release`, `accept`            | guards on moving things (see [Consent](#11-moving-things-and-consent)) | yes    |  yes  |
| `as target for verb { … }`               | its part in a verb                                             |      yes       |  yes  |
| `on :message { … }`                      | a handler for a message                                        |      yes       |  yes  |
| `changed :prop (was) { … }`              | a hook, run when one of its own properties changes             |      yes       |  yes  |
| `pass :message (…)`, `pass any (…)`      | what messages and reach pass through it                        |      yes       |  yes  |
| `without … from Kind`                    | leaves out one member it would otherwise compose               |      yes       |  yes  |
| `object name is Kind`                    | an object inside it                                            |      yes       |  yes  |
| `visitors are`, `visitors arrive at`     | the visitor kind and the arrival place                         |       —        |  yes  |

### Containment

Whether a thing can hold others is declared, never assumed.

- `contains` means it can hold things.
- `contains actors` means it can hold people (and characters) as well. A
  thing that declares `contains actors` is a **place**.

The engine knows nothing else about containers. Capacity, lids and locks
are all ordinary Sprout, written in the standard library's
`sprout.Container`, `sprout.Actor` and `sprout.Lockable`, and you can
write your own.

---

## 5. Names

A name does three jobs in Sprout, and each has its own mechanism: an
_identifier_ names something in source; the `grammar` block says what a
visitor calls it; and the engine uses the grammar block again when it
writes about it.

### The grammar block

```sprout
object brass_key is Key {
  grammar {
    name    "brass key"
    article a
    nouns   "brass"
  }
}
```

| field     | if you leave it out                                                                             |
| --------- | ----------------------------------------------------------------------------------------------- |
| `name`    | the identifier, with `_` turned to spaces: `oak_door` is "oak door".                            |
| `nouns`   | the full name and its last word: "brass key" answers to `brass key` and `key`.                  |
| `adjectives` | the name's words before its last: "brass key" has `brass`.                                   |
| `article` | `a`, or `an` before a vowel. Write `the` for something unique, or `none` for a proper name.     |
| `pronouns` | none. Write `she`, `he`, `it` or `they` for the pronoun it is called by, under Pronouns below. |

- A `name` may not begin with `a`, `an` or `the`; that is what `article` is
  for.
- `nouns` are _added_ to the defaults. Several may go on one line, with or
  without commas: `nouns "cabinet", "type"`.
- `adjectives` are added to the defaults the same way. An adjective goes
  before a noun, `old brass key`, or names the thing on its own, `brass`,
  though only where nothing else is named better by a noun.
- Nouns and adjectives compose: a kind's and those of whatever is made of
  it all apply. `name`, `article` and `pronouns` do not; two sources for
  any of them is an error unless the object writes its own.
- Names are fixed. Nothing can rename itself while the world runs.

On input, articles are optional (`take the key` and `take key` are the
same), and so are `my`, `this` and `that`. On output, the engine always
uses the declared article — no "a key" first and "the key" after.

### Identifiers and scope

| declaration                   | visible in                                              |
| ----------------------------- | ------------------------------------------------------- |
| kinds, enums, verbs, messages | the whole world, and in the library that declares them  |
| objects                       | the body they are written in, and everything inside it  |
| properties and passages       | the kind or object that declares them                   |

An object's identifier belongs to the body it is written in and can be
seen from anywhere inside that body, however deep; the nearest one wins.
So two chests can each hold a `key`, and inside each chest `key` means its
own. Places written directly in the world's body are visible everywhere,
which is why most exits are one word.

Something further in than you can see is named by a **dotted path**, with
no spaces round the dots. The first step is a name you can see; each
next step is declared inside the one before: `bedroom.wardrobe`,
`composing_room.paper_store`. The world's own name may start a path from
anywhere: `printers_shop.lamp` is the lamp directly in the world, even
where something nearer is also called `lamp`.

If an object has the same identifier as one further out, it hides the
outer one inside itself, and the compiler warns you and tells you the path
to use for the outer one.

**Names in a kind's body.** A kind has no place in the world, so a bare
object name inside a kind's body is looked up when the code runs, from
wherever the instance running it is standing. Two lamps of one kind may
therefore reach different objects by the same name. The compiler still
refuses a name that no object in the world declares, and treats what such
a name reaches as the object type (see [Types](#the-types)), so you must
narrow it with `is()` before reading its properties.

### Nicknames

A visitor is known in a world by a nickname they choose on arrival,
which may be more than one word. It must not collide with anything the
world could read: no noun or word of a noun, no direction, article, or
word from any verb's phrases, no reserved word, nothing that looks like
source (a leading `:` or a `.` inside a word), and no other visitor's
nickname. The host checks this before admitting anyone, and a refusal
names the word that clashed. Nicknames are at most 24 characters by
default.

A nickname is per-world. It is the only thing about a person a world can
read.

---

## 6. Places, exits and links

### Places

There are no rooms as such. A **place** is any object that declares
`contains actors`. The standard library's `sprout.Place` is exactly that,
plus two passages:

```sprout
kind Place {
  contains actors
  passage arrives default { {item} arrives{if bound from} from {from}{/if}. }
  passage leaves  default { {item} leaves{if bound to} for {to}{/if}. }
}
```

An actor's **place** is the nearest thing around them that holds actors.
That is where `tell` reaches, what they leave when they go, and what
`look` describes.

When someone enters a place, every other visitor in reach of it reads the
`arrives` line, every other object there is sent `:arrived`, and the one
arriving reads the place's description. Leaving is the mirror: `leaves`,
and `:departed`. `arrives` is given `from`, the place they came from, and
`leaves` is given `to`, the place they went to; someone coming into the
world or leaving it has none. Both are given `way`, the label of the exit
they went through, when they went through one. A passage reads any of
these only inside `{if bound …}`, as the defaults do.

### Exits

An exit is a way out of a place: a direction, a label, and a destination.
Exits are written in the place's `grammar` block.

```sprout
grammar {
  exit out  "back to the yard"    -> yard
  exit down "down the coal stair" -> cellar
}
```

- The direction is one of `north`, `south`, `east`, `west`, `northeast`,
  `northwest`, `southeast`, `southwest`, `up`, `down`, `in` and `out`.
  Visitors may abbreviate the usual way (`n`, `sw`, `u`) and may leave out
  `go`.
- The label is what a client shows on a button, and a visitor may type it
  too: `back to the yard` works as well as `go out`.
- The destination is a place, by identifier or dotted path. An exit may
  only be written on a place, and may only lead to one.
- A place has at most 8 exits by default.

Exits are **not** composed. A kind's exits belong to objects directly made
of that kind, and not to kinds that compose it. Where an object writes an
exit in a direction its kind also has, the object's own replaces it. Exits
are tried in the order they are written.

### Conditional exits

An exit may have a `when` guard. Several exits may share a direction; the
first whose guard holds is the one that applies, and an exit without a
guard always holds. So a run of them reads like an `if … else` chain:

```sprout
grammar {
  exit north "deeper into the dark" -> maze_hall when (!self.get(:lamp_lit))
  exit north "toward a grey light"  -> meadow
}
```

An exit that does not apply is not offered, not usable, and not
mentioned. A `when` guard only reads: it cannot change anything or roll
dice.

### Places inside places

A place is an object, so it can be inside another place:

```sprout
object bedroom is sprout.Place {
  grammar { exit in "into the wardrobe" -> wardrobe }

  object wardrobe is sprout.Place, sprout.Container {
    grammar {
      article the
      exit out "back into the bedroom" -> bedroom
      exit in  "through the fur coats" -> narnia when (self.get(:snowing))
    }
  }
}
```

Everything follows from the rules already given. Shutting the wardrobe
cuts its occupants off from the bedroom, because a shut container passes
nothing. `tell` inside the wardrobe reaches only those in it. And someone
shut inside can always open it, because a thing can always reach the
container it is in.

### Links

An exit's destination is fixed in source. A **link** is a way out whose
destination is set while the world runs, for places that do not exist
until the world makes them.

```sprout
kind MazeCell is sprout.Place {
  :dug false

  grammar {
    name "turning of the maze"
    link onward "deeper into the dark"
    link back   "the way you came"
  }

  on :spawned (from) { connect back to from }

  as target for dig {
    permit { if (self.get(:dug)) { refuse "This wall is already broken through." } }
    do {
      self.set(:dug, true)
      let cell = spawn MazeCell in self
      connect onward to cell
      say "The stones give, and a gap opens into more dark."
    }
  }
}
```

- `link name "label"` declares a way out and leaves it unset. The name is
  a word of your own, not a direction; it exists only in source. Visitors
  take a link by typing its label.
- `connect name to binding` sets it. It writes only to the object running
  it, and the destination is always a binding — something bound while
  the code runs, like `from` or a `let` — never an identifier.
- An unset link, or one whose destination has been destroyed, simply does
  not apply.
- A link can be set but never read back. Nothing can follow a link except
  someone walking through it.
- Like exits, links are not composed.

---

## 7. Properties, types and values

### The types

| type    | written                          | values                                                       |
| ------- | -------------------------------- | ------------------------------------------------------------ |
| boolean | `boolean`                        | `true`, `false`                                              |
| integer | `integer`, with `min`/`max`      | whole numbers in range; −2,147,483,648 to 2,147,483,647 by default |
| string  | `string`                         | short text; set and compared, never joined                   |
| symbol  | an enum's name                   | one of that enum's options                                   |
| list    | `[T]`                            | an ordered collection of one type, without duplicates        |
| object  | never written                    | a thing in the world                                         |

There is **no null**. Every property has a default, and "nothing" is
written as an option you name yourself, `:glaze Glaze default none`, so the
compiler can check you have handled it.

There is **no object-valued property**. A property cannot point at
another object. Objects are reached through where they are, not stored.

The **object type** is the type of a binding whose kind the compiler
cannot know: an open role, a message's sender, a loop variable with no
kind filter. You can render it in a slot, compare it with `==`, and ask
`x.is(Kind)`, which narrows it (see [Narrowing](#narrowing-with-is)).
Nothing else.

### Declaring a property

```sprout
:lit      false                     // type from the literal
:lit      boolean default false     // the same, spelled out
:wear     0 min 0 max 99            // an integer with a range
:state    Drying default wet        // one of an enum's options
:ward     Ward.iron                 // the same form, qualified
:opens    [Ward] default [oak]      // a list
:note     string default ""
```

A property is a name, a type and a default. The type can be left out when
the default is a boolean, integer or string literal, or a qualified enum
option. A kind or object that composes a property may restate it to change
its default, and then the type is already known: `:ward iron`.

A property's name is its identity in storage. Renaming one in source
makes a new property with its default; the old value is dropped.

### Enums

```sprout
enum Ward  { oak, silver }
enum Glaze { none, shino, tenmoku, }
```

An enum is a named set of options, separated by commas (a trailing comma
is allowed). Enums are declared at the top level beside kinds and verbs.

An option can be written qualified, `Ward.oak` (or, for a library's enum,
with the library in front: `victorian.Tone.grave`), or
bare as a symbol, `:oak`, wherever the enum is already known from context:
a typed property, the other side of a comparison. Every option literal is
checked, so `== :slver` is an error listing the real options, not a
comparison that is quietly false forever.

Visitors type an option in its humanised form — `the_press` is typed "the
press" — and a slot renders it the same way.

### Lists

```sprout
kind Key {
  :opens [Ward] default [oak]
}

object skeleton_key is Key { :opens [oak, silver] }
```

A list holds values of one type, in the order they were added, with no
duplicates, up to 16 elements by default. Its operations are `includes(x)`,
`count`, `add` and `remove`:

- `self.add(:opens, silver)` does nothing if `silver` is already there;
  adding to a full list is a fault.
- `self.remove(:opens, iron)` does nothing if `iron` is not there.
- Two lists cannot be compared with `==`.
- A list can hold lists, `[[Ward]]`.

### Per-actor memory

A `remembers` block declares properties kept separately for each actor —
each visitor or character — rather than once for the object:

```sprout
remembers {
  :handled   false
  :ward_seen Ward default oak
  :visits    0 min 0 max 99
}
```

They are read with `x.recall(:p)`, written with `x.remember(:p, value)`,
and stepped with `x.adjust(:p, n)`, where `x` is any actor binding. Only
the object that declared the memory can use it:

```sprout
object composing_room is sprout.Place {
  remembers { :visits 0 min 0 max 99 }

  on :entered (item, from) {
    if (item.is(sprout.Actor)) { item.adjust(:visits, 1) }
  }

  describe {
    if (actor.recall(:visits) <= 1) { text first_sight }
    else                           { text familiar }
  }
}
```

The difference from a property matters. A property on a visitor is public:
anything nearby can read it. An object's memory of a visitor is private to
that object.

---

## 8. Expressions

### Operators

| operators                 | on                                   | gives   |
| ------------------------- | ------------------------------------ | ------- |
| `\|\|`, `&&`, `!`         | booleans                             | boolean |
| `==`, `!=`                | two values of the same type, not lists | boolean |
| `<`, `<=`, `>`, `>=`      | integers                             | boolean |
| `+`, `-`, unary `-`       | integers                             | integer |

Loosest first: `||`; `&&`; `==` `!=`; `<` `<=` `>` `>=`; `+` `-`; prefix `!`
and `-`; then reads like `x.get(:p)`. Left to right within a level.
Parentheses group.

There is no truthiness and no coercion: `if` wants a boolean, and `1 ==
"1"` is an error. A literal compared against something with a range must
be inside that range, since otherwise the answer is known in advance.

### Reading

| written                                | gives                                                           |
| -------------------------------------- | --------------------------------------------------------------- |
| `x.get(:p)`                            | the value of `x`'s property `:p`                                |
| `x.recall(:p)`                         | what `self` remembers about actor `x`                           |
| `x.count`                              | how many things container `x` holds, or the length of a list or set role |
| `x.count(Kind)`                        | how many of them are of a kind (containers and set roles)       |
| `x.holds(y)`                           | whether `y` is directly inside container `x`                    |
| `x.is(Kind)`                           | whether `x` is made of that kind                                |
| `x.includes(v)`                        | whether a list or set role holds `v`                            |
| `bound x`                              | whether an optional tool was filled (see [Optional tools](#optional-tools)) |
| `chance(n)`, `random(n)`               | dice (see [Chance](#17-chance))                                 |
| `elapsed`                              | seconds passed, in a tick or wake handler                       |

### Narrowing with `is()`

Inside `if (x.is(K)) { … }`, `x` is treated as a `K`, so `K`'s properties
can be read:

```sprout
if (tool.is(Key)) {
  if (!tool.get(:opens).includes(self.get(:ward))) { refuse "It goes in, and turns nothing." }
} else {
  refuse "{tool} is not a key."
}
```

This is the only way to read the properties of something of object type.
Matching is by composition, not by shape: `x.is(sprout.Container)` is true
for anything that composes `sprout.Container`, and false for something
that merely has an `:open` property.

### Identity

`==` on two object bindings asks whether they are the same object:
`if (p != self)`. Object bindings last only as long as the code that bound
them, so identity is available for a turn and never stored.

### `let`

`let` names the value of an expression for the rest of its block:

```sprout
permit {
  let ribs  = tools.count(Rib)
  let state = self.get(:state)
  if (ribs > 1)           { refuse "Two ribs at once is one rib too many." }
  else if (state == :wet) { refuse "Too wet to take a tool at all." }
}
```

A `let` is set once and never reassigned. It cannot reuse a name already
in scope. It is allowed wherever an expression is, including guards and
`describe`, but not in a passage. `let x = spawn …` is the one form whose
right-hand side is a statement, and it is allowed only where `spawn` is.

### Walking contents with `each`

```sprout
each pot: Vessel in self { send pot :fired }
each thing in cabinet    { … }        // thing has the object type
each tool of tools       { … }        // a set role
```

`each x in c` visits the things directly inside container `c`, in order.
A kind filter, `x: Vessel`, skips anything not made of that kind and types
`x` as it. `each x of r` walks a set role. Only things in range are
visited, so a shut chest walked from outside is empty. There is no `each`
over a list; use `{for … of}` in prose.

---

## 9. Bodies and statements

A _body_ is a block of statements. What a body may do depends on what
kind of body it is:

- **Guards** (`depart`, `release`, `accept`) and **`permit`** decide.
  They may read, and they may `refuse` or `allow`, but they may not change
  anything.
- **`do`**, **handlers** (`on :m`) and **hooks** (`changed :p`) act.
- **`describe`** gives words and nothing else.

| statement                  | what it does                                                         | guard | `permit` | `do` | `describe` | handler, hook |
| -------------------------- | -------------------------------------------------------------------- | :---: | :------: | :--: | :--------: | :-----------: |
| `if (c) { } else { }`      | runs a block when `c` holds; `else if` chains                        |  yes  |   yes    | yes  |    yes     |      yes      |
| `let x = e`                | names a value for the rest of the block                              |  yes  |   yes    | yes  |    yes     |      yes      |
| `each x in c { }`          | walks a container's contents                                         |  yes  |   yes    | yes  |    yes     |      yes      |
| `refuse "…"` / `refuse p`  | decides no, with text or a passage                                   |  yes  |   yes    |  —   |     —      |       —       |
| `allow`                    | decides yes                                                          |  yes  |   yes    |  —   |     —      |       —       |
| `text "…"` / `text p`      | gives a description its words                                        |   —   |    —     |  —   |    yes     |       —       |
| `say "…"`                  | speaks to the actor                                                  |   —   |    —     | yes  |     —      |       —       |
| `tell "…"`, `tell x "…"`   | speaks to others, or to one actor                                    |   —   |    —     | yes  |     —      |      yes      |
| `self.set(:p, v)` etc.     | writes one of `self`'s properties                                    |   —   |    —     | yes  |     —      |      yes      |
| `x.remember(:p, v)` etc.   | writes `self`'s memory of an actor                                   |   —   |    —     | yes  |     —      |      yes      |
| `send x :m`, `broadcast :m`| sends a message                                                      |   —   |    —     | yes  |     —      |      yes      |
| `move x to c`              | proposes a move                                                      |   —   |    —     | yes  |     —      |      yes      |
| `act verb (role: x)`       | performs a verb, for an actor                                        |   —   |    —     | yes  |     —      |      yes      |
| `spawn K in c`             | makes a new object                                                   |   —   |    —     | yes  |     —      |      yes      |
| `destroy self`             | removes this object when the body ends                               |   —   |    —     | yes  |     —      |      yes      |
| `finally destroy self`     | removes it once the turn's messages are all handled                  |   —   |    —     | yes  |     —      |      yes      |
| `connect l to x`           | sets one of its links                                                |   —   |    —     | yes  |     —      |      yes      |
| `wake in n minutes`        | asks to be woken later                                               |   —   |    —     | yes  |     —      |      yes      |

`say` also needs someone acting, so it is not allowed in a handler or
hook. (See [Prose](#14-prose).)

A guard or `permit` ends at its first `allow` or `refuse`; reaching the
end allows. There is no limit on the number of statements in a body.

### Writing

**Only an object writes its own state.** Every write goes to `self`:

| written                    | does                                                  |
| -------------------------- | ----------------------------------------------------- |
| `self.set(:p, v)`          | sets a property; `v` must fit its type and range      |
| `self.adjust(:p, n)`       | adds `n` to an integer, clamped to its range          |
| `self.add(:p, v)`          | adds a value to a list                                |
| `self.remove(:p, v)`       | removes a value from a list                           |
| `x.remember(:p, v)`        | sets what `self` remembers about actor `x`            |
| `x.adjust(:p, n)`          | adjusts what `self` remembers about actor `x`         |

`x.set(…)` for anything but `self` is an error. To change something
else, send it a message, or give it a part in a verb, and let it decide.
Setting a value out of range while the world runs is a fault; `adjust`
clamps instead.

---

## 10. Verbs

A **verb** says what can be typed. Objects say what part they play in it
and what happens. Neither reaches into the other.

### Declaring a verb

```sprout
verb unlock {
  role target: Lockable
  role tool

  "unlock [target] with [tool]"
  "use [tool] on [target]"
  "unlock [target]"
}
```

A verb names its **roles**, then its **phrases**.

- The first role is the **target**, the thing the verb is done to. Every
  other role is called a **tool**, whether it is a thing (`with the brass
  key`) or a value (`about the press`, `to 7`).
- A role may say what fills it: a kind (`role target: Lockable`), which
  both narrows what the parser accepts and types the binding; a value type
  (see [Value roles](#value-roles)); or nothing, in which case anything
  that plays the role can fill it, and it has the object type.
- Each phrase is text in quotes with `[role]` slots. Every phrase must name
  the target. Every phrase is tried, and the readings they make are ranked,
  under [What the parser says](#what-the-parser-says).
- A verb may have no roles, `verb look { "look" "l" }`, or no phrases, in
  which case nobody can type it and only a character can perform it with
  `act`.

Verbs are declared at the top level, by a world or a library. Up to 8
roles and 8 phrases per verb, each phrase up to 80 characters, by default.

### Synonyms

A **synonym** is another word for a verb. It takes every phrase that
writes the verb's name, with its own words in the name's place:

```sprout
verb open {
  role target: Container
  "open [target]"
  synonyms "unseal", "prise open"
}

world printers_shop is sprout.World {
  synonyms open: "jimmy"

  object cabinet is sprout.Container {
    synonyms open: "force"
  }
}
```

`"open [target]"` gives `"unseal [target]"`, `"prise open [target]"` and
`"jimmy [target]"`. A phrase that does not write the name, like `"use
[tool] on [target]"` for `unlock`, gives nothing. A name with an
underscore is written as its words, so `look_in` is written `look in`.

Synonyms come from three places, and only ever add phrases:

- a verb's own `synonyms` line holds everywhere the verb does;
- a world's `synonyms verb: …` holds throughout the world;
- an object's holds only when that object takes part in the command, so
  `force cabinet` opens the cabinet and `force chest` is not understood.

A kind's body holds no synonyms. A phrase a synonym gives may not repeat
one its verb already has, and is held to the phrase length limit.
Synonyms and the phrases they give don't count toward the 8 phrases. Every
word of every synonym is a word the world reads, so nobody can take it as
a nickname.

### Intents

An **intent** is a phrase that stands for several verbs, one after
another. It is declared beside verbs, at a file's top level:

```sprout
intent stow {
  "stow [x] in [y]"
  do take (target: x) then open (target: y) when (!y.get(:open)) then put (item: x, container: y)
}
```

Its phrases come first, in quotes, the canonical one first, and then one
`do` with its **steps** joined by `then`. The words in a phrase's
brackets are the intent's own **slots**, and each step gives each role of
its verb a slot: `take (target: x)`. A step's verb is named as any verb
is, so a library's verb is imported into the file first. A slot holds a
thing, never a value or a way out, and whatever the line names for it
must fit a role it fills in at least one step.

`stow coin in strongbox` then runs as `take coin`, `open strongbox` and
`put coin in strongbox`:

- Every step is planned before the line runs, against the world as the
  visitor typed into it. A step whose `when` is false, or whose role the
  slot's thing cannot fill, is left out without a word, so `stow` opens
  the strongbox only where it is shut.
- The steps that are left run in order, each its own turn, with its own
  dice and its own entry in the log. The host notes each step at info as
  it runs.
- A step that is refused, by a `permit` or by its own body refusing its
  actor, stops the rest; what ran before stays done.
- Where every step is left out, the visitor reads the world's
  `nothing_happens` passage.

A `when` reads the world and may not change it or roll the dice. It sees
`actor`, the one who typed, `here`, where they stand, and each slot, as
the kind of the role the step gives it. An intent's phrases count toward
the 8 phrases, and it has at most 8 steps, by default.

The standard library declares `open_with`: `open [y] with [x]` and `use
[x] to open [y]` unlock y with x where it is locked, then open it. A
world's intent of the same name replaces a library's.

### Playing a role

A kind or object takes part in a verb with `as <role> for <verb>`:

```sprout
kind Key {
  :wear 0 min 0 max 99

  as tool for unlock {
    permit { if (self.get(:wear) >= 99) { refuse "The bit is worn smooth. It turns nothing." } }
    do     { self.adjust(:wear, 1) }
  }
}
```

Inside, `self` is the one playing the role, `actor` is whoever is acting,
`here` is their place, and the verb's other roles are bound by name
(`target`, `tool`, …).

- **`permit`** decides whether it may happen. It is read-only. It may
  `refuse`, and the first refusal from anyone ends the whole command with
  those words as its only answer. A participant without a `permit`
  agrees.
- **`do`** is what happens. A participant without a `do` does nothing.

### The actor's own part

Every verb has one more participant than its roles: the one acting. An
actor's kind plays it with `as actor for <verb>`. This is how the
standard library writes `take`:

```sprout
verb take { role target  "take [target]"  "get [target]"  "pick up [target]" }

kind Actor {
  as actor for take {
    permit { if (self.holds(target)) { refuse "You already have it." } }
    do     { move target to self  say taken  tell takes }
  }
  passage taken default { You take {target}. }
  passage takes default { {actor} takes {target}. }
}
```

### How a command runs

A command the parser understands becomes a **reading**: a verb, an actor,
and each role filled. Running it takes two passes over the participants —
the actor first, then the roles in the order the verb declares them:

1. **The consent pass** runs every `permit`. The first refusal stops
   everything.
2. **The effect pass** runs every `do`, in the same order. Then any
   messages they sent are delivered.

Because the phrases only decide which object fills which role, `unlock the
cabinet with the brass key` and `use the brass key on the cabinet` do
exactly the same thing.

If a visitor's command runs and nobody `say`s, `tell`s or `refuse`s
anything to them, they read the world's `nothing_happens` passage
("Nothing much comes of that."). The compiler warns about any verb whose
participants never `say` anything.

When a role is several `as` members deep — a world's `Warded` composing
the library's `Lockable`, both playing `target for unlock` — every
`permit` runs and any may refuse, and every `do` runs.

### Set roles

A role marked `many` is filled by every object the visitor names, split on
`and` and commas:

```sprout
verb work {
  role target
  role tools many
  "work [target]"
  "work [target] with [tools]"
}
```

`work press with the wooden rib and the bone rib` binds both ribs. Each one
permits and acts for itself. Inside any participant, the whole set is
available by name: `tools.count`, `tools.count(Rib)`, `tools.includes(x)`,
and `each t of tools`. A phrase that leaves the set out binds it as empty.
A set holds up to 8 objects by default. The target may be a set role too:
`verb juggle { role balls many  "juggle [balls]" }`.

### Optional tools

A tool that some phrase leaves out is **optional**. `"unlock [target]"`
above leaves out `tool`, so a visitor may type `unlock door` with nothing
to unlock it with. Inside a body, an optional tool can only be used under
`if (bound tool)`:

```sprout
as target for unlock {
  permit {
    if (bound tool) {
      if (!tool.is(Key)) { refuse "{tool} is not a key." }
    } else {
      refuse "You need something to turn the lock with."
    }
  }
}
```

Reading an optional tool anywhere else is an error that names the phrase
that leaves it out. A verb with no phrases marks its optional tools
itself: `role tool optional`.

### Value roles

A role can be filled by a value the visitor names, rather than a thing:
`symbol` for an enum option, or `integer` for a number. There is no
string role; free text never enters a world.

```sprout
enum Topic { bridge, toll, weather }

verb ask {
  role target
  role topic: symbol
  "ask [target] about [topic]"
}

kind Guard is sprout.Actor {
  :knows [Topic] default [bridge, toll]

  as target for ask {
    topic from :knows
    do {
      if (bound topic) {
        if (topic == :toll) { say "Two coppers." } else { say "It holds." }
      } else {
        say "The guard has nothing to say about that."
      }
    }
  }
}
```

`symbol` says only that an option fills the role. Which options, the
role-player says with `from`, naming a list property: here the guard
understands exactly what is in its `:knows`, and `topic` is typed as a
`Topic`. Anything else the visitor types — `ask guard about potatoes` —
still matches the phrase and arrives with `topic` unbound. So a value
tool is always optional.

An `integer` role narrows the same way, with `from` naming an integer
property (whose range bounds it) or giving a range directly:

```sprout
verb turn { role target: Dial  role number: integer  "turn [target] to [number]" }

kind Dial {
  :setting 1 min 1 max 12
  as target for turn {
    number from 1 to 12
    do {
      if (bound number) { self.set(:setting, number)  say "The dial clicks round to {number}." }
      else              { say "The dial goes no further." }
    }
  }
}
```

A value role cannot be `many`. The options each object will accept are
part of what a client can show a visitor, which solves the old
text-adventure problem of guessing what to ask about.

### Acting: characters performing verbs

An object that composes `sprout.Actor` may perform a verb itself:

```sprout
act nuzzle (target: p)
```

`act` builds a reading with `self` as the actor and runs it on the spot,
consent pass and all, then carries on. Roles are named, so no phrase is
needed; an optional tool may be left out. A refused `act` ends the body it
is in. `act go` is not allowed: characters move with `move` (see below).

A character has nobody behind it, so its `say` lines are heard by the
people around as the character speaking, and if it says nothing, nothing
is shown. Otherwise every rule that governs a visitor governs a character.

### Engine verbs

Six verbs read the world rather than change it, so the engine answers
them itself. Their phrases are in the standard library like any verb's, so
you can add words or translate them.

| verb        | phrases                                         | answer                                                                |
| ----------- | ----------------------------------------------- | --------------------------------------------------------------------- |
| `go`        | `go [way]`, `[way]`, `walk [way]`               | moves the actor through an exit or link, then describes the new place |
| `look`      | `look`, `l`, `look around`                      | the actor's place's `describe`                                        |
| `examine`   | `examine [x]`, `x [x]`, `look at [x]`, `inspect [x]` | the thing's `describe`, or the world's `unremarkable`, then its `contents` |
| `inventory` | `inventory`, `i`, `inv`                         | the actor's `inventory` passage                                       |
| `wait`      | `wait`, `z`                                     | the world's `waited` passage ("Time passes.")                         |
| `help`      | `help`, `?`                                     | the world's `help` passage, listing everything the actor could type   |

A kind may play `as actor for go`; its `permit` can refuse the move and
its `do` runs after it.

After a thing's description, `examine` says the thing's own `contents`
passage where its kinds write one. `sprout.Container`'s lists what is
inside while it is open, "Inside: a shop key." or "It is empty.", and says
nothing while it is shut. A `contents` is held to a description's rules:
it may not use `chance`, `random` or `{one of}`. A line typed with a `?`
at the end is read without it, so `what is in the cabinet?` works; `?` on
its own still means `help`.

### What the parser says

Every phrase is tried against the whole line, its words wherever they
could fall, so a name that holds one, "the rope with a knot", still reads.
A name may be narrowed by what holds it: `the key in the cabinet`, `the
key on the shelf`, `the key that is in the cabinet` and `the one in the
cabinet` each name what stands directly in the cabinet or on the shelf.
A line may hold several commands, split at `.` or `then`: `take key then
open cabinet`, `take key. open cabinet`. Each runs as its own turn, in
order. A refusal, `unknown`, `not_here` or `cannot` stops the rest, and what
ran before stays done.

`again`, or `g`, runs your last command's reading again: the same verb
and the same things, even where its words would now mean something else.
Its `permit`s are asked afresh, and a thing no longer in reach is answered
with `not_here`. Before your first command there is nothing to do again,
and it is answered with `unknown`.

`all` fills a role with everything in reach it may take: `take all`, `put
all in the crate`. A role of a kind takes what is of that kind; a role
only the actor plays, as `take`'s target, takes every thing that is not a
person and not the place you stand in; another takes what plays a part in
the verb. `except` leaves things out, by name or by kind: `take all except
the brass key and the lamp`. A set role takes them all at once; any other
role runs once for each, as a line of several commands would, in the order
they are reached, and stops at the first refusal. No more are taken than a
set role may hold, 8 by default.

A pronoun, `it`, `them`, `him` or `her`, names what your own last command
was done to, where it is still in reach: `take lamp`, then `drop it`.
`him` and `her` name it only where it is a person or declares that
pronoun. A command that is about nothing, such as `look`, leaves them as
they were. A thing that declares its pronoun, `grammar { pronouns she }`,
is corrected when you call it by another, and the action goes ahead: `pet
it` reads "The cat is a she." first, through the world's
`pronoun_correction` passage. A thing that declares none is never
corrected. Each visitor's pronouns are their own, and are kept with them.

Every way the line reads is a **reading**: a verb and what fills each
role, or an intent and what fills each slot. An intent's reading asks no
`permit` of its own, so it counts as allowed; its steps ask theirs as
they run. The readings are ranked whole:

1. one whose `permit`s all allow beats one that is refused;
2. then the one that matched more of the line's words, where a name of
   adjectives alone matches none;
3. then the one whose things are nearer.

Readings still tied are drawn with the dice, and the host logs the draw
as a warning. Where the drawn reading names a thing its rivals did not,
the visitor is first told which, through the world's `meant` passage:
"(A wooden rib)". Things written exactly alike (same name, same article)
are drawn without it, since no word could tell them apart. The parser
never asks which you meant.

When a line cannot be run, the visitor reads one of the world's passages,
the first of these that fits:

| passage    | when                                                               |
| ---------- | ------------------------------------------------------------------ |
| `cannot`   | a phrase matches, and something in reach answers to a noun but cannot fill its role: "You can't put the key in the anvil." |
| `not_here` | a phrase matches but nothing in reach answers to the noun: "You see nothing like that here." |
| `unknown`  | no phrase matches: "That is not something you can do here."        |

`cannot`'s `reading` is the line as the world understood it, written as a
visitor would type it: the phrase's words, each thing by its name after
"the" (a proper name alone), a way out by its direction or label, and a
value as typed. Where it could be read in part more than one way, the one
that matched most of the line's words wins, then the one that filled most
roles; any still tied are drawn with the dice.

---

## 11. Moving things, and consent

Only an object writes its own state — but where things are is not any one
object's state. So when something moves, the engine asks everyone
concerned. This is the **consent protocol**.

### `move`

```sprout
move target to self
move item to cellar
move self to there
```

`move x to c` proposes moving `x` into container `c`. It is allowed in a
`do`, a handler or a hook. The engine then asks three guards, in order,
stopping at the first refusal:

```sprout
depart  (to)          // asked of the thing moving
release (item, to)    // asked of the container it is leaving
accept  (item, from)  // asked of the container it is entering
```

If one refuses, nothing moves, the refusal's text is said to the actor if
there is one, and the body that ran the `move` stops there. If all allow,
the thing moves.

A move that would put a container inside itself is refused before any
guard, with the world's `inside_itself` passage. A move that would bring
one more person into a full place (if the host limits it) is refused with
the world's `crowded` passage.

### Guards

```sprout
accept (item, from) {
  if (self.count >= self.get(:capacity)) { refuse "No room on the shelf." }
}
```

Inside a guard, `mover` is whatever proposed the move — the actor typing
`take`, or the object whose body ran `move` — with the object type. A
guard ends with `allow`, with `refuse "…"` (or `refuse passage_name`), or
by reaching its end, which allows. A guard nobody wrote allows.

Guards only read. They cannot change anything, send, move, speak (beyond
their refusal) or roll dice. That makes them safe to ask at any moment.

If an object is made of several kinds with guards, all of them run and any
refusal decides; the first refusal supplies the words.

### After the move

Once the move happens, the engine sends:

- `:left (item, to)` to the old container,
- `:entered (item, from)` to the new one,
- `:moved (from, to)` to the thing itself.

When the thing moved is an actor, both containers are places, and the
engine also has everyone else in reach of the old place read its `leaves`
passage and sends the other objects there `:departed (actor, to)`; does the
same with `arrives` and `:arrived (actor, from)` for the new place; and
shows the one who moved the new place's description.

### Characters moving

A character changes place with `move self to <place>`. It can only reach a
place that is the destination of an exit or link, from its own place, that
currently applies — the same ways a visitor could walk.

```sprout
kind Watchman is sprout.Actor {
  on :departed (actor, there) { move self to there }
}
```

---

## 12. Messages

Objects tell each other things with **messages**. A message is queued,
never called: the sending body runs to the end, then messages are
delivered, oldest first.

### Declaring

```sprout
message :stir
message :unlock_attempt
message :illuminating with boolean
```

A message is declared at the top level, with the type of the value it
carries if it carries one. Sending or handling an undeclared message is an
error; so a typo is caught rather than silently never arriving.

### Sending

```sprout
send oak_door :unlock_attempt          // to one object in range
send from :unlock_failed with 2        // to a bound object, with a value
broadcast :illuminating with true      // outward and inward through containment
```

A `send` to something out of range does nothing. A `broadcast` travels
through containment:

1. The sender's own contents always receive it.
2. The sender's container receives it if it passes that message, and
   delivers it on to its other contents (a container among them passes it
   in only if its own rule says so).
3. And so on outward, until a container refuses.

So a lamp broadcasting inside a shut cabinet lights nothing outside it,
and a room's broadcast stops at the world, which passes nothing unless you
say otherwise. Nothing receives a broadcast twice.

### Handlers

```sprout
on :illuminating (from, value) { self.set(:illuminated, value) }
on :fired (from)               { … }
on :gust                       { … }
on :pong (_, value)            { … }
```

A handler for your own message binds the sender (object type) and the
value (typed by the declaration); `_` skips one, and either may be left
off. A handler cannot `refuse`: it decides by acting or not acting. If the
sender needs an answer, the receiver sends one back.

The engine sends these messages itself:

| handler                          | when                                           |
| -------------------------------- | ---------------------------------------------- |
| `on :entered (item, from)`       | something came into this container             |
| `on :left (item, to)`            | something left this container                  |
| `on :moved (from, to)`           | this object was moved                          |
| `on :arrived (actor, from)`      | an actor arrived in this object's place        |
| `on :departed (actor, to)`       | an actor left this object's place              |
| `on :spawned (from)`             | this object was just made by a `spawn`         |
| `on :tick (elapsed)`             | a place's moment of ambience (see [Time](#16-time)) |
| `on :woke (elapsed)`             | a wake this object asked for has arrived       |

### Hooks

A hook runs when one of the object's own properties changes:

```sprout
changed :lit (was) {
  broadcast :illuminating with self.get(:lit)
}
```

It is queued each time `self.set` actually changes the value, with `was`
holding the value before. Setting a property twice queues it twice.

### Pass rules

A container decides what passes through it — for messages, for reach,
and for voices.

```sprout
kind GlassCase {
  contains
  pass :illuminating (true)
  pass any (false)
}
```

`pass :m (condition)` answers for one message; `pass any (condition)` for
everything else. A container with no pass rule passes everything, except
the world, which passes nothing. `sprout.Container` passes everything
while it is open, `pass any (self.get(:open))`, which is what makes a lid
mean something. `sprout.Actor` passes nothing, which is what makes a
pocket private. Pass rules only read, and cannot roll dice.

---

## 13. Range

**Range** is what an object can reach: what it may read with `get`,
`send` to, walk with `each`, and what a visitor's commands can name. One
definition serves all of them.

An object reaches a target when nothing strictly between them on the
containment tree refuses to pass. In practice:

- An object always reaches **itself and its own contents**. A shut chest
  can still count what is in it.
- It always reaches **the container it is in**, as a surface — so a
  visitor shut in a wardrobe can still open the wardrobe.
- It reaches further containers outward while each container in between
  passes, and their other contents while they pass too.

A visitor's range is therefore their own hands, then their place and what
is openly in it. A key in a shut chest cannot be named until the chest is
open. What another visitor carries is out of reach (actors pass nothing),
so you can name Marta but not the key in her pocket. Places are out of
each other's range, because the world passes nothing.

Range is walked nearest first: the asker and its contents, then its
container and that container's other contents, and so on outward. A
broadcast is delivered in that order.

Naming something out of range: a `send` does nothing, and a `get` is a
fault.

---

## 14. Prose

### Who hears what

| statement                     | reaches                                                    | allowed in                                           |
| ----------------------------- | ---------------------------------------------------------- | ---------------------------------------------------- |
| `text`                        | whoever is looking                                         | `describe`                                           |
| `say`                         | the actor                                                  | a `do`                                               |
| `tell`                        | everyone in the teller's place except the actor and the participants | a `do`, handler, hook                      |
| `tell x`                      | one actor, `x`                                             | the same                                             |
| `tell inside`, `tell outside` | only the teller's own occupants, or only the place around it | the same, in something that holds actors           |
| `refuse`                      | the actor, as the whole answer                             | a guard or `permit`                                  |

Each of these takes either quoted text or the name of a passage: `say
taken`, `refuse hands_full`, `text arrival`.

`tell` reaches every actor in the teller's place that the teller can
reach, except the actor and anyone taking part in the reading: those are
addressed separately, with `say` and `tell self`. So a verb usually has
two lines, one for the actor and one for everyone else, and a target who
is a person gets their own with `tell self`:

```sprout
as target for tag {
  do {
    self.set(:team, :it)
    say  "You tag {self}."
    tell self "{actor} tags you. You are It."
    tell "{actor} tags {self}."
  }
}
```

A thing inside a shut chest is heard by nothing outside it. `tell x` to
someone out of range, or to a character, goes nowhere.

**`actor` and `here`** are bound only where someone is acting: in a
`permit`, a `do`, a `describe` (where the actor is whoever is looking),
and passages those use. A handler, hook, tick or wake has no actor, so it
cannot `say`; it can `tell` the place, or `tell` an actor it has bound
(like `item` in `:entered`).

### Passages

A passage is a named piece of writing belonging to a kind or object.
Short ones go inline; long ones go in a `.prose` file the body points at:

```sprout
kind MagicMirror {
  prose "mirror.prose"
  :mood Mood default drowsy
  describe { text greeting }
}
```

```text
// mirror.prose
passage greeting {
  The glass is older than the frame, and older than the house. It holds
  the room a half-second behind, so you see your own shoulder settle
  after you have already stopped moving.

  {if self.get(:mood) == :drowsy}
  Nothing in it looks back with much interest.
  {else}
  Something in it is paying attention.
  {/if}
}
```

- Inside a passage, `self` is the object it belongs to, and it may use the
  bindings of the body that says it — `actor`, `here`, a role, an `each`
  variable. The compiler checks that every body that says a passage has
  the bindings it uses.
- Lines are joined into paragraphs; a blank line starts a new one. A
  block that renders nothing leaves no empty paragraph.
- The first letter of each rendered line is capitalised.
- A passage may be declared `default`, which means any other passage of
  the same name, from anywhere, replaces it. All of the standard library's
  lines are defaults.
- One body may have one `prose` line, and each `.prose` file belongs to
  one body.

Quoted text given to `say`, `tell`, `text` or `refuse` is a one-line
passage and may use slots too. Nothing else is: a `name`, a noun, an exit
label or a string property is plain text, and `{` in it is just a brace.

### Slots

| slot                      | renders                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `{thing}`                 | an object's article and name ("a brass key", "the press", "Marta"), or "you" to that object itself |
| `{self.get(:mood)}`       | an option, humanised: `bone_dry` is "bone dry"                            |
| `{self.count}`            | a number, as digits                                                       |
| `{actor.recall(:note)}`   | a string, as written                                                      |
| `{pot.greeting}`          | another object's passage, with that object as its `self`                  |

Booleans cannot go in a slot — use `{if}`. Nor can a bare list — use
`{for}`, so you decide the separators. `\{` writes a literal brace.

Because an object renders as "you" to itself, one line serves everyone:
`tell "{actor} tags {self}."` reads "Marta tags Ines." to the bystanders.

### Conditions and loops

```text
{if self.get(:wet)}
Rain still beads along the grain.
{else if self.get(:on_fire)}
Not merely dry. Burning.
{/if}

{for thing in self}{thing}{if $last}.{else}, {/if}{/for}
```

- `{if c}…{else if c}…{else}…{/if}`. Conditions have no parentheses. They
  may compare, narrow with `is()` and test identity, but not add.
- `{for x in c}` walks a container's contents; `{for x: Kind in c}` only
  those of a kind, typing `x`; `{for x of list}` walks a list or a set
  role. Inside, `$first` and `$last` are booleans, and `$index` (counting
  from 1) and `$count` are integers.
- `{one of}…{or}…{/one of}` picks one at random (see [Chance](#17-chance)).

There is no `while`, no arithmetic in slots, and no `let` in a passage,
so a passage always ends. Plurals are yours:
`{if self.count == 1}one pot{else}{self.count} pots{/if}`.

**A tip for listing a room's contents.** The person looking is in the
room too, so skip them with `{if thing != actor}`. But `$last` counts
them, so a comma-separated list may end with a comma if they happen to be
last. A sentence per thing avoids the problem:

```text
{for thing in self}{if thing != actor} There is {thing} here.{/if}{/for}
```

### `describe`

`describe` is what someone reads when they look at a thing, or at the
place they are in.

```sprout
describe {
  if (self.get(:lit)) { text "The lamp burns steadily." }
  else                { text "An unlit lamp." }
}
```

It may use `if`, `let`, `each` and `text`, and nothing that changes
anything or rolls dice: a description is re-read constantly, and must
not shimmer. A `describe` with no `text` in it at all is an error. One
whose `text` all renders to nothing reads the world's `unremarkable`
passage instead ("There is nothing special about the type cabinet.").
A thing has one voice, so two composed kinds that both `describe` is an
error; write the combined description yourself.

### When lines are rendered

A turn's lines are rendered after all its work is done, against the state
it leaves behind. So `say "{self.get(:count)} left"` followed by
`self.adjust(:count, -1)` says the count after the adjust.

---

## 15. Actors, visitors and characters

An **actor** is an object that can act: it has hands, a place, and can
perform verbs. Anything composing `sprout.Actor` is an actor. There are
two sorts:

- A **visitor** is an instance of the world's visitor kind with a person
  behind it. Nobody declares one: it is made when a person first arrives.
- A **character** (an NPC) is any other object composing `sprout.Actor`.
  It is declared like any object, has a name rather than a nickname, acts
  on messages, ticks and wakes rather than on typing, and reads nothing.

An actor can only be inside something that declares `contains actors`,
so every actor has a place.

### The visitor kind

```sprout
kind Visitor is Creature, sprout.Visitor { }
```

The visitor kind must be one of the world's own kinds and must compose
`sprout.Visitor`. Its own body may declare properties, `remembers`
blocks, passages, a grammar block and a `describe`, and may use `without`,
but it may not have handlers, hooks, guards, pass rules or verb roles —
a person acts by typing. Behaviour a person needs goes on a kind the
visitor kind composes, like `Creature` above.

Objects written in the visitor kind's body are given to each visitor on
their first arrival: that is how a world hands out a satchel.

### What `sprout.Actor` gives

- `contains`, with `:capacity 8`.
- `pass any (false)`: what an actor carries is private.
- `depart`: an actor only moves if it moved itself. Nobody can be carried
  off.
- `release`: only the actor can take things out of its hands. Nobody can
  pick a pocket.
- `accept`: things fit if there is room, so a gift arrives if the hands
  are free.
- The actor's part in `take`, `drop`, `put` and `give`, and the
  `inventory` passage.

### Visitors come and go

A visitor arrives at the world's arrival place, or on a later visit where
they last stood, if it still exists and lets them in. On leaving they take
what they carry and are out of the world — out of range of everything —
until they return. What the world wrote about them is kept for next time.

Everything the world stores about a visitor belongs to that world, keyed
to the visit. It is never shared with other worlds.

---

## 16. Time

A world can move without being poked, two ways.

### Ticks

Every so often, each place with a visitor in it is sent `:tick`. How
often is up to the host, so never count ticks; accumulate `elapsed`, the
seconds since this place's last tick (0 on its first):

```sprout
on :tick (elapsed) {
  self.adjust(:since_gust, elapsed)
  if (self.get(:since_gust) > 30) {
    self.set(:since_gust, 0)
    tell "The wind picks up in the eaves."
    broadcast :gust
  }
}
```

- Only places are ticked, and only while someone is in them. An `on
  :tick` on something that is not a place never runs, and the compiler
  says so.
- The tick reaches the place and no further. If the things in it should
  stir, the place sends or broadcasts to them.
- A tick that changes nothing visible should say nothing.

### Wakes

An object can ask to be woken later:

```sprout
wake in 3 hours
wake in 40 minutes
wake in 90 seconds
```

The unit is always plural (`wake in 1 hours`). When the time comes, the
object is sent `:woke`, with `elapsed` the seconds since it asked — which
may be more than it asked for, if the world was empty or busy. Use it:

```sprout
on :woke (elapsed) {
  if (elapsed >= 7200) { self.set(:state, :cured) }
  else {
    self.set(:state, :touch_dry)
    wake in 2 hours
  }
}
```

- The host sets the shortest possible wake (60 seconds by default); a
  shorter one is quietly lengthened.
- An object may have one wake pending at a time by default; asking for
  another is a fault.
- A wake is a turn of its own. It happens whether or not anyone is
  watching.

### While nobody is there

Whether wakes happen while a world is empty is the host's choice. If they
are held back, they are delivered when the next visitor arrives, before
that visitor is let in: one per object, oldest first, with `elapsed`
giving the true time since each was asked for. These catch-up wakes change
state, but **say nothing**: nobody was there to hear it, and the place's
description already shows the result.

`elapsed` is the only way a world can learn about time. There is no clock.

---

## 17. Chance

| written                          | gives                                  |
| -------------------------------- | -------------------------------------- |
| `chance(3)`                      | true one time in three                 |
| `random(6)`                      | a whole number from 0 to 5             |
| `{one of}…{or}…{/one of}`        | one of the blocks, in prose            |

The argument is always a positive whole-number literal.

Dice are only allowed where something is _done_: a `do`, a handler or a
hook, and passages they say. They are **not** allowed in `describe`, a
`when` guard, a consent guard, a `permit`, a pass rule, or the world's
`unseen` and `unremarkable` passages — nor in any passage those use.
Those are all asked repeatedly or as part of a decision, and a random
answer would flicker. If a description should vary, keep the variation
in a property that a tick or a `do` changes.

There is no "cycling" or "first time only" text. Keep a property or a
`remembers` entry instead: it says what you mean, and counts visits
rather than every time someone happens to look.

Every roll comes from a seed recorded with each turn, so a world replays
exactly. One line is rolled once, however many people read it, so
everyone in the room sees the same outcome. (`sprout play` starts at seed
0; `@seed` changes it.)

---

## 18. Spawning and destroying

### `spawn`

```sprout
spawn Cup in actor
let cell = spawn MazeCell in self
```

`spawn Kind in c` makes a new object of that kind, with its defaults and
its kinds' contents, inside `c`. No guard is asked. The container is sent
`:entered`, and the new object `:spawned (from)`. `let x = spawn …` names
it for the rest of the block.

A spawn into something out of range, or that does not hold things, or
does not hold actors when the kind is an actor, is a fault. A world may
spawn at most 8 things per turn by default, and the host caps how many
objects a world may hold in total.

A spawned object has no identifier. Visitors address it by its kind's
nouns, and where several alike answer, the nearest is meant. No new noun
ever appears at runtime: the world's whole vocabulary is known when it
compiles.

You cannot spawn a visitor or a world.

### `destroy self`

`destroy self` is the only form: an object can only remove itself. It
happens when the body that ran it ends (statements after it still run),
and takes everything the object holds with it. Anything pending for it is
dropped. Destroying something with a visitor anywhere inside is a fault.

`finally destroy self` waits instead until every message the turn has
sent has been delivered, so what the body sent still arrives:

```sprout
kind Match {
  as target for strike {
    do {
      say "The match flares, and the lamp takes the flame."
      send lamp :lit
      finally destroy self
    }
  }
}
```

Destroying is meant for spawned things. A declared object that is
destroyed is gone for good, so the compiler warns about `destroy self` on
one. There is no automatic clean-up: something that should not outlive its
use asks to be woken and destroys itself.

---

## 19. Composition in detail

Composition is Sprout's one way of reusing behaviour. There is no
inheritance chain and no `super`.

### How members combine

| member                               | from several sources                                 |
| ------------------------------------ | ---------------------------------------------------- |
| a property, a `remembers` entry      | error, unless the composer restates it               |
| `on :m` handler, `changed :p` hook   | all run                                              |
| `depart`, `release`, `accept`        | all run; any refusal decides                         |
| `as <role> for <verb>`               | every `permit` runs, any refusal decides; every `do` runs |
| `nouns`, `adjectives`                | all apply                                            |
| `name`, `article`, `pronouns`       | error                                                |
| `contains`, `contains actors`        | the same either way                                  |
| `pass :m`, `pass any`                | error                                                |
| a passage                            | error, unless all but one are `default`              |
| `describe`                           | error                                                |
| `exit`, `link`                       | not composed at all                                  |

The rules behind the table:

1. A kind reached twice through different paths contributes once.
   Composition is walked depth-first, left to right.
2. Where every contribution runs, they run in the order their sources
   appear in the `is` list, and the composer's own last. Order changes
   what order things are said in, never what happens.
3. Where only one can apply, two sources is an error naming both. The
   composer settles it by writing its own, which always wins.

### Properties merge; they never shadow

Properties are one flat map per object; libraries do not namespace them.
Two kinds from different sources both declaring `:open` is an error, even
if the declarations are identical — a futon's "unfolded" and a chest's
"lid off" are different ideas. The composing kind resolves it by restating
the property, which says "these are meant to be one":

```sprout
kind Crate is sprout.Container {
  :capacity 40
}
```

Restating keeps the type and may change the default. Changing the type is
an error. A kind that itself composes the property's origin may restate it
and win quietly: `kind Visitor is Creature, sprout.Visitor { }` takes
`Creature`'s `:capacity` over `sprout.Actor`'s.

### `default` passages

A passage marked `default` gives way to any passage of the same name from
another source. Two defaults of one name collide, except that a standard
library default gives way to another library's. This is what lets you
replace any stock line by writing a passage of the same name, and lets a
library supply a whole world's stock lines in another voice.

### `without`

A kind may drop one member it would compose, naming the member and where
it comes from:

```sprout
kind SafetyLamp is sprout.LightSource {
  without changed :lit from sprout.LightSource
}
```

What a kind leaves out stays out for everything that composes it — unless
the same member also arrives by another route.

### Splitting work between a library and a world

A library cannot know a world's enums. So the library carries the
behaviour and the world supplies the vocabulary, each half playing the
same verb role:

```sprout
// in the library
kind Lockable {
  :locked true
  as target for unlock {
    permit { if (!self.get(:locked)) { refuse "It is already unlocked." } }
    do     { self.set(:locked, false) }
  }
}

// in the world
kind Warded is sprout.Lockable {
  :ward Ward default brass
  as target for unlock {
    permit {
      if (tool.is(Key)) {
        if (!tool.get(:opens).includes(self.get(:ward))) { refuse "It goes in, and turns nothing." }
      } else { refuse "{tool} is not a key." }
    }
  }
}
```

Both `permit`s run and either can refuse; both `do`s run.

### Namespaces

A kind's identity is its library and its name: `sprout.Container` and
`ericworld.Container` are different kinds. A world's own declaration that
takes a standard library name hides the bare form, with a warning, and the
qualified `sprout.` name still reaches the library's. A world verb that
hides a library verb replaces it entirely: the library verb's phrases stop
working, and only the phrases you write are understood.

---

## 20. The standard library

The standard library, `sprout`, is written in Sprout. Nothing in it is
special to the engine: you could write it yourself, and you can replace
any of its lines. `sprout skill` prints its full source.

### Kinds

| kind              | is                                                                               |
| ----------------- | -------------------------------------------------------------------------------- |
| `sprout.World`    | what every world composes; holds the engine's own lines (below)                  |
| `sprout.Place`    | `contains actors`; the `arrives` and `leaves` passages                           |
| `sprout.Actor`    | hands (`:capacity 8`), a private pocket, the guards that protect a person, and `take`, `drop`, `put`, `give` |
| `sprout.Visitor`  | a person: `sprout.Actor`, marked as having someone behind it                     |
| `sprout.Fixture`  | cannot be picked up; says `immovable`                                            |
| `sprout.Container`| `:open true`, `:capacity 8`; passes things while open; plays `open` and `close`  |
| `sprout.Lockable` | `:locked true`; plays `unlock`, and refuses `open` while locked                  |

### Verbs

| verb     | roles                              | phrases                                                     |
| -------- | ---------------------------------- | ----------------------------------------------------------- |
| `take`   | `target`                           | `take [target]`, `get [target]`, `pick up [target]`, `grab [target]` |
| `drop`   | `target`                           | `drop [target]`, `put down [target]`                        |
| `put`    | `item`, `container: Container`     | `put [item] in [container]`, `put [item] into [container]`  |
| `give`   | `item`, `recipient: Actor`         | `give [item] to [recipient]`, `hand [item] to [recipient]`  |
| `open`   | `target: Container`                | `open [target]`                                             |
| `close`  | `target: Container`                | `close [target]`, `shut [target]`                           |
| `look_in` | `target: Container`               | `look in [target]`, `look inside [target]`, `what is in [target]` |
| `unlock` | `target: Lockable`, `tool`         | `unlock [target] with [tool]`, `use [tool] on [target]`     |
| `ask`    | `target`, `topic: symbol`          | `ask [target] about [topic]`, `ask [target] [topic]`        |

Plus the six engine verbs, above. The standard library plays no part in
`ask`: a world's own kinds answer it. It declares one intent, `open_with`,
under Intents above.

### The world's lines

These are `default` passages on `sprout.World`. Write a passage of the
same name in your world's body to replace one.

Every line the engine says, these and a place's `arrives` and `leaves`
and an actor's `inventory`, is looked for first on the one it is about
(whoever is acting, looking, moving or leaving), then on the place they
stand in (for `leaves`, the place they left), then on the world. The first
passage found that is not `default` is said; the standard library's are
all `default`, so they are said only when nothing nearer words the line.
So a character can have its own `arrives`, and a place its own
`not_here`.

| passage           | default words                                                       |
| ----------------- | ------------------------------------------------------------------- |
| `unknown`         | That is not something you can do here.                              |
| `not_here`        | You see nothing like that here.                                     |
| `cannot`          | You can't {reading}.                                                |
| `meant`           | ({thing})                                                           |
| `pronoun_correction` | {thing} is a {pronoun}.                                          |
| `nothing_happens` | Nothing much comes of that.                                         |
| `unremarkable`    | There is nothing special about {thing}.                             |
| `unseen`          | Something here is too much to take in.                              |
| `fault`           | Something in this world has gone wrong, and nothing has changed.    |
| `missing`         | This world uses something this host does not provide, and will be missing some of itself. |
| `displaced`       | The place you were standing is gone.                                |
| `inside_itself`   | {item} cannot go inside itself.                                     |
| `crowded`         | There is no room in {to} for {item}.                                |
| `waited`          | Time passes.                                                        |
| `help`            | You can type: …                                                     |
| `acted`           | {actor} tries to {reading}.                                         |
| `gone_away`       | You leave, and take what you carry with you.                        |
| `npc_says`        | {actor} says "{words}"                                              |

`gone_away` is what someone leaving the world is told. `npc_says` frames
what a character says: `words` is their line, its paragraphs as one.

### The actor's and container's lines

`sprout.Actor`: `taken`, `takes`, `dropped`, `drops`, `put_in`, `puts_in`,
`given`, `received`, `gives`, `not_carried`, `not_held`, `held_fast`,
`not_yours`, `hands_full`, `inventory`. `sprout.Container`: `contents`,
`shut`, `full`, `opened` (which includes `contents`), `opens`, `closed`,
`closes`. `sprout.Lockable`:
`unlocked`, `unlocks`. `sprout.Fixture`: `immovable`. `sprout.Place`:
`arrives`, `leaves`.

To make taking things say "Got it." in your world, write on your visitor
kind:

```sprout
kind Person is sprout.Visitor {
  passage taken { Got it. }
}
```

---

## 21. What the compiler checks

`sprout check` compiles a world exactly as publishing it would, and
refuses it on any problem. Every problem names the file, line and column
of the token it is about, says what is wrong in plain words, and says what
to write instead:

```text
vessel.sprout:5:38  `State` has no option `dyr`. Did you mean `dry`?
                    Options: raw, leather, dry.

cat.sprout:4:14  `say` has nobody to speak to inside `on :stir`.
                 Use `tell` to speak to the room, or `tell p` to one person.
```

### It refuses

- A write to anything but `self`.
- Changing anything, speaking, or rolling dice in a guard or `permit`;
  anything but `text` in `describe`.
- `say`, `actor` or `here` where nobody is acting.
- Dice where they are not allowed (see [Chance](#17-chance)).
- Type errors: comparing different types, an option that is not in its
  enum, a literal outside a range, arithmetic on non-integers, a
  non-boolean condition, `get` on the object type, setting a literal out of
  range.
- Two sources for a property or an exclusive member.
- Reserved names, a `name` beginning with an article, composing with `:`.
- A world that does not compose `sprout.World`; anything else that does;
  no world, two worlds, or a world not named as in the manifest.
- A `describe` with no `text`.
- `act` by something that is not an actor, or leaving out a required tool.
- A visitor kind that does not compose `sprout.Visitor` or is not the
  world's own.
- `optional` where phrases already decide; a phrase without the target.
- Reading an optional tool outside `if (bound …)`; `many` on a value role.
- Anything unknown: a kind, enum, verb, message, property, passage, exit
  destination or extension.
- A `move` into something that is not a container; an exit on something
  that is not a place, or to something that does not hold actors.
- Objects in the wrong place: outside the world, inside something that
  holds nothing, an actor where actors cannot be, two of one name in one
  body.
- A name another file or a library declares, used without importing it.
- Any static cap exceeded (see [Limits](#22-limits)).

### It warns about

A warning never stops a world, but is usually a mistake:

- a handler nothing sends to, or a message nothing handles;
- a declaration hiding a standard library name;
- an object hiding one of the same name further out;
- a verb nothing plays a part in, or a role nothing can fill;
- a verb nobody ever `say`s anything for (it will answer
  `nothing_happens`);
- a passage nothing uses, which is usually a misspelled replacement
  (it suggests the name you probably meant);
- `contains` written twice;
- a statement after `allow` or `refuse`, which never runs;
- an exit whose `when` is `false`;
- `destroy self` on a declared object;
- a `.prose` file nothing points at;
- `on :tick` on something that is not a place;
- a `wake` nothing answers, or an `on :woke` nothing asks for;
- a `{one of}` with only one choice.

### Publishing and loading

Checking and publishing are **strict**: any problem refuses the world.
Loading a world that is already running is **lenient**: a file that is
missing, withheld by a moderator, or does not parse is treated as
_absent_, and the rest of the world keeps running around the gap.

| when this is absent…                  | …this happens                                                      |
| ------------------------------------- | ------------------------------------------------------------------ |
| a kind an object is made of           | the object is absent: out of range, unlisted, unnameable            |
| a kind a role needs                   | nothing fills the role; the verb's phrases do not match             |
| a kind a `spawn` makes                | the `spawn` faults                                                  |
| a verb                                | its phrases do not parse; `act` of it does nothing                  |
| a message                             | sends of it go nowhere                                              |
| a passage or `.prose` file            | it renders nothing                                                  |
| an exit's or link's destination       | the exit does not apply                                             |
| the place a visitor is standing in    | they are moved to the arrival place and told `displaced`            |
| the arrival place, world or visitor kind | nobody is admitted                                               |

Stored state for absent objects is kept, so restoring a file brings them
back as they were.

---

## 22. Limits

Two kinds of limit keep a world safe to host. All the numbers are the
host's to set; these are the defaults `sprout` runs with.

**Caps** bound what someone must read to understand a world. They are
checked when the world compiles, and exceeding one refuses it.

| cap                                         | default |
| ------------------------------------------- | ------- |
| options in one enum                         | 100     |
| roles in one verb (a set role counts once)  | 8       |
| phrases in one verb or intent               | 8       |
| steps in one intent                         | 8       |
| characters in one phrase                    | 80      |
| nouns on one object                         | 8       |
| characters in one noun word                 | 40      |
| exits on one place                          | 8       |
| elements in one list                        | 16      |
| characters in a quoted `say`, `tell`, `text` or `refuse` | 600 |
| places, objects, kinds, files, source bytes | unlimited unless the host sets them |

Passages have no length cap. The standard library costs nothing against
these caps.

**Budgets** bound what a single turn may cost. Running out is a _fault_:
the turn is abandoned, the world is left exactly as it was, and the actor
reads the world's `fault` passage.

| budget                                      | default         |
| ------------------------------------------- | --------------- |
| steps per turn (every statement, expression, loop iteration, object reached, noun tried) | 50,000 |
| steps per poll (building a visitor's view)  | 10,000          |
| characters of output per turn, per reader   | 8,000           |
| deliveries that run a handler or hook, per turn (one however many handlers run) | 256 |
| depth of messages causing messages          | 20              |
| depth of passages using passages            | 8               |
| objects in one set role                     | 8               |
| spawns per turn                             | 8               |
| shortest wake                               | 60 seconds      |
| wakes pending per object                    | 1               |
| characters in a nickname                    | 24              |
| people in one place                         | unlimited unless the host sets it |

The step budget is the one that matters. An `each` inside an `each` over a
big room can do a lot of work; the step budget is what stops it.

If a `tell` would push a bystander past their output budget, they are
simply cut off for the rest of the turn; only the actor's own output can
fault a turn. A crowd can make a turn more expensive for the host, but
never makes it fail for the person acting.

---

## 23. How a world runs

### Turns

Everything that happens is a **turn**:

| turn        | caused by                             | may change the world |
| ----------- | ------------------------------------- | :------------------: |
| command     | a visitor typing                      | yes                  |
| tick        | the host, for an occupied place       | yes                  |
| wake        | a wake falling due                    | yes                  |
| maintenance | catching up on wakes before an arrival | yes                 |
| poll        | a client asking what a visitor sees   | no                   |

Arriving and leaving are turns too. Turns that change the world run one at
a time, each all-or-nothing: a fault abandons the whole turn.

Within a command turn the order is always the same: parse the line; the
consent pass; the effect pass (actor first, then roles in order); deliver
queued messages, breadth-first, oldest first, including any readings an
`act` starts; then render what was said.

### A visitor's view

A **poll** builds what a visitor sees: their place's description, the
ways out that apply, who else is there, what they carry, and every command
they could type right now, each with whether it would be refused and why.
That is what a client's buttons are made from, and what `sprout view`
prints. A poll changes nothing and rolls no dice.

### Effects

A turn's output is a sequence of **effects**, each for one reader:

| effect      | from                                               |
| ----------- | -------------------------------------------------- |
| `said`      | `say`                                              |
| `told`      | `tell`                                             |
| `refused`   | a refusal in the consent pass                      |
| `described` | a description, on arriving, moving or looking      |
| `notice`    | the engine's own lines: arrivals, faults, unknown words |
| `extension` | an extension's effect, with a text fallback        |

These are the labels `sprout play` shows. A client can use them to decide
how to present a line; a screen reader, for instance, interrupts for a
refusal.

### Faults

A **fault** is something going wrong while a turn runs: a budget
exhausted, a `get` on something out of range, a value out of range. The
turn is abandoned, and the world is exactly as it was before it.

| what faulted  | what happens                                                   |
| ------------- | -------------------------------------------------------------- |
| a command     | the actor reads the world's `fault` passage                    |
| an arrival    | the visitor is not admitted                                    |
| a departure   | the visitor leaves quietly                                     |
| a tick        | it is dropped                                                  |
| a wake        | it is used up; the object is not woken again unless it asks    |
| a poll        | the description is the world's `unseen` passage                |

### Replay

Every turn that changes the world is logged with its inputs and its seed,
and a world's state is determined entirely by its source and that log. So
a host can replay what happened exactly, which is how problems get
investigated and worlds moderated.

---

## 24. Extensions

An **extension** adds something Sprout cannot say itself — for example,
showing a picture. Unlike a library, an extension is code installed by
the host, and a world can only use the extensions a host has chosen to
install.

A world names each extension it uses in its manifest, with a major
version, and at the top of each file that uses it:

```sprout
extension media 2
```

Then it may use the extension's types and statements, which begin with
its name: `media.show(self.get(:image), "a cat")`, type `media.Image`.

An extension statement only _records_ an effect; it never does anything
to the world. A world must still read correctly with every effect
dropped, so each effect comes with a line of text for clients that cannot
show it, and a `describe` must always have a `text`.

If a host does not have an extension a world uses, the world still runs:
the extension's statements record nothing, and each arriving visitor is
told the world will be missing some of itself.

The `sprout` command line installs no extensions, so `sprout check`
refuses a world that pins one.

---

## 25. The command line

```text
sprout init [dir] [--author name]
sprout check [dir] [--json]
sprout parse [dir]
sprout parse dir "line" [--at place] [--as name]
sprout view [dir] [--at place] [--as name]
sprout play dir [script] [--at place] [--as name]
sprout test [dir] [script ...]
sprout skill
```

Every command runs the world as it loads, under the default limits, with
no clock and no extensions.

| command        | does                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `init`         | makes a folder with a manifest, a world, a visitor kind and a first test. The folder must be empty or new.                |
| `check`        | compiles strictly and prints every problem and warning. `--json` for editors. Exits 1 on any problem.                     |
| `parse`        | with no line: every phrase the world accepts. With a line: how a visitor would read it, and whether it would be refused, without running it. |
| `view`         | what a visitor is shown and could type.                                                                                   |
| `play`         | plays a script and prints it back filled in (`--write` saves it), or with no script (or `-`) plays interactively (`--debug`, `--record file.json`). |
| `test`         | runs every `.json` in the world's `tests/` folder, or the scripts named. Exits 1 on any failure.                          |
| `skill`        | prints the builder's reference, generated from the compiler, as a skill for an AI assistant: `sprout skill > .claude/skills/sprout/SKILL.md`. |

`--as name` sets the visitor's nickname (default `Inspector`). `--at
place` brings them in at that place, written as the world's body names it
(`composing_room.paper_store`), as a returning visitor would come back —
so the place's `accept` is still asked.

### Scripts

`play` and `test` read the same script, a JSON file of _steps_:

```json
{
  "about": "What this script is for.",
  "steps": [
    { "arrive": "Marta" },
    { "as": "Marta", "type": "brew teapot", "expect": [
      { "reader": "Marta", "kind": "said", "words": "You warm the pot, spoon in the leaves and pour. It smells like rain." }
    ] }
  ]
}
```

| step                                      | means                                                           |
| ----------------------------------------- | --------------------------------------------------------------- |
| `{ "as": "Marta", "type": "take key" }`   | Marta types `take key`                                          |
| `{ "arrive": "Marta" }`                   | Marta arrives                                                   |
| `{ "leave": "Marta" }`                    | Marta leaves                                                    |
| `{ "tick": true }`                        | every occupied place gets a tick                                |
| `{ "advance": "40 minutes" }`             | time moves on; due wakes happen (`seconds`, `minutes`, `hours`) |
| `{ "seed": 7 }`                           | the dice use seed 7 from now on                                 |
| `{ "comment": "…" }`                      | a note, kept as written                                         |

Any step but `seed` and `comment` may carry `expect`, the lines it should
make:

| expected line                                            | matches                                       |
| -------------------------------------------------------- | --------------------------------------------- |
| `{ "reader": "Ben", "kind": "told", "words": "…" }`      | that reader reading those words, as that kind |
| `{ "words": "…" }`                                       | anyone reading those words                    |
| `{ "level": "info", "text": "…" }`                       | a note of the host's, such as a wake delivered |
| `{ "level": "error", "text": "…" }`                      | a fault                                       |
| `{ "level": "warning", "text": "…" }`                    | someone's lines cut short past their output   |
| `{ "level": "prose", "text": "…" }`                      | the host's words to someone kept at the door  |

`"expect": []` means the step makes nothing at all.

`play` prints the script back with every step expecting everything it
made, and `--write` saves that over the file, so a played script is its
own golden. Time starts at 0 and the seed at 0. Wakes are delivered as
time advances while someone is in the world; while nobody is, they wait
for the next arrival.

Interactively, you type the same steps written short: `Marta> take key`,
`@arrive Marta`, `@leave Marta`, `@tick`, `@advance 40 minutes`,
`@seed 7`, and `#` for a comment. A line with no `Name>` goes to whoever
arrived most recently and is still there. Ctrl-D ends the session, and
whoever is still standing leaves. `--record file.json` writes the session
as a script.

### Tests

A test is a script whose steps expect what the world should say:

- Expected lines must appear among what the step made, in the order
  written; other lines may come between.
- A step with no `expect` is played but not checked — but if its turn
  faults, the test fails unless the fault is expected.
- A test that expects nothing anywhere fails, since it tests nothing.
- Every test starts from a freshly loaded world, at time 0 and seed 0.

When the world is right and a test is wrong, `sprout play` the test file
and keep what the world says now.
