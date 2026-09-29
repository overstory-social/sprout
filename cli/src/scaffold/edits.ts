import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { MANIFEST_FILE, type Bundle } from '@overstory/sprout/lang';

import { checkWorld, formatCheck } from '../check.js';

// What a scaffold writes into a world folder, and how it is undone: every
// file it writes or changes, kept as it was first, so that where the world
// no longer compiles once they are written, each is put back as it was and
// each new one removed (the spec's The compiler; `sprout check`'s strict
// compile). A file a scaffold adds is added to the manifest's `files`, and
// an import it needs goes after the file's own imports, once.

/** A single quote, as an import's specifier is written between them. */
const Q = "'";

/** One file a scaffold writes: its path in the world folder, and its whole text. */
export interface Written {
  readonly file: string;
  readonly text: string;
}

/** What a scaffold did: the page it says, and whether the world still compiles. */
export interface Scaffolded {
  readonly ok: boolean;
  readonly page: string;
}

/**
 * Write `files` into the world in `dir`, adding each `.sprout` file the
 * manifest does not name to its `files`, then check the world strictly:
 * where it compiles, say what was written; where it does not, put every
 * file back as it was and say why.
 */
export function applyScaffold(dir: string, files: readonly Written[]): Scaffolded {
  const before = new Map<string, string | null>();
  const keep = (file: string) => {
    if (before.has(file)) return;
    const path = join(dir, file);
    before.set(file, existsSync(path) ? readFileSync(path, 'utf8') : null);
  };
  const said: string[] = [];
  const manifest = readManifest(dir);
  const named = new Set(manifest.files);
  const added = files.filter((one) => one.file.endsWith('.sprout') && !named.has(one.file));
  for (const { file, text } of files) {
    keep(file);
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
    said.push(`${before.get(file) === null ? 'wrote' : 'changed'} ${file}`);
  }
  if (added.length > 0) {
    keep(MANIFEST_FILE);
    const files = [...manifest.files, ...added.map((one) => one.file)];
    writeFileSync(
      join(dir, MANIFEST_FILE),
      `${JSON.stringify({ ...manifest.raw, files }, null, 2)}\n`,
    );
    for (const one of added) said.push(`added ${one.file} to ${MANIFEST_FILE}`);
  }
  const checked = checkWorld(dir);
  if (checked.ok) return { ok: true, page: `${said.join('\n')}\n` };
  for (const [file, text] of before) {
    const path = join(dir, file);
    if (text === null) rmSync(path, { force: true });
    else writeFileSync(path, text);
  }
  return {
    ok: false,
    page: `${formatCheck(checked)}\nThe world would not compile with this, so nothing was written.\n`,
  };
}

/** The manifest in `dir` as written, and the files it names. */
function readManifest(dir: string): { raw: Record<string, unknown>; files: string[] } {
  const path = join(dir, MANIFEST_FILE);
  if (!existsSync(path))
    throw new Error(`${dir}: no ${MANIFEST_FILE} here; \`sprout scaffold world\` makes one`);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const files = Array.isArray(raw['files'])
    ? raw['files'].filter((one): one is string => typeof one === 'string')
    : [];
  return { raw, files };
}

/** `text` with each of `imports` after the file's own imports, where it does not already hold it. */
export function withImports(text: string, imports: readonly string[]): string {
  const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n');
  const missing = imports.filter((one) => !lines.includes(one));
  if (missing.length === 0) return text;
  let at = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^import\s/.test(lines[i]!)) at = i + 1;
    else if (lines[i]!.trim() !== '' && !lines[i]!.startsWith('//')) break;
  }
  lines.splice(at, 0, ...missing);
  return `${lines.join('\n')}\n`;
}

/**
 * The imports that name each of `kinds` in `file`: a library's kind by its
 * library, `import * as sprout` from its library, and one of the world's by
 * the file that declares it, found in `bundle`; null, with why, where the
 * world declares none of that name.
 */
export function importsFor(
  kinds: readonly string[],
  file: string,
  bundle: Bundle,
): { readonly imports: string[] } | { readonly missing: string } {
  const imports: string[] = [];
  for (const kind of kinds) {
    const dot = kind.indexOf('.');
    if (dot >= 0) {
      const library = kind.slice(0, dot);
      imports.push(`import * as ${library} from ${Q}${library}${Q}`);
      continue;
    }
    const declared = bundle.definitions.find(
      (one) => one.kind === 'kind' && one.name.text === kind,
    );
    if (declared === undefined) return { missing: `The world declares no kind \`${kind}\`.` };
    const from = declared.at.source.name;
    if (from !== file)
      imports.push(`import {${kind}} from ${Q}${from.replace(/\.sprout$/, '')}${Q}`);
  }
  return { imports: [...new Set(imports)] };
}
