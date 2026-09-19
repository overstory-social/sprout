import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';

import { SproutManifest, type Archive, type ArchiveFile } from '@overstory/sprout/lang';

import { readZip, writeZip } from './zip.js';

// A microworld archive on disk (the split proposal §3.3, §6): a folder of
// `*.sprout` files with a `sprout.json` beside them, or a zip of the
// same. The directories are for people; a file's name is its path from
// the root with `/` between, and the compiler reads files in name order.
// A folder's `.sprout/` — the CLI's runtime state — and every other
// dotted entry are never part of the archive: `check` reads regular
// files only.

export interface ReadArchive extends Archive {
  files: ArchiveFile[];
  manifest: SproutManifest | null;
  /** The resolved path it was read from. */
  path: string;
  kind: 'folder' | 'zip';
}

export const MANIFEST = 'sprout.json';

function sproutFilesUnder(root: string, dir = root): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith('.')) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...sproutFilesUnder(root, path));
    else if (stat.isFile() && entry.endsWith('.sprout')) out.push(path);
  }
  return out;
}

function manifestOf(text: string | null, where: string): SproutManifest | null {
  if (text === null) return null;
  const parsed = SproutManifest.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`${where}: ${MANIFEST} is not a manifest`);
  return parsed.data;
}

/** A folder as an archive: every `*.sprout` under it, in name order, and its manifest if it has one. */
export function readArchiveFolder(dir: string): ReadArchive {
  const root = resolve(dir);
  const files = sproutFilesUnder(root).map((path) => ({
    name: relative(root, path).split('\\').join('/'),
    source: readFileSync(path, 'utf8'),
  }));
  const manifestPath = join(root, MANIFEST);
  let text: string | null = null;
  try {
    text = readFileSync(manifestPath, 'utf8');
  } catch {
    text = null;
  }
  return { files, manifest: manifestOf(text, root), path: root, kind: 'folder' };
}

/** A zip as an archive: its `*.sprout` entries and `sprout.json`, paths as they are in the zip. */
export function readArchiveZip(path: string): ReadArchive {
  const full = resolve(path);
  const entries = readZip(readFileSync(full));
  const files = entries
    .filter((e) => e.name.endsWith('.sprout') && !e.name.split('/').some((s) => s.startsWith('.')))
    .map((e) => ({ name: e.name, source: e.data.toString('utf8') }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const manifest = entries.find((e) => e.name === MANIFEST);
  return {
    files,
    manifest: manifestOf(manifest ? manifest.data.toString('utf8') : null, full),
    path: full,
    kind: 'zip',
  };
}

/** A folder or a zip, by what is at the path. */
export function readArchive(path: string): ReadArchive {
  const full = resolve(path);
  let stat;
  try {
    stat = statSync(full);
  } catch {
    throw new Error(`${path}: no such folder or zip`);
  }
  if (stat.isDirectory()) return readArchiveFolder(full);
  if (extname(full).toLowerCase() === '.zip') return readArchiveZip(full);
  throw new Error(`${path}: not a folder and not a .zip`);
}

/** The archive as one zip: the manifest first, then the files in name order. */
export function packArchive(archive: Archive): Buffer {
  const entries = [];
  if (archive.manifest) {
    entries.push({
      name: MANIFEST,
      data: Buffer.from(`${JSON.stringify(archive.manifest, null, 2)}\n`, 'utf8'),
    });
  }
  for (const f of archive.files)
    entries.push({ name: f.name, data: Buffer.from(f.source, 'utf8') });
  return writeZip(entries);
}

/** Where the CLI keeps a folder's runtime state: `.sprout/` beside its files. */
export function stateDirOf(archive: ReadArchive): string {
  return archive.kind === 'folder'
    ? join(archive.path, '.sprout')
    : join(dirname(archive.path), `.sprout-${basename(archive.path, '.zip')}`);
}

/** Write `bytes` to `path`, making the folders on the way. */
export function writeFile(path: string, bytes: Buffer | string): void {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(resolve(path), bytes);
}
