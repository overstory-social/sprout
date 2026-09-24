import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { basename, join, resolve } from 'node:path';

import {
  fileNamedFor,
  LANGUAGE_LEVEL,
  libraryHash,
  MANIFEST_FILE,
  STANDARD_LIBRARY,
  type Manifest,
} from '@overstory/sprout/lang';

// `sprout init [dir]`: a folder with a manifest, the world in the file
// named for its name, the kind its visitors are made of in the file named
// for it, a first test in `tests/`, and a README line. The manifest pins
// the standard library the CLI carries, since every world composes
// `sprout.World`. What it writes passes `sprout check` and `sprout test`.

export function initWorld(dir: string, author = userInfo().username): string[] {
  const root = resolve(dir);
  if (existsSync(root) && readdirSync(root).length > 0) {
    throw new Error(`${dir}: not empty — init wants an empty or new folder`);
  }
  mkdirSync(root, { recursive: true });
  const name = basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_');
  const worldFile = fileNamedFor(name);
  // The visitor kind's file may not be the world's, so a world called
  // `person` has its visitors made of `Guest`.
  const visitor = worldFile === fileNamedFor('Person') ? 'Guest' : 'Person';
  const visitorFile = fileNamedFor(visitor);
  const manifest: Manifest = {
    name,
    namespace: name,
    version: '0.1.0',
    author,
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
    files: [worldFile, visitorFile],
  };
  const { namespace: _namespace, ...written } = manifest;
  // A visitor is made of the world's own kind composing `sprout.Visitor`,
  // named `Person` because a `Visitor` of its own would hide the
  // library's, and arrives in a place, which `sprout.Place` is, written in
  // the world's body because it sits directly in the world. The kind is
  // in a file of its own, as every kind is.
  const world = [
    `world ${name} is sprout.World {`,
    `  visitors are ${visitor}`,
    '  visitors arrive at hall',
    '',
    '  object hall is sprout.Place',
    '}',
    '',
  ].join('\n');
  const person = `kind ${visitor} is sprout.Visitor { }\n`;
  const readme =
    `# ${name}\n\nA Sprout microworld. \`sprout check .\` checks it, and ` +
    '`sprout test .` runs its tests, the scripts in `tests/`.\n';
  const test = [
    '# What a visitor reads on arriving. `sprout test` plays this and checks',
    '# that the world says each indented line; change them as the world grows.',
    '@arrive Marta',
    '  There is nothing special about a hall.',
    '',
  ].join('\n');
  const files = [
    [MANIFEST_FILE, `${JSON.stringify(written, null, 2)}\n`],
    [worldFile, world],
    [visitorFile, person],
    ['tests/arrival.txt', test],
    ['README.md', readme],
  ] as const;
  mkdirSync(join(root, 'tests'));
  for (const [file, text] of files) writeFileSync(join(root, file), text);
  return files.map(([file]) => file);
}
