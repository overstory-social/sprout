// What the runtime's specs load a world from: a real bundle, compiled
// through `compileBundle` from the files given, under a manifest naming
// exactly them and pinning the standard library, which travels with it
// blessed as the CLI sends it. Spec support: the package build leaves it out.

import { libraryHash, type Bundle, type Manifest } from '../bundle/bundle.js';
import { compileBundle } from '../bundle/compile.js';
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
      blessed: new Set([sha]),
    },
  );
  if (bundle === null) {
    throw new Error(diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }
  return bundle;
}

/**
 * A small shop, in two files: two rooms, a shelf holding a jar and a
 * cup, a `Person` kind for a case to make visitors of, and a box whose
 * kind `Crate` lives in `kiln.sprout` with an object of its own. Withhold that file at load and the box is absent
 * while the tin it holds still composes, and the kiln is not placed.
 */
export const SHOP: Readonly<Record<string, string>> = {
  'world.sprout': [
    'world printers_shop: sprout.World { contains visitors arrive at hall }',
    'enum Glaze { none, shino, tenmoku }',
    'kind Room { contains actors :lit true }',
    'kind Shelf { contains }',
    'kind Jar { :glaze Glaze default none :fill 3 min 0 max 9 :remembers [seen: false] }',
    'kind Person { contains :score 0 }',
    'object hall: Room in printers_shop',
    'object yard: Room in printers_shop',
    'object shelf: Shelf in hall',
    'object jar: Jar in hall.shelf',
    'object cup: Jar in hall.shelf',
    'object box: Crate in hall',
    'object tin: Jar in hall.box',
    '',
  ].join('\n'),
  'kiln.sprout': 'kind Crate { contains :lid false }\nobject kiln: Crate in yard\n',
};

/** The shop as published. */
export const shop = (): Bundle => compiledWorld('printers_shop', SHOP);

/** The shop loaded with `kiln.sprout` withheld: `Crate` and the kiln are absent. */
export const shopWithheld = (): Bundle =>
  compiledWorld('printers_shop', SHOP, { mode: 'load', withheld: ['kiln.sprout'] });
