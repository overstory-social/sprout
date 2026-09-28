# What is Sprout?

Sprout lets you write a small world made of words, and lets other people
walk around in it.

A Sprout world is a handful of places, the things in them, and the people
visiting. A visitor types what they want to do — `look`, `take the brass
key`, `go north` — and the world answers in sentences you wrote. Several
people can be in the same world at the same time: if you pick up the key,
the person standing next to you reads "Marta takes a brass key."

If you have played a text adventure, you already know how this feels.
Sprout is that kind of game, made small and made to share.

## A tiny example

Here is a complete room with a lamp in it:

```sprout
import * as sprout from 'sprout'
import {Lamp} from 'lamp'

world lantern_yard is sprout.World {
  visitors are Person
  visitors arrive at yard

  object yard is sprout.Place {
    describe { text "A cobbled yard. A shed leans on the north wall." }
    object lamp is Lamp
  }
}

verb light { role target: Lamp  "light [target]" }
```

The first lines bring in what the file uses: the standard library that
comes with Sprout, and the lamp from its own file. The last line adds a
verb, so visitors can type `light lamp`. And here is what a lamp is, in
`lamp.sprout`:

```sprout
import {light} from 'lantern_yard'

kind Lamp {
  :lit false

  as target for light {
    permit { if (self.get(:lit)) { refuse "It is already lit." } }
    do {
      self.set(:lit, true)
      say  "You light the lamp."
      tell "{actor} lights the lamp."
    }
  }
}
```

Even without knowing the language you can probably read it. The lamp
starts unlit. When someone lights it, it first checks whether it is
already lit, and says so if it is. Otherwise it lights, tells the person
who lit it "You light the lamp.", and tells everyone else in the yard who
did it.

## Small on purpose

We call a Sprout world a _microworld_: small, complete and consistent
enough to be explored rather than just read. Everything about the
language pushes in that direction.

- **You write the sentences.** Sprout never glues bits of description
  together for you. The language keeps track of facts — whether the lamp
  is lit, what is in the chest — and you decide how to say them.
- **Everything gets an answer.** Whatever a visitor types, they read
  something back: your words, the standard wording that comes with
  Sprout, or a polite "That is not something you can do here." A world
  never goes silent on someone.
- **Things change only themselves.** A key cannot unlock a door by
  reaching in and flipping the door's lock. It can only ask, and the door
  decides. This sounds strict, but it means you can understand a thing
  by reading that thing alone.
- **Mistakes are caught before anyone plays.** If you misspell a
  property, compare a number to a word, or say something in a place where
  nobody could hear it, Sprout refuses to run the world and tells you, in
  plain English, which line is wrong and what to write instead.
- **The everyday verbs are ordinary Sprout.** `take`, `drop`, `open`,
  `unlock` and the rest are written in the same language you use, and you
  can change what they say or do.

## Safe to share

Sprout worlds are meant to run on a shared server that did not write
them. So the language makes some promises that ordinary programming
languages cannot:

- **Every turn finishes.** There are no loops that can run forever, no
  recursion, and a firm budget on how much work any single action can do.
- **A world only sees itself.** It cannot reach the internet, read files,
  look at another world, or check the clock.
- **Worlds are repeatable.** Given the same actions in the same order, a
  world does exactly the same thing every time — even its dice rolls. So
  if something odd happens, it can be replayed and understood.
- **People are protected.** Visitors are known only by a nickname they
  choose for that one world. Nobody can carry you off, pick your pocket,
  or delete you.

## What Sprout is not

Sprout is not a general programming language. Arithmetic is adding and
subtracting whole numbers. Text is written and compared, never built up
piece by piece. There are no functions.

It is not a game engine either. There are no graphics, no physics, and no
real-time controls. A Sprout world is words.

And it is not a whole website. Accounts, chat between visitors, saving
worlds and deciding how much each world may cost to run all belong to the
_host_ — the server a world runs on. The command-line tool in this
repository is a small host of its own, for trying worlds out on your own
computer.

## Written with or without an AI

Many Sprout worlds are written with an AI assistant in the loop, and the
language is designed for that: it is small enough to hold in your head,
and the compiler refuses to guess. The `sprout skill` command prints a
reference written for an AI assistant to read, generated from the
compiler itself so it can never describe a feature that is not there.

## Where to go next

- To try a world right now, read [Playing Sprout](02-playing.md).
- To write your own, go to the [Quickstart](03-quickstart.md).
