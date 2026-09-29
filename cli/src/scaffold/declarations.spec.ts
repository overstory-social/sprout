import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkWorld } from '../check.js';
import { scaffoldKind, scaffoldObject } from './declarations.js';
import { scaffoldWorld } from './world.js';

/** A single quote, as an import's specifier is written between them. */
const Q = "'";

/** A fresh world, `shop`, as `scaffold world` writes it. */
function shop(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'sprout-scaffold-')), 'shop');
  scaffoldWorld(dir, 'marta');
  return dir;
}
const read = (dir: string, file: string) => readFileSync(join(dir, file), 'utf8');
const files = (dir: string) => (JSON.parse(read(dir, 'sprout.json')) as { files: string[] }).files;

describe('`scaffold kind`', () => {
  it('writes the kind in a file of its own, importing what it composes, and names the file in the manifest', () => {
    const dir = shop();
    expect(scaffoldKind('Key', dir, undefined, 'sprout.Fixture')).toEqual({
      ok: true,
      page: 'wrote key.sprout\nadded key.sprout to sprout.json\n',
    });
    expect(read(dir, 'key.sprout')).toBe(
      `import * as sprout from ${Q}sprout${Q}\n\nkind Key is sprout.Fixture { }\n`,
    );
    expect(scaffoldKind('BrassKey', dir, undefined, 'Key').ok).toBe(true);
    expect(read(dir, 'brass_key.sprout')).toBe(
      `import {Key} from ${Q}key${Q}\n\nkind BrassKey is Key { }\n`,
    );
    expect(files(dir)).toEqual(['shop.sprout', 'person.sprout', 'key.sprout', 'brass_key.sprout']);
    expect(checkWorld(dir).ok).toBe(true);
  });

  it('appends to the file `--path` names, its imports after the file’s own, each once', () => {
    const dir = shop();
    scaffoldKind('Key', dir, undefined, 'sprout.Fixture');
    expect(scaffoldKind('Lamp', dir, 'key.sprout', 'sprout.Fixture')).toEqual({
      ok: true,
      page: 'changed key.sprout\n',
    });
    expect(read(dir, 'key.sprout')).toBe(
      `import * as sprout from ${Q}sprout${Q}\n\nkind Key is sprout.Fixture { }\n\nkind Lamp is sprout.Fixture { }\n`,
    );
  });

  it('refuses a name that is not a kind’s, a kind the world does not declare, and a file named for it that is there', () => {
    const dir = shop();
    expect(scaffoldKind('key', dir).page).toContain('begins with a capital');
    expect(scaffoldKind('Key', dir, undefined, 'Lock')).toEqual({
      ok: false,
      page: 'The world declares no kind `Lock`. Nothing was written.\n',
    });
    scaffoldKind('Key', dir);
    expect(scaffoldKind('Key', dir).page).toBe(
      'key.sprout is there already. Write --path key.sprout to add to it, or --path another.sprout. Nothing was written.\n',
    );
  });
});

describe('`scaffold object`', () => {
  it('places the object in what `--in` names, in a file of its own', () => {
    const dir = shop();
    scaffoldKind('Key', dir, undefined, 'sprout.Fixture');
    expect(scaffoldObject('brass_key', dir, 'hall', 'Key').ok).toBe(true);
    expect(read(dir, 'brass_key.sprout')).toBe(
      `import {Key} from ${Q}key${Q}\n\nobject brass_key is Key in hall { }\n`,
    );
    expect(checkWorld(dir).ok).toBe(true);
  });

  it('undoes everything it wrote where the world would not compile with it, and says why', () => {
    const dir = shop();
    const before = read(dir, 'sprout.json');
    const done = scaffoldObject('bell', dir, 'nowhere', 'sprout.Fixture');
    expect(done.ok).toBe(false);
    expect(done.page).toContain('`in nowhere` names nothing in the world');
    expect(done.page).toContain('The world would not compile with this, so nothing was written.');
    expect(existsSync(join(dir, 'bell.sprout'))).toBe(false);
    expect(read(dir, 'sprout.json')).toBe(before);
  });

  it('asks for what holds it and what it is made of', () => {
    const dir = shop();
    expect(scaffoldObject('bell', dir, undefined, 'sprout.Fixture').page).toContain('--in hall');
    expect(scaffoldObject('bell', dir, 'hall', undefined).page).toContain('--is sprout.Container');
    expect(scaffoldObject('Bell', dir, 'hall', 'sprout.Fixture').page).toContain('lower case');
  });
});
