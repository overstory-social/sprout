// `node scripts/pin-standard-library.mjs`: pin the standard library the CLI
// carries in every corpus manifest, by its name, version and current hash.
// It rewrites the `libraries` value alone: another library's pin is kept as
// it was, and nothing else in a manifest is touched. A manifest that leaves
// `libraries` out uses none, on purpose, and is left alone. It reads the built
// library, so run `npm run build` first. Read the diff before committing it.
//
// A world whose pin is wrong on purpose, to pin the refusal of a library
// that did not travel as recorded, is named in `WRONG_ON_PURPOSE` and left
// alone; the script checks that its pin still differs from the real hash.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { libraryHash, STANDARD_LIBRARY } from '@overstory/sprout/lang';

const pin = {
  name: STANDARD_LIBRARY.name,
  version: STANDARD_LIBRARY.version,
  sha: libraryHash(STANDARD_LIBRARY),
};

/** Where the top-level `"libraries"` value starts and ends in the manifest's text. */
function librariesValue(text) {
  const key = text.indexOf('"libraries"');
  if (key < 0) return null;
  const start = text.indexOf('[', key);
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) return { start, end: i + 1 };
    }
  }
  return null;
}

/** A list of pins as prettier writes it in a manifest, one key to a line. */
function written(pins) {
  const entries = pins.map((p) =>
    [
      '    {',
      Object.entries(p)
        .map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
        .join(',\n'),
      '    }',
    ].join('\n'),
  );
  return `[\n${entries.join(',\n')}\n  ]`;
}

/** Manifests whose standard-library pin is meant not to match, by path. */
const WRONG_ON_PURPOSE = new Set([join('corpus/bad', 'library-mismatched', 'sprout.json')]);

const manifests = ['corpus/good', 'corpus/bad']
  .filter((root) => existsSync(root))
  .flatMap((root) => readdirSync(root).map((dir) => join(root, dir, 'sprout.json')))
  .filter((path) => existsSync(path));

let changed = 0;
for (const path of manifests) {
  const text = readFileSync(path, 'utf8');
  if (!('libraries' in JSON.parse(text))) {
    console.log(`left ${path} alone: it uses no libraries`);
    continue;
  }
  const at = librariesValue(text);
  if (at === null) throw new Error(`${path}: no "libraries" list to pin the standard library in`);
  if (WRONG_ON_PURPOSE.has(path)) {
    const pinned = JSON.parse(text.slice(at.start, at.end)).find((p) => p.name === pin.name);
    if (pinned !== undefined && pinned.sha === pin.sha) {
      throw new Error(`${path}: its pin is meant to be wrong, and now matches the real hash`);
    }
    console.log(`left ${path} alone: its pin is wrong on purpose`);
    continue;
  }
  const others = JSON.parse(text.slice(at.start, at.end)).filter((p) => p.name !== pin.name);
  const next = `${text.slice(0, at.start)}${written([pin, ...others])}${text.slice(at.end)}`;
  if (next === text) continue;
  writeFileSync(path, next);
  changed++;
  console.log(`pinned ${path}`);
}
console.log(`${changed} of ${manifests.length} manifests pinned to ${pin.name} ${pin.version} ${pin.sha}`);
