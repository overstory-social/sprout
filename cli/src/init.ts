import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { LANGUAGE_LEVEL, type SproutManifest } from '@overstory/sprout/lang';

import { MANIFEST } from './archive.js';

// `sprout init [dir]` (the split proposal §6): a folder with a manifest,
// one room, and a README line — a host's literal first command.

const HALL = `room hall {
  :name "The Hall"
  prose "A quiet hall. The door you came in by is behind you."
}
`;

export function initArchive(dir: string): string[] {
  const root = resolve(dir);
  if (existsSync(root) && readdirSync(root).length > 0) {
    throw new Error(`${dir}: not empty — init wants an empty or new folder`);
  }
  mkdirSync(join(root, 'rooms'), { recursive: true });
  const manifest: SproutManifest = {
    format: 1,
    language: LANGUAGE_LEVEL,
    entry: 'hall',
    extensions: [],
  };
  const written = [
    [MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`],
    ['rooms/hall.sprout', HALL],
    [
      'README.md',
      `# ${basename(root)}\n\nA Sprout microworld. \`sprout check .\` to check it, \`sprout play .\` to walk it, \`sprout skill\` for the language.\n`,
    ],
  ] as const;
  for (const [name, text] of written) writeFileSync(join(root, name), text);
  return written.map(([name]) => name);
}
