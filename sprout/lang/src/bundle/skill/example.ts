// The worked example the generated skill opens with (the spec's The
// compiler › The generated skill: "the worked example first"). It is a
// whole world, manifest and all, compiled when the skill is generated;
// one that says anything at all, a warning included, is a defect the
// generator throws for rather than a page it prints.

import { compileExample, manifestText, type ExampleWorld } from './bench.js';
import { blocks, code, fenced, heading } from './markdown.js';
import { MANIFEST_FILE } from '../manifest.js';
import { renderDiagnostics } from '../../source/diagnostics.js';
import { readable } from '../../source/words.js';

/** A yard, a shed off it, a lamp that lights once and a chest that starts shut. */
export const WORKED_EXAMPLE: ExampleWorld = {
  name: 'lantern_yard',
  files: {
    'lantern_yard.sprout': `// The world: its places, what is in them, and the verbs it adds.
world lantern_yard is sprout.World {
  visitors are Person
  visitors arrive at yard

  object yard is sprout.Place {
    describe { text "A cobbled yard. A shed leans on the north wall." }
    grammar { exit north "into the shed" -> shed }
    object lamp is Lamp
  }

  object shed is sprout.Place {
    describe { text "A low shed that smells of oil." }
    grammar { exit south "back to the yard" -> yard }
    object chest is sprout.Container {
      :open false
      object match is Match
    }
  }
}

verb light { role target: Lamp  "light [target]" }
`,
    'person.sprout': `// Whoever visits: the library's visitor, with hands for three things.
kind Person is sprout.Visitor {
  :capacity 3
}
`,
    'lamp.sprout': `// A lamp: dark until someone lights it, and then it says so.
kind Lamp {
  :lit false

  describe {
    if (self.get(:lit)) { text "The lamp burns steadily." } else { text "An unlit lamp." }
  }

  as target for light {
    permit { if (self.get(:lit)) { refuse "It is already lit." } }
    do     { self.set(:lit, true)  say lit  tell lights }
  }

  passage lit    { You light {self}. }
  passage lights { {actor} lights {self}. }
}
`,
    'match.sprout': `// A match answers to "matchstick" as well as to its name.
kind Match {
  grammar { nouns "matchstick" }
}
`,
  },
};

/** "the kinds `A` and `B`", or "the kind `A`". */
function counted(what: string, names: readonly string[]): string {
  return `the ${what}${names.length === 1 ? '' : 's'} ${readable(names)}`;
}

/** The worked example as the skill's first section: the manifest, then every file, then that it compiles. */
export function workedExampleSection(world: ExampleWorld = WORKED_EXAMPLE): string {
  const { bundle, diagnostics } = compileExample(world);
  if (bundle === null || diagnostics.length > 0) {
    throw new Error(
      `The skill's worked example does not compile cleanly:\n${renderDiagnostics(diagnostics)}`,
    );
  }
  const files = Object.entries(world.files).map(([name, text]) =>
    blocks(`${code(name)}:`, fenced('sprout', text)),
  );
  const own = (library: string): boolean => library === bundle.manifest.namespace;
  const kinds = bundle.kinds.filter((kind) => own(kind.library)).map((kind) => kind.name);
  const verbs = bundle.verbs
    .all()
    .filter((verb) => own(verb.library))
    .map((verb) => verb.name);
  return blocks(
    heading(2, 'A worked example'),
    `A microworld is a folder: a manifest, ${code(MANIFEST_FILE)}, and the files it names. ` +
      'This one compiles as it stands, with nothing to say about it. ' +
      `It declares ${counted('kind', kinds)} and ${counted('verb', verbs)}; ` +
      'everything else it uses is the standard library, `sprout`, below.',
    `${code(MANIFEST_FILE)}:`,
    fenced('json', manifestText(world)),
    ...files,
  );
}
