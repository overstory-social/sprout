// The standard library, `sprout`, as it travels with a world that names
// it (the spec's Kinds › Libraries and namespaces, The standard library
// is written in Sprout; A worked microworld › The standard library it
// needs). It is ordinary Sprout source, a kind at most to a file beside
// the verbs it plays, vendored and hashed like any library. The compiler
// gives it one privilege: only it declares the engine verbs, and only its
// `go` has a role an exit fills (Reserved names, Exits). A world that
// pins another hash runs against that copy or none. Its files are named
// as the worked microworld names them, `sprout/actor.sprout`, so a
// diagnostic in library source never reads as one in the world's own.
//
// It holds only what the compiler reads today, written as the worked
// microworld writes it. The rest of that library is named, file by file,
// as the item that brings it.

import type { LibrarySource } from './bundle.js';
import { SourceFile } from '../source/source.js';

const WORLD = `// sprout.World: what every world composes (the spec's The world model),
// and the words the engine speaks for itself, as default passages any
// other source's line of the same name replaces.
kind World {
  contains

  passage unknown default         { That is not something you can do here. }
  passage unreachable default     { You cannot reach {thing} from here. }
  passage which default           { Which do you mean: {for thing of candidates}{thing}{if $last}?{else}, {/if}{/for} }
  passage nothing_happens default { Nothing much comes of that. }
  passage unremarkable default    { There is nothing special about {thing}. }
  passage unseen default          { Something here is too much to take in. }
  passage fault default           { Something in this world has gone wrong, and nothing has changed. }
  passage missing default         { This world uses something this host does not provide, and will be missing some of itself. }
  passage displaced default       { The place you were standing is gone. }
  passage inside_itself default   { {item} cannot go inside itself. }
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
// consent, The three roles), with the passages they refuse through; and
// the verbs a visitor takes for granted (The actor's own part). B32
// brings its pass any (false); B48 brings \`put\` with the container it
// names, each verb's \`as actor for\` and its passages, and the inventory
// line.
verb take { role target  "take [target]"  "get [target]"  "pick up [target]"  "grab [target]" }
verb drop { role target  "drop [target]"  "put down [target]" }
verb give { role item  role recipient: Actor  "give [item] to [recipient]"  "hand [item] to [recipient]" }

kind Actor {
  contains
  :capacity 8

  depart  (to)         { if (mover != self) { refuse held_fast } }
  release (item, to)   { if (mover != self) { refuse not_yours } }
  accept  (item, from) { if (self.count >= self.get(:capacity)) { refuse hands_full } }

  passage held_fast default   { {self} is not something you can carry off. }
  passage not_yours default   { That is for {self} to put down, not you. }
  passage hands_full default  { {self} cannot carry any more. }
}
`;

const VISITOR = `// sprout.Visitor: what a person is made of, an actor with somebody
// behind it (the spec's Actors and visitors). A world's visitor kind
// composes it, and no object or spawn is made of it.
kind Visitor is Actor { }
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
    new SourceFile('sprout/talk.sprout', TALK),
  ],
};
