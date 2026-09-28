import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  compileBundle,
  DEFAULT_BLESSED,
  libraryHash,
  neededImports,
  parseManifest,
  Diagnostics,
  SourceFile,
  STANDARD_LIBRARY,
  type Bundle,
} from '@overstory/sprout/lang';

// Spec support for the player, the REPL and the CLI, never imported by a
// command: two small worlds, compiled in memory as `sprout check` compiles
// a folder, or written out as a folder for the commands that read one.

function manifestOf(name: string, files: Record<string, string>): string {
  const manifest = {
    name,
    version: '0.1.0',
    author: 'spec',
    license: 'MIT',
    level: 1,
    extensions: [],
    libraries: [{ name: 'sprout', version: '0.1.0', sha: libraryHash(STANDARD_LIBRARY) }],
    files: Object.keys(files),
  };
  return JSON.stringify(manifest, null, 2);
}

/**
 * `files`, each with the imports it needs written at its end, as the
 * language works them out, so a case writes a world without them and
 * nothing written moves.
 */
function importing(files: Record<string, string>): Record<string, string> {
  const sources = Object.entries(files).map(([file, text]) => new SourceFile(file, text));
  const needed = neededImports(sources, [STANDARD_LIBRARY]);
  return Object.fromEntries(
    Object.entries(files).map(([file, text]) => {
      const lines = needed.get(file);
      return [
        file,
        lines === undefined
          ? text
          : `${text}${text.endsWith('\n') ? '' : '\n'}${lines.join('\n')}\n`,
      ];
    }),
  );
}

/** A world folder holding `files` with what each imports, its manifest naming each in order and pinning the standard library. */
export function worldFolder(name: string, written: Record<string, string>): string {
  const files = importing(written);
  const dir = join(mkdtempSync(join(tmpdir(), 'sprout-world-')), name);
  mkdirSync(dir);
  writeFileSync(join(dir, 'sprout.json'), manifestOf(name, files));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
}

/** The world `files` make, compiled strictly with the standard library vendored; throws where it is refused. */
export function bundleOf(name: string, written: Record<string, string>): Bundle {
  const files = importing(written);
  const diagnostics = new Diagnostics();
  const manifestFile = new SourceFile('sprout.json', manifestOf(name, files));
  const manifest = parseManifest(manifestFile, diagnostics)!;
  const sources = Object.entries(files).map(([file, text]) => new SourceFile(file, text));
  const { bundle } = compileBundle(
    { manifestFile, manifest, files: sources, libraries: [STANDARD_LIBRARY] },
    { mode: 'publish', blessed: DEFAULT_BLESSED },
  );
  if (bundle === null) throw new Error(`${name} does not compile`);
  return bundle;
}

/**
 * The lane, which the inspector specs stand in: a yard with a way into
 * the shed, two keys written alike, a crate whose `permit` refuses to be
 * pried, a dial of ten notches and a warden who hears two topics; a shed
 * with a way back; and an attic that lets nobody in.
 */
export const LANE: Record<string, string> = {
  'lane.sprout': `world lane is sprout.World {
  visitors are Walker
  visitors arrive at yard

  object yard is sprout.Place {
    grammar { exit in "into the shed" -> shed }
    describe { text "A muddy yard." }
    object brass_key is Key { grammar { name "brass key" } }
    object iron_key is Key { grammar { name "iron key" } }
    object crate is Crate
    object dial is Dial
    object warden is Warden
  }
  object shed is Shed
  object attic is Attic
}

verb pry  { role target  "pry [target]"  "pry open [target]" }
verb turn { role target  role notch: integer  "turn [target] to [notch]" }
enum Topic { toll, old_road }
`,
  'walker.sprout': 'kind Walker is sprout.Visitor { }\n',
  'key.sprout': 'kind Key {\n  grammar { nouns "key" }\n}\n',
  'crate.sprout': `kind Crate {
  as target for pry {
    permit { refuse "The lid is nailed down." }
    do { say "The lid gives." }
  }
}
`,
  'dial.sprout': `kind Dial {
  as target for turn {
    notch from 0 to 9
    do { say "Click." }
  }
}
`,
  'warden.sprout': `kind Warden is sprout.Actor {
  :knows [Topic] default [toll, old_road]
  as target for ask {
    topic from :knows
    do { say "Two coppers to cross." }
  }
}
`,
  'shed.sprout': `kind Shed is sprout.Place {
  grammar { exit out "back to the yard" -> yard }
  describe { text "Tools hang in rows." }
}
`,
  'attic.sprout': `kind Attic is sprout.Place {
  accept (item, from) { refuse "The hatch is bolted." }
}
`,
};

/**
 * The kiln yard, which the play and test specs play: a kiln that fires,
 * asks to be woken in an hour and cools when it is, and faults when
 * kicked; a yard that speaks on every tick it is sent, one of two lines
 * drawn from the tick's seed; a shed beside it with nothing that ticks.
 */
export const KILN_YARD: Record<string, string> = {
  'kiln_yard.sprout': `world kiln_yard is sprout.World {
  visitors are Walker
  visitors arrive at yard

  object yard is Yard {
    grammar { exit in "into the shed" -> shed }
    object kiln is Kiln
  }
  object shed is sprout.Place {
    grammar { exit out "back to the yard" -> yard }
    describe { text "A dark shed." }
  }
}

verb fire { role target  "fire [target]" }
verb kick { role target  "kick [target]" }
`,
  'walker.sprout': 'kind Walker is sprout.Visitor { }\n',
  'yard.sprout': `kind Yard is sprout.Place {
  describe { text "A kiln yard." }
  on :tick { tell "{one of}Smoke drifts.{or}The air is still.{/one of}" }
}
`,
  'kiln.sprout': `kind Kiln is sprout.Fixture {
  :hot false
  as target for fire {
    permit { if (self.get(:hot)) { refuse "It is firing already." } }
    do { self.set(:hot, true)  wake in 1 hours  say "The chamber takes the flame." }
  }
  as target for kick {
    do { if (2147483647 + 1 > 0) { say "Clang." } }
  }
  on :woke (elapsed) {
    self.set(:hot, false)
    tell "The kiln ticks as it cools."
  }
}
`,
};
