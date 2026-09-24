import { describe, expect, it } from 'vitest';

import { Diagnostics } from '../source/diagnostics.js';
import { locationOf, SourceFile } from '../source/source.js';
import { parseDeclarations } from '../syntax/parse.js';
import { checkKindFiles, checkWorldFile, fileNamedFor } from './file-names.js';
import type { WorldDeclaration } from '../syntax/ast.js';

/** What the rule says of `text` written in the file `name`, as location, sentence and remedy. */
function said(name: string, text: string): string[][] {
  const parsing = new Diagnostics();
  const declarations = parseDeclarations(new SourceFile(name, text), parsing);
  expect(parsing.all).toEqual([]);
  const diagnostics = new Diagnostics();
  checkKindFiles(name, declarations, diagnostics);
  return diagnostics.all.map((d) => [locationOf(d.at), d.message, d.remedy ?? '']);
}

describe('the file named for a kind or a world', () => {
  it('is its name in lower case', () => {
    expect(fileNamedFor('Chest')).toBe('chest.sprout');
    expect(fileNamedFor('K')).toBe('k.sprout');
  });

  it('puts a `_` between the words of a name', () => {
    expect(fileNamedFor('PrintedSheet')).toBe('printed_sheet.sprout');
    expect(fileNamedFor('SafetyLamp')).toBe('safety_lamp.sprout');
    expect(fileNamedFor('StormLanternCase')).toBe('storm_lantern_case.sprout');
  });

  it('reads a run of capitals as one word, and its last capital as the next word’s start', () => {
    expect(fileNamedFor('TVSet')).toBe('tv_set.sprout');
    expect(fileNamedFor('HTML')).toBe('html.sprout');
  });

  it('starts a word at a capital after a digit, and keeps a `_` already written', () => {
    expect(fileNamedFor('Room2B')).toBe('room2_b.sprout');
    expect(fileNamedFor('Room_B')).toBe('room_b.sprout');
  });

  it('keeps a world’s lower snake case name as it is', () => {
    expect(fileNamedFor('printers_shop')).toBe('printers_shop.sprout');
    expect(fileNamedFor('ways')).toBe('ways.sprout');
  });
});

describe('each kind in a file of its own, named for it', () => {
  it('takes a kind in the file named for it, beside enums, verbs and messages', () => {
    const text = [
      'enum Ward { brass, iron }',
      'message :stir',
      'verb unlock { role target  "unlock [target]" }',
      'kind PrintedSheet { :ward Ward default brass }',
    ].join('\n');
    expect(said('printed_sheet.sprout', text)).toEqual([]);
  });

  it('takes a file with no kind in it, whatever it is called, and the world in one', () => {
    const text = [
      'world shop is sprout.World { }',
      'enum Ward { brass, iron }',
      'message :stir',
      'verb work { role target  "work [target]" }',
    ].join('\n');
    expect(said('Anything.sprout', text)).toEqual([]);
    expect(said('chest.sprout', text)).toEqual([]);
  });

  it('refuses a kind in a file not named for it, at its name, naming the file', () => {
    expect(said('kinds.sprout', 'enum Ward { brass }\nkind PrintedSheet { }')).toEqual([
      [
        'kinds.sprout:2:6',
        '`PrintedSheet` is declared in `kinds.sprout`, and a kind is declared in the file named for it.',
        'Move `kind PrintedSheet` to a file of its own called `printed_sheet.sprout`.',
      ],
    ]);
  });

  it('compares the name exactly, so a capital or a missing `_` is another file', () => {
    for (const name of ['Chest.sprout', 'CHEST.sprout']) {
      expect(said(name, 'kind Chest { }').map(([at]) => at)).toEqual([`${name}:1:6`]);
    }
    expect(said('printedsheet.sprout', 'kind PrintedSheet { }')[0]![2]).toBe(
      'Move `kind PrintedSheet` to a file of its own called `printed_sheet.sprout`.',
    );
  });

  it('refuses every kind in a file named for none of them, each with its own file', () => {
    expect(
      said('world.sprout', 'kind Room { }\nkind Crate { }').map(([at, , to]) => [at, to]),
    ).toEqual([
      ['world.sprout:1:6', 'Move `kind Room` to a file of its own called `room.sprout`.'],
      ['world.sprout:2:6', 'Move `kind Crate` to a file of its own called `crate.sprout`.'],
    ]);
  });

  it('refuses a second kind in a kind’s file at the second kind, naming where it goes', () => {
    expect(said('chest.sprout', 'kind Chest { }\nkind Lid { }')).toEqual([
      [
        'chest.sprout:2:6',
        '`Lid` shares `chest.sprout` with `Chest`, and each kind is declared in a file of its own.',
        'Move `kind Lid` to a file of its own called `lid.sprout`.',
      ],
    ]);
  });

  it('keeps the kind the file is named for, wherever in the file it is written', () => {
    expect(said('chest.sprout', 'kind Lid { }\nkind Chest { }').map(([at]) => at)).toEqual([
      'chest.sprout:1:6',
    ]);
  });

  it('leaves a kind declared twice under the file’s name to the check that says so', () => {
    expect(said('chest.sprout', 'kind Chest { }\nkind Chest { }')).toEqual([]);
  });

  it('takes the world in a kind’s file, which is the world’s file to refuse', () => {
    expect(said('chest.sprout', 'kind Chest { }\nworld shop is sprout.World { }')).toEqual([]);
  });

  it('refuses a kind named for the file of the world declared there, at the kind', () => {
    expect(said('chest.sprout', 'world chest is sprout.World { }\nkind Chest { }')).toEqual([
      [
        'chest.sprout:2:6',
        '`Chest` shares `chest.sprout` with the world `chest`, and each kind is declared in a file of its own.',
        "Rename `kind Chest`, since `chest.sprout` is the world's file.",
      ],
    ]);
  });

  it('reads the last part of a path, as a library’s files are named', () => {
    expect(said('sprout/chest.sprout', 'kind Chest { }')).toEqual([]);
    expect(
      said('sprout/kinds.sprout', 'kind Chest { }').map(([at, message]) => [at, message]),
    ).toEqual([
      [
        'sprout/kinds.sprout:1:6',
        '`Chest` is declared in `kinds.sprout`, and a kind is declared in the file named for it.',
      ],
    ]);
  });
});

/** What the rule says of a world `named` in the manifest, declared as `text` in the file `path`. */
function saidOfWorld(path: string, text: string, named: string): string[][] {
  const parsing = new Diagnostics();
  const world = parseDeclarations(new SourceFile(path, text), parsing).find(
    (d): d is WorldDeclaration => d.kind === 'world',
  );
  expect(parsing.all).toEqual([]);
  const diagnostics = new Diagnostics();
  checkWorldFile(world!, named, diagnostics);
  return diagnostics.all.map((d) => [locationOf(d.at), d.message, d.remedy ?? '']);
}

describe('the world in the file named for its name', () => {
  it('takes the world in the file named for the manifest’s name', () => {
    expect(saidOfWorld('ways.sprout', 'world ways is sprout.World { }', 'ways')).toEqual([]);
    expect(
      saidOfWorld(
        'printers_shop.sprout',
        'world printers_shop is sprout.World { }',
        'printers_shop',
      ),
    ).toEqual([]);
  });

  it('refuses the world in any other file, at its name, naming the file', () => {
    expect(
      saidOfWorld('world.sprout', 'enum Ward { brass }\nworld ways is sprout.World { }', 'ways'),
    ).toEqual([
      [
        'world.sprout:2:7',
        'The world `ways` is declared in `world.sprout`, and the world is declared in the file named for it.',
        "Move `world ways` to a file called `ways.sprout`, and name that file in the manifest's files.",
      ],
    ]);
  });

  it('reads the file from the manifest’s name, not from the file the world happens to be in', () => {
    expect(saidOfWorld('shop.sprout', 'world shop is sprout.World { }', 'ways')[0]![2]).toBe(
      "Move `world shop` to a file called `ways.sprout`, and name that file in the manifest's files.",
    );
  });

  it('compares the name exactly, so a capital is another file', () => {
    expect(
      saidOfWorld('Ways.sprout', 'world ways is sprout.World { }', 'ways').map(([at]) => at),
    ).toEqual(['Ways.sprout:1:7']);
  });

  it('reads the last part of a path', () => {
    expect(saidOfWorld('shop/ways.sprout', 'world ways is sprout.World { }', 'ways')).toEqual([]);
  });
});
