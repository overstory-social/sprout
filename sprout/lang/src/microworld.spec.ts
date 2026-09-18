import { describe, expect, it } from 'vitest';

import { MEDIA } from './fixtures/media.js';
import { SproutManifest, compileMicroworld, type Archive } from './microworld.js';

// Microworld compilation (§3.3): files → a program; strict refuses,
// lenient drops into `absent`; identifiers resolve across files; the
// order is declaration order; `use` is archive-level.

const KINDS = `kind Lamp {
  :lit false
  :takeable true
  light when (!self.get(:lit)) { self.set(:lit, true) say "It glows." send room :lit }
}
kind OilLamp: Lamp {
  :fuel 3 min 0 max 9
}
`;
const HALL = `room hall {
  :name "The Hall"
  prose "A hall."
  exit "down" to cellar
  on :lit { say "Brighter." }
}
`;
const CELLAR = `room cellar {
  prose "A cellar."
  exit "up" to hall
}
object lamp: OilLamp in cellar { :name "Old lamp" }
object chest: Container in cellar { :open false }
object coin in chest { :takeable true }
`;

const archive = (extra: Partial<Archive> = {}, manifest = true): Archive => ({
  files: [
    { name: 'rooms/cellar.sprout', source: CELLAR },
    { name: 'kinds.sprout', source: KINDS },
    { name: 'rooms/hall.sprout', source: HALL },
  ],
  manifest: manifest ? { format: 1, language: 1, entry: 'hall', extensions: [] } : null,
  ...extra,
});

describe('compileMicroworld', () => {
  it('compiles an archive: kinds, rooms and objects across files, exits and placement resolved, the entry named', () => {
    const { program, problems, warnings, absent } = compileMicroworld(archive(), { strict: true });
    expect(problems).toEqual([]);
    expect(absent).toEqual([]);
    expect(warnings).toEqual([]);
    expect(program.level).toBe(1);
    expect(program.entry).toBe('hall');
    expect([...program.kinds.keys()]).toEqual(['Lamp', 'OilLamp']);
    expect([...program.rooms.keys()].sort()).toEqual(['cellar', 'hall']);
    expect(program.rooms.get('hall')?.definition.exits).toEqual([
      { label: 'down', toRoomId: 'cellar' },
    ]);
    // objects in declaration order: files by name (kinds, rooms/cellar, rooms/hall), definitions in file order
    expect(program.order).toEqual(['lamp', 'chest', 'coin']);
    const lamp = program.objects.get('lamp')!;
    expect(lamp.placedIn).toBe('cellar');
    expect(lamp.file).toBe('rooms/cellar.sprout');
    // the kind chain is folded: the lamp has Lamp's message and OilLamp's property
    expect(lamp.kinds).toEqual(['OilLamp', 'Lamp']);
    expect(lamp.definition.properties.map((p) => p.name)).toEqual(['lit', 'takeable', 'fuel']);
    expect(lamp.definition.messages.map((m) => m.name)).toEqual(['light']);
    expect(program.objects.get('coin')?.placedIn).toBe('chest');
    // the grammar table: every reachable message, tokenised, the default line included
    expect(program.grammar.get('lamp')?.get('light')).toEqual([
      [{ lit: 'light' }, { slot: 'self', kind: 'object' }],
    ]);
    expect(program.grammar.get('hall')?.size).toBe(0); // `on :lit` is a handler, not a verb
    expect(program.builtins.map((b) => b.name)).toContain('take');
    expect(program.files.get('OilLamp')).toBe('kinds.sprout');
    expect(program.files.get('coin')).toBe('rooms/cellar.sprout');
  });

  it('strict: an exit to no room, an unknown kind, an unplaced object, a duplicate, a bad entry — each a problem naming its file', () => {
    const { problems, program } = compileMicroworld(
      archive({
        files: [
          {
            name: 'a.sprout',
            source:
              'room hall {\n  exit "down" to nowhere\n}\nobject lamp: Ghost in hall {}\nobject lost {}',
          },
          { name: 'b.sprout', source: 'room hall {}' },
        ],
        manifest: { format: 1, language: 1, entry: 'attic', extensions: [] },
      }),
      { strict: true },
    );
    expect(problems.map((p) => [p.file, p.definition, p.message])).toEqual([
      ['b.sprout', 'hall', 'Something called hall is already defined in a.sprout.'],
      ['a.sprout', 'lamp', 'No kind called "Ghost" is defined here.'],
      ['a.sprout', 'lost', 'lost sits nowhere: say where with `in <room or container>`.'],
      ['a.sprout', 'nowhere', 'No room is called "nowhere" here (the exit "down" from hall).'],
      [null, 'attic', 'The manifest\'s entry room "attic" is not here.'],
    ]);
    expect(problems[0]).toMatchObject({ line: 1, column: 1 });
    expect(problems[1]).toMatchObject({ line: 4, column: 1 });
    // the program still holds what did resolve — the caller decides what a problem means
    expect([...program.rooms.keys()]).toEqual(['hall']);
    expect(program.rooms.get('hall')?.definition.exits).toEqual([]);
  });

  it('lenient: the same archive loads with the broken parts absent, each with its reason', () => {
    const { problems, absent, program } = compileMicroworld(
      archive({
        files: [
          {
            name: 'a.sprout',
            source:
              'room hall {\n  exit "down" to nowhere\n}\nobject lamp: Ghost in hall {}\nobject lost {}',
          },
          { name: 'b.sprout', source: 'room hall {}' },
          { name: 'c.sprout', source: 'object { broken' },
        ],
        manifest: { format: 1, language: 1, entry: 'attic', extensions: [] },
      }),
      { strict: false },
    );
    expect(problems).toEqual([]);
    expect(absent.map((a) => a.definition)).toEqual([
      'c.sprout',
      'hall',
      'lamp',
      'lost',
      'nowhere',
      'attic',
    ]);
    expect(absent[0]?.reason).toContain('does not parse');
    expect(program.entry).toBeNull();
    expect(program.absent).toBe(absent);
  });

  it('a container chain must reach a room; a thing in what holds nothing, or in a cycle, is absent', () => {
    const { absent, program } = compileMicroworld(
      {
        files: [
          {
            name: 'a.sprout',
            source: `room hall {}
object box: Container in hall {}
object pebble in box {}
object rock in pebble {}
object a: Container in b {}
object b: Container in a {}`,
          },
        ],
      },
      { strict: false },
    );
    expect(program.order).toEqual(['box', 'pebble']);
    expect(absent.map((x) => [x.definition, x.reason])).toEqual([
      ['rock', 'rock is in pebble, which holds nothing.'],
      ['a', 'a is in b, which never reaches a room.'],
      ['b', 'b is in a, which is not here.'],
    ]);
  });

  it('`use` is archive-level: one file says it, every file compiles under it; an unknown extension is a problem', () => {
    const { program, problems } = compileMicroworld(
      {
        files: [
          { name: 'a.sprout', source: 'use media\nroom hall { :image media "m-1" }' },
          {
            name: 'b.sprout',
            source: 'object sign in hall { :image media "m-2" describe { show self } }',
          },
        ],
      },
      { strict: true, ext: MEDIA },
    );
    expect(problems).toEqual([]);
    expect(program.uses).toEqual(['media']);
    expect(program.values.get('media')).toEqual(['m-1', 'm-2']);
    const unknown = compileMicroworld(
      { files: [{ name: 'a.sprout', source: 'use pictures\nroom hall {}' }] },
      { strict: true },
    );
    expect(unknown.problems[0]?.message).toBe('This host has no extension called "pictures".');
  });

  it('a kind whose parent is gone takes its instances with it; a dropped kind is not a spawn target', () => {
    const { absent, program } = compileMicroworld(
      {
        files: [
          {
            name: 'a.sprout',
            source: 'kind Child: Parent {}\nroom hall {}\nobject thing: Child in hall {}',
          },
        ],
      },
      { strict: false },
    );
    expect(absent.map((x) => x.definition)).toEqual(['Child', 'thing']);
    expect(program.kinds.size).toBe(0);
  });

  it('warnings name the file and the definition; a message someone else sends is not "never fires"', () => {
    const { warnings } = compileMicroworld(archive(), { strict: true });
    expect(warnings).toEqual([]);
    const lonely = compileMicroworld(
      { files: [{ name: 'a.sprout', source: 'room hall { on :ping { say "?" } }' }] },
      { strict: true },
    );
    expect(lonely.warnings).toEqual([
      'a.sprout: hall: On "ping" never fires: nothing sends it in this zone.',
    ]);
  });

  it('the manifest: a newer language level is refused; the shape is pinned', () => {
    expect(SproutManifest.parse({ format: 1, language: 1, entry: 'hall' }).extensions).toEqual([]);
    expect(SproutManifest.safeParse({ format: 2, language: 1, entry: 'hall' }).success).toBe(false);
    const { problems } = compileMicroworld(
      archive({ manifest: { format: 1, language: 99, entry: 'hall', extensions: [] } }),
      { strict: true },
    );
    expect(problems[0]?.message).toContain('needs language level 99');
  });
});
