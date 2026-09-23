// What the runtime's specs load a world from: a real bundle, compiled
// through `compileBundle` from the files given, under a manifest naming
// exactly them and pinning the standard library, which travels with it
// blessed, as a host starts from. Spec support: the package build leaves it out.

import { libraryHash, type Bundle, type Manifest } from '../bundle/bundle.js';
import { compileBundle } from '../bundle/compile/compile.js';
import { DEFAULT_LIMITS, type Limits } from '../bundle/limits.js';
import { STANDARD_LIBRARY } from '../bundle/standard-library.js';
import { SourceFile } from '../source/source.js';

export interface WorldOptions {
  /** Strict unless a case says otherwise. */
  readonly mode?: 'publish' | 'load';
  /** Files the host holds back; they read as absent at load. */
  readonly withheld?: readonly string[];
  readonly limits?: Limits;
}

/**
 * Compile `files`, by name and text, as the world `name`. A world that
 * does not compile throws with what was said, since a fixture that does
 * not compile proves nothing.
 */
export function compiledWorld(
  name: string,
  files: Readonly<Record<string, string>>,
  options: WorldOptions = {},
): Bundle {
  const sha = libraryHash(STANDARD_LIBRARY);
  const manifest: Manifest = {
    name,
    namespace: name,
    version: '0.1.0',
    author: 'Eric Eslinger',
    license: 'MIT',
    level: 1,
    extensions: [],
    libraries: [{ name: STANDARD_LIBRARY.name, version: STANDARD_LIBRARY.version, sha }],
    files: Object.keys(files),
  };
  const { bundle, diagnostics } = compileBundle(
    {
      manifestFile: new SourceFile('sprout.json', JSON.stringify(manifest, null, 2)),
      manifest,
      files: Object.entries(files).map(([file, text]) => new SourceFile(file, text)),
      libraries: [STANDARD_LIBRARY],
      ...(options.withheld === undefined ? {} : { withheld: options.withheld }),
    },
    {
      mode: options.mode ?? 'publish',
      limits: options.limits ?? DEFAULT_LIMITS,
    },
  );
  if (bundle === null) {
    throw new Error(diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }
  return bundle;
}

/**
 * A small shop, in two files: a world that is open, two rooms, a shelf
 * holding a jar and a cup, `Person` for visitors to be made of, and a
 * box and a kiln whose kind `Crate` lives in `kiln.sprout`. Withhold
 * that file at load and the box and the kiln are absent, while the tin
 * the box holds still composes.
 */
export const SHOP: Readonly<Record<string, string>> = {
  'world.sprout': [
    'world printers_shop is sprout.World { contains visitors are Person visitors arrive at hall :open true',
    '  object hall is Room {',
    '    object shelf is Shelf {',
    '      object jar is Jar',
    '      object cup is Jar',
    '    }',
    '    object box is Crate {',
    '      object tin is Jar',
    '    }',
    '  }',
    '  object yard is Room {',
    '    object kiln is Crate',
    '  }',
    '}',
    'enum Glaze { none, shino, tenmoku }',
    'kind Room { contains actors :lit true }',
    'kind Shelf { contains }',
    'kind Jar { :glaze Glaze default none :fill 3 min 0 max 9 :remembers [seen: false] }',
    'kind Person is sprout.Actor { :score 0 }',
    '',
  ].join('\n'),
  'kiln.sprout': 'kind Crate { contains :lid false }\n',
};

/** The shop as published. */
export const shop = (): Bundle => compiledWorld('printers_shop', SHOP);

/** The shop loaded with `kiln.sprout` withheld: `Crate` and the kiln are absent. */
export const shopWithheld = (): Bundle =>
  compiledWorld('printers_shop', SHOP, { mode: 'load', withheld: ['kiln.sprout'] });
