// Where the generated skill's examples are compiled (the spec's The
// compiler › The generated skill). Every piece of Sprout the skill shows
// is compiled by this compiler, strictly, as publishing would, when the
// skill is generated, and what the skill says of it is what compiling it
// said: so the skill cannot show text the compiler does not accept, or
// put words in the compiler's mouth. A snippet is compiled on the bench,
// a world of one place that nothing else is in.

import { LANGUAGE_LEVEL, libraryHash, type Manifest, type MicroworldSource } from '../bundle.js';
import { DEFAULT_BLESSED } from '../blessed.js';
import { compileBundle, type BundleResult } from '../compile/compile.js';
import { MANIFEST_FILE } from '../manifest.js';
import { STANDARD_LIBRARY } from '../standard-library.js';
import { SourceFile } from '../../source/source.js';

/** A whole world, as an author writes it: its name, and its files by name. */
export interface ExampleWorld {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
}

/** A piece of a world: files beside the bench's own, and lines for the body of its one place. */
export interface Snippet {
  readonly files?: Readonly<Record<string, string>>;
  /** Written inside `object hall is sprout.Place { … }`, indented as its members are. */
  readonly hall?: string;
}

/** The bench world's name. */
export const BENCH = 'bench';

/** The manifest `world` travels under: every file it has, and the standard library pinned. */
export function manifestOf(world: ExampleWorld): Manifest {
  return {
    name: world.name,
    namespace: world.name,
    version: '0.1.0',
    author: 'Marta',
    license: 'MIT',
    level: LANGUAGE_LEVEL,
    extensions: [],
    libraries: [
      {
        name: STANDARD_LIBRARY.name,
        version: STANDARD_LIBRARY.version,
        sha: libraryHash(STANDARD_LIBRARY),
      },
    ],
    files: Object.keys(world.files),
  };
}

/** The manifest as a file: `sprout.json`, as an author writes it, the namespace left to the name. */
export function manifestText(world: ExampleWorld): string {
  const { namespace: _namespace, ...written } = manifestOf(world);
  return `${JSON.stringify(written, null, 2)}\n`;
}

/** `world` compiled strictly, with the standard library vendored and blessed, as a host starts from. */
export function compileExample(world: ExampleWorld): BundleResult {
  const source: MicroworldSource = {
    manifestFile: new SourceFile(MANIFEST_FILE, manifestText(world)),
    manifest: manifestOf(world),
    files: Object.entries(world.files).map(([name, text]) => new SourceFile(name, text)),
    libraries: [STANDARD_LIBRARY],
  };
  return compileBundle(source, { mode: 'publish', blessed: DEFAULT_BLESSED });
}

/** The world a snippet is compiled in: one place, `hall`, where a visitor made of `Person` arrives. */
export function onTheBench(snippet: Snippet = {}): ExampleWorld {
  const hall = snippet.hall === undefined ? '' : ` {\n${snippet.hall}\n  }`;
  const world = [
    `world ${BENCH} is sprout.World {`,
    '  visitors are Person',
    '  visitors arrive at hall',
    '',
    `  object hall is sprout.Place${hall}`,
    '}',
    '',
  ].join('\n');
  return {
    name: BENCH,
    files: {
      [`${BENCH}.sprout`]: world,
      'person.sprout': 'kind Person is sprout.Visitor { }\n',
      ...snippet.files,
    },
  };
}

/** A snippet compiled on the bench. */
export function compileSnippet(snippet: Snippet): BundleResult {
  return compileExample(onTheBench(snippet));
}
