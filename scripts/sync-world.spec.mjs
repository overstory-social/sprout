// Specs for scripts/sync-world.mjs, over a studio checkout made in a scratch folder: what the
// snapshot holds, the pin, and each refusal, which writes nothing. Run by `node --test`
// (`shippingSpecs`); they need git and nothing built.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { httpsAddress, syncWorld } from './sync-world.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'sprout-sync-'));

function git(cwd, ...args) {
  const done = spawnSync(
    'git',
    [
      '-c',
      'user.name=Studio',
      '-c',
      'user.email=studio@example.com',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd, encoding: 'utf8' },
  );
  assert.equal(done.status, 0, done.stderr);
  return done.stdout.trim();
}

function write(dir, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}

/** A studio checkout holding worlds/cave/world, committed, with an origin; returns its folder and HEAD. */
function studio(files = {}) {
  const dir = scratch();
  git(dir, 'init', '-q');
  git(dir, 'remote', 'add', 'origin', 'git@github.com:example/studio.git');
  write(join(dir, 'worlds/cave/world'), {
    'sprout.json': '{ "name": "cave" }\n',
    'cave.sprout': 'world cave\n',
    'pictures/door.png': '\u0089PNG',
    'tests/walkthrough.json': '[]\n',
    'tests/other.json': '[]\n',
    ...files,
  });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'cave');
  return { dir, head: git(dir, 'rev-parse', 'HEAD') };
}

/** A snapshot folder and a shipping list naming `<into>/cave` with `plays`. */
function target(plays = ['tests/walkthrough.json'], into = join(scratch(), 'worlds')) {
  const list = join(scratch(), 'worlds.json');
  writeFileSync(
    list,
    JSON.stringify({ graduated: [{ world: join(into, 'cave'), title: 'Cave', plays }] }),
  );
  return { into, list };
}

test('the snapshot is the committed world and its listed plays, and the pin names the commit', () => {
  const { dir, head } = studio();
  const { into, list } = target();
  const done = syncWorld({ world: 'cave', studio: dir, into, list });
  assert.equal(done.commit, head);
  const snap = join(into, 'cave');
  assert.equal(readFileSync(join(snap, 'cave.sprout'), 'utf8'), 'world cave\n');
  assert.ok(existsSync(join(snap, 'pictures/door.png')));
  assert.ok(existsSync(join(snap, 'tests/walkthrough.json')));
  assert.ok(!existsSync(join(snap, 'tests/other.json')), 'an unlisted transcript is not copied');
  assert.deepEqual(JSON.parse(readFileSync(join(snap, 'source.json'), 'utf8')), {
    repository: 'https://github.com/example/studio',
    world: 'worlds/cave/world',
    commit: head,
  });
});

test('a newer sync replaces the snapshot, so a file the studio removed goes too', () => {
  const { dir } = studio();
  const { into, list } = target();
  syncWorld({ world: 'cave', studio: dir, into, list });
  git(dir, 'rm', '-q', 'worlds/cave/world/pictures/door.png');
  git(dir, 'commit', '-q', '-m', 'no door');
  const done = syncWorld({ world: 'cave', studio: dir, into, list });
  assert.ok(!existsSync(join(into, 'cave/pictures/door.png')));
  assert.equal(
    JSON.parse(readFileSync(join(into, 'cave/source.json'), 'utf8')).commit,
    done.commit,
  );
});

test('each refusal says what is wrong and leaves the snapshot as it was', () => {
  const { dir } = studio();
  const { into, list } = target();
  syncWorld({ world: 'cave', studio: dir, into, list });
  const pin = readFileSync(join(into, 'cave/source.json'), 'utf8');

  const noManifest = studio();
  git(noManifest.dir, 'rm', '-q', 'worlds/cave/world/sprout.json');
  git(noManifest.dir, 'commit', '-q', '-m', 'no manifest');
  const dirty = studio();
  writeFileSync(join(dirty.dir, 'worlds/cave/world/cave.sprout'), 'world cave changed\n');
  const noOrigin = studio();
  git(noOrigin.dir, 'remote', 'remove', 'origin');
  const unlisted = join(scratch(), 'worlds.json');
  writeFileSync(unlisted, JSON.stringify({ graduated: [] }));

  const cases = [
    [{ world: '../cave', studio: dir }, /"..\/cave" is not a world's name/],
    [
      { world: 'cave', studio: join(dir, 'nowhere') },
      /is not a folder: give the path to a sprout-studio checkout/,
    ],
    [{ world: 'cave', studio: scratch() }, /is not a git checkout/],
    [
      { world: 'lake', studio: dir },
      /has no world "lake": nothing is committed at worlds\/lake\/world/,
    ],
    [
      { world: 'cave', studio: noManifest.dir },
      /has no manifest for "cave": worlds\/cave\/world\/sprout.json is not committed/,
    ],
    [
      { world: 'cave', studio: dirty.dir },
      /has uncommitted changes to worlds\/cave\/world .*commit them in the studio first/,
    ],
    [{ world: 'cave', studio: noOrigin.dir }, /has no origin remote/],
    [
      { world: 'cave', studio: dir, list: unlisted },
      /lists no world at .*: add \{ "world": "sprout-player\/worlds\/cave"/,
    ],
    [
      { world: 'cave', studio: dir, list: target(['tests/missing.json'], into).list },
      /lists the play "tests\/missing.json" for "cave", and .* commits no worlds\/cave\/world\/tests\/missing.json/,
    ],
  ];
  for (const [args, pattern] of cases) {
    assert.throws(() => syncWorld({ into, list, ...args }), pattern);
    assert.equal(readFileSync(join(into, 'cave/source.json'), 'utf8'), pin);
  }
  rmSync(into, { recursive: true, force: true });
});

test('an origin is pinned by its https address', () => {
  assert.equal(
    httpsAddress('git@github.com:example/studio.git'),
    'https://github.com/example/studio',
  );
  assert.equal(
    httpsAddress('https://github.com/example/studio.git'),
    'https://github.com/example/studio',
  );
  assert.equal(
    httpsAddress('https://github.com/example/studio'),
    'https://github.com/example/studio',
  );
});
