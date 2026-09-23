// The standard library, `sprout`, as it travels with a world that names
// it (the spec's Kinds › Libraries and namespaces, The standard library
// is written in Sprout; A worked microworld › The standard library it
// needs). It is ordinary Sprout source, one file per kind, vendored and
// hashed like any library: the compiler gives it no privilege, and a
// world that pins another hash runs against that copy or none.
//
// It holds only what the parser reads today. The rest of the worked
// microworld's library is named, file by file, as the item that brings it.

import type { LibrarySource } from './bundle.js';
import { SourceFile } from '../source/source.js';

const WORLD = `// sprout.World: what every world composes (the spec's The world model).
// B20 and B29 bring the stock lines the engine speaks for itself, as
// default passages; B48 the engine verbs' phrases.
kind World {
  contains
}
`;

const PLACE = `// sprout.Place: a place is whatever holds actors (the spec's Places).
// B20 and B29 bring its arrives and leaves notices, as default passages.
kind Place {
  contains actors
}
`;

const ACTOR = `// sprout.Actor: the hands, and their capacity (the spec's Actors and
// visitors). B22 brings the guards that make a person's things their
// own, which read :capacity; B32 its pass any (false); B48 take, drop,
// put and give, with their passages.
kind Actor {
  contains
  :capacity 8
}
`;

/** The standard library at the version the CLI carries and `sprout init` pins. */
export const STANDARD_LIBRARY: LibrarySource = {
  name: 'sprout',
  version: '0.1.0',
  level: 1,
  files: [
    new SourceFile('world.sprout', WORLD),
    new SourceFile('place.sprout', PLACE),
    new SourceFile('actor.sprout', ACTOR),
  ],
};
