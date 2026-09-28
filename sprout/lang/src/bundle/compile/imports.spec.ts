import { describe, expect, it } from 'vitest';

import { compileWorld } from '../../fixtures/bundle.js';
import { locationOf } from '../../source/source.js';
import { specifierOf } from './imports.js';

/** A single quote, as an import's specifier is written between them. */
const Q = "'";

const PERSON = 'kind Person is sprout.Visitor { }\n';

/** A world `w` whose body is `body`, beside `files`. */
const world = (body: string, files: Record<string, string> = {}, mode?: 'publish' | 'load') =>
  compileWorld(
    'w',
    {
      'w.sprout': `world w is sprout.World {\n  visitors are Person\n  visitors arrive at yard\n  object yard is sprout.Place\n${body}\n}\n`,
      'person.sprout': PERSON,
      ...files,
    },
    mode === undefined ? {} : { mode },
  );

const refused = (result: ReturnType<typeof world>) =>
  result.diagnostics
    .filter((d) => d.severity === 'refusal')
    .map((d) => [locationOf(d.at), d.message]);

const paths = (result: ReturnType<typeof world>) =>
  result.bundle!.objects.map((object) => object.path.join('.'));

describe('specifierOf', () => {
  it('is a file’s path from its part’s root, without `.sprout`', () => {
    expect(specifierOf('rooms/cellar.sprout', 'w', 'w')).toBe('rooms/cellar');
    expect(specifierOf('sprout/actor.sprout', 'sprout', 'w')).toBe('actor');
  });
});

describe('what a file imports', () => {
  it('reads a kind by another name after `as`', () => {
    const result = world('  object box is Box', {
      'w.sprout': `import {Crate as Box} from ${Q}crate${Q}\nworld w is sprout.World {\n  visitors are Person\n  visitors arrive at yard\n  object yard is sprout.Place\n  object box is Box\n}\n`,
      'crate.sprout': 'kind Crate is sprout.Container { }\n',
    });
    expect(refused(result)).toEqual([]);
    const box = result.bundle!.objects.find((object) => object.name === 'box')!;
    expect(box.kind.composes.has('w.Crate')).toBe(true);
  });

  it('reads a library’s names through a namespace, under any name the file gives it', () => {
    const result = compileWorld('w', {
      'w.sprout': `import * as lib from ${Q}sprout${Q}\nworld w is lib.World {\n  visitors are Person\n  visitors arrive at yard\n  object yard is lib.Place\n}\n`,
      'person.sprout': `import * as lib from ${Q}sprout${Q}\nkind Person is lib.Visitor { }\n`,
    });
    expect(refused(result)).toEqual([]);
    expect(paths(result)).toEqual(['yard']);
  });

  it('refuses a specifier that reaches nothing, and a name the file does not declare', () => {
    const result = world('', {
      'crate.sprout': `import {Crate} from ${Q}boxes${Q}\nimport {Bag, Crate as C2} from ${Q}person${Q}\nkind Crate { }\n`,
    });
    expect(refused(result)).toEqual([
      ['crate.sprout:1:21', "`'boxes'` reaches no file or library of this world."],
      ['crate.sprout:2:9', '`person.sprout` declares no `Bag` at its top level.'],
      ['crate.sprout:2:14', '`person.sprout` declares no `Crate` at its top level.'],
    ]);
  });

  it('refuses the world imported, a name imported twice, and one a file declares itself', () => {
    const result = world('', {
      'crate.sprout': `import {w} from ${Q}w${Q}\nimport {Person} from ${Q}person${Q}\nimport {Person as Crate} from ${Q}person${Q}\nimport {Person} from ${Q}person${Q}\nkind Crate { }\n`,
    });
    expect(refused(result).map(([, message]) => message)).toEqual([
      '`w` is the world, which every path may start from, so it is never imported.',
      '`Crate` is imported, and this file declares a `Crate` of its own.',
      '`Person` is imported twice into this file.',
    ]);
  });

  it('refuses a world file named for a library', () => {
    const result = world('', { 'sprout.sprout': 'enum Ward { oak }\n' });
    expect(refused(result)).toEqual([
      [
        'sprout.sprout:1:1',
        "This file cannot be called `sprout.sprout`: `'sprout'` names the library.",
      ],
    ]);
  });

  it('reads an import of a file the manifest names and did not arrive as absent, not unknown', () => {
    const result = compileWorld(
      'w',
      {
        'w.sprout': `import {Crate} from ${Q}crate${Q}\nworld w is sprout.World {\n  visitors are Person\n  visitors arrive at yard\n  object yard is sprout.Place\n}\n`,
        'person.sprout': PERSON,
        'crate.sprout': 'kind Crate { }\n',
      },
      { mode: 'load', withheld: ['crate.sprout'] },
    );
    expect(refused(result)).toEqual([]);
  });
});

describe('an object in a file of its own', () => {
  it('sits where its `in` clause says, from the world’s body, through objects other files place', () => {
    const result = world('', {
      'shed.sprout': 'object shed is sprout.Place in w { }\n',
      'crate.sprout': 'kind Crate is sprout.Container { }\nobject crate is Crate in shed\n',
      'lid.sprout': 'object lid is Crate in w.shed.crate\n',
    });
    expect(refused(result)).toEqual([]);
    expect(paths(result)).toEqual(['yard', 'shed', 'shed.crate', 'shed.crate.lid']);
  });

  it('sits where a stub in the body names it, having been imported there', () => {
    const result = world('  object shed', {
      'w.sprout': `import {shed} from ${Q}rooms/shed${Q}\nworld w is sprout.World {\n  visitors are Person\n  visitors arrive at yard\n  object yard is sprout.Place {\n    object shed\n  }\n}\n`,
      'rooms/shed.sprout': 'object shed is sprout.Place { }\n',
    });
    expect(refused(result)).toEqual([]);
    expect(paths(result)).toEqual(['yard', 'yard.shed']);
  });

  it('refuses one placed nowhere, placed twice, or placed where nothing is', () => {
    const result = world('  object shed\n  object loft', {
      'w.sprout': `import {shed, loft} from ${Q}rooms${Q}\nworld w is sprout.World {\n  visitors are Person\n  visitors arrive at yard\n  object yard is sprout.Place\n  object shed\n  object loft\n  object attic\n}\n`,
      'rooms.sprout':
        'object shed is sprout.Place in w { }\nobject loft is sprout.Place\nobject cellar is sprout.Place\nobject pit is sprout.Place in nowhere\n',
    });
    expect(refused(result).map(([, message]) => message)).toEqual([
      '`cellar` is written in a file of its own, and nothing places it in the world.',
      '`in nowhere` names nothing in the world for `pit` to sit in.',
      '`shed` is placed twice: by its own `in` clause and by this stub.',
      '`object attic` names no object this file imports, and says nothing of its own.',
    ]);
  });

  it('says an object waits on one that names nothing, not that the two are a circle', () => {
    const result = world('', {
      'rooms.sprout':
        'object a is sprout.Place in x.thing\nobject x is sprout.Place, sprout.Container in nowhere\n',
    });
    expect(refused(result).map(([, message]) => message)).toEqual([
      '`in x.thing` names nothing in the world for `a` to sit in.',
      '`in nowhere` names nothing in the world for `x` to sit in.',
    ]);
  });

  it('refuses two objects each placed inside the other', () => {
    const result = world('', {
      'rooms.sprout':
        'object a is sprout.Place, sprout.Container in b\nobject b is sprout.Place, sprout.Container in a\n',
    });
    expect(refused(result).map(([, message]) => message)).toEqual([
      '`a` is placed inside something that is placed inside it.',
      '`b` is placed inside something that is placed inside it.',
    ]);
  });
});
