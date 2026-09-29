# Playing Sprout

The quickest way to meet Sprout is to walk around a world. This chapter
sets Sprout up on your computer and takes you through the sample world
that comes with it, a Victorian printer's shop.

## Setting up

You need [Node.js](https://nodejs.org) version 22 or newer, and `git`.

Sprout has not been published to npm yet, so for now you get it by
copying this repository and building it:

```sh
git clone https://github.com/overstory-social/sprout.git
cd sprout
npm ci
npm run build
```

That gives you the `sprout` command. Inside the `sprout` folder, run it
with `npx`:

```sh
npx sprout help
```

If you want to use it from other folders too, point an alias at it. Put
this in your shell's startup file, with the path to where you cloned
Sprout:

```sh
alias sprout="node ~/sprout/cli/bin/sprout.js"
```

The rest of this manual writes plain `sprout`; use `npx sprout` instead if
you have not set up the alias.

## Starting a game

The printer's shop lives in the `corpus/good/printers_shop` folder. To
walk into it:

```sh
sprout play corpus/good/printers_shop
```

You arrive, read where you are, and get a prompt with your name on it:

```text
Lead and lamp oil. The composing frames take the long wall, and the cabinet stands where the light is worst, which is either carelessness or the opposite.
You have not stood in here before, and the room somehow knows it.
The paper store, the type cabinet, a brass key, the apprentice, the shop cat,
Inspector>
```

Type a command after the prompt and press Enter. When you are done, press
**Ctrl-D** to leave the world.

Unless you say otherwise, you are called `Inspector`. To pick your own
name, add `--as`:

```sh
sprout play corpus/good/printers_shop --as Marta
```

A name can be more than one word, but it cannot be a word the world
already uses — you cannot call yourself `North` or `Key` in a world with a
north exit or a key in it, because then `give key to key` would be
ambiguous. If your name clashes with something, Sprout says which word
and asks for another.

## Reading the screen

What you see is what you read: the world's words, one paragraph to a
line. When something in the world breaks, you read the world's own
apology, then a short line such as `[error] BudgetExhausted` naming what
went wrong, for whoever wrote the world.

Everything the world and the server say is at one of five levels:
`prose` is what a person in the world reads, `error` is something that
broke, `warning` is something the server settled one way where it could
have gone another (someone else's lines cut short because too much was
said to them in one turn), `info` is the server's own notes, and `debug`
is all of it in full. Playing shows prose and errors.

To see everything instead, add `--debug`:

```sh
sprout play corpus/good/printers_shop --debug
```

Now each line the world says is indented under what caused it, with who
read it and a label in brackets that tells you what kind of line it is:

```text
@arrive Inspector
  Inspector (described): Lead and lamp oil. The composing frames take the long wall, and the cabinet stands where the light is worst, which is either carelessness or the opposite.
  Inspector (described): You have not stood in here before, and the room somehow knows it.
  Inspector (described): The paper store, the type cabinet, a brass key, the apprentice, the shop cat,
Inspector>
```

| label         | means                                                      |
| ------------- | ---------------------------------------------------------- |
| `described`   | a description: of the place you are in, or a thing you examined |
| `said`        | the world answering what you just did                      |
| `told`        | something you noticed happening — usually someone else's doing |
| `refused`     | you could not do that, and here is why                     |
| `notice`      | Sprout itself speaking: someone arriving, a word it did not understand |

Debug output also shows the server's own notes — a wake delivered, a
fault in full — and what every visitor read, not only you. It is the
command line's testing view: lines to read, not a script to play back
(for that, see [Replaying a session](#replaying-a-session)).

## What you can type

Every world understands these, whatever else it adds:

| type                               | to                                             |
| ---------------------------------- | ---------------------------------------------- |
| `look` or `l`                      | read the description of where you are again    |
| `examine the key`, `x key`, `look at key`, `check key` | look closely at one thing  |
| `take key`, `get key`, `pick up key`, `pick key up` | pick something up             |
| `drop key`, `put down key`, `put key down` | put it down where you stand            |
| `put key in chest`, `place key in chest` | put something inside something else      |
| `look in chest`, `search chest`    | see what a container holds                     |
| `give key to Ines`, `offer key to Ines` | hand something to someone                 |
| `open chest`, `close chest`        | open or shut a container                       |
| `unlock chest with key`, `use key to unlock chest` | unlock something (if the world has locks) |
| `open chest with key`              | unlock it where it is locked, then open it     |
| `ask Oskar about the toll`, `talk to Oskar about the toll` | ask someone about something |
| `inventory` or `i`                 | list what you are carrying                     |
| `go north`, `north`, `n`, `enter shed` | walk through a way out                     |
| `wait` or `z`                      | let a moment pass                              |
| `again` or `g`                     | do your last command again                     |
| `help` or `?`                      | list everything you can do right now           |

Ways out are named by direction — north, south, east, west, the four
diagonals, up, down, in and out — and each also has a description, like
"out to the press yard". You can type either: `go out` and `out to the
press yard` do the same thing.

A few more things worth knowing:

- **Articles are optional.** `take the brass key` and `take brass key` are
  the same. So are `my`, `this` and `that`.
- **You can use a short name.** "brass key" also answers to `key`, and to
  `brass` where nothing else is called brass. `the key in the box` names
  the one in the box.
- **`it`, `them`, `him` and `her`** mean what your own last command was
  about: `take lamp`, then `drop it`.
- **Several commands on one line.** `take key then open chest`, or `take
  key. open chest`. They run one after the other, and the first that
  does not work stops the rest.
- **`all` and `except`.** `take all`, `drop all except the lamp`.
- **Where a line could mean two things,** the world picks the likelier.
  If it is still a toss-up, it picks one and tells you which, "(A brass
  key)", before it acts.
- **You can only name what you can reach.** A key inside a shut cabinet
  cannot be named until the cabinet is open. If you ask for something
  that is not there, you read "You see nothing like that here." If you
  ask for something that cannot be used that way, the world tells you
  what it understood: "You can't put the key in the anvil."
- **`help` is a real list.** It shows every command that makes sense right
  now, built from what is in front of you.
- Each world adds its own verbs. In the printer's shop you can `ink the
  press`, `work the press`, `lower the ladder` and `ask the apprentice
  about the press`. `help` will show you them.

## A short walk

Here is a few minutes in the printer's shop, as Marta. Lines after the
prompt are what she typed; the lines under them are what came back.

```text
Marta> take cabinet
It is a cabinet. It stays where it is.
Marta> open cabinet
It is locked.
Marta> take key
You take a brass key.
Marta> unlock cabinet with key
The lock turns over.
Marta> open cabinet
You open the type cabinet. Inside: a shop key.
Marta> take shop key
You take a shop key.
Marta> ask apprentice about the press
Bar's stiff, he says. Mind your knuckles.
Marta> go out
Flagstones, a water butt, and the press under its lean-to, which is the only thing out here anyone has ever been careful with.
A wooden rib, a bone rib, the press,
Marta> take rib
(A wooden rib)
You take a wooden rib.
```

Notice that `take key` picked up the brass key, not the shop key: the
shop key was still locked in the cabinet, out of reach, so there was only
one key it could mean. Two ribs answer to `rib`, and neither is a better
fit than the other, so the world picked one and said which in brackets
first. Type `take bone rib` to be exact.

There is more to find — the paper store, the loft above it, and what
happens when you ink the press and pull it. The cat has opinions too.

## More than one visitor

Sprout worlds are built for several people at once, and you can try that
on your own. A line that starts with `@` is not something a visitor
types: it is you, playing the part of the server. `@arrive` brings in
another visitor:

```text
Marta> @arrive Ines
Lead and lamp oil. ...
Ines>
```

The prompt now says `Ines>`, and the screen is Ines's: you read what she
reads, starting with where she arrived. A plain command goes to whoever
arrived most recently. To act as someone else, put their name and `>` in
front:

```text
Ines> Marta> take brass key
Marta tries to take brass key.
Marta takes a brass key.
```

The first line is Sprout telling you what was typed on Marta's behalf;
a world can word it its own way, by writing its own `acted` passage. The
second is what Ines saw happen. Marta's own "You take a brass key." is
hers, so it is not on Ines's screen; `--debug` shows every visitor's
lines, each under their name.

`@leave Ines` sends Ines away. She keeps what she was carrying, and if she
comes back with `@arrive Ines` she returns to where she last stood.

## Letting time pass

Sprout worlds can change on their own: an ink sheet dries, a kettle
cools, a cat wanders over. On a real server this happens with real time.
In `sprout play`, the clock only moves when you say so:

| type                  | does                                                         |
| --------------------- | ------------------------------------------------------------ |
| `@advance 40 minutes` | moves time forward (use `seconds`, `minutes` or `hours`)     |
| `@tick`               | gives every place with someone in it one "moment of ambience" |
| `@seed 7`             | changes the dice, so random things turn out differently      |

For example, in the press yard a freshly printed sheet is wet for forty
minutes before you can pick it up (after `ink press` and `work press`):

```text
Marta> take sheet
The ink is still wet; it would smear.
Marta> @advance 40 minutes
Marta> take sheet
You take a printed sheet.
```

With `--debug`, `@advance` also shows the server's own note that
something in the world woke up: `printers_shop#4 woke, 2400 seconds after
it asked`.

Dice in Sprout are not truly random: each moment rolls from a number
called the _seed_, which starts at 0. That is what makes worlds
repeatable. If the cat never does anything interesting, try `@seed 14`
and then `@tick`.

## Starting somewhere else

To skip straight to a particular place, use `--at` with the place's name
as the world's source writes it. A place inside another place is written
with a dot:

```sh
sprout play corpus/good/printers_shop --at press_yard
sprout play corpus/good/printers_shop --at composing_room.paper_store
```

The place still gets to decide whether to let you in, as it would for
anyone coming back to it. The paper store starts out locked, so the
second command stops with a message saying the paper store turned you
away — useful when you are checking that a door of your own works.

## Replaying a session

To keep a session, add `--record` with a file name:

```sh
sprout play corpus/good/printers_shop --as Marta --record walk.json
```

When you leave, `walk.json` holds everything you did as a _script_: a
list of steps, each with everything the world said in answer. Pass the
file to `sprout play` and it plays it again, from a fresh world:

```sh
sprout play corpus/good/printers_shop walk.json
```

You can also write a script by hand:

```json
{
  "steps": [
    { "arrive": "Marta" },
    { "as": "Marta", "type": "take brass key" },
    { "as": "Marta", "type": "go out" }
  ]
}
```

Sprout plays it and prints it back with what the world said under each
step. The [Quickstart](03-quickstart.md) shows how to turn scripts like
this into tests for your own world.

## Peeking behind the curtain

Two more commands are handy when you are curious about a world, or
writing one:

- `sprout view <world>` shows everything a visitor standing there is
  offered: the description, the ways out, who is there, what they carry,
  and every command they could type, each with whether it would be
  refused and why.
- `sprout parse <world> "take the brass key"` shows how the world
  understands a line — which verb, which thing — and whether it would be
  refused, without actually doing it.

Both take `--at` and `--as` like `play` does.
