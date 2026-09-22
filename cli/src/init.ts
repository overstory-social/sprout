import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { LANGUAGE_LEVEL, MANIFEST_FILE, type Manifest } from '@overstory/sprout/lang';

// `sprout init [dir]`: a folder with a manifest, a world and a README
// line. What it writes passes `sprout check`.

export function initWorld(dir: string, author = userInfo().username): string[] {
  const root = resolve(dir);
  if (existsSync(root) && readdirSync(root).length > 0) {
    throw new Error(`${dir}: not empty — init wants an empty or new folder`);
  }
  mkdirSync(root, { recursive: true });
  const name = basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_');
  const manifest: Manifest = {
    name,
    namespace: name,
    version: '0.1.0',
    author,
    license: 'MIT',
    level: LANGUAGE_LEVEL,
    extensions: [],
    libraries: [],
    files: ['world.sprout'],
  };
  const { namespace: _namespace, ...written } = manifest;
  // Visitors arrive in a place, which is whatever holds actors.
  const world = [
    `world ${name}: sprout.World {`,
    '  visitors are Visitor',
    '  visitors arrive at hall',
    '}',
    '',
    'kind Hall {',
    '  contains actors',
    '}',
    '',
    `object hall: Hall in ${name}`,
    '',
  ].join('\n');
  const readme = `# ${name}\n\nA Sprout microworld. \`sprout check .\` checks it.\n`;
  const files = [
    [MANIFEST_FILE, `${JSON.stringify(written, null, 2)}\n`],
    ['world.sprout', world],
    ['README.md', readme],
  ] as const;
  for (const [file, text] of files) writeFileSync(join(root, file), text);
  return files.map(([file]) => file);
}
