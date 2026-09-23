// The standard library, `sprout`, as it travels with a world that names
// it (the spec's Kinds › Libraries and namespaces, The standard library
// is written in Sprout; A worked microworld › The standard library it
// needs). It is ordinary Sprout source, one file per kind, vendored and
// hashed like any library: the compiler gives it no privilege, and a
// world that pins another hash runs against that copy or none. Its files
// are named as the worked microworld names them, `sprout/actor.sprout`,
// so a diagnostic in library source never reads as one in the world's own.
//
// It holds only what the compiler reads today, written as the worked
// microworld writes it. The rest of that library is named, file by file,
// as the item that brings it.

import type { LibrarySource } from './bundle.js';
import { SourceFile } from '../source/source.js';

const WORLD = `// sprout.World: what every world composes (the spec's The world model),
// and the words the engine speaks for itself, as default passages any
// other source's line of the same name replaces. B48 brings the engine
// verbs' phrases.
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
}
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
// consent, The three roles), with the passages they refuse through. B32
// brings its pass any (false); B48 take, drop, put and give and the
// inventory line, with their passages.
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

/** The standard library at the version the CLI carries and `sprout init` pins. */
export const STANDARD_LIBRARY: LibrarySource = {
  name: 'sprout',
  version: '0.1.0',
  level: 1,
  files: [
    new SourceFile('sprout/world.sprout', WORLD),
    new SourceFile('sprout/place.sprout', PLACE),
    new SourceFile('sprout/actor.sprout', ACTOR),
  ],
};
