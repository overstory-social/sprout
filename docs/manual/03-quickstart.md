# Quickstart: your first world

In this chapter you will build a small tea shop: a front room, a kitchen
behind a bead curtain, a teapot you can brew in, and a pot of tea that
goes cold if you leave it. Along the way you will meet most of what you
need to write worlds of your own.

You will need Sprout set up as described in
[Playing Sprout](02-playing.md#setting-up). The finished world is in this
repository at `corpus/good/teashop`, if you want to compare notes.

## 1. Make a new world

```sh
sprout init teashop --author "Your Name"
```

This makes a folder called `teashop` with everything a world needs:

```text
teashop/
  sprout.json         the manifest: the world's name, author, and list of files
  teashop.sprout      the world itself
  person.sprout       what a visitor is
  tests/arrival.json  a first test
  README.md
```

Open `teashop.sprout`:

```sprout
import * as sprout from 'sprout'
import {Person} from 'person'

world teashop is sprout.World {
  visitors are Person
  visitors arrive at hall

  object hall is sprout.Place
}
```

Line by line:

- `import * as sprout from 'sprout'` — brings in the _standard library_
  that comes with Sprout, so this file can write `sprout.World` and
  `sprout.Place`. A file uses only what it imports.
- `import {Person} from 'person'` — brings in `Person` from
  `person.sprout`.
- `world teashop is sprout.World` — this is the world, and it is built on
  `sprout.World`, which comes with Sprout and supplies the stock phrases
  like "You see nothing like that here." Everything in the world goes
  between its braces.
- `visitors are Person` — visitors are made of the kind `Person`, which is
  in `person.sprout`.
- `visitors arrive at hall` — where new visitors appear.
- `object hall is sprout.Place` — one object, called `hall`, which is a
  place: something people can stand in.

Check it and walk in:

```sh
sprout check teashop
sprout play teashop
```

```text
Inspector> look
There is nothing special about a hall.
```

It works, but it is not much of a tea shop. Press Ctrl-D to leave.

## 2. Describe the front room

Keep the two `import` lines at the top, and replace the world below them
with this:

```sprout
world teashop is sprout.World {
  visitors are Person
  visitors arrive at front_room

  object front_room is sprout.Place {
    grammar {
      name    "front room"
      article the
    }

    describe {
      text "Six small tables, a bell over the door, and the smell of bergamot."
    }
  }
}
```

What changed:

- The place is now called `front_room`. That is its _identifier_, the name
  you use for it in your source. Identifiers are lower case, with `_`
  between words.
- The `grammar` block says what visitors call it. `name "front room"` is
  how it is written in sentences, and `article the` makes it "the front
  room" rather than "a front room". (Without a `name`, Sprout makes one
  from the identifier, turning `_` into spaces.)
- `describe` is what a visitor reads when they arrive or type `look`.
  `text` gives it its words.

Run `sprout check teashop` again. Then run the test that `init` wrote:

```sh
sprout test teashop
```

```text
arrival.json: failed
  step 1, `@arrive Marta`, the world did not say:
    There is nothing special about a hall.
  it said:
    Marta (described): Six small tables, a bell over the door, and the smell of bergamot.

Where the world is right and a test is not, `sprout play` prints the script with what the world says now filled in.
1 test: 0 passed, 1 failed
```

The test still expects the old hall. That is the point of a test: it
notices when the world says something different. Here the world is right
and the test is out of date, so open `tests/arrival.json` and update it:

```json
{
  "about": "The first thing a visitor reads.",
  "steps": [
    { "arrive": "Marta", "expect": [
      { "words": "Six small tables, a bell over the door, and the smell of bergamot." }
    ] }
  ]
}
```

Now `sprout test teashop` passes. There is more on tests in step 8.

## 3. Add a kitchen

A place links to another through an _exit_: a direction, a description of
the way, and where it goes. Exits live in the `grammar` block. Add an exit
to the front room, and a second place after it:

```sprout
world teashop is sprout.World {
  visitors are Person
  visitors arrive at front_room

  object front_room is sprout.Place {
    grammar {
      name    "front room"
      article the
      exit north "through the bead curtain" -> kitchen
    }

    describe {
      text "Six small tables, a bell over the door, and the smell of bergamot."
    }
  }

  object kitchen is sprout.Place {
    grammar {
      article the
      exit south "back to the front room" -> front_room
    }

    describe { text "A narrow kitchen, all steam and copper." }
  }
}
```

Exits go one way, so the kitchen needs its own exit back. Now a visitor
can type `north`, `n`, `go north`, or the exit's own words, `through the
bead curtain`.

## 4. Put some things in the rooms

An object sitting inside something is written inside that thing's braces.
Your source has the same shape as the world: the world holds the rooms,
and each room holds its things.

Add a counter to the front room, after its `describe`:

```sprout
    object counter is sprout.Fixture {
      grammar { article the }
      describe { text "Zinc-topped and cold to the touch." }
      passage immovable { The counter is bolted to the floor. }
    }
```

`sprout.Fixture` is a kind that comes with Sprout. It stops visitors
picking a thing up, and says "The counter is not something you can pick
up." when they try. That line is a _passage_ called `immovable`, and by
writing a passage of the same name you replace it with your own words.

Things can be picked up unless they say otherwise. Add a tea caddy with a
spoon in it to the kitchen, after its `describe`:

```sprout
    object caddy is sprout.Container {
      grammar { name "tea caddy" nouns "tin" }
      :open false
      object spoon is Spoon
    }
```

- `sprout.Container` is a thing that holds other things and can be opened
  and closed. It has a _property_, `:open`, which is normally `true`.
  Writing `:open false` here makes this caddy start closed.
- `nouns "tin"` lets visitors call it "tin" as well as "tea caddy" and
  "caddy". (Sprout adds the last word of a name on its own.)
- The spoon is made of `Spoon`, which does not exist yet.

Every object is made of one or more _kinds_: a kind says what a sort of
thing is and does. A kind can go in any file; this one gets a file of its
own. Make `teashop/spoon.sprout`:

```sprout
kind Spoon {
  grammar { name "caddy spoon" }
}
```

A file uses only what it imports, so add this line to the top of
`teashop.sprout`, beside the other two:

```sprout
import {Spoon} from 'spoon'
```

Then tell the manifest about the new file. Open `sprout.json` and add
`spoon.sprout` to `files`:

```json
  "files": [
    "teashop.sprout",
    "person.sprout",
    "spoon.sprout"
  ]
```

Check and play. The spoon cannot be named until the caddy is open:

```text
Inspector> north
A narrow kitchen, all steam and copper.
Inspector> take spoon
You see nothing like that here.
Inspector> open tin
You open a tea caddy.
Inspector> take spoon
You take a caddy spoon.
```

## 5. A thing that does something

Now for the teapot, and a verb of your own: `brew`.

A _verb_ says what visitors can type. Add this at the bottom of
`teashop.sprout`, after the world's closing brace:

```sprout
verb brew { role target: Teapot  "brew [target]"  "make tea in [target]" }
```

This says: `brew` has one _role_, called `target`, which must be filled by
a `Teapot`. Then come the phrases a visitor can type, with `[target]`
where the teapot's name goes. So `brew teapot` and `make tea in the
teapot` both work, and `brew spoon` does not, because the spoon is not a
teapot.

The verb only says what may be typed. What _happens_ is up to the teapot.
Make `teashop/teapot.sprout`. It imports `brew` from the world's file,
where the verb is declared:

```sprout
// A teapot: empty until someone brews in it.
import {brew} from 'teashop'

kind Teapot {
  grammar { nouns "pot" }

  :brewed false

  describe {
    if (self.get(:brewed)) { text "The teapot is warm and full." }
    else                   { text "A brown teapot, empty." }
  }

  as target for brew {
    permit { if (self.get(:brewed)) { refuse "It is already full of tea." } }
    do {
      self.set(:brewed, true)
      say  "You warm the pot, spoon in the leaves and pour. It smells like rain."
      tell "{actor} brews a pot of tea."
    }
  }
}
```

Take it a piece at a time:

- `:brewed false` declares a property, `:brewed`, that starts out `false`.
  Every teapot has its own.
- `describe` checks the property with `self.get(:brewed)`, and describes
  the pot accordingly. `self` always means "this object".
- `as target for brew` is the teapot's part in the `brew` verb: what it
  does when it is the thing being brewed in. It has two halves.
  - `permit` decides whether it can happen. If the pot is already full, it
    `refuse`s, and the visitor reads the reason. Nothing else happens.
  - `do` is what happens. The pot sets its own `:brewed` to `true`, `say`s
    a line to the person brewing, and `tell`s everyone else in the room.
    `{actor}` in the line is replaced by the brewer's name.

Put a teapot in the kitchen, beside the caddy:

```sprout
    object teapot is Teapot
```

Import it at the top of `teashop.sprout`, where the verb names it too:

```sprout
import {Teapot} from 'teapot'
```

Add `teapot.sprout` to the manifest's `files`, then play:

```text
Inspector> n
A narrow kitchen, all steam and copper.
Inspector> x pot
A brown teapot, empty.
Inspector> brew pot
You warm the pot, spoon in the leaves and pour. It smells like rain.
Inspector> brew pot
It is already full of tea.
Inspector> x pot
The teapot is warm and full.
```

## 6. Longer writing in its own file

The kitchen's description should mention what is in it, and prose that
long is nicer in a file of its own. Make `teashop/kitchen.prose`:

```text
passage kitchen_view {
  A narrow kitchen, all steam and copper. A kettle mutters on the range.

  {for thing in self}{if thing != actor} There is {thing} here.{/if}{/for}
}
```

A `.prose` file holds passages: named pieces of writing. Inside one:

- Lines are joined up into paragraphs, and a blank line starts a new
  paragraph.
- Anything in `{ }` is filled in when the passage is read. `{thing}`
  becomes a thing's name with its article, like "a teapot".
- `{for thing in self}…{/for}` repeats its middle once for each thing in
  the room. `{if thing != actor}…{/if}` skips the person looking, who is
  in the room too.

Now point the kitchen at the file and use the passage in its description.
In the kitchen's body, replace the `describe` line with:

```sprout
    prose "kitchen.prose"
    describe { text kitchen_view }
```

Add `kitchen.prose` to the manifest's `files`, and look around:

```text
Inspector> n
A narrow kitchen, all steam and copper. A kettle mutters on the range.
There is a teapot here. There is a tea caddy here.
```

Take the teapot and look again, and it drops off the list.

## 7. Letting time pass

Tea goes cold. An object can ask to be _woken_ later, and do something
when it is. In `teapot.sprout`, add `wake in 20 minutes` to the `do`
block, and a new block to the kind:

```sprout
    do {
      self.set(:brewed, true)
      wake in 20 minutes
      say  "You warm the pot, spoon in the leaves and pour. It smells like rain."
      tell "{actor} brews a pot of tea."
    }
  }

  on :woke (elapsed) {
    self.set(:brewed, false)
    tell "The teapot has gone cold. Someone tips it out."
  }
```

`on :woke` runs when the wake-up arrives. It uses `tell`, not `say`,
because nobody typed anything to cause it: there is no one to answer,
only people nearby to notice.

In `sprout play`, time only moves when you move it:

```text
Inspector> brew pot
You warm the pot, spoon in the leaves and pour. It smells like rain.
Inspector> @advance 20 minutes
The teapot has gone cold. Someone tips it out.
```

## 8. Write tests

A test is a script: a list of _steps_, each something a visitor types or
something the server does, and under a step, what the world should say
in answer. Make `teashop/tests/brewing.json`:

```json
{
  "about": "Brewing fills the pot once, and a friend in the room sees it happen.",
  "steps": [
    { "arrive": "Marta" },
    { "arrive": "Ben" },
    { "as": "Marta", "type": "north" },
    { "as": "Ben", "type": "north" },
    { "as": "Marta", "type": "brew teapot", "expect": [
      { "reader": "Marta", "kind": "said", "words": "You warm the pot, spoon in the leaves and pour. It smells like rain." },
      { "reader": "Ben", "kind": "told", "words": "Marta brews a pot of tea." }
    ] },
    { "as": "Ben", "type": "brew pot", "expect": [
      { "words": "It is already full of tea." }
    ] },
    { "as": "Ben", "type": "x teapot", "expect": [
      { "words": "The teapot is warm and full." }
    ] }
  ]
}
```

How a test reads:

- `{ "arrive": "Marta" }` brings a visitor in. `{ "as": "Marta", "type":
  "north" }` is Marta typing `north`.
- `expect` lists what the world must say in answer, in order. Write a
  line in full, with its `reader` and `kind`, to check who read it, or
  just its `words`, if anyone reading them will do.
- A step with no `expect` is played but not checked.
- `"expect": []` means the world must say nothing at all.
- `about` says what the test is for; a `{ "comment": "…" }` step is a
  note along the way.

And one for the tea going cold, `teashop/tests/cooling.json`. The server's
clock moves with `advance`:

```json
{
  "about": "A pot of tea goes cold after twenty minutes.",
  "steps": [
    { "arrive": "Marta" },
    { "as": "Marta", "type": "north" },
    { "as": "Marta", "type": "brew pot" },
    { "advance": "19 minutes", "expect": [] },
    { "advance": "1 minute", "expect": [
      { "words": "The teapot has gone cold. Someone tips it out." }
    ] },
    { "as": "Marta", "type": "x pot", "expect": [
      { "words": "A brown teapot, empty." }
    ] }
  ]
}
```

Run them:

```sh
sprout test teashop
```

```text
arrival.json: passed, 1 expected line said
brewing.json: passed, 4 expected lines said
cooling.json: passed, 3 expected lines said

3 tests: all passed
```

Each test starts from a fresh copy of the world, so tests never affect
each other. The easy way to write one is to play the world with
`sprout play teashop --record tests/new.json`, then keep the lines you
care about under each step and delete the rest.

## 9. When the compiler says no

Sooner or later you will write something Sprout will not accept. It tells
you the file, the line and the column, what is wrong, and what to write
instead. Misspell the property in the teapot's `describe`:

```text
teapot.sprout:11:18  `Teapot` has no `:brewd`. Did you mean `:brewed`?
                     It has `:brewed`: name one of those, or declare `:brewd` in `Teapot` with its default.
```

Or give it the wrong sort of value, `self.set(:brewed, "yes")`:

```text
teapot.sprout:18:25  `:brewed` holds true or false, and "yes" is text in quotes.
                     Write `true` or `false`, or a condition, as in `self.get(:open)`.
```

Some tips:

- **Fix the first problem first.** A mistake that stops a file being read
  at all makes everything else in that file disappear, and then other
  files complain that things are missing. Fix the syntax error and the
  rest usually goes away.
- **Warnings are not errors.** `sprout check` also warns about things that
  are allowed but probably a mistake — a message nothing listens for, a
  wake nothing answers. Read them; they are usually right.
- **Import what a file uses.** A name another file declares, or the
  standard library's, needs an `import` at the top of the file that uses
  it; the compiler says which one is missing and the line to write. And
  every file is listed in `sprout.json`.

## What you have learned

In one small world you have used:

- the world, places and exits;
- objects, and the kinds they are made of, from Sprout's own
  (`sprout.Place`, `sprout.Fixture`, `sprout.Container`) and your own;
- properties, and reading and setting them;
- a verb, with a `permit` that can refuse and a `do` that acts;
- `say` for the person acting, `tell` for everyone else;
- passages and `.prose` files, with slots and loops;
- waking up later;
- tests.

The [Language reference](04-language-reference.md) covers all of these in
full, and what else there is: messages between objects, characters that
act on their own, dice, things that appear and disappear, and more.
