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
  const made: string[] = [];
  for (const { file, text } of files) {
    keep(file);
    const first = mkdirSync(dirname(join(dir, file)), { recursive: true });
    if (first !== undefined) made.push(first);
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
  // A folder the scaffold made goes with what it wrote there.
  for (const folder of made.reverse()) rmSync(folder, { recursive: true, force: true });
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

/**
 * `text` with each of `imports` after the file's own imports, where it
 * does not already import what it names: an import read whole however many
 * lines it spans, in either quotes, and a name counted as imported where
 * any import from its file names it.
 */
export function withImports(text: string, imports: readonly string[]): string {
  const lines = text === '' ? [] : text.replace(/\n$/, '').split('\n');
  const held: string[] = [];
  let at = 0;
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!.trim();
    if (line === '' || line.startsWith('//')) {
      i += 1;
      continue;
    }
    if (!/^import\b/.test(line)) break;
    // An import runs to the line naming where it is from.
    let end = i;
    while (end < lines.length - 1 && !FROM.test(lines[end]!)) end += 1;
    held.push(lines.slice(i, end + 1).join(' '));
    i = end + 1;
    at = i;
  }
  const missing = imports.filter((one) => !held.some((some) => covers(some, one)));
  if (missing.length === 0) return text;
  lines.splice(at, 0, ...missing);
  return `${lines.join('\n')}\n`;
}

/** Where an import is from, in either quotes. */
const FROM = /\bfrom\s+['"]([^'"]+)['"]/;

/** Whether the import `held` already imports what `wanted` would. */
function covers(held: string, wanted: string): boolean {
  const from = FROM.exec(held)?.[1];
  if (from === undefined || from !== FROM.exec(wanted)?.[1]) return false;
  const star = /\*\s+as\s+(\w+)/;
  if (star.test(wanted)) return star.exec(held)?.[1] === star.exec(wanted)?.[1];
  const names = (one: string) =>
    (/\{([^}]*)\}/.exec(one)?.[1] ?? '').split(',').map((name) => name.trim().split(/\s+as\s+/)[0]);
  return names(wanted).every((name) => names(held).includes(name));
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
