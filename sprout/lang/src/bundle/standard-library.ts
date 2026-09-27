// The standard library, `sprout`, as it travels with a world that names
// it (the spec's Kinds › Libraries and namespaces, The standard library
// is written in Sprout; A worked microworld › The standard library it
// needs). It is ordinary Sprout source, each kind in the file named for it
// beside the verbs it plays, vendored and hashed like any library. The compiler
// gives it one privilege: only it declares the engine verbs, and only its
// `go` has a role an exit fills (Reserved names, Exits). A world that
// pins another hash runs against that copy or none. Its files are named
// as the worked microworld names them, `sprout/actor.sprout`, so a
// diagnostic in library source never reads as one in the world's own.
//
// It is the worked microworld's library, declaration for declaration, with one
// difference: `Lockable` is in `sprout/lockable.sprout`, the file named
// for it, where the worked microworld writes `sprout/lock.sprout`.

import type { LibrarySource } from './bundle.js';
import { SourceFile } from '../source/source.js';

const WORLD = `// sprout.World: what every world composes (the spec's The world model),
// and the words the engine speaks for itself, as default passages any
// other source's line of the same name replaces.
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
  passage crowded default         { There is no room in {to} for {item}. }
}
`;

const ENGINE = `// The phrases for the verbs whose behaviour is the engine's (the spec's
// Engine verbs). They have no \`do\`: the engine answers them, and only
// \`go\` may have a role an exit fills.
verb go        { role way: exit  "go [way]"  "[way]"  "walk [way]" }
verb look      { "look"  "l"  "look around" }
verb examine   { role target  "examine [target]"  "x [target]"  "look at [target]"  "inspect [target]" }
verb inventory { "inventory"  "i"  "inv" }
verb wait      { "wait"  "z" }
verb help      { "help"  "?" }
`;

const PLACE = `// sprout.Place: a place is whatever holds actors (the spec's Places),
// and the notices of someone arriving and leaving, as default passages.
kind Place {
  contains actors
  passage arrives default { {item} arrives. }
  passage leaves default  { {item} leaves. }
}
`;

const ACTOR = `// sprout.Actor: the hands, their capacity, and the guards that make a
// person's things their own (the spec's Actors and visitors; Movement and
// consent, The three roles), the verbs a visitor takes for granted and its
// own part in each (The actor's own part), with the passages they say and
// refuse through, and the inventory the engine's \`inventory\` says (Engine
// verbs). Its pass rule makes a pocket private (Containers route).
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
`;

const VISITOR = `// sprout.Visitor: what a person is made of, an actor with somebody
// behind it (the spec's Actors and visitors). A world's visitor kind
// composes it, and no object or spawn is made of it.
kind Visitor is Actor { }
`;

const FIXTURE = `// sprout.Fixture: a thing no actor carries off, said with a guard and a
// passage rather than a property (the spec's The standard library is
// written in Sprout).
kind Fixture {
  depart (to) { if (to.is(Actor)) { refuse immovable } }
  passage immovable default { {self} is not something you can pick up. }
}
`;

const CONTAINER = `// sprout.Container: a lid and a capacity, the pass rule that lets a
// message in only while it is open (the spec's Containers route), and the
// \`open\` and \`close\` it plays the target of.
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
`;

const LOCKABLE = `// sprout.Lockable: a lock, which carries no pass rule of its own and adds
// a \`permit\` to the library's \`open\`, so a locked container stays shut
// until it is unlocked (the spec's A worked microworld, The standard
// library it needs). Which tool fits is the world's to say, in a
// \`permit\` of its own.
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
`;

const TALK = `// \`ask\`, whose topic is a value the visitor names (the spec's Value
// roles). The library plays no part in it: a world's own object is asked,
// and says with \`from\` which topics it hears.
verb ask {
  role target
  role topic: symbol
  "ask [target] about [topic]"
  "ask [target] [topic]"
}
`;

/** The standard library at the version the CLI carries and `sprout init` pins. */
export const STANDARD_LIBRARY: LibrarySource = {
  name: 'sprout',
  version: '0.1.0',
  level: 1,
  files: [
    new SourceFile('sprout/world.sprout', WORLD),
    new SourceFile('sprout/engine.sprout', ENGINE),
    new SourceFile('sprout/place.sprout', PLACE),
    new SourceFile('sprout/actor.sprout', ACTOR),
    new SourceFile('sprout/visitor.sprout', VISITOR),
    new SourceFile('sprout/fixture.sprout', FIXTURE),
    new SourceFile('sprout/container.sprout', CONTAINER),
    new SourceFile('sprout/lockable.sprout', LOCKABLE),
    new SourceFile('sprout/talk.sprout', TALK),
  ],
};
