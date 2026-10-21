// `node scripts/sync-world.mjs <world> <path to the studio checkout>` refreshes the snapshot of a
// studio world that sprout-player/worlds.json lists, to ship or to test only: it copies the world, as
// committed at the checkout's HEAD, into sprout-player/worlds/<world>/ and rewrites its pin there. It
// is run by hand, and its diff is read before it is committed; the gate never runs it, and the build
// reads only the snapshot.
//
// The snapshot is every file the studio commits under worlds/<world>/world except its tests/, of
// which only the plays sprout-player/worlds.json lists for the world are copied. The pin,
// source.json, is `{ "repository": "<https URL of the checkout's origin>", "world":
// "worlds/<world>/world", "commit": "<sha>" }`. The copy is of the commit, so a world with
// uncommitted changes is refused: the pin would not name what was copied.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '../..');

/** Where the snapshots live, one folder per world. */
export const SNAPSHOTS = join(root, 'sprout-player/worlds');

/** The list of worlds whose entry for the world names the plays to copy. */
const WORLDS_FILE = join(root, 'sprout-player/worlds.json');

/** Runs git in `cwd`; its output, or null where it failed. */
function git(cwd, args, encoding = 'utf8') {
  const done = spawnSync('git', args, { cwd, encoding, maxBuffer: 64 * 1024 * 1024 });
  return done.status === 0 ? done.stdout : null;
}

/** The https address of a remote written as `git@host:owner/repo.git` or `https://host/owner/repo.git`. */
export function httpsAddress(remote) {
  const scp = /^[^@/]+@([^:/]+):(.+?)(\.git)?$/.exec(remote);
  if (scp !== null) return `https://${scp[1]}/${scp[2]}`;
  return remote.replace(/\.git$/, '');
}

/**
 * Copies `world` from the studio checkout `studio` into `<into>/<world>` and writes its pin; returns
 * `{ dir, commit, files }`. Throws, saying what to do, before writing anything, where the checkout
 * has no such world, no manifest, uncommitted changes to it or no origin, or where `list` has no
 * entry for the snapshot or names a play the world does not commit.
 */
export function syncWorld({ world, studio, into = SNAPSHOTS, list = WORLDS_FILE }) {
  if (!/^[A-Za-z0-9_-]+$/.test(world)) {
    throw new Error(`"${world}" is not a world's name: write the folder name under worlds/.`);
  }
  if (!existsSync(studio) || !statSync(studio).isDirectory()) {
    throw new Error(`${studio} is not a folder: give the path to a sprout-studio checkout.`);
  }
  const top = git(studio, ['rev-parse', '--show-toplevel'])?.trim();
  if (top === undefined) {
    throw new Error(`${studio} is not a git checkout: give the path to a sprout-studio checkout.`);
  }
  const from = `worlds/${world}/world`;
  const commit = git(top, ['rev-parse', 'HEAD'])?.trim();
  const listed =
    commit === undefined
      ? null
      : git(top, ['ls-tree', '-r', '-z', '--name-only', commit, '--', `${from}/`]);
  const paths = (listed ?? '').split('\0').filter((path) => path !== '');
  if (paths.length === 0) {
    throw new Error(`${top} has no world "${world}": nothing is committed at ${from}.`);
  }
  if (!paths.includes(`${from}/sprout.json`)) {
    throw new Error(`${top} has no manifest for "${world}": ${from}/sprout.json is not committed.`);
  }
  const changed = git(top, ['status', '--porcelain', '--', `${from}/`]);
  if (changed !== '') {
    const first = (changed ?? '')
      .split('\n')
      .filter((line) => line !== '')
      .slice(0, 3);
    throw new Error(
      `${top} has uncommitted changes to ${from} (${first.join('; ')}): commit them in the studio first, so the pin names what is copied.`,
    );
  }
  const remote = git(top, ['remote', 'get-url', 'origin'])?.trim();
  if (remote === undefined || remote === '') {
    throw new Error(
      `${top} has no origin remote: the pin names the repository the world came from.`,
    );
  }

  const dir = resolve(into, world);
  const plays = playsFor(list, dir, world);
  for (const play of plays) {
    if (!paths.includes(`${from}/${play}`)) {
      throw new Error(
        `${list} lists the play "${play}" for "${world}", and ${top} commits no ${from}/${play}.`,
      );
    }
  }
  const files = paths
    .map((path) => path.slice(from.length + 1))
    .filter((path) => !path.startsWith('tests/') || plays.includes(path))
    .map((path) => [path, git(top, ['cat-file', 'blob', `${commit}:${from}/${path}`], 'buffer')]);

  rmSync(dir, { recursive: true, force: true });
  for (const [path, bytes] of files) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), bytes);
  }
  const pin = { repository: httpsAddress(remote), world: from, commit };
  writeFileSync(join(dir, 'source.json'), `${JSON.stringify(pin, null, 2)}\n`);
  return { dir, commit, files: files.length };
}

/**
 * The plays `list` names for the world whose snapshot is `dir`, under "graduated" or "testOnly";
 * throws where neither has an entry for it.
 */
function playsFor(list, dir, world) {
  let lists;
  try {
    lists = JSON.parse(readFileSync(list, 'utf8'));
  } catch (err) {
    throw new Error(`${list} cannot be read as JSON: ${err.message}`);
  }
  const entries = ['graduated', 'testOnly'].flatMap((key) =>
    Array.isArray(lists?.[key]) ? lists[key] : [],
  );
  const entry = entries.find(
    (one) => typeof one?.world === 'string' && resolve(root, one.world) === dir,
  );
  if (entry === undefined) {
    throw new Error(
      `${list} lists no world at ${dir}: add { "world": "sprout-player/worlds/${world}", "title": "<title>", "plays": [ … ] } to "graduated", to ship it, or to "testOnly", to test it only.`,
    );
  }
  return Array.isArray(entry.plays) ? entry.plays : [];
}

// ---- the command ----

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [world, studio] = process.argv.slice(2);
  if (world === undefined || studio === undefined) {
    console.error('write `node scripts/sync-world.mjs <world> <path to the studio checkout>`.');
    process.exit(2);
  }
  try {
    const { dir, commit, files } = syncWorld({ world, studio: resolve(studio) });
    console.log(`${world}: ${files} files copied at ${commit.slice(0, 12)} into ${dir}`);
    spawnSync('git', ['--no-pager', 'status', '--short', '--', dir], {
      cwd: root,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
