# Sprout — design spec

2026-09-20 · @Someone

The language as it is to be built. This document describes Sprout whole, not as a set of changes to any earlier version; where it disagrees with the working notes or the current repository, this wins.

## What Sprout is

Sprout is a language for describing small interactive fiction worlds — microworlds, in Papert's sense: bounded, complete, and consistent enough to be explored rather than merely read.

A microworld is places, the objects in them, and the kinds those objects are made of. Visitors arrive, type or tap, and the world answers in prose. Several visitors may be in one at once. Worlds are usually the work of one author who controls every piece, and they are written as often with a model in the loop as without, which is why the compiler refuses rather than guesses and why the language is small enough to hold in view.

Worlds run on a shared host that did not write them and cannot vet them by hand. Everything below follows from that.

### What the language guarantees a host

**Termination and cost.** Every turn ends, within a bounded number of steps, having emitted a bounded amount of text and created a bounded number of objects. There are no unbounded loops, no recursion, and no user-defined functions, so a body terminates by construction; budgets bound what construction alone does not. The host sets every budget.

**Isolation.** A turn touches one microworld. There is no network, no filesystem, no other world, and no clock — the only time a world can read is the `elapsed` handed to a tick or a wake.

**Determinism.** A world's state is a function of its bundle and its event log. Every turn's inputs and its seed are recorded, and replaying them reproduces the world exactly, which is what makes support and moderation possible at all.

**Legibility.** An object writes only its own state. What an object can affect follows from its own source and where it sits, so reviewing a world means reading it rather than simulating it.

**Durability.** A world carries every library it uses, so nothing it depends on can change or vanish underneath it. A file that is removed or fails to compile reads as absent, and the rest of the world keeps running.

### The shape of the design

- **Prose is written, not assembled.** The language supplies facts; the author supplies the sentence. Nothing concatenates descriptions on an author's behalf.
- **Every action is answered.** A visitor who acts always reads something: the author's words, the library's, or the world's own fallback. Silence is never an outcome.
- **Consent is a corollary, not a mechanism.** Because only an object can write its own state, every cross-object change is already a request. Movement needs a protocol only because containment is the one piece of state no object owns.
- **Affordance and response are different questions.** What a world offers and what it says when refused are decided separately, so a client's buttons stay honest without the world going mute.
- **Every binding is typed where it is bound.** There is no unknown receiver, so the compiler checks exactly, and a misspelled symbol is an error rather than a comparison that is false forever.
- **One mechanism per job.** One way to reuse behaviour, one way to route events, one way to decide a move, one way to act. Where two mechanisms would overlap, the language has one.
- **The standard library is ordinary Sprout.** Everything a visitor can do by default — take, drop, give, the words that answer — is written in the language and can be rewritten by a world.

### What Sprout is not

It is not a general-purpose language. Arithmetic is addition, subtraction and comparison on bounded integers. Strings are set and compared, never built. There are no functions, no collections beyond a bounded list, and no way to express a computation whose cost is not apparent from its source.

It is not a game engine. It has no rendering, no physics, no real-time input, and no notion of a screen.

And it is not the whole system. Accounts, moderation, storage, scheduling, presentation and every numeric limit belong to the host. The language's job is to describe a world precisely enough that a host can run someone else's imagination safely.

## The world model

A microworld is one tree. At its root is the **world**; everything else is an object inside it, and an object that declares `contains` may hold others.

```sprout
world printers_shop is sprout.World {
  contains
  visitors are Visitor
  visitors arrive at composing_room
  :season Season default autumn

  object composing_room is sprout.Place { … }
  object press_yard is sprout.Place { … }
}
```

The source is written in the shape of that tree. The world's body holds what sits directly in the world, beside what the world declares for itself, and each object's body holds what sits directly in that object, under Objects. The world's body is one block in one file, so every object in a world is declared in the file that declares the world; the kinds, enums, verbs and messages it uses may sit in any of its files, and a file that holds only those needs no world.

The world is the only object with no container, the only one that cannot move, and the only one that can be neither spawned nor destroyed. It holds what belongs to no single place, and — because a broadcast travels outward as well as inward — it is the only route by which one place can hear another. Its pass rule is `pass any (false)` unless it says otherwise, so nothing crosses between places unless the world says it may.

Every world composes `sprout.World`, which carries the words the engine speaks for itself, and writes so: `world printers_shop is sprout.World { … }`, with the library named; an unqualified `World` does not stand for it. A world that leaves it out is refused, and anything but a world that composes it is refused, because it would make a place into a world. A world composes like a kind, so it may compose more beside it — `world printers_shop is sprout.World, victorian.Voice { … }` — which is how a library of stock lines in another register or another language is installed. Being explicit here is deliberate: a later level may make `sprout.World` implicit, and a level can relax a requirement it stated; it can never add one to worlds already accepted.

That is the whole shape. The containment tree is the one piece of state no object owns, which is why moving through it takes a protocol and nothing else does.

### Places

There are no rooms. A **place** is any object that declares `contains actors`. The standard library's `sprout.Place` is that and the two notices a place speaks for itself:

```sprout
kind Place {
  contains actors
  passage arrives default { {item} arrives. }
  passage leaves  default { {item} leaves. }
}

object composing_room is sprout.Place {
  grammar {
    name    "composing room"
    article the
    exit out "out to the press yard" -> press_yard
  }

  prose "composing_room.prose"
  describe { text arrival }

  on :entered (item, from) { … }
}
```

`contains actors` is a declared capability beside `contains`, not a kind the engine knows by name. An actor's **place** is the nearest ancestor declaring it: that is what `tell` reaches, what a visitor leaves when they go, and what a description describes. A wardrobe that declares it can be entered, and everything that follows from being somewhere follows from that one line.

A place's `accept` decides who may enter. When an actor enters, every visitor in range of the place reads its `arrives` passage, every other object in range of it is sent `:arrived (actor, from)`, and the one arriving reads the place's description; its `:entered` handler is for anything the author wants to add or count. Leaving is the mirror: `leaves` and `:departed (actor, to)`, across the range of the place left. (The two message names await Eric's confirmation: the notes' Open 69.)

Exits live in the grammar block, because an exit is surface: a direction, a label for the chip, and where it leads.

### Objects

```sprout
kind Chest is sprout.Container { }

world printers_shop is sprout.World {
  visitors are Visitor
  visitors arrive at composing_room

  object composing_room is sprout.Place {
    object cabinet is Chest {
      :open false

      object brass_key is Key {
        grammar { name "brass key" }
      }
    }

    object bench is Bench { … }
  }
}
```

An object is declared inside the body of what holds it: the world's body for what sits directly in the world, and another object's body for what sits inside that object. The parse tree is the containment tree, so a declaration never names its container, and where an object starts is where it is written.

An object names its kinds after `is`, and declares everything a visitor may say to it in one block. A body may follow, which declares an anonymous kind for that object alone — the right form for a thing there is only one of — and holds the objects inside it. The two sit side by side: the cabinet's body restates `:open` for itself and holds the key. Only something whose kind holds things may hold an object, as the cabinet's does by composing `sprout.Container`; an object in the body of one whose kind does not is refused.

Kinds are declared at a file's top level, and a kind's body may hold objects too: every instance of the kind, declared or spawned, starts with its own copy of each, inside it. So `kind Lantern is sprout.Container { object wick is Wick }` gives every lantern a wick, and spawning a lantern spawns its wick with it, telling only the lantern `:spawned` and its container `:entered`. An object in a kind's body that is made of that kind, directly or through another kind's contents, would never end, and is refused. A declared instance's own body may hold more beside what its kinds give it; a name its kinds' contents already use is two objects of one name in one body. An `object` at a file's top level, outside the world, is refused.

Each kind is declared in a file of its own, named for it: the kind's name in lower case with `_` between its words, compared exactly against the last part of the file's path, so `kind Chest` is in `chest.sprout`, `kind PrintedSheet` in `printed_sheet.sprout` and `kind TVSet` in `tv_set.sprout`. A kind in a file not named for it is refused at publish and warned about at load, where it stands. The world is declared in the file named for the world's name, `world printers_shop` in `printers_shop.sprout`. Enums, verbs and messages may sit in any file, alone or beside a kind or the world, and a library is held to the same rule. Nothing is imported, since every name resolves across the whole closed bundle, so no two files can refer to each other in a circle.

An object's identifier belongs to the body it is written in, so two chests may each hold a `key`; how a name is seen from other bodies is under Identifiers and scope. Where an example in this document shows an object on its own, it is an excerpt from the body that holds it.

### Range

Range is what an object can reach: what it may read with `get`, `send` to, and walk with `each`. One definition serves all three, and it is the same walk a broadcast makes.

An object reaches a target when nothing strictly between them on the containment tree refuses. Counted from the asker, that is itself and its own contents; its own container, as a surface; each container further out, when every container between the asker and it passes; and a container's other contents when it passes too. So a container that refuses is reached as a surface from inside and is a wall beyond that, in both directions. A bench in a bedroom that relays reaches the house around the bedroom, so it can `get` the house's `:season`; the house refuses, so the bench reaches none of the house's other places.

An object always reaches **itself and its own contents**: a shut chest can still count what it holds and speak to it, because a lid stops others looking in, not the chest looking down. Without that, every container would go blind the moment it closed. It also always reaches **the surface of its own container** — the thing it is inside, even when nothing beyond it is — so a visitor shut in a wardrobe can still name the wardrobe and open it.

A visitor's range is computed from the visitor, so it is their hands and then their place, and it is what a command's nouns resolve against. A key in a shut chest cannot be named until the chest is open — which is what makes a lid mean anything, and what a player already expects. A command whose phrase reads but whose noun nothing in range answers to is answered with the world's `not_here`, "You see nothing like that here.", which says no more of what a lid or a wall hides. Because `sprout.Actor` does not pass, what another visitor carries is out of range: you can name Marta, and not the key in her pocket.

Because the world's pass rule refuses, places are out of range of one another until the world says otherwise. One place hearing another is a deliberate act by the world, not a consequence of sharing a microworld.

Range is a walk. It goes nearest first: the asker and its own contents, then its container and that container's other contents, and so on outward a ring at a time, breadth-first within each ring and each container's contents in the order it holds them. A broadcast delivers in that order. The walk is bounded by the pass rules that stop it and charged to the step budget like any other work.

### Actors and visitors

An **actor** is an object that can act: it holds things, it has a place, and it can perform verbs. A world says what its actors are made of:

```sprout
world tag_yard is sprout.World {
  contains
  visitors are Player
  visitors arrive at yard
}

kind Player is Tagged, sprout.Visitor {
  :capacity 4
}

kind Tagged is sprout.Actor {
  :team Team default hider

  as target for tag {
    permit { if (self.get(:team) == :it) { refuse "{self} is already It." } }
    do {
      self.set(:team, :it)
      say  "You tag {self}."
      tell self "{actor} tags you. You are It."
      tell "{actor} tags {self}."
    }
  }
}
```

`sprout.Actor` declares the hands, their capacity, and the guards that make a person's things their own. Every object that composes `sprout.Actor` is an actor and may `act`. A world's own kind — the **visitor kind** — composes `sprout.Visitor`, the standard library's kind for a person, which composes `sprout.Actor`; it adds whatever this story needs a person to have, and has no behaviour of its own, since a person acts by typing: its own body may declare properties, a `remembers` block, passages, a grammar block and a `describe`, may leave out a member it composes with `without`, and is refused a handler, hook, tick, wake, play, guard or pass rule. What it composes runs as it would for any object, so behaviour a person needs is written on a kind the visitor kind composes. `item.is(sprout.Actor)` is an ordinary nominal test rather than a name the engine knows.

A **visitor** is an instance of the visitor kind with a person behind it. It sits in the tree, holds what it carries, and has a place — and alone among objects, nobody wrote its declaration. It arrives where the world says visitors arrive, or, on a later visit, where it last stood if that place still exists and still accepts it. `visitors arrive at` names a place inside the world, never the world itself, even where the world declares `contains actors`; it is written in the world's body, so a place directly in the world is named bare and one deeper by its path: `visitors arrive at kiln.back_room`.

The only actors are visitors and NPCs: an instance of the visitor kind is a visitor, and every other object composing `sprout.Actor` is an NPC. Nothing declares or spawns a visitor, so an object or a `spawn` of a kind composing `sprout.Visitor` is refused. An actor is only ever inside something that declares `contains actors`, so every actor has a place: declaring one elsewhere is refused, and moving or spawning one elsewhere is refused or faults.

An **NPC** is an object composing `sprout.Actor`, and not `sprout.Visitor`, with nobody behind it. It is declared like any object, has a name rather than a nickname, acts on `:tick` or on a message rather than on typing, performs verbs with `act`, and reads nothing: prose addressed to it goes nowhere. Its presence does not keep a place ticking; only a person's does.

### What a world may know about a visitor

**Visitor state belongs to the world, never to the person.** Everything a world writes about a visitor lives in that world's own store, keyed to the visit, and never reaches the account behind it. `:team` means something in the tag yard and nothing anywhere else. The account supplies exactly one thing, the nickname, and that is per-world too.

So the rule sharpens rather than loosening: **an object may read what this world wrote about a visitor, and nothing else.**

Writes still go only to self. To change a visitor, send them a message or give them a role to play — their own kind's handler does the writing. That is why `as target for tag` is the natural shape above: the tagger proposes and the visitor decides.

Two kinds of memory sit side by side, and they are not the same. A property on the visitor is the world's **public record**: anything in range can read whether you are It. a `remembers` entry on an object is that object's **private note** about an actor, which nothing else can read. A door remembering it has seen you before is private; being It is not.

A visitor who leaves keeps their state for a later visit and has no container while away — out of range of everything, receiving nothing.

### Spawning

```sprout
kind Clay {
  as target for throw {
    do { spawn Cup in actor }
  }
}
```

`spawn Kind in <target>` makes a new instance at runtime, with the kind's defaults and the objects its kinds hold, in a container in range. No guard is asked — nothing is proposing anything; the author is placing — and the container receives `:entered` as for any arrival. The new object is sent `:spawned (from)` so it can speak for itself. `spawn` is a statement, and the one statement that also yields a binding: `let cup = spawn Cup in actor` names the new object for the rest of the block.

A `spawn` whose target, when it runs, is out of range or does not hold things, or does not hold actors where the kind is an actor, is a fault, never nothing: the statement yields a binding, and there is no null for it to hold. The world is a target like any other, so a spawn into it is allowed wherever the world is in range.

A spawned instance has no identifier — an identifier is a declaration written in its container's body, and a spawn declares nothing. It is addressed by its kind's nouns, and where several things written alike, with one article and one name, answer to the same words, nothing is asked: the nearest in range is meant, and among equally near ones a draw from the turn's seed, so no world comes to depend on an order it never chose.

A place may be spawned like anything else. Nothing can *exit* to one, because an exit names its target by identifier and a spawned object has none; a **link**, described under Verbs, is the way out that is assigned while the world runs, and it is how a spawned place is reached.

Because every spawn instantiates a kind declared in the bundle, and names are immutable declaration syntax, **no new noun can appear at runtime**. The world's complete vocabulary is known when it compiles.

Spawning is bounded per turn by a budget the host sets, and over time by how many live instances the host will hold.

### Destroying

`destroy self` is the only form: an object removes itself, as it is the only thing it may write. It takes effect when the body that ran it ends; statements after it still run. Whatever it held is destroyed with it, all the way down, dormant instances included: a container and its contents are one thing to the author who destroys it, and nothing is moved without anyone proposing it.

A binding to a destroyed object stays readable for the rest of the turn, holding the state the object had. A declared object that is destroyed is gone for good: its id is never made again, at load or after, and an identifier or path that names it is a fault when it is read at run time, as a dangling reference is. The engine reads a destroyed declared place as it reads an absent one: an exit to it does not apply, and a world whose arrival place is destroyed admits no one. Destroying is meant for what was spawned, so the compiler warns about `destroy self` in a declared object's body or in a kind a declared object is made of. A destroyed object has no effects. Everything pending on it is dropped: messages queued to it, messages it sent that have not yet been delivered, engine messages that name it as their `from`, and its pending wakes. Destroying anything with a visitor anywhere inside it is a fault, because a person is never destroyed.

`finally destroy self` is the one-shot form. It may stand wherever `destroy self` may, and marks the object to be destroyed once every message the turn has queued has been delivered and handled, so what the body sent still arrives:

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

The destroy then happens exactly as `destroy self` would, at the end of the turn's cascade, with nothing further delivered to the object. Only `destroy self` may follow `finally`. Written twice, or beside a `destroy self`, it is once; a fault abandons the turn and the mark with it. (These details await Eric's confirmation: the notes' Open 66.)

There is no sweep primitive. An object that should not outlive its usefulness asks to be woken and destroys itself, which puts the policy in the world that cares about it.

### Files

A microworld is a manifest, some `.sprout` files, the `.prose` files they point at, and the vendored source of every library they use. The file that declares the world declares every object in it, because the world's body is one block; kinds, enums, verbs and messages may sit in any file, and identifiers resolve across files by the scope rules in Names.

A file that is removed, withheld, named in the manifest and not delivered, or that fails to compile reads as absent. What referred to it keeps compiling, the rest of the world keeps running, and the gap is visible rather than fatal. What "absent" means at each kind of reference is a table under The compiler.

### The manifest

The manifest is what a world says about itself before any of it is read.

| field | what it holds |
| --- | --- |
| `name` | the world's own name, which its one `world` declaration repeats |
| `namespace` | the namespace its declarations are unqualified in; optional, and the world's name when unset |
| `version` | which version of this world this is, as [semver](https://semver.org) |
| `author` | who made it, as text: a name, an address, a profile |
| `license` | the terms it is offered under |
| `level` | the language level it was written for |
| `extensions` | the extensions it pins, by name and major version |
| `libraries` | every library it uses, each by name, by version as semver, and by the hash of the source vendored beside it |
| `files` | its own `.sprout` and `.prose` files, by name |

None of it needs a parser, and that is the point: whether a bundle is closed and whether it is complete are both settled before a line of the language has been read.

A bundle holds exactly one `world` declaration, and its name is the manifest's `name`: none, more than one, or one under another name is refused.

`files` is what makes a file that did not arrive *missing* rather than merely absent — without it there is nothing for a file to be missing from. What travelled must be exactly what the manifest names; publishing refuses otherwise, and loading says so and runs.

`libraries` is what closes the bundle. A library named here whose source did not travel is absent, and so is one whose source does not hash to the value recorded beside it: a world runs against the library it meant to vendor or against none, because running against some other copy under a trusted name is the worse of the two failures. It is the same hash a host's blessed set is keyed on, under Libraries and namespaces.

## Kinds, composition and libraries

A kind is a named bundle of properties and behaviour with no place in the world. An object *composes* kinds. There is one reuse mechanism, no inheritance chain, and no `super`.

### Declaring and composing

```sprout
kind Crate is sprout.Container {
  :capacity 20
  grammar { nouns "box" }
  describe { text "Slat-sided, heavier than it looks." }
}
```

Everything after `is` is composed; a kind may compose any number of kinds, including none, and one that composes none leaves `is` out: `kind Marker { }`. `kind Crate is sprout.Container` reads as the question `x.is(K)` asks, answered: every crate is a `sprout.Container`.

`is` composes and the colon does not. The colon marks a property, a message or an option in an expression, labels a role in `act`, and gives a role or a loop variable its kind; a declaration that composes with it, `kind Crate: sprout.Container`, is refused, and the refusal says to write `is`.

A kind body may declare properties, `remembers` blocks, `contains`, `contains actors`, a grammar block, `as <role> for <verb>` members, consent guards, handlers, hooks, pass rules, passages and the `prose` file that holds them, and one `describe`. An object's body may declare the same. Either may hold objects, under Objects, where its kind holds things.

### How members combine

Members divide by whether more than one answer makes sense.

| member | several sources |
| --- | --- |
| property declaration | refuse; composer restates to merge |
| `remembers` entry | refuse; composer restates to merge |
| `on :m` handler | all run |
| `changed :p` hook | all run |
| `depart` / `release` / `accept` | all run; any refusal decides |
| `as <role> for <verb>` | all `permit` run, any refusal decides; all `do` run |
| nouns in the grammar block | all apply |
| `name`, `article` | refuse |
| `contains`, `contains actors` | idempotent |
| `pass :m`, `pass any` | refuse |
| a passage | refuse, unless all but one are `default` |
| `describe` | refuse |

Four rules cover the table.

1. **One source.** The member is the composing kind's own.
2. **One origin, several paths.** A kind reached twice through a diamond contributes once. Composition is walked depth-first, left to right, each kind included at its first appearance.
3. **Several origins, composable member.** Every contribution runs, in the order its source appears in the composition list, the composing kind's own last.
4. **Several origins, exclusive member.** A compile error naming both sources. The composing kind resolves it by writing its own, which is then the one that applies.

A composer's own exclusive member always replaces what it composes — a collision is only ever between two *sources*, neither of which is the composer — so an object that writes its own `immovable` passage over `sprout.Fixture`'s has suppressed nothing and needs no `without`.

A passage may be declared `default`. A default passage yields to any passage of the same name from any other source, without collision; two defaults of one name collide as any two sources do, except that the standard library's default yields to another library's. The standard library's stock lines are all defaults, which is what lets a world compose `victorian.Voice` beside `sprout.Actor` and take the library's `taken` without writing anything, lets a second library supply the lines the first left out, and lets a register library write its own lines as defaults that still yield to the world's. A composer's own default replaces a composed passage of the same name, default or not, as any exclusive member of its own does, and stays a default, so it still yields to a source further up.

Order in the composition list sequences effects. It never decides which effect applies. `A, B` and `B, A` may narrate in a different order and can never differ in what happened, and no composed kind's member silently shadows another composed kind's at any depth.

### Consent under composition

All three guards run for every composed kind, and any refusal decides the move. The first refusal in run order supplies the text the actor reads.

Composition is conjunctive within an object exactly as the three-party protocol is conjunctive between objects. `sprout.Fixture`'s `depart` and a world's own `Fragile` both apply, and both must allow.

### Suppressing a contribution

A composing kind may drop one inherited member, naming both the member and its source:

```sprout
kind SafetyLamp is sprout.LightSource {
  without changed :lit from sprout.LightSource
}
```

This is the exception, which is why it is the verbose form.

What a kind leaves out stays left out in every kind that composes it. Where the same member also reaches the composer through another kind, which does not leave it out, that copy still runs.

### Properties merge; they never shadow

Property names are not namespaced. An object's properties are one flat map, and that map is what a moderator reads, so two kinds declaring `:open` are two claims on one slot.

A property arriving from **one origin** by any number of paths is one property. A property arriving from **two origins** is a compile error, even when the declarations are identical: `ericworld.Futon`'s `:open` for unfolded and `sprout.Container`'s `:open` for lid-off are textually the same and mean different things, and merging them silently would make unfolding the futon open the drawer.

The composing kind resolves it by restating the property in its own body, which reads as a statement that these are meant to be one slot. Restating also overrides the default while keeping the type, the same move an instance makes one level down:

```sprout
kind Crate is sprout.Container {
  :capacity 40
}
```

A restatement by a kind that itself composes the property's origin supersedes that origin wherever both reach one composer, so the worked microworld's `kind Visitor is Creature, sprout.Visitor { }` takes `Creature`'s `:capacity` over `sprout.Actor`'s without restating it. Two restatements neither of which composes the other still collide.

Changing a property's type in a composing kind is a refusal, not an override. And because every standard library property name is one an author cannot use freely without a merge decision, the standard library declares as few as it can.

A property's name is its identity in storage. Renaming one in source is a new property with the declared default; the old one's values are dropped.

### Prose does not compose

`describe` is exclusive because a thing has one voice. Stitched paragraphs read as stitched, and prose is the one place Sprout exists to keep human. Composition supplies facts and the author supplies the sentence: a `Cracked` kind declares `:cracked` and says nothing, and the author writes where the crack appears in their own paragraph, in their own register.

Standard library kinds therefore carry no `describe` and no name. What they do carry is the prose for what they *do* — `sprout.Fixture`'s `immovable`, `sprout.Actor`'s `taken` — as `default` passages, because a visitor who takes something must read something, and a default yields to anyone: to the composer's own line, and to any other library's. A world that wants every stock line in a different voice composes a library that supplies them, and writes nothing. Collisions on `describe` are consequently rare, arising only when an author composes two of their own kinds that both describe, and there refusing and asking for the combined paragraph is right.

### Containment is a declaration

A kind whose instances hold things says so.

```sprout
kind Container {
  contains
  :open true
  :capacity 8
  pass any (self.get(:open))
  accept (item, from) {
    if (!self.get(:open))                       { refuse shut }
    else if (self.count >= self.get(:capacity)) { refuse full }
  }
}
```

`contains` is the primitive. Whether an object has contents is a declared capability the engine asks about, never a name the engine recognises, so a library's container and the standard library's container are equally real. Capacity is a property `sprout.Container` and `sprout.Actor` declare and their own `accept` guards read; the engine reads no property by name.

### Libraries and namespaces

A kind's identity is its library and its name. `sprout.Container` and `ericworld.Container` are different kinds and may be composed together.

- `sprout` is in scope in every microworld and its kinds, enums, verbs and messages may be written unqualified.
- A world's own declarations are unqualified.
- A world's own declaration taking a standard library name shadows the unqualified form, with a warning. The qualified name always reaches the library's.
- A world's verb that shadows a library's takes its phrases with it: the library verb's phrases are not offered, so the world's verb answers only to the phrases it writes.
- Libraries namespace kinds, enums, verbs and messages. They do not namespace properties.

Libraries are **statically linked**. A published microworld carries the full source of every library it uses, and nothing is resolved, fetched or versioned at runtime. A world's behaviour is a function of its own bundle, so replay stays exact, a library author cannot change worlds that have already shipped, and a withdrawn library cannot take live worlds with it.

Vendored library source is content-hashed. A copy matching a version the host knows is exempt from the world's source, kind and file caps and collapses in the moderation view; a modified copy is the author's own source and counts as it. Forking the standard library is legal and not free.

A bundle's language level is the highest level of any of its parts, library source included.

### The standard library is written in Sprout

Every standard library kind, verb and passage is ordinary Sprout composed from the primitives in this document. If a standard library kind cannot be written in Sprout, the language is missing something and the language is what changes.

So `sprout.Container` is the code above; `sprout.Fixture` is a `depart` guard and a passage; `sprout.LightSource` is a property and a `changed` hook that broadcasts; `take` is a verb whose `do` is one `move` and two lines of prose. There are no magic property names. `:open` and `:capacity` belong to `sprout.Container` the way any property belongs to the kind that declared it, and a kind that does not compose it has those names free.

### Splitting a kind along the type seam

A library kind cannot declare a property of a type the world invented — `Ward` is the world's enum and `sprout` has never heard of it. That looks like a wall and is not one, because role composition splits the work exactly where the types divide.

The library carries the half that needs no world types: the verb, the role, and the state it can name itself.

```sprout
verb unlock {
  role target: Lockable
  role tool
  "unlock [target] with [tool]"
  "use [tool] on [target]"
}

kind Lockable {
  :locked true

  as target for unlock {
    permit { if (!self.get(:locked)) { refuse "It is already unlocked." } }
    do     { self.set(:locked, false) }
  }
}
```

The world composes in the half that does:

```sprout
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

Both `permit` bodies run and either may refuse; both `do` bodies run. Neither kind mentions the other's types, and nothing needed a type parameter to say so. The `tool` role is open — filled by anything that plays it — so the world narrows it with `is()` before reading what only its own `Key` declares.

The same split works wherever the pattern recurs. A vending kind carries the verb and the mechanism while the world carries its own denominations; a growing kind schedules the wake while the world advances its own stages. Where a library and a world must agree about a value, **the library supplies behaviour and the world supplies vocabulary.**

Which side of a verb knows the other is the author's choice, not a convention of the language. A lock may know what keys look like, or a key may know what wards do; both are legal, and the standard library picks per verb.

## Names

A name does three jobs: it identifies something in source, it lets a visitor address it, and it appears in the prose the engine writes for itself. Sprout keeps them separate.

### Identifiers and scope

An identifier names something in source. Its scope is the smallest one that works, and every rule below falls out of something already in place rather than being imposed:

|  | scope | because |
| --- | --- | --- |
| kinds, enums, verbs, messages | their library | libraries namespace them, and linking is static |
| objects | the body they are written in, and everything inside it | that body is their container |
| members — properties, passages | whatever declares them | a kind's passages are the kind's |

One rule covers objects at every depth: an identifier belongs to the body it is written in and is visible from inside that body at any depth, the nearest declaration winning. From inside the cat, `cabinet` is the cabinet beside it and `composing_room` is the room around it; from inside a chest, `key` is the chest's own key even if the room has another. Places sitting directly in the world are written in the world's body, and every other object is inside it, so they are visible from every object's body and an exit can name one from anywhere. Two places may each hold a `shelf`, and two chests may each hold a `key`, and nobody writes `kiln_shelf` again.

Something deeper than a body can see is named by its dotted path, written without spaces around the dots: the first step is a name visible where the path is written, and each step after it is declared in the body of the one before. An exit names a wardrobe in another room as `-> bedroom.wardrobe`, and the world's `visitors arrive at`, written in the world's body, names a nested place the same way: `visitors arrive at composing_room.paper_store`. The world's name may be a path's first step, and no other: `printers_shop.lamp` names the lamp directly in the world from anywhere, even where something nearer is called `lamp`.

An object hides anything of its name written further out: in the body of the container around its own, or of any container beyond that out to the world. The compiler warns at the inner declaration and names the path the outer one is now reached by. Two objects of one name in sibling containers hide nothing, since neither is further out than the other.

A kind has no place in the tree, so a name in a kind's body, and in the body of an object a kind gives its instances, resolves at run time from where the instance running it sits, by the same rule: nearest wins, counted from that instance. Two instances of one kind may so reach different objects by one name.

An identifier in the world's or an object's own body resolves at compile time. Either is a target at run time only if it is in range; a `send` to an identifier out of range does nothing, and a `get` through one is a fault.

### Addressing and display

Naming is part of the grammar block, not a set of properties. The engine never reaches for a property by name to learn what something is called, and a name cannot be rewritten mid-scene, so nothing can rename itself into something else.

```sprout
object brass_key is Key {
  grammar {
    name    "brass key"
    article a
    nouns   "brass"
  }
}
```

| field | default |
| --- | --- |
| `name` | the identifier, humanised in lower case — `oak_door` becomes "oak door" |
| `nouns` | the full name and its last word — "brass key" is addressable as both `brass key` and `key` |
| `article` | `a`, written `an` before a name beginning with `a`, `e`, `i`, `o` or `u`; `the` and `none` only where written |

A name never contains an article, and the compiler refuses one that begins with `a`, `an` or `the`. Additional `nouns` are added to the defaults, not substituted for them, and like every other part of the block they compose: a kind's nouns and its composer's both apply.

### Articles

On input an article is optional wherever a noun is expected: `unlock oak door with brass key` and `unlock the oak door with the brass key` parse identically. So are `my`, `this` and `that`.

On output the engine uses the declared article for everything it writes itself — chips, disambiguation prompts, arrival notices. There is no first-mention tracking and no indefinite-to-definite progression; a thing is addressed the way its author declared, consistently.

Authored prose is unaffected. A passage writes its own words, so an author who wants "your brass key" or "that wretched key" simply writes it.

### Nicknames

A visitor is known in a microworld by a nickname they choose on entering. It is per-world, may be more than one word, and may be kept and reclaimed on a later visit. It is the only thing about the person behind a visitor that any object can read.

A nickname is accepted only if it is addressable without ambiguity, which means it must collide with nothing the parser knows:

- Not with any noun in the world, nor any token of one. Because names are declaration syntax and immutable, and every spawn instantiates a declared kind, **a microworld's complete noun set is known at compile time** and travels with the bundle. "Marta B" is accepted where no object answers to `marta` or `b`; "brass rose" is refused in a world containing a rose.
- Not with any other word the parser reads: a direction, an article, a connector, or a word in any verb's phrases. "North", "With" and "Open" are refused.
- Not with another visitor's nickname. A second Marta is asked for another — "Marta B" — before entering.

The host checks all three against the bundle's word set with no scan of live state. A visitor with no nickname does not enter, so the engine always has a name to render and never has to write an absence.

Nicknames are matched longest-first, as multi-word nouns are, so `give key to marta b` resolves to the visitor rather than to a `marta` who is not there.
## Properties, types and values

Every value in Sprout has a declared type, every binding's type is known where it is bound, and there is no null. The compiler therefore checks expressions exactly. It never guesses at a receiver and never reports a problem that might not be one.

### The types

| type | written | values |
| --- | --- | --- |
| boolean | `boolean` | `true`, `false` |
| integer | `integer`, optionally `min`/`max` | whole numbers within the declared range |
| string | `string` | short text, set and compared, never joined |
| symbol | an enum's name | one of that enum's options |
| list | `[T]` | a bounded, ordered collection of one element type, without duplicates |
| object | never written | a thing in the world, known only by identity and kind |

There is no null and no object-valued property. Absence is spelled as an option — `:glaze Glaze default none` — which makes it a case the author named and the compiler can check exhaustively.

An integer declared without `min`/`max` ranges over −2,147,483,648 to 2,147,483,647, which is also the range of `elapsed`. `-x` is an expression.

The object type has no properties. It is the type of a binding whose kind the compiler cannot know — an open role, a handler's sender, an unfiltered loop variable, a guard's `mover` — and all it admits is rendering in a slot, `==`, and `is()`, which narrows it.

### Declaring a property

```sprout
:lit      false                     // type from the literal
:lit      boolean default false     // the same, spelled out
:wear     0 min 0 max 99            // an integer with a range
:state    Drying default wet        // a symbol from an enum
:opens    [Ward] default [oak]      // a list
:note     string default ""
```

A property is a name, a type, and a default. A default is always written: there is no null for a property to hold instead. The type may be written or taken from the literal — a boolean, an integer or a string names its own type, and an option names its enum, `:ward Ward default iron` or `:ward Ward.iron`, or with the enum's library, `:ward sprout.Ward.iron`. A list writes its element type, so `:cars [Car] default []` is unambiguous. Every instance of the kind starts at the default; a kind or an object's body may restate a property it composes to change the default, keeping the type, and there the type is already known, so `:ward iron` is enough.

### Enums

Symbols belong to a named enum, declared beside kinds and exported by libraries:

```sprout
enum Ward  { oak, silver }
enum Glaze { none, shino, tenmoku }
```

An enum's options are in scope wherever the enum is. An option may always be written qualified, `Ward.iron` or `sprout.Ward.iron`, and bare as `:iron` wherever the enum is known from the other side (a typed property, the other operand, a restatement); which to write is the author's choice where both apply, and the qualified form is how an ambiguous one is disambiguated. A symbol literal is checked against the option set of whatever it is compared or assigned to, so `== :slver` is a compile error naming the options, not a comparison that is false forever.

Options are separated by commas, and a comma after the last is allowed. An option may not be a reserved word. An enum holds at most as many options as the host allows.

Enums are how two kinds from different libraries agree about a value. A property merging under composition merges only when both declarations name the same enum.

On input, an option is typed as its humanised form: `the_press` is what a visitor means by "the press". On output a slot renders it the same way.

### Lists

A list is a bounded, ordered collection of one element type, declared on a kind and settable on an instance:

```sprout
kind Key {
  :opens [Ward] default [oak]
}

object skeleton_key is Key { :opens [oak, silver] }
```

A list holds no duplicates, and it may change. Its element type may itself be a list, `[[Ward]]`, so long as every element is of that one type. `self.add(:opens, silver)` on a list already holding `silver` does nothing, and `self.remove(:opens, iron)` on a list without `iron` does nothing. Order is insertion order and is preserved, because `{for … of}` makes it visible in prose.

A list holds at most as many elements as the host allows, and adding a new one to a full list is a fault rather than a silent drop. `adjust` clamps at a ceiling because reaching the ceiling is the meaning; dropping an element would lose something the author wrote.

Four operations: `includes(x)`, `count`, `add` and `remove`. Only the object that declared the property may add or remove, as with any other write. Two lists are not compared with `==`; whether equality is by set or by order is a later level's to add. Inside a list of lists, `add`, `remove` and `includes` take two elements to be the same when they hold the same elements in the same order, which is how the no-duplicates rule is kept there; it is not an `==` an author can write.

### Where types come from

Every binding is typed where it enters scope. There is no unknown receiver anywhere in the language.

| binding | typed by |
| --- | --- |
| `self` | the composed kind |
| `actor` | `sprout.Actor`, a visitor or an NPC; anything more is read through `is()` |
| `here` | `sprout.Place`; the actor's place |
| `mover`, in a guard | object; whatever proposed the move |
| a role | the kind or value type the verb declares; object if it declares none |
| a set role | as above, as a set |
| a role narrowed by `from` | the element type of the property named |
| an `each` variable | its kind filter — `each pot: Vessel in self` — or object without one |
| a `{for}` variable | the same |
| a `let` binding | the expression it names |
| an optional tool | as its role declares, inside `if (bound x)` only |
| a handler's sender | object |
| a handler's value | the message's declaration |
| a hook's previous value | the property that changed |
| `elapsed` | integer |
| a guard's `to`, `item` or `from` | object |
| `$first`, `$last` in a passage loop | boolean |
| `$index`, `$count` in a passage loop | integer |
| `thing` in the world's `unremarkable` | object |
| `candidates` in the world's `which` | a set of objects |
| `actor` and `here` in the world's `unknown`, `not_here`, `which`, `nothing_happens` and `fault` | as above |
| `item` in the world's `inside_itself` and a place's `arrives` and `leaves` | object |

An engine line is given exactly what this table names for it: `unremarkable` only `thing`, and `unseen`, `missing` and `displaced` nothing.

A kind named in a role or an `each` matches **nominally**, and by composition rather than by exact kind: `role into: sprout.Container` admits anything that composes `sprout.Container`, whatever else it composes, and nothing that merely resembles one.

Matching is deliberately not structural. Two kinds declaring `:open` are already a compile error when they compose, because a futon's unfolded and a container's lid-off are textually identical and mean different things; a slot that accepted anything shaped like a container would readmit exactly that confusion at the argument boundary. A kind in a slot is also a claim about intent — `sprout.Lockable` says an author meant this to have a lock — and intent has no shape to match on.

A role's kind also constrains the parser. `dip pot in crate` fails to match rather than matching and running an author's hand-written rejection, so a verb is never offered with a filler it cannot use.

### What the compiler checks

| construct | rule |
| --- | --- |
| `a == b`, `a != b` | same type, and not a list; a symbol literal, on either side, must be one of the other operand's options; an integer literal, on either side, must be within the other operand's range, since outside it the comparison is decided before the world runs |
| `<` `<=` `>` `>=` | both integer; an integer literal, on either side, must be within the other operand's range, for the same reason |
| `+` `-`, unary `-` | integer |
| `&&` `\|\|` `!` | operands boolean; there is no truthiness and no coercion |
| `if (e)` | `e` boolean |
| `self.set(:p, e)` | `e` is `p`'s declared type and, for an integer, within its range where the compiler can tell |
| `self.adjust(:p, e)` | both integer; the result is clamped to `p`'s range |
| `self.add(:p, e)`, `self.remove(:p, e)` | `p` a list; `e` its element type |
| `x.get(:p)` | `p` is declared on `x`'s type; `x` is not of object type |
| `x.recall(:p)`, `x.remember(:p, e)`, `x.adjust(:p, e)` on memory | `x` composes `sprout.Actor`; `p` is in `self`'s `remembers` |
| `x.includes(e)` | `x` a list or a set role; `e` its element type |
| `x.count`, `x.count(K)` | `x` a container, a set role or a list; `count(K)` only on a container or a set role; `K` a kind in scope |
| `x.holds(y)` | `x` a container; `y` an object binding; true when `y` is directly in `x` |
| `x.is(K)` | `K` is a kind in scope; `x` an object binding |
| `bound x` | `x` an optional tool; inside the branch it guards, `x` is bound |

Inside `if (x.is(K)) { … }` the binding `x` narrows to `K` for the branch, so a kind's own properties are readable there. That is how anything of object type is read.

A `set` or `remember` whose value is out of range at run time is a fault; `adjust` clamps. The compiler catches the literal cases.

### Precedence

Operators bind in the conventional order, loosest first: `||`; `&&`; `==` and `!=`; `<`, `<=`, `>` and `>=`; `+` and `-`; the prefix `!` and `-`; then a reading such as `x.get(:p)`. Within a level, left to right. Parentheses group.

### Naming a value

`let` names the result of an expression for the rest of its block.

```sprout
as target for throw {
  permit {
    let ribs  = tools.count(Rib)
    let state = self.get(:state)

    if (ribs > 1)            { refuse "Two ribs at once is one rib too many." }
    else if (state == :wet)  { refuse "Too wet to take a tool at all." }
  }
}
```

A `let` is written once and never again. There is no reassignment, so a name means one thing everywhere it is in scope, and a reader never has to track where it changed. Its type is the expression's, exactly, so nothing is annotated.

It may name a value or an object binding, and it lives exactly as long as the binding it was made from — to the end of its block, and never in state. Naming an object does not make it storable.

Shadowing is a compile error. A `let` may not take the name of a role, an `each` variable, or another `let` already in scope, because two things answering to one name is the opposite of what naming is for.

Because an initializer is an expression, a `let` cannot write, send, move or narrate, which is why it is allowed everywhere an expression is: in a role's `permit` and `do`, in handlers and hooks, in consent guards, and in `describe`. The one exception is `let x = spawn …`, whose initializer is a statement, and which is therefore allowed only where `spawn` is. A `let` is not allowed in a passage — a passage has slots and blocks, not statements, and a passage that could bind values would be a program rather than prose.

A `let` is a statement and is charged as one, and reading the name is charged as any expression is. It is there to be read, not to save steps.

### Object identity

Objects cannot be stored, but they can be compared. A binding in scope — a role, an `each` variable, a handler's sender, `mover`, a `let` naming one of these — evaluates to the object it names, and `==` on two such bindings tests whether they are the same object.

Identity is therefore available for the length of a turn and never longer. Nothing in a property points at an object, so no reference dangles, no stored handle reaches past the containment tree, and what an object can reach is still decided by where it sits.

### Walking contents

`each` visits the direct contents of a container in range, one at a time, in the container's order:

```sprout
each pot: Vessel in self { send pot :fired }
each thing in cabinet    { … }        // thing is of object type
each tool of tools       { … }        // a set role
```

A kind filter binds only the contents that compose it and types the variable; without one the variable is an object. `each … of` walks a set role. There is no `each` over a list — a list holds values, and `{for … of}` renders them. Each iteration is charged as a step, and an `each` inside an `each` is what the step budget exists for.

### Per-actor memory

A `remembers` block declares properties held per actor rather than per object. Each entry is written exactly as a property is, and typed by the same rules:

```sprout
remembers {
  :handled   false
  :ward_seen Ward default oak
  :visits    0 min 0 max 99
}
```

A body may write several blocks; their entries combine as one, and a name in two of them is declared twice.

They are read with `x.recall(:p)`, written with `x.remember(:p, v)` and stepped with `x.adjust(:p, n)`, where `x` is any binding that composes `sprout.Actor` — most often `actor`, and in an `:entered` handler the `item` that arrived. Only the object that declared them may read or write them. No object can read another object's memory of anyone.

## Verbs and the grammar a visitor types

Turning what a visitor typed into something runnable, and running it, are two jobs. They live in two places. A **verb** is declared for the world and says what may be typed. An **object** says what part it can play in a verb, and what happens when it plays it.

Object-level grammar is about nouns — what a thing is called and answers to. World-level grammar is about verbs. Neither reaches into the other.

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

A verb names its **roles** and the **phrases** that fill them. The first role is the **target**, the thing the verb is done to, and every other role is a **tool**: whatever the sentence supplies besides the target, a thing (`with the brass key`) or a value (`about the press`, `to 7`). The word is a convenience — a topic of conversation is a tool only in this sense — and it is the word this document uses for every non-target role. Both lists may be short: `verb shove { role target  "shove [target]" }` takes no tool, and `verb look { "look" "l" }` has no roles at all, so only the actor plays it. A phrase always names the target and need not fill every tool: `"unlock [target]"` leaves `tool` empty, which makes it optional, under Optional tools. A verb with no phrases cannot be typed and can only be performed with `act`.

Verbs are declared by a world or exported by a library, never by an object. The standard library ships the common ones, so most worlds declare few of their own.

A role declares what fills it: a kind — `role target: Lockable` — which narrows what the parser will bind and types the binding; a value type, under Value roles; or nothing, in which case the role is filled by anything that plays it and is bound as an object.

### Playing a role

```sprout
kind Warded is sprout.Lockable {
  :sealed false

  as target for unlock {
    permit {
      if (self.get(:sealed)) { refuse "A second ward shimmers across the plate." }
    }
    do {
      say  "The bolt slides back."
      tell "{actor} opens {self}."
    }
  }
}

kind Key {
  :wear 0 min 0 max 99

  as tool for unlock {
    permit { if (self.get(:wear) >= 99) { refuse "The bit is worn smooth. It turns nothing." } }
    do     { self.adjust(:wear, 1) }
  }
}
```

`as tool for unlock` is both the claim that this thing can be a tool and the code for being one. There is no brand to compose and no phrase to own. Inside, `self` is the role-player, `actor` is whoever is acting, `here` is their place, and the other roles are bound by name.

### The actor's own part

Every verb has one more participant than its roles: the actor. A kind composing `sprout.Actor` may play it with `as actor for <verb>`, and this is how the standard library writes the verbs a visitor takes for granted:

```sprout
verb take {
  role target
  "take [target]"
  "get [target]"
  "pick up [target]"
}

kind Actor {
  as actor for take {
    do {
      move target to self
      say  taken
      tell takes
    }
  }

  passage taken default { You take {target}. }
  passage takes default { {actor} takes {target}. }
}
```

`take` is nothing the engine knows. It is a verb, a `move`, and two passages a world may replace by writing its own — which is also how a world writes them in another language.

### The two passes

An understood command produces one **reading**: a verb, an actor, and its roles filled with objects or values. Running it is two passes over the participants, the actor first and then the roles in the order the verb declares them.

The **consent pass** runs every `permit`. These are read-only — no writing, sending, moving or narrating — and the first refusal halts the whole reading, its text becoming the entire output. Same shape as `depart`, `release` and `accept`, for the same reason: a poll that can change the world is a poll you cannot trust.

The **effect pass** runs every `do`, in the same order. The first role's usually carries the sentence; the others act and mostly stay quiet, so a wheel can learn it is dirty without saying so. When the pass ends, the queue drains.

A participant with no `permit` consents. A participant with no `do` does nothing. A visitor's reading whose effect pass says nothing to them is answered with the world's `nothing_happens` passage, so that acting is never met with silence; an NPC's is not; the compiler warns about a verb that no player ever `say`s for.

### Word order stops mattering

*Unlock the cabinet with the brass key* and *use the brass key on the cabinet* produce the same reading, the same roles bound to the same objects, run in the same order. Two objects can never claim one command, because neither of them owns it.

A verb is offered when its roles can be filled; `permit` decides what happens when it is tried, and says why in the author's own words. Possibility is the chip's business and permission is the prose's — and because `permit` is pure, a client may ask it ahead of time and grey the chip with its reason.

### Roles compose

`as <role> for <verb>` is a composable member. Every composed kind's `permit` runs and any refusal decides; every composed kind's `do` runs in composition order. `sprout.Lockable` carries the ordinary refusal and a world's own `Cursed` adds another, neither knowing about the other.

### Slots

A slot in a phrase names a role. Nouns resolve through an object's identifier and the `nouns` in its grammar block, and a role's declared kind narrows what may fill it — it constrains matching and is never a source of refusal text. When nothing present can fill a required role, the phrase does not match.

Position decides which slot a noun fills. The literal words already do most of the work — in `"use [tool] on [target]"`, `on` pins both — and where they do not, the order in the phrase does.

### Set roles

A role marked `many`, the target included, is filled by every object the visitor names in one run.

```sprout
verb throw {
  role target
  role tools many
  "throw [target] using [tools]"
}
```

*Throw the clay using a sponge and a wooden rib* binds both tools. A set role holds up to a host-set number of objects, in the order typed, duplicates collapsed, and it exists for the turn only. A phrase that leaves it out — `"work [target]"` — binds it as the empty set, so `tools.count` is zero and a loop over it runs no times; a set role is never optional in the sense below, because the empty set is already an answer.

**Each filler permits and acts for itself.** The metal rib refuses on its own behalf, in its own words, and the first refusal halts everything. Inside any participant's body the whole set is bound by name, so the target can ask `tools.count(Rib) > 1` and decide that one rib is one too many.

Operations on a set: `count`, `count(Kind)`, `includes(x)`, and `each … of`, which binds each member at the role's kind.

A run is either several single slots or one set slot, never a mix. Parsing splits on `and` and commas literally and resolves each noun independently, so cost stays linear in the length of the command.

### Optional tools

A visitor does not fill every slot every time. *Shove the statue* is a reading of a verb that also takes *shove the statue with the pole*, and the body that plays `target` runs either way. What it sees is decided statically, from the verb's phrases.

A tool that some phrase leaves out is **optional**; a tool that every phrase fills is not, and needs nothing. Every value tool is optional as well, because what a visitor types is never one of a closed set until it has been checked against one: see A role-player narrows its own options. Inside a body, an optional tool may be read only under a test that narrows it, the same move `is()` makes for the object type:

```sprout
verb unlock {
  role target: Lockable
  role tool
  "unlock [target] with [tool]"
  "unlock [target]"                      // tool is optional: this phrase leaves it out
}

kind Warded is sprout.Lockable {
  as target for unlock {
    permit {
      if (bound tool) {
        if (!tool.is(Key)) { refuse "{tool} is not a key." }
      } else {
        refuse "You need something to turn the lock with."
      }
    }
  }
}
```

Inside `if (bound tool) { … }` the tool is bound and typed as its role declares; in the `else` branch, and anywhere outside the test, reading it is a compile error that names the phrase which leaves it out and says what to write. No value stands for an unbound tool, so nothing compares to one, stores one or renders one; the author is never asked to remember which slots a visitor might skip, because the compiler says so at the line.

A verb with no phrases has nothing to infer from, so it says which tools may be missing: `role tool optional`. Only such a verb writes `optional`, and only on a tool, since the target is never optional; on a verb with phrases the phrases decide. `act` may leave an optional tool unnamed, and may never leave out one that is not.

### Value roles

Not every role is filled by a thing you could pick up. A subject of conversation, a setting on a dial, a number on a keypad — each is something the visitor names rather than something the world contains.

A role may declare a value type instead of a kind: `symbol`, or `integer`. Not a string. A string role would be the one place unmoderated player text enters a world, and every case is served by an enum or a number — a password is an enum of accepted words, and a wrong guess arrives as an unbound tool, under Optional tools, carrying nothing of what was typed.

```sprout
enum Topic { bridge, toll, weather }

verb ask {
  role target
  role topic: symbol
  "ask [target] about [topic]"
  "ask [target] [topic]"
}

kind Guard {
  :knows [Topic] default [bridge, toll]

  as target for ask {
    topic from :knows
    do {
      if (bound topic) {
        if (topic == :toll) { say toll_speech }
        else                { say bridge_speech }
      } else {
        say "The guard has nothing to say about that."
      }
    }
  }
}
```

`symbol` says only that the role is filled by an option; *which* enum is the role-player's to say, and it says so with `from`.

### A role-player narrows its own options

`topic from :knows` names a list property. The options in it are what a client offers, and a typed value among them binds; inside the body `topic` is typed by the list's element type, so `topic == :toll` checks against `Topic`. Anything else the visitor supplies — *ask the guard about potatoes* — still matches the phrase, and arrives with `topic` unbound, so the guard's `else` branch is where "he has never heard of potatoes" is written. A value tool is therefore always optional, whatever the phrases say: a typed value is never naturally closed, and a client that offers chips is simply one that never produces the unbound case. Without a `from`, a `symbol` tool has no options for this role-player at all, so it is never bound here and the body may not read it, not even under `bound`.

A guard learns a topic by adding to the list, which is why list mutation earns its place here. An `integer` role narrows the same way, with `from` naming an integer property whose range bounds it; a `from` may also give a literal range, `topic from 1 to 12`. A number inside the range binds; one outside it, or no `from` at all, leaves the tool unbound, exactly as for a symbol.

This is also the oldest problem in parser interactive fiction, which is that a visitor cannot guess what to ask about. Because the options are declared and narrowed per object, they are data the runtime exports along with everything else a client renders — the same derivation behind completion and chips. How a client presents them, including asking for the target first and the topic second, is the client's business and not the language's.

A value role binds a value, so `topic` is compared with `==` and never sent to, moved or read from. It is a symbol like any other, which is the whole reason the type is closed.

A value tool is single: `many` on a `symbol` or an `integer` tool is a refusal at this level. Several values are several tools, or a set of objects that stand for them. A later level may add a set of values, bound as a list and all or nothing; nothing accepted now would change if it did.

### Acting

An object that composes `sprout.Actor` may perform a verb itself:

```sprout
object cat is Creature {
  on :stir {
    each p: Creature in composing_room {
      if (p != self && chance(4)) { act nuzzle (target: p) }
    }
  }
}
```

`act <verb> (<role>: <binding>, …)` builds a reading with `self` as the actor and runs it on the spot — the consent pass, the effect pass, everything a typed command would do — and continues when it is done; a refused `act` ends the body it stands in, as a refused `move` does. Roles are named, so no phrase is needed and a verb with no phrases is a verb only an NPC can perform; an optional tool may be left unnamed, and one that is not optional may not. `act` is legal only in a body whose `self` composes `sprout.Actor`, and it is charged like any other work; an `act` inside an `act` counts against cascade depth.

Inside the reading, `actor` is the cat. Nobody is behind it to read its `say` lines, so they come from it instead: everyone who would hear its `tell` hears them as the cat speaking, *the cat says "miaow"*, in fixed words the engine supplies rather than a passage. A reading of an NPC's that says nothing has no output; `nothing_happens` answers only a person. Its `tell` lines reach everyone present as they would for a person. This is what makes an NPC and a visitor the same thing to a world: the cat enters a room with `act go`, carries a toy with `act take`, and licks a hand with a verb the world declared, and every rule that governs a person governs it.

### Moving something

```sprout
move target to self
move item to cellar
```

`move <object> to <container>` proposes a move exactly as a typed `take` does: the three guards under Movement and consent run, with `mover` bound to the object whose body ran the statement, and on a refusal nothing moves, the refusal text is said to the actor if there is one, and the body that ran the `move` ends there: the first refusal ends the work, so `take` never says it took what it could not carry. On success the engine performs the write and sends the three messages. `move` is a statement for a `do`, a handler, a hook, a tick or a wake; never a guard, a `permit` or a `describe`. It is how every standard library verb that moves anything is written, and it is available to a trapdoor, a conveyor or a tide on the same terms.

### Exits

An exit is a way out of a place: a direction, a label, and where it leads.

```sprout
grammar {
  exit out  "back to the yard"    -> yard
  exit down "down the coal stair" -> cellar
}
```

The direction is what makes `go down` work, and comes from a closed set — `north`, `south`, `east`, `west`, their diagonals, `up`, `down`, `in` and `out` — each with its usual abbreviation, and a bare direction is `go`. The engine's `go` declares its one role as `exit`, a role type only it may use, filled by the direction or label of an exit that applies. The label is what the visitor reads on a chip, and the engine accepts the label typed as an alias for the direction, so what a screen reader speaks can be spoken back. An exit is only reachable on a place, because only a place holds visitors; declaring one elsewhere is a compile error, and so is one whose destination does not hold actors.

### An exit may be conditional

This is how a world changes shape.

```sprout
grammar {
  exit north "deeper into the dark" -> maze_hall when (!self.get(:lamp_lit))
  exit north "toward a grey light"  -> meadow
}
```

Several exits may share a direction. The first whose guard holds is the one that applies, and one without a guard always holds — so a run of them reads as the `if`/`else` chain it is. An exit that does not apply is not offered, not traversable and not mentioned. A guard that reads through something out of the place's range does not fault the poll: the exit does not apply, as an unset link does not.

Guards are read-only and pure, as a description is, and for the same reason: they are evaluated on every poll to build what a visitor can see and say. A maze whose halls all lead back to themselves until a lamp is lit needs no more than this, and nothing about the map is stored.

### Places inside places

A place is an object, so a place may sit inside one. A wardrobe that declares `contains actors` can be entered, shut, and left through a different door than the one you came in by.

```sprout
object bedroom is sprout.Place {
  grammar { exit in "into the wardrobe" -> wardrobe }

  object wardrobe is sprout.Place, sprout.Container {
    grammar {
      name    "wardrobe"
      article the
      exit out "back into the bedroom" -> bedroom
      exit in  "through the fur coats" -> narnia when (self.get(:snowing))
    }
  }
}
```

Everything this needs is already true. Range flows through the wardrobe's pass rule, so pulling the door shut cuts off the bedroom. `tell` reaches the wardrobe's occupants and not the bedroom's, because an actor's place is the nearest ancestor holding actors. And the way through to Narnia leaves the containment tree's shape entirely, because an exit says how the world is joined up, not what contains what.

An identifier belongs to the body it is written in, so `wardrobe` is a name only inside the bedroom. An exit elsewhere reaches it by path — `-> bedroom.wardrobe`. Places sitting directly in the world are written in the world's body and need no path, which is why most exits are one word.

An occupant of a shut container-place can always name the container itself and its exits — an object reaches its own container's surface as it reaches its own contents — so a visitor shut in the paper store can open it from inside, and nobody can be trapped by a lid.

### Links, for space that does not exist yet

An exit names its destination in source, so it can only ever lead somewhere an author wrote. A **link** is an exit whose destination is assigned while the world runs, which is what procedural and visitor-built space needs.

```sprout
kind MazeCell is sprout.Place {
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

`link` declares the way out and leaves it unset. An unset link does not apply — not offered, not traversable, not mentioned — which is the rule conditional exits already follow, so nothing needs a null to mean "nowhere yet."

`connect` assigns it, and writes only to self. A cell connects its own way forward; the new cell connects its own way back inside `on :spawned (from)`, where the spawner is already bound. `spawn` yields an ordinary object binding, so `let cell = spawn MazeCell in self` names the new place for the rest of the block.

### Why this does not reopen stored references

A link's destination is **write-only from the language's side.** It can be connected from a binding and never read back into an expression. So no null is ever observed, no dangling value is ever compared, and nothing can `get` through a link, `send` to it, or walk it with `each`. What an object may talk to still follows from where it sits; only the map grew. The sole consumer is traversal, which goes through the consent protocol like any other move.

Spawning into `self` is the idiom. Containment is not adjacency — exits and links do the joining — so a maze growing inside the maze is sound, and a cell can spawn into itself however deep it sits, where a spawn into the world needs the world in range.

Three things come with it. Procedural space counts against live instances like everything else, so a world that grows must prune; a cell that wakes and destroys itself once empty is the natural form. Destroying a place with a visitor anywhere inside it is a fault, because the alternative is destroying a person or moving them silently. And a link whose destination has been destroyed reads as unavailable rather than broken, which is the `absent` rule once more.

### Engine verbs

Six verbs are the engine's, because they read the world rather than change it: `go`, `look`, `examine`, `inventory`, `wait` and `help`. Their phrases are declared in the standard library like any verb's — `look` answers to `l`, `examine` to `x` and `look at` — so their words can be added to and translated, but they have no `do`:

- `go <direction>` proposes moving the actor through the applicable exit, exactly as `move` would; on success the actor reads the new place's description.
- `look` renders the actor's place through its `describe`; `examine <thing>` renders the thing's, or the world's `unremarkable` passage if it has none.
- `inventory` renders the actor's own `inventory` passage, which `sprout.Actor` supplies.
- `wait` is a turn in which nothing is done, so a client can show what has changed.
- `help` renders what the actor can currently do, as text: the same derivation the chips come from.

Everything else a visitor can do by default — `take`, `drop`, `put`, `give`, `open`, `close`, `unlock`, `ask` — is a standard library verb written in Sprout, and a world that wants them to say or do something else writes its own.

### Reserved names

An authored message may not take the name of an engine message: `:spawned`, `:woke`, `:tick`, `:moved`, `:left`, `:entered`, `:arrived` or `:departed`. A world's verb may not take the name of an engine verb. `describe`, `depart`, `release`, `accept`, `permit`, `do`, `passage` and `prose` name members and are not available as message or verb names either. A reserved word, listed under The compiler › Lexical rules, may not name an enum's option, a role, a `let` or any other binding.
## Events, messages and the bus

Objects change their own state and tell each other about it. A message is **queued, never called**: the sending body runs to completion, then the queue drains, breadth-first, in insertion order. Within one body your own state holds still, which is the invariant everything below protects.

### Declaring a message

```sprout
message :stir
message :unlock_attempt
message :illuminating with boolean
```

A message is declared beside verbs and enums, by a world or a library, with the type of the value it carries if it carries one. Sending an undeclared message, or a declared one with the wrong value, is a compile error, which is what makes a misspelled `:illumnating` an error rather than a handler that never fires.

### Sending

```sprout
send oak_door :unlock_attempt          // directed, to one object in range
send from :unlock_failed with 2        // to a bound object, carrying a value
broadcast :illuminating with true      // outward and inward through containment
```

A directed `send` names an object in range; one that is out of range when the statement runs is not sent to, and nothing else happens. A `broadcast` walks containment:

1. The sender's own contents receive it, always.
2. The sender's container receives it if that container passes it. A container that receives a broadcast hears it, and then delivers it to everything else it holds; where one of those is itself a container, its contents receive it only if it passes.
3. The container's own container receives it in turn if it passes, and so on outward, until a container refuses.

So a lamp in a shut cabinet lights nothing outside the cabinet; a room's broadcast reaches everything in the room and stops at the world unless the world passes; and everything in a container hears what enters it, including a shut chest, though what the chest holds hears only if the chest passes. Containment is a tree, so nothing is delivered twice.

### Receiving

```sprout
on :illuminating (from, value) { self.set(:illuminated, value) }
on :fired (from)               { … }
on :gust                       { … }
on :pong (_, value)            { … }
```

A handler for an authored message binds the sender, as an object, and the carried value, typed by the declaration; `_` leaves a parameter unnamed and either may be omitted. The engine's own messages bind what they name instead: `:entered (item, from)`, `:left (item, to)`, `:moved (from, to)`, `:arrived (actor, from)`, `:departed (actor, to)`, `:spawned (from)`, `:tick (elapsed)`, `:woke (elapsed)`. A sender binding is live for the length of the handler and cannot be stored; to read its properties, narrow it with `is()`.

A hook is the same shape for the object's own changes: `changed :lit (was) { … }` is queued when `self.set(:lit, …)` actually changed the value, once per change, with `was` captured at that moment. A body that sets a property twice queues two hooks.

### Handlers do not refuse

There is no `refuse` in a handler, and a sender never learns what happened. A handler decides by writing or not writing, so `if`/`else` already is the decision, and a refusal would imply a return channel that queued delivery does not have.

When the sender needs to know, the receiver tells it:

```sprout
on :unlock_attempt (from) {
  if (from.is(Key)) {
    if (from.get(:opens).includes(self.get(:ward))) {
      self.set(:locked, false)
      tell "The wards give and the bolt slides back."
    } else {
      tell "It goes in, but nothing turns."
      send from :unlock_failed
    }
  }
}
```

and the key answers for itself in `on :unlock_failed { tell "The brass shears at the shoulder." }`. Two events, in narration order, and the key keeps its voice.

This is the exception rather than the pattern. A sender that needs the answer often signals that the verb belongs on the other object, where one body can decide with no message at all. Reply-by-message is for the cases where the split is worth it — a brittle key, a machine that reports back — and most worlds will never need it.

### Containers route

A container decides what passes through it, for everything it holds. Routing is the container's policy, never the item's, so an item does not know whether it sits in glass or oak.

```sprout
kind GlassCase {
  contains
  pass :illuminating (true)
  pass any (false)
}
```

`pass :m` answers for one message; `pass any` answers for the rest. A kind that declares `contains` and no pass rule relays everything — no rule means no policy — except the world, whose unwritten rule is `pass any (false)`. `sprout.Container` is what makes a lid matter, with `pass any (self.get(:open))`; `sprout.Actor` is what makes a pocket private, with `pass any (false)`.

### Bounds

Every event — a delivery that runs a handler or a hook, charged once however many of its handlers run — is charged against the turn's budget; a delivery to something with no handler for it costs nothing. A cascade deeper than the limit faults rather than running on. An object may hear the same event twice by two routes; that is the builder's to handle, and it is visible in the transcript.

## Movement and consent

Consent is not a mechanism Sprout adds. It is what falls out of only an object being able to write its own state: if the lock owns `:locked`, the key can do nothing but ask, and the lock decides by writing or not. Every two-party interaction in the language works this way, and needs nothing beyond a handler and an `if`.

Containment is the exception, and the only one. **No object owns the tree** — it is the engine's state. So when something moves, the write rule cannot find a single owner to ask, and the engine polls everyone with standing instead. That poll is the consent protocol, and it exists because containment is the one piece of state no object owns.

### The three roles

A move has a thing, a source and a destination. Each answers for itself:

```sprout
depart  (to)          // the thing moving
release (item, to)    // the container it is leaving
accept  (item, from)  // the container it is entering
```

The engine asks in that order and stops at the first refusal, which supplies the text the actor reads. Thing before source before destination puts the most specific voice first: a pot too soft to lift should say so before the shelf mentions being crowded.

Inside a guard, `mover` is bound to whatever proposed the move — the actor of a `take`, the object whose body ran `move` — as an object. A guard ends in `allow`, in `refuse "…"`, or by reaching its end, which allows. Where a guard is not written, the engine allows; every policy, including capacity, is a guard some kind wrote.

```sprout
accept (item, from) {
  if (self.count >= self.get(:capacity)) { refuse "No room on the shelf." }
}
```

`sprout.Actor` writes the guards that make a person's things their own: it departs only when the mover is itself, so nobody is carried off; it releases only to its own hand, so nobody is picked; and it accepts what fits, so a gift arrives if there is room for it. A world's visitor kind composes those, and a world that wants more of a person's guards writes them on a kind its visitor kind composes.

### Guards are read-only

A guard may read and decide. It may not write, send, move, spawn or destroy. This is what makes the poll safe to run inline, and it is the reason handlers are queued while guards are not: a guard cannot change the world underneath the decision it is part of.

It is also why a guard has no voice beyond its refusal text. Narration belongs after the move, not inside the question.

### The engine polls; containers do not delegate

The engine asks each role directly. A source container is never responsible for asking what it holds, because a container author who forgot would silently delete the thing's own veto.

This is the mirror of routing. Routing is policy, so containers own it and may answer differently per message. Consent is an invariant, so the engine owns it and nobody can opt out.

### After the move

Once every guard allows, the engine performs the single write and then tells the world: `:left (item, to)` to the old container, `:entered (item, from)` to the new one, and `:moved (from, to)` to the thing itself. When the thing is an actor, the engine also speaks, since both containers are places: every visitor in range of the old place reads its `leaves` passage and every other object in range of it is sent `:departed (actor, to)`; every visitor in range of the new place reads its `arrives` and every other object in range of it is sent `:arrived (actor, from)`; and the one who moved reads the new place's description. The one who moved hears neither notice. A move that would make a container hold itself is refused before any guard, in the world's `inside_itself` passage.

These are ordinary queued messages. They run after the move is committed, so they may write, send and narrate freely. A move must not make a container hold itself; a `move` that would is refused by the engine before any guard is asked.

### One rule for many opinions

Conjunction appears in three places and reads the same way in all of them. Guards composed into one kind all run. The three roles in a move all run. Contributions from composed kinds to a handler all run. In each case every contribution runs, any refusal decides, and the first refusal supplies the voice.

## Prose

Three statements put words in front of a visitor, and each has an audience.

| statement | reaches | where it is allowed |
| --- | --- | --- |
| `text` | whoever is looking | `describe` only |
| `say` | the actor | a role's `do` |
| `tell` | everyone in the place except the actor and the participants | a role's `do`, a handler, a hook, a tick, a wake |
| `tell <x>` | one actor, `x` | the same |

A **passage** is a named block of words belonging to a kind, for prose too long to sit in the middle of behaviour, and any of the four takes one in place of a string, as does `refuse`.

`actor` and `here` are bound where a person is acting: in a role's `permit` and `do`, in `describe` — where the actor is whoever is looking — and in any passage those invoke. A handler, hook, tick or wake has no actor: it may `tell` the place, and it may `tell` a particular actor it has bound, but it has nobody to `say` to. The compiler enforces this exactly: a passage that renders `{actor}` may only be invoked from a body where `actor` is bound.

### Passages

A passage is an ordinary member that happens to be mostly words. Inside it `self` is the owning object and `actor`, where bound, is the visitor, the same frame as any other member — it is not a function and nothing is passed to it.

Short ones sit inline. Long ones live in a file the kind points at — one `prose` line to a body, and one body to a file — so a reader of the kind can still see that it has words and where they are:

```sprout
kind MagicMirror {
  prose "mirror.prose"
  :mood Mood default drowsy

  describe { text greeting }
}
```

```
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

A passage belongs to its kind, so every slot in it type-checks against a known `self`. It may also use the bindings of the body that invokes it — `actor`, `here`, a role by name, an `each` variable — and it may then only be invoked from a body where those bindings exist; the compiler checks this exactly, so `say taken` in the actor's `do` for `take` may render `{target}` and a handler may not. Lines in source are reflowed; a blank line is a paragraph break; a block that renders nothing leaves no paragraph behind.

A string given to `say`, `tell`, `text` or `refuse` is a one-line passage and carries slots. Nothing else does: a `name`, a noun, an exit label and a string property are plain text, and `{` in them is a brace.

### Slots

A slot is `{…}`; `\{` is a literal brace, and a backslash escapes in a passage as it does in quoted text.

| slot | renders |
| --- | --- |
| `{thing}` | an object: its article and name — "a brass key", "the press", "Marta" — or **you**, when the reader is that object |
| `{self.get(:mood)}` | the option word, humanised — `bone_dry` becomes "bone dry" |
| `{self.count}` | digits |
| `{actor.recall(:note)}` | the string as written |
| `{pot.greeting}` | another object's passage, run with that object as its own `self`; `pot` must be typed by a kind that declares `greeting`; it is given `actor` and `here` where the slot has them, and no other binding |

An object in a slot renders as its name, with the article its grammar block declared, except to itself. A line told to Marta that names Marta says "you", so one `tell "{actor} tags {self}."` reads correctly to the bystanders, and the target is told in the second person by a `tell self` the author writes for them. That is all `{actor}` ever was: a visitor is an object, and a visitor's name is their nickname, so nothing about it is special. The first letter of a rendered line is capitalised, which is where an object slot most often sits.

Listing what a place holds is a loop over its contents:

```
{for thing in self}{if thing != actor}{thing}{if $last}.{else}, {/if}{/if}{/for}
```

Booleans are refused — write an `if`. A bare list is refused: the separator and the empty case are voice decisions, and a loop hands both back to the author. Plurals are the author's too: `{if self.count == 1}one pot{else}{self.count} pots{/if}`.

### Conditionals and loops

```
{if self.get(:wet)}
Rain still beads along the grain.
{else if self.get(:on_fire)}
Not merely dry. Burning.
{/if}

{for thing in self}
{thing}{if $last}.{else}, {/if}
{/for}
```

`{for x in <container>}` walks contents, and `{for x: Kind in <container>}` walks only those composing the kind, typing `x` so its passages and properties are in reach; `{for x of <list>}` walks a list, and `{for x of <set role>}` a set role. All bind `$first`, `$last`, `$index`, counting from 1, and `$count`.

Conditions take no parentheses — the braces already delimit, and a paragraph should not carry the noise. This is the one place the language spells a condition differently from a body. A condition may compare, narrow with `is()`, and test identity; it may not add.

`{one of}…{or}…{/one of}` varies a block at random, under the restrictions in Chance below.

There is no `while`, no arithmetic in slots, and no nesting beyond loops, so a passage terminates by construction.

### Bounds

A passage may be long; a turn may not emit unlimited passages. The per-string cap that governs a literal `say` does not apply to passages, and the real bound is the turn's output budget together with total source bytes.

Loops are charged against the step budget like any iteration, passages nest no deeper than bodies do, and a passage invoking another object's passage is capped the way a cascade is, so two objects cannot describe each other without end.

## Other people

`say` speaks to the actor. `tell` speaks to everyone else who is there.

```sprout
verb pull { role target  "pull [target]" }

kind Lever {
  :thrown false

  as target for pull {
    do {
      self.set(:thrown, true)
      say  "The lever gives with a sound like a held breath."
      tell "{actor} pulls the lever, and somewhere below, water moves."
    }
  }
}
```

### Who hears it

A plain `tell` reaches every actor in the telling object's **place** — its nearest ancestor declaring `contains actors` — except the actor and except any participant in the current reading. Participants are people the author is already addressing: the actor with `say`, and a role-player who is a person with `tell self`, in the second person, in their own sentence. So a visitor who has climbed into a wardrobe that declares it hears the wardrobe's occupants and not the room, which is what being inside something should mean, and nobody reads the same event twice.

`tell <x>` reaches one actor, whoever `x` is bound to — `self` in a role a person is playing, `item` in an `:entered` handler, a loop variable. Told to an NPC, it goes nowhere.

Pass rules do not apply, because prose is not a message: a voice from inside a shut chest is heard, and an author who wants otherwise writes the condition.

`tell` is refused in `describe` and in every guard and `permit`, all of which are read-only, and it is dropped during catch-up after an absence. `say` is refused wherever `actor` is not bound; ambience is told to the place or it is not said at all.

### The visitor's name

`{actor}` renders the acting visitor's **nickname**: a name chosen for this microworld, supplied by the host, never a platform identity and never shared between worlds. The engine's own notices use it the same way, so a place announces arrivals and departures by the name the visitor chose here.

The host guarantees a nickname always exists, so the language never has to render an absence. The nickname is also the only thing about the person any object can read; nothing else about who they are is available, in prose or in an expression.

### What this costs

This is the one place visitor-supplied text renders in front of a third party, and it is therefore a moderation surface. Three things contain it: nicknames are moderated by the host before they are ever rendered, they are length-capped so none can overrun a line, and prose carries no markup, so a nickname is words and nothing else.

Because nicknames are per-world, a name a bystander sees says nothing about who that visitor is anywhere else. That is the property per-world scoping exists to protect, and `tell` is where it earns its keep.

One `tell` produces a line for every actor present. The output budget is counted per recipient, so a crowded room costs the host more and the actor nothing: a turn never faults because of who else was there.

### Talking to each other

Two people in one place have no verb for speaking freely to each other, because free text is the one thing a world must never carry. Conversation between visitors is the host's, alongside the world and outside its log, and a client shows it beside the world's words. Within the world, people speak through the verbs it declares — `ask`, `tag`, whatever the author gives them — and through what they do.

## Time

A world moves without being poked, two ways. A **tick** is ambience: it only means anything when someone is there to perceive it. A **wake** is a process: it happens whether or not anyone stayed to watch.

### Ticks

Periodically, each place holding a visitor receives `:tick`, as a turn of its own. Empty places receive nothing, so cost follows occupancy rather than the number of worlds that exist. How often is the host's to decide and to tune under load; the language says only that it happens, and never names an interval a world could come to depend on.

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

The tick reaches the place and no further. A place that wants its contents to stir sends or broadcasts onward, so fan-out is the author's decision and is visible in that place's own source.

A tick is a turn: the same budgets, the same write lock, the same serialization as a typed command. A place whose last tick has not yet run is not ticked again; the missed interval is folded into the next `elapsed`. A tick that faults is dropped.

`elapsed` carries the seconds since the last tick this place actually received, and 0 on its first. Skipping is therefore invisible to an author who accumulates it, and wrong only for one who counts deliveries, which is the same discipline wakes already ask for. An author who wants something to happen about once a minute writes it against `elapsed`, not against `chance`, because how often a tick arrives is not theirs to know.

A tick that changes nothing visible says nothing. Silence is the default, and a place that narrates every tick is a place nobody can read.

### Wakes

An object asks to be woken:

```sprout
verb fire { role target  "fire [target]" }

kind Kiln {
  :state Firing default cool

  as target for fire {
    do {
      self.set(:state, :firing)
      wake in 3 hours
      say "The chamber takes the flame."
    }
  }

  on :woke (elapsed) {
    self.set(:state, :cool)
    tell "The kiln ticks as it cools."
  }
}
```

`wake in <n> seconds | minutes | hours`, with `n` a whole number written out and the unit always plural (`wake in 1 hours`), schedules one wake, no sooner than the shortest interval the host allows: a shorter wait is raised to it, and nothing is said. An object has at most as many pending as the host allows, and a `wake` past that faults, as a `spawn` does when the host will hold no more; so pending wakes are bounded by live instances. Nothing is charged while a wake waits. A wake is a turn of its own; a wake that faults is consumed and logged, not retried.

`elapsed` is how long has actually passed since the wake was asked for, in seconds, and may exceed what was requested. That is what makes a missed wake recoverable: a kiln reads "long since cooled" and a plant computes its growth stage from elapsed rather than being stepped through five times. It is the only way time enters an expression, and it arrives as a parameter rather than as a clock, so nothing else in the language can read the hour.

### Absence

Whether wakes fire while a world is empty is the host's policy, not the language's. The language guarantees only that every due wake is delivered once, oldest first — by when it fell due, then in the order it was asked for — and that `elapsed` reports the true interval, which is what lets a host choose to run them live, to fast-forward on the next arrival, or to stop an empty world entirely. Catch-up delivers one wake per object; if that wake asks for another, it waits for live time. A catch-up wake that faults is consumed and what it did is abandoned, and the other objects' due wakes are still delivered.

What the language does fix is that **catch-up does not narrate**. A wake delivered after an absence applies its state changes and its `tell` is dropped. Forty lines announcing what happened while nobody was there is worse than none, and the place's description already shows the result.

What this gives up is interleaving across objects during an absence. A candle that burns out and then ignites a curtain cannot have that ordering reconstructed. The alternative is replaying an unbounded backlog on the visitor who happens to return, which costs more than the ordering is worth.

### Determinism

Everything else in Sprout is deterministic given the world and the commands typed. Ticks and wakes introduce wall-clock, so the guarantee becomes deterministic **given the event stream**: ticks and wakes are recorded in the log alongside commands, and a replay of that log reproduces the world exactly. A transcript therefore contains lines nobody typed, and the log is what a moderator reads.

## Chance

Worlds need variation. A cat that does the same thing every time is furniture, and a wind that rises on a counter is a metronome. Sprout has three ways to be uncertain, and one rule about where uncertainty is allowed.

### The forms

```
{one of}
The cat considers you, and declines to be interested.
{or}
The cat's tail moves once, which is not agreement.
{or}
The cat is asleep, or doing a convincing impression of it.
{/one of}
```

`{one of}…{or}…{/one of}` picks one block, uniformly, in prose. In an expression, `chance(3)` is true one time in three, and `random(6)` is an integer from 0 to 5. The bound of `random` and the argument of `chance` are positive integer literals.

Random is the only kind of alternative. There is no form that runs through its entries in order, cycles them, or shows each once and then stops, and the reason is that all three need to remember where they got to.

Such a counter would be state nobody declared: absent from the property map a moderator reads, keyed to a position in the source that moves the moment an author adds a paragraph, and multiplied by every visitor if it is to mean "the first time *you* saw this."

Write the state instead. It is barely longer and it says what it means:

```sprout
object composing_room is sprout.Place {
  remembers { :visits 0 min 0 max 99 }

  on :entered (item, from) {
    if (item.is(Creature)) { item.adjust(:visits, 1) }
  }

  describe {
    if (actor.recall(:visits) <= 1) { text first_sight }
    else                           { text familiar }
  }
}
```

The explicit form is also the more correct one. A sequence would advance on each *render*, and a description renders whenever anyone polls — so "the first time" would be spent by a poll that happened because somebody else acted in the room. What an author means is the first *visit*, and only a counter they wrote can say so. The `<= 1` is because the description is derived after the turn that moved the visitor, by which time the handler has already counted them.

The same goes for the other two. A lever that grinds differently after its first pull sets a boolean in its `do`, which may write where a description may not. Ambience that should not repeat is usually better random than cyclical anyway.

### Where chance is forbidden

Not in `describe`, not in an exit's `when` guard, not in a consent guard, and not in a `permit`.

All four are polled or decisive rather than performed. A description re-runs on every poll, so a random one shimmers — the place rewrites itself while the visitor stands still and does nothing. An exit's guard is evaluated to build what a visitor can see and go, so a random one offers a way out that vanishes when taken. And a guard or a `permit` is asked as part of a decision it must not change.

The restriction is transitive: a passage reachable from a `describe` may not use chance, and the compiler checks reachability across the closed bundle the same way it checks that `say` and `tell` never appear in a description. Because a slot that invokes another object's passage names that object's kind, reachability is exact: `{pot.greeting}` reaches the `greeting` of kinds composing `Vessel` and no other.

Variation in a description belongs to the world's state, not to the die. A cat that is sometimes asleep should *be* asleep, on a property, changed by a tick — which is also what makes it the same cat to two visitors standing in the same place.

### The seed

Each turn draws from a seed the host supplies and records in the event log beside the command. Draws within a turn are sequential, and execution order is already fully determined — the actor's body, then each role's, then the queue breadth-first in insertion order — so replaying a log reproduces every draw and therefore the whole world. A poll draws nothing, because nothing it may run is allowed to.

A moderator reading a transcript sees results they did not roll. That is tolerable here in a way it would not be for compiled code: the log is server-side, the seed is in it, and the world's source is prose, names and rules that can simply be read.
## Extensions

An extension adds to the language and to the runtime: a value type, the statements that use it, and the code that makes something happen once a turn is over. A library is Sprout, vendored into the bundle, and adds nothing an author could not have written. An extension is code, installed by the host, and adds what Sprout cannot say.

|  | libraries | extensions |
| --- | --- | --- |
| written in | Sprout | TypeScript |
| travels | vendored in the bundle, content-hashed | installed by the host, pinned by the world |
| trusted by | nobody — it runs in the evaluator | the host administrator, explicitly |
| adds | kinds, enums, verbs, messages | value types, statements, effects, rendering |

The boundary is the point. A world may carry any library it likes, because a library cannot do anything a world could not already do. A world may not carry an extension, because an extension is code on the runtime side, and that is a decision only a server administrator can make.

### The rule

**An extension statement records an effect; it never performs one.** `run` is handed a frozen, read-only view of the frame and returns a value appended to the turn's outcome. What happens because of that effect — a viewer panel opening, a signed URL, a line in a terminal — happens after the turn, outside the evaluator, and the world never learns whether it happened.

This is what keeps every other guarantee intact. An extension cannot write world state, cannot move anything, cannot be waited on, and cannot make a turn take longer than its budget allows.

### What an extension may add

A **value type**: how it is written as a literal, how it persists, what it defaults to, how it prints. A type must also declare how it compares and how it renders in prose, or declare that it does neither — so the compiler always knows whether `==` and a `{slot}` are legal for it, rather than discovering at runtime that there is no answer.

**Statements**, with their arguments, a compile-time check, and whether they may appear in `describe`. A statement allowed in `describe` records its effect into the view; one that is not is refused there. None may appear in a guard or a `permit`. An **effect** shape a host validates against. A **transcript line** — the words a text-only client shows instead. And a paragraph for the generated skill, in a builder's terms.

An extension may **not** add properties to every object. A property belongs to the kind that declares it, so an extension that wants one ships a library alongside: `media.Illustrated` declares `:image`, and an object composes it. The value type is the extension's; the property is ordinary.

### Activation and absence

A world names the extensions it uses, pinned by major version, in its manifest and at the top of each source that uses one. A host without that extension, or with an incompatible major version, does not refuse the world: the extension's statements record nothing, its value types hold their defaults, and the visitor is told once, on entry, through the world's `missing` passage, that the world uses something this host does not provide and will be missing some of itself.

This is the `absent` rule again. A gap is visible and survivable; a world does not go dark because of what is missing around it.

### Effects are additive

**A world must read correctly with every effect dropped.** Prose is the substrate and an effect is enhancement, never the other way round. A `describe` with no `text` statement anywhere in it is a description that is empty on a text client, and the compiler refuses it.

That rule is what makes the rest of the negotiation possible. Clients differ in what they can render, and a client declares what it can handle; the host sends an effect's payload where it can be used and the transcript line where it cannot. The world is not told which happened, and cannot be — otherwise prose would fork by client, and the promise that a microworld is words would be gone.

The protocol by which a client declares its capabilities belongs to the host contract, not to the language.

### Trust

Extensions are host-trusted code, not sandboxed, on the server and now in the visitor's browser. The evaluator contains a buggy extension the way it contains a faulting object — a throw becomes a fault naming the extension, every run is charged, effects per turn are capped — but it cannot contain a malicious one.

So installing an extension is a decision about the safety of everyone who visits any world on that host, not only about the server. Extension names are one flat, host-curated namespace, and preventing collisions between them is the administrator's job at install time.

## Limits

There are two kinds of limit, for two different reasons, and keeping them apart is what makes both defensible.

**Static caps bound what a person must read** to know what a world does. They are checked when a world compiles, and exceeding one is a refusal naming the line.

**Runtime budgets bound what a turn may cost.** They are counted while running, and exhausting one is a fault: the turn is abandoned, the world is left exactly as it was, and whoever acted is told plainly through the world's `fault` passage.

**The numbers are the host's.** The language defines which limits exist and what exceeding each one means; the host running the world sets every value, and the figures below are the defaults a host starts from. A bundle records the static caps it was checked against at publish, and a host loading a bundle checked against larger caps than its own refuses to run it, unless the host has made an exception for that world; the exception is the host's to grant and to record. A limit the host leaves unset is unbounded: the language does not invent a figure for a host that set none, and what bounds the world then is the host process itself.

**There is no limit on statements in a body.** A cap there would bound cost in the one place only review effort belongs, and would push authors toward chains of `if` instead of prose. The step budget does that work, at runtime, where cost actually lives.

### Static caps

| cap | default |
| --- | --- |
| options per enum | 100 |
| roles per verb | 8, counting a set role as one |
| phrases per verb | 8, each at most 80 characters |
| nouns per object | 8, each word at most 40 characters |
| exits per place | 8 |
| elements in a list | 16 |
| a `say`, `tell`, `text` or `refuse` written as a literal | 600 characters |
| places, objects, kinds, files, total source bytes | as the host says |

`objects` counts every object the world starts with: the `object` declarations in the world's body, at every depth, composed or not, and every copy a kind's contents give a declared instance; `places` counts those whose composed kind holds actors, copies included; the world counts toward neither. `kinds` counts kind declarations in the world's files and in every usable library the host has not blessed, and not an object's anonymous kind.

Vendored library source is content-hashed and exempt from the source, kind and file caps, so using the standard library costs an author nothing. A modified copy is the author's own source and counts as it.

A passage has no length cap of its own. It is bounded by total source bytes on one side and the turn's output budget on the other.

Nesting has no cap. The compiler bounds its own recursion so that pathologically deep text is refused rather than crashing it; that bound is the compiler's, not a limit the host sets, and it is not recorded in the bundle.

### Runtime budgets

| budget | default |
| --- | --- |
| **steps** per turn | 50,000 — every statement executed, every expression node evaluated, every `each` iteration, every object a range walk visits, every noun the parser tries |
| **output** per turn, per recipient | 8,000 characters |
| events per turn | 256 |
| cascade depth | 20 |
| passage invocation depth | 8 |
| objects bound by one set role | 8 |
| spawns per turn | 8 |
| shortest wake | 60 seconds |
| pending wakes per object | 1 |
| steps per poll | 10,000 |
| wall clock | a backstop that should never fire |

A turn is a typed command, a tick, a wake, a maintenance turn, or a poll; the budgets are per turn, except pending wakes, which an object holds across turns. Parsing is charged to steps because typed slots make it real work, and a command that costs too much to read is a fault like any other.

Two bounds are the world's rather than a turn's, and outlive any turn. How many live instances a world may hold — every instance the host stores, dormant ones included — is the host's storage decision, not a figure in this table: when the host will not hold another, a `spawn` faults. How many wakes an object may have pending is the table's: a `wake` past it faults the same way, and with live instances it bounds how many wakes a world has waiting. There is no cap on spawns over time; what a world can accumulate is bounded by what the host will store.

The step budget is the one that matters. Totality guarantees a body ends; it says nothing about when. An `each` nested inside an `each` is total and, over a large room, effectively endless — the event budget never notices, because iteration emits no events. Counting steps is five lines in the evaluator and is the only bound that actually holds.

It is also **deterministic**, which is why it is primary. A step fault replays identically from the log; a wall-clock fault does not, and a limit that gives different answers on different days cannot be part of a moderation story. The clock is a backstop against something the step budget failed to catch, logged loudly when it fires, and never load-bearing.

### Cost that scales with people

Most limits bound what an author wrote. Three scale with how many people are present, and they are the ones to watch:

- A `tell` produces a line for every actor in the place. The output budget is per recipient, so a crowded place costs the host and never faults the turn; the host bounds the crowd.
- Ticks cost the tick interval times the number of *occupied* places. Empty places are never ticked, so the figure follows people rather than worlds.
- Write turns on one world are serialized. This keeps a pathological world from harming any other, and the step budget is what keeps it from harming its own visitors — it bounds how long any turn can hold the lock.

### What the limits do not cover

A wake that reschedules itself at the shortest interval, on a kind with many instances, is a load the host must be able to see. Every such wake is a turn in the log with its object named, and the instance bound is what limits what it can make; what they do not bound is the host's own time, which is why the wake floor is the host's to raise.

## The compiler

Source is the truth. A definition is rebuilt from source every time a world loads and is never persisted, so there is no compiled artifact to drift from what an author wrote or a moderator reads. Printing a definition and compiling it again yields the same definition.

### Lexical rules

- A comment is `//` to the end of the line, or `/* … */` across lines. A `/* … */` closes at the first `*/` and does not nest; one that is never closed is a refusal at its opening.
- Text in quotes takes the escapes `\"`, `\\`, `\n` and `\{`; a backslash before anything else is a refusal. A passage takes the same escapes, and `\{` is how it writes a literal brace.
- A `:` followed by a lower-case letter is a symbol: a property, a message, or an option in an expression. Anywhere else it is punctuation, which is why a label is written with the space, `act nuzzle (target: p)`.
- The reserved words are the type names `boolean`, `integer`, `string` and `object`; the value-role word `symbol`; the literals `true` and `false`; and the words of the language's own syntax: `accept`, `act`, `actors`, `allow`, `any`, `are`, `arrive`, `article`, `as`, `at`, `bound`, `broadcast`, `changed`, `connect`, `contains`, `default`, `depart`, `describe`, `destroy`, `do`, `each`, `else`, `enum`, `exit`, `finally`, `for`, `from`, `grammar`, `hours`, `if`, `in`, `kind`, `let`, `link`, `many`, `max`, `message`, `min`, `minutes`, `move`, `name`, `nouns`, `object`, `of`, `on`, `optional`, `pass`, `passage`, `permit`, `prose`, `refuse`, `release`, `remembers`, `role`, `say`, `seconds`, `send`, `spawn`, `tell`, `text`, `to`, `verb`, `visitors`, `wake`, `when`, `with`, `without` and `world`. None may name an enum's option or a binding.

### Two tiers

A single definition can be checked alone for its shape: syntax, the caps that apply to it, its own declarations agreeing with themselves, every write going to `self`. This is what an editor runs on each keystroke.

Everything typed needs the whole bundle: composition resolved across kinds, properties merged, exclusive members checked for collision, every `get` and `set` against a resolved kind, `chance` and `actor` reachability through passages, the world's word set. Because libraries are vendored, the bundle is closed, and whole-bundle checking is exact rather than a guess.

So an editor cannot catch every error live. That is a consequence worth stating rather than discovering.

### Strict and lenient

Saving and publishing are **strict**: any problem is a refusal. Loading is **lenient**: a file that is missing, withheld or broken reads as absent, what referred to it keeps compiling, and the world runs with a visible gap.

### What absent means

| reference | when its target is absent |
| --- | --- |
| a kind, in an object's composition | the object is absent: not in range, not listed, not addressable; what it holds is unreachable until the kind returns |
| a kind, in a role's declaration | nothing fills the role; the verb's phrases do not match |
| a kind, in a `spawn` | the `spawn` faults when it runs, and the actor, if there is one, reads the world's `fault` passage |
| a verb | its readings do not parse, and `act` of it does nothing |
| a message | sends of it go nowhere |
| a passage or `.prose` file | the slot or statement renders nothing, and the description is refused at publish if that leaves it empty |
| a place, in an exit or link | the exit does not apply |
| a place a visitor stands in | the visitor is moved to the world's arrival place on their next turn and told through the world's `displaced` passage |
| a place the world says visitors arrive at | the world does not admit anyone; entry fails as a host matter, the way a crash does, and the host says so outside the world |
| the `world` declaration | the same: the world does not admit anyone, and the host says so outside it |
| the world's visitor kind | the same: the world does not admit anyone, and the host says so outside it |
| an extension | its statements record nothing and its types hold their defaults |

Stored state for absent objects is kept, untouched, so that a file restored brings its objects back as they were.

### What it refuses

- A write to anything but `self`.
- `say`, `tell`, `text`, or any write, send, move, act, spawn or destroy in a guard or a `permit`; any of those but `text` in `describe`.
- `say`, `actor` or `here` in a handler, a hook, a tick or a wake, or in a passage reachable from one.
- `chance` in `describe`, in a `when` guard, in a consent guard or in a `permit` — including in any passage reachable from one.
- A comparison between different types, a symbol that is not one of its enum's options, an integer literal compared against a range it lies outside, arithmetic or a relation on anything but integers, a non-boolean where a boolean belongs, a `get` on a binding of object type, a `set` or `remember` of a literal outside its range.
- A property arriving from two origins under composition; an exclusive member — `describe`, a passage, a `pass` rule, `name`, `article` — arriving from two sources.
- A message or a verb taking a reserved name; a `name` beginning with an article.
- A composition written with the colon rather than `is`.
- A world that does not compose `sprout.World`, written as `sprout.World`; anything but a world composing it.
- A bundle with no `world` declaration or with more than one; a `world` declaration whose name is not the manifest's `name`.
- A `describe` with no `text`.
- `act` in a body whose kind does not compose `sprout.Actor`; an `act` that leaves out a tool that is not optional.
- A visitor kind that does not compose `sprout.Visitor`, or that is not one of the world's own kinds: `visitors are sprout.Visitor` included.
- `optional` on any role of a verb that has phrases, or on the target of one that has none; a phrase that does not name the verb's target.
- An optional tool read outside `if (bound x)`; `bound` on a tool that is not optional, or on a `symbol` or `integer` tool with no `from`.
- `many` on a `symbol` or `integer` tool.
- An unknown kind, enum, verb, message, property, passage, exit target or extension; an undeclared message sent or handled.
- A `move` whose destination is not a container; an exit declared on something that is not a place, or leading to something that does not hold actors.
- An `object` at a file's top level; an object inside something whose kind does not hold things; an actor declared inside something that does not hold actors; an object composing `sprout.Visitor`, and a `spawn` of such a kind; the world's name as a step of a path other than the first, or as an object's name; two objects of one name in one body.
- `visitors arrive at` naming the world itself.
- A `spawn` of `sprout.World`, or of a kind that composes it; `destroy self` in the world's own body.
- Any static cap exceeded.

### What it warns about

A handler nothing sends to, and a message nothing handles — the second symmetric with the first, so a `send` that will never arrive is visible at compile time rather than being a silent no-op forever. A world declaration shadowing an unqualified standard library name, except a kind that composes the library kind it hides, as `kind Visitor is Creature, sprout.Visitor` does. An object hiding one of its name further out, at the inner declaration, naming the path the outer one is now reached by. A verb no object plays a role for, and a role in a verb nothing fills. A verb with phrases that no participant ever `say`s for, which will fall back to `nothing_happens`. A passage on an object or the world that nothing invokes and nothing it composes declares, which is most often a misspelt override. An exit guard that is the literal `false`. `destroy self` in a declared object's body, or in a kind a declared object is made of. A `.prose` file no kind points at.

### Diagnostics

**Every problem names the line and column of the thing it is about.** Not the head of the definition — the token. This requires position spans on every node, and it is a requirement rather than a refinement: a type system that reports a hundred errors at line 1 is worse than no type system, because the author cannot act on any of them.

Messages are written for someone who is not a programmer, and say what to write instead:

```
kiln.sprout:23:9    `:door` holds one of open, closed — "closed" is a string.
                    Write :closed.

vessel.sprout:41:24  `:state` has no option `dyr`. Did you mean `dry`?
                     Options: raw, leather, dry, bisque, glazed.

cat.sprout:12:5      `say` has nobody to speak to inside `on :stir`.
                     Use `tell` to speak to the room, or `tell p` to one person.
```

How a page of them is laid out — the gutter, the wrapping — is the tool's business, and should follow the width it has.

### What compiling produces

A bundle: the manifest it was compiled from, the definitions, the world's complete word set, the language level, the extensions it pins, the hash of every vendored library, the static caps it was checked against, and which of those the host blessed at publish.

### Language levels

A level is how the language changes without breaking what already runs. Each part declares the level it needs — the manifest for the world, and each vendored library beside its source — and a declared level is a request, as a package asking for a version of its runtime is: nothing checks that a part uses what it asked for, and a world may ask for a level higher than it needs. A bundle's level is the highest of any of its parts, and a compiler refuses a bundle whose level it does not understand. A world accepted at one level keeps loading when the language tightens: refusals introduced later apply as warnings to it, not as errors — and the level it was accepted at is the bundle's, not the one its manifest asked for.

The language starts at level 1, and nothing here is shaped by compatibility with anything built before it. Level 1 is explicit wherever it could have defaulted — `sprout.World` is written, a default is written, a type is written where a literal could not name it — because a later level can relax a requirement it stated and can never add one to worlds already accepted.

### The generated skill

The builder's reference is generated from the compiler's own tables — the statements it accepts, the caps it enforces, the refusals it issues, the standard library's verbs and their phrases. It cannot describe a language the compiler does not implement, which matters because most Sprout will be written with a model in the loop, reading that reference. It is also the document ordered for an author — the worked example first, composition and routing last — where this one is ordered for someone checking the design.

## The runtime

### Turns

Everything that runs is a **turn**, and there are five kinds:

| turn | actor | writes | logged |
| --- | --- | --- | --- |
| command | the visitor who typed | yes | yes |
| tick | none | yes | yes |
| wake | none | yes | yes |
| maintenance | none | yes | yes |
| poll | the visitor looking, as `actor` | no | no |

Write turns on one world are serialized under a lock and run in a transaction: a fault abandons the transaction, and the world is exactly as it was; a maintenance turn abandons only the part that faulted, under Faults. A poll runs against the last committed state, holds no lock, draws no seed, and has its own step budget; it may run while a write turn runs, and sees the state before it.

Within a command turn, the order is fixed: parse; the consent pass; the effect pass, actor first and then roles in declared order; the queue, breadth-first in insertion order, including any reading an `act` starts and the messages a `move` sends; then the views of everyone present are marked stale. `act` runs its reading inline where it stands, and a `move`'s guards run inline where it stands, since guards are pure.

### The view

A visitor's **view** is what a poll produces: the description of their place, rendered with them as `actor`; the exits that apply, with their labels; who else is there; what they carry; and every reading the parser could build from what is in range — verb, fillers, the options of each value role — with the result of its consent pass, so a client can offer a chip, grey it, and say why. A view is derived when a client asks and is valid until the world's next committed write turn, which names every visitor whose view it made stale, so a host may cache it per visitor until then.

A poll that exhausts its budget yields a view whose description is the world's `unseen` passage, and is logged as an authoring fault against the object whose `describe` cost too much.

### Effects

A turn's output is a sequence of effects, each carrying its kind, the object it came from, the actor if there was one, and its recipient:

| effect | what it is |
| --- | --- |
| `said` | a line from `say` |
| `told` | a line from `tell`, to one recipient |
| `refused` | the consent pass's refusal text, to the actor |
| `described` | a description, to the one who moved or looked |
| `notice` | an engine-spoken passage — arrivals, faults, unknown words |
| an extension's | as it declares |

Every prose effect carries its rendered line, because words are true at the time they are said and moved state or a changed nickname cannot re-render them. A client that speaks — a screen reader — has in the effect kind what it needs to decide what to announce and how urgently, and a client that is a moderator reads the same record.

### State

The engine keeps, for every instance: a stable **id**; its kinds; its property map; its container's id; the destination of each link; its pending wakes; and its memory of each actor, keyed by that actor's id. For every place, when it last ticked. For every visitor, the visit, the nickname, the instance, and where they last stood. The visit is a UUID the host mints, keyed by the host's own opaque id for the person, so a person who returns finds their visit again, or starts a new one.

A declared object's id is its declared path — `printers_shop.composing_room.cabinet`. Names never change while a world runs; changing one in source, the world's own included, changes every id under it. Moving or renaming it in source is therefore a new object with the declared defaults; the old one's state is kept as for an absent object, in case the move was a mistake. A spawned object's id is minted at spawn and never reused.

Where stored state no longer fits a declared type, the value is dropped and the declared default stands. An actor found at load inside something that no longer holds actors, because the source changed under it, is an engine error the host reports loudly: nothing the language can do puts one there, since `contains actors` is fixed when the world compiles.

### The log

The host draws a seed for each write turn and records it beside the turn. The log holds, in order: every command, tick, wake and maintenance turn with its inputs and seed; every visitor's entry, exit and nickname; every publish, with the bundle's hash, so that a segment of the log is read against the bundle that produced it; every withholding by a moderator; and every effect. Polls are not logged. Replaying the log against its bundles reproduces the world exactly.

### Faults

| what faulted | what happens |
| --- | --- |
| a command turn | the transaction is abandoned; the actor is told through the world's `fault` passage; nothing else is logged but the fault |
| a tick | dropped |
| a wake | consumed and logged; the object is not woken again unless it asks |
| a part of a maintenance turn | that part is abandoned and its wake consumed; the rest of the catch-up is still delivered, and the visitor is admitted |
| a poll | the view carries the world's `unseen` passage |

Anything a turn's body throws is a fault, told as the table says, a defect of the engine's own that no rule of the language explains included; the host is told which faults are the engine's, to report loudly.

## The host contract

The language describes a world. The host runs it, and owns everything a world must not be trusted with. This is the seam, stated as obligations rather than as an interface, because a host may satisfy them however it likes.

### Admission and identity

A visitor enters with a **nickname**, and the host guarantees one exists before the world ever sees them, so the language never has to render an absence.

The host accepts a nickname only if it collides with nothing in the bundle's word set: no noun or token of one, no direction, article, connector or phrase word, and no other visitor's nickname. The word set travels with the bundle and is fixed at compile time, so this is a lookup rather than a scan of live state. A second Marta is asked for another name before entering.

A nickname may be kept and reclaimed on a later visit if it is still free. Reservations are soft; nothing is held against a returning visitor who has not come back. A republish that adds a noun a current visitor is named by does not evict them; they are asked for a new name on their next entry.

The host moderates nicknames before they are ever rendered, and length-caps them. It never exposes platform identity to a world — a nickname is scoped to one microworld and says nothing about who a visitor is anywhere else.

The host places an arriving visitor where the world says visitors arrive, or where they last stood if that place still exists and accepts them. Entry is a move, with `accept`, `:entered`, `arrives` and the description, like any other.

### Time

The host ticks places that hold visitors, chooses the interval, and tunes it under load. A place whose previous tick has not run is not ticked again until it has.

It decides whether wakes fire while a world is empty. Catch-up runs as a **maintenance turn** with its own budget, completed before the arriving visitor is admitted, so nobody walks into a place that is about to rearrange itself and nobody is charged for an absence they did not cause.

In both cases the host supplies `elapsed` truthfully. It is the only time the language can read.

### Conversation

Visitors who want to talk to each other do so through the host, outside the world: a chat beside the world's text, moderated as the host moderates, never entering the world's state or its log. A client shows the two side by side and never mixes them.

### Storage

The host persists the state described under The runtime, serializes write turns per world, and abandons the transaction on a fault so a failed turn leaves the world exactly as it was.

### Two decisions, of different kinds

**Installing an extension is a safety decision.** It is host-trusted code, unsandboxed, running on the server and in every visitor's browser. The host installs it, updates it, supplies the pinned major version, validates recorded effects against its schema, and negotiates with each client which effect kinds it can render.

**Blessing a library is a quota decision.** A library is Sprout; it runs in the evaluator and can do nothing a world could not already do. Blessing changes only whether its bytes count against an author's caps. The host keeps a set of trusted hashes — not a package manager, since nothing is resolved or fetched at run time — and blessing is its state, not a world's: a load honours what the host blesses now, both ways, so a library blessed since publish is exempt and one un-blessed since counts. A world an un-blessing pushes past the host's caps is the host's to handle. A modified copy is the author's own source and counts as it.

Where a world pins an extension the host cannot supply, the host tells the visitor once, on entry, that the world will be missing some of itself, and runs it anyway.

### Enforcement

The host sets every limit in Limits and enforces every runtime budget, including the wall-clock backstop that should never fire and is logged loudly when it does. It bounds how many people may be in one place, since that is the one cost the language cannot.

### Moderation and takedown

A file the host removes or withholds reads as absent: what referred to it keeps compiling and the world keeps running. A moderator reads the world's own source, with blessed libraries collapsed, and replays the log to see what actually happened. What objects remember about a visitor is opaque to that visitor: it shows only in how the world behaves and describes itself to them, and a debugging view may one day show it to the world's author. It is erased only when the visitor is deleted, when the host removes every entry keyed by them with their instance and everything it holds, all the way down, which is possible because memory is declared and keyed and nothing else about them is stored. An export for that visitor carries it, each remembering object's entry, since what an export hands on is the host's to decide.

### What the host may not do

It may not change a world's behaviour, write world state on a world's behalf, reorder recorded events, or let any part of one world observe another. A host that does any of these breaks replay, and replay is the only reason anyone can be held to account for what a world did.
## A worked microworld

A jobbing printer's shop, written to exercise as much of this document as a small world honestly can, with the standard library it needs written out beside it. What both surfaced is at the end, and it is the most useful part.

### The standard library it needs

```sprout
// sprout/world.sprout
kind World {
  contains

  passage unknown default         { That is not something you can do here. }
  passage not_here default        { You see nothing like that here. }
  passage which default           { Which do you mean: {for thing of candidates}{thing}{if $last}?{else}, {/if}{/for} }
  passage nothing_happens default { Nothing much comes of that. }
  passage unremarkable default    { There is nothing special about {thing}. }
  passage unseen default          { Something here is too much to take in. }
  passage fault default           { Something in this world has gone wrong, and nothing has changed. }
  passage missing default         { This world uses something this host does not provide, and will be missing some of itself. }
  passage displaced default       { The place you were standing is gone. }
  passage inside_itself default   { {item} cannot go inside itself. }
}

// sprout/engine.sprout — phrases for the verbs whose behaviour is the engine's
verb go        { role way: exit  "go [way]"  "[way]"  "walk [way]" }
verb look      { "look"  "l"  "look around" }
verb examine   { role target  "examine [target]"  "x [target]"  "look at [target]"  "inspect [target]" }
verb inventory { "inventory"  "i"  "inv" }
verb wait      { "wait"  "z" }
verb help      { "help"  "?" }

// sprout/place.sprout
kind Place {
  contains actors
  passage arrives default { {item} arrives. }
  passage leaves default  { {item} leaves. }
}

// sprout/actor.sprout
verb take { role target  "take [target]"  "get [target]"  "pick up [target]"  "grab [target]" }
verb drop { role target  "drop [target]"  "put down [target]" }
verb put  { role item  role container: Container  "put [item] in [container]"  "put [item] into [container]" }
verb give { role item  role recipient: Actor  "give [item] to [recipient]"  "hand [item] to [recipient]" }

kind Actor {
  contains
  :capacity 8
  pass any (false)

  depart  (to)         { if (mover != self) { refuse held_fast } }
  release (item, to)   { if (mover != self) { refuse not_yours } }
  accept  (item, from) { if (self.count >= self.get(:capacity)) { refuse hands_full } }

  as actor for take {
    permit { if (self.holds(target)) { refuse "You already have it." } }
    do     { move target to self  say taken  tell takes }
  }

  as actor for drop {
    permit { if (!self.holds(target)) { refuse not_carried } }
    do     { move target to here  say dropped  tell drops }
  }

  as actor for put {
    permit { if (!self.holds(item)) { refuse not_held } }
    do     { move item to container  say put_in  tell puts_in }
  }

  as actor for give {
    permit {
      if (!self.holds(item))        { refuse not_held }
      else if (recipient == self)   { refuse "You already have it." }
    }
    do { move item to recipient  say given  tell recipient received  tell gives }
  }

  passage taken default       { You take {target}. }
  passage takes default       { {actor} takes {target}. }
  passage dropped default     { You put {target} down. }
  passage drops default       { {actor} puts {target} down. }
  passage put_in default      { You put {item} in {container}. }
  passage puts_in default     { {actor} puts {item} in {container}. }
  passage given default       { You give {item} to {recipient}. }
  passage received default    { {actor} gives you {item}. }
  passage gives default       { {actor} gives {item} to {recipient}. }
  passage not_carried default { You are not holding {target}. }
  passage not_held default    { You are not holding {item}. }
  passage held_fast default   { {self} is not something you can carry off. }
  passage not_yours default   { That is for {self} to put down, not you. }
  passage hands_full default  { {self} cannot carry any more. }
  passage inventory default   {
    {if self.count == 0}You are carrying nothing.{else}
    You are carrying {for thing in self}{thing}{if $last}.{else}, {/if}{/for}{/if}
  }
}

// sprout/visitor.sprout — what a person is made of: an actor, marked as one with somebody behind it
kind Visitor is Actor { }

// sprout/fixture.sprout
kind Fixture {
  depart (to) { if (to.is(Actor)) { refuse immovable } }
  passage immovable default { {self} is not something you can pick up. }
}

// sprout/container.sprout
verb open  { role target: Container  "open [target]" }
verb close { role target: Container  "close [target]"  "shut [target]" }

kind Container {
  contains
  :open     true
  :capacity 8

  pass any (self.get(:open))

  accept (item, from) {
    if (!self.get(:open))                       { refuse shut }
    else if (self.count >= self.get(:capacity)) { refuse full }
  }

  as target for open {
    permit { if (self.get(:open)) { refuse "It is already open." } }
    do     { self.set(:open, true)  say opened  tell opens }
  }

  as target for close {
    permit { if (!self.get(:open)) { refuse "It is already shut." } }
    do     { self.set(:open, false)  say closed  tell closes }
  }

  passage shut default   { {self} is shut. }
  passage full default   { There is no room in {self}. }
  passage opened default { You open {self}. }
  passage opens default  { {actor} opens {self}. }
  passage closed default { You shut {self}. }
  passage closes default { {actor} shuts {self}. }
}

// sprout/lock.sprout
verb unlock {
  role target: Lockable
  role tool
  "unlock [target] with [tool]"
  "use [tool] on [target]"
}

kind Lockable {
  :locked true

  as target for unlock {
    permit { if (!self.get(:locked)) { refuse "It is already unlocked." } }
    do     { self.set(:locked, false)  say unlocked  tell unlocks }
  }

  as target for open {
    permit { if (self.get(:locked)) { refuse "It is locked." } }
  }

  passage unlocked default { The lock turns over. }
  passage unlocks default  { {actor} unlocks {self}. }
}

// sprout/talk.sprout
verb ask {
  role target
  role topic: symbol
  "ask [target] about [topic]"
  "ask [target] [topic]"
}
```

That is the whole of it for this world. Things are carryable unless they say otherwise, and `sprout.Fixture` is how most of them say it without writing a guard at all. `Lockable` carries no pass rule of its own — a lock on something that holds nothing has nothing to pass — and adds a `permit` to the library's own `open`, so a locked container stays shut until it is unlocked and `sprout.Container`'s lid rule is the only pass rule a lockable container needs.

### `printers_shop.sprout`

```sprout
world printers_shop is sprout.World {
  contains
  visitors are Visitor
  visitors arrive at composing_room
  :season Season default autumn

  object composing_room is sprout.Place {
    grammar {
      name    "composing room"
      article the
      exit out "out to the press yard" -> press_yard
      exit in  "into the paper store"  -> paper_store
    }

    prose "composing_room.prose"
    remembers { :visits 0 min 0 max 99 }

    describe { text arrival }

    on :entered (item, from) {
      if (item.is(Creature)) { item.adjust(:visits, 1) }
    }

    on :tick { broadcast :stir }

    object paper_store is sprout.Place, sprout.Container, Warded {
      grammar {
        name    "paper store"
        article the
        exit out "back to the composing room" -> composing_room
        exit up  "up the ladder to the loft"  -> drying_loft when (ladder.get(:down))
      }

      :open     false
      :ward     iron
      :capacity 40

      describe { text "Reams in brown paper, shelved by weight. A ladder leans against the loft hatch." }

      object ladder is sprout.Fixture {
        grammar { nouns "ladder" }

        :down false

        passage immovable { The ladder is chained to the shelving. }

        as target for lower {
          permit { if (self.get(:down)) { refuse "It is down already." } }
          do {
            self.set(:down, true)
            say  "You let the ladder down. The hatch above it swings open."
            tell "{actor} lets the ladder down."
          }
        }
      }
    }

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

    object brass_key is Key

    object apprentice is Creature {
      grammar { name "apprentice" article the nouns "boy" }

      :knows [Topic] default [the_press, the_cat]

      as target for ask {
        topic from :knows
        do {
          if (bound topic) {
            if (topic == :the_press) { say "Bar's stiff, he says. Mind your knuckles." }
            else                     { say "She's not ours, he says. She just decided." }
          } else {
            say "He shrugs. Not something he knows about."
          }
        }
      }
    }

    object cat is Creature {
      grammar { name "shop cat" article the }

      on :stir {
        if (chance(8)) {
          tell "{one of}The cat resettles.{or}The cat regards the door and declines to go through it.{/one of}"
        }
        each p: Creature in composing_room {
          if (p != self && chance(4)) { act nuzzle (target: p) }
        }
      }
    }
  }

  object press_yard is sprout.Place {
    grammar {
      name    "press yard"
      article the
      exit in "back into the shop" -> composing_room
    }

    prose "press_yard.prose"
    describe { text yard }

    object wooden_rib is Rib { grammar { nouns "rib" } }
    object bone_rib   is Rib { grammar { nouns "rib" } }

    object press is sprout.Fixture {
      grammar { name "press" article the }

      :inked false

      passage immovable { The press is bolted to the yard. }

      as target for ink {
        permit { if (self.get(:inked)) { refuse "The forme is inked already." } }
        do {
          self.set(:inked, true)
          say "You beat the ink over the forme until it shines."
        }
      }

      as target for work {
        permit {
          if (!self.get(:inked))         { refuse "Dry type. It would print nothing but a bruise." }
          else if (tools.count(Rib) > 1) { refuse "Two ribs at once is one rib too many." }
        }
        do {
          self.set(:inked, false)
          spawn Sheet in here
          say  "The bar comes over, and the yard is briefly very quiet."
          tell "{actor} works the press."
        }
      }
    }
  }

  object drying_loft is sprout.Place {
    grammar {
      name    "drying loft"
      article the
      exit down "down the ladder" -> composing_room.paper_store
    }

    describe { text "Lines strung wall to wall under the slates, and the smell of size. Nothing hangs on them yet." }
  }
}

enum Season { spring, summer, autumn, winter }
enum Ward   { brass, iron }
enum Drying { wet, touch_dry, cured }
enum Topic  { the_press, the_cat, the_cellar }
enum Cuff   { dry, damp }

message :stir

verb work {
  role target
  role tools many
  "work [target]"
  "work [target] with [tools]"
  "pull [target]"
}

verb ink    { role target  "ink [target]" }
verb lower  { role target  "lower [target]"  "let down [target]" }
verb nuzzle { role target: Creature }
```

### `creature.sprout`

```sprout
kind Creature is sprout.Actor {
  :capacity 4
  :cuff     Cuff default dry

  as target for nuzzle {
    do {
      self.set(:cuff, :damp)
      tell self "{actor} winds round your ankles and licks your hand. Your cuff will be damp all morning."
      tell "{actor} winds round {self}'s ankles."
    }
  }
}
```

### `visitor.sprout`

```sprout
kind Visitor is Creature, sprout.Visitor { }
```

### `warded.sprout`

```sprout
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

### `key.sprout`

```sprout
kind Key {
  grammar { nouns "key" }

  :opens [Ward] default [brass]
  :wear  0 min 0 max 99

  as tool for unlock {
    permit { if (self.get(:wear) >= 99) { refuse "The bit is worn smooth. It turns nothing." } }
    do     { self.adjust(:wear, 1) }
  }
}
```

### `rib.sprout`

```sprout
kind Rib {
  :cracked false
  :used    false

  as tools for work {
    permit { if (self.get(:cracked)) { refuse "The rib is cracked; it would score the sheet." } }
    do     { self.set(:used, true) }
  }
}
```

### `sheet.sprout`

```sprout
kind Sheet {
  grammar { name "printed sheet" nouns "sheet", "print" }

  :state Drying default wet

  depart (to) {
    if (self.get(:state) == :wet) { refuse "The ink is still wet; it would smear." }
  }

  on :spawned (from) { wake in 40 minutes }

  on :woke (elapsed) {
    if (elapsed > 7200) { self.set(:state, :cured) }
    else {
      self.set(:state, :touch_dry)
      wake in 2 hours
    }
  }
}
```

### `composing_room.prose`

```
passage arrival {
  Lead and lamp oil. The composing frames take the long wall, and the
  cabinet stands where the light is worst, which is either carelessness
  or the opposite.

  {if actor.recall(:visits) <= 1}
  You have not stood in here before, and the room somehow knows it.
  {/if}

  {for thing in self}{if thing != actor}{thing}{if $last}.{else}, {/if}{/if}{/for}
}
```

### `press_yard.prose`

```
passage yard {
  Flagstones, a water butt, and the press under its lean-to, which is the
  only thing out here anyone has ever been careful with.

  {for thing in self}{if thing != actor}{thing}{if $last}.{else}, {/if}{/if}{/for}
}
```

### What it surfaced

**Portability is a guard, and the default belongs in a library kind.** A `sprout.Takeable` kind that makes things carryable cannot work: guards are conjunctive, so an engine default refusing departure to an actor could never be overridden by a composed guard that allows. Nor does a keyword follow. `contains` and `contains actors` are **structural** — the engine must know whether a thing holds others to build the tree, and no guard can say that — while portability is **policy**, and policy is what guards are for.

What removes the boilerplate is a library kind on the negative side. `sprout.Fixture` refuses departure to an actor and puts its words in a passage, so most fixtures compose it and write nothing:

```sprout
object press is sprout.Fixture {
  passage immovable { The press is bolted to the yard. }
}
```

Overriding the prose rather than the guard sidesteps the ordering trap. A composing kind's own member is simply the one that applies — collisions arise only between two *sources*, neither of which is the composer — so the author's line replaces the library's with nothing suppressed and no `without` needed. Had `Fixture` refused with a literal instead, the library's words would have spoken first and the author's would never have been read. Capabilities stay structural; policies stay guards.

**A person's guards are written in the language.** Once `sprout.Actor` writes `depart`, `release` and `accept` like any other kind, nobody can be carried off or picked, and giving works within capacity — and a world that wants a gift to need a handshake, or a pocket to be searchable, writes one guard on a kind its visitor kind composes. Nothing about a person is a special case in the engine; the special cases are three lines of Sprout.

**`take` is a verb.** Making the actor a participant — `as actor for take` — let every built-in be written in the language: one `move` and two passages. The words a visitor reads for the commonest things they do are therefore the library's, replaceable, and translatable: an author who wants "Got it." instead of "You take the brass key." writes a two-word passage on their visitor kind, and one who wants every line in another register composes a library that supplies them, because the standard library's are all `default` and yield.

**Set roles need no marker kind.** A set role is filled by whatever declares `as tools for work`, so `Rib` opts in directly and a `Sponge` would too. Nothing empty needs to exist to give the role something to constrain, so the objection to marker kinds stops applying anywhere in the language.

**An open role is an object, and `is()` is how you read one.** `unlock`'s `tool` is open, because the standard library cannot know what a world will call a key. The world's `Warded` narrows it with `tool.is(Key)` before reading `:opens`, and the compiler holds it to that: without the narrowing, the read is refused. Exact typing survived the type seam at the cost of one `if`, which is cheaper than the alternative of every kind that ever plays `tool` having to agree on a property.

**A lock is a `permit`, not a pass rule.** `Lockable` composed onto `Container` first looked like two pass rules colliding. It is not: a lock on a diary has nothing to pass, so `Lockable` carries no pass rule, and what it adds instead is a refusal on the library's own `open`. Roles compose, so the container's "already open" and the lock's "it is locked" both run, the lid stays shut until the key has turned, and `sprout.Container`'s `pass any (self.get(:open))` is the only pass rule the cabinet needs.

**Ticks stop at the place.** The cat's first draft handled `:tick` directly and would never have run, because the tick reaches the place and no further. The room forwards with `broadcast :stir`, which is the rule working as intended: fan-out is the room's decision, visible in the room's source.

**The cat acts like anyone else.** The cat does not `send` a lick; it performs `nuzzle`, a verb with no phrases, on a person in the room, and the person's own kind decides what a lick does to them and tells them so in the second person. The cat is the actor of that reading, so the bystanders' line reads "The shop cat winds round Marta's ankles" and Marta's reads "…licks your hand," from two sentences the author wrote for two audiences. That is the whole of the NPC model, and it is the same model as a visitor.

**Listing contents needed no convention after all.** An earlier draft invoked `{thing.short}` on everything a place held and had to assume every object supplied that passage. An object already has a name and an article, so `{thing}` renders "a brass key" and the loop is the whole of it — with one `{if thing != actor}`, because the person reading the room is standing in it.

**The world file is the floor plan.** With every object declared in the body of what holds it, `printers_shop.sprout` reads as the shop does: the ladder in the paper store, the paper store and the key-holding cabinet in the composing room, the ribs and the press in the yard. What those things are made of sits in files of its own, and what every instance of a kind starts with, a lantern's wick, is written once in the kind.

**Not exercised:** `link` and `connect`, because nothing in a printer's shop wants space that does not exist yet; `changed` hooks and `without`; `destroy self`; authored `move`; `release`; `random` and integer value roles; `{for … of}` over a list; and `send` with a value. Inventing a maze or a vending machine to reach them would have tested the example rather than the language.
