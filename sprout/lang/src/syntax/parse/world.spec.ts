import { describe, expect, it } from 'vitest';

import { DECLARATIONS } from '../parse.js';
import { locationOf, textOf } from '../../source/source.js';
import { readProperty, readWorld, readLet } from '../../fixtures/parse.js';

/** A world's members as plain words, for a suite that is not about nodes. */
const membersOf = (declared: { members: readonly { kind: string }[] }): string[] =>
  declared.members.map((m) => m.kind);

describe('a world declaration', () => {
  it('reads the spec’s own world', () => {
    const { world, refusals } = readWorld(`world printers_shop: sprout.World {
  visitors are Creature
  visitors arrive at composing_room
  :season Season default autumn
}`);
    expect(refusals).toEqual([]);
    expect(world!.name.text).toBe('printers_shop');
    expect(world!.composes.map((c) => `${c.library?.text ?? ''}.${c.name.text}`)).toEqual([
      'sprout.World',
    ]);
    expect(membersOf(world!)).toEqual(['visitors-are', 'visitors-arrive-at', 'property']);
  });

  it('reads what it composes, qualified or not, one or several', () => {
    const one = readWorld('world w: victorian.Voice { visitors are P\n visitors arrive at y }');
    expect(one.world!.composes.map((c) => `${c.library?.text ?? ''}.${c.name.text}`)).toEqual([
      'victorian.Voice',
    ]);

    const two = readWorld(
      'world w: victorian.Voice, Other { visitors are P\n visitors arrive at y }',
    );
    expect(two.world!.composes.map((c) => c.name.text)).toEqual(['Voice', 'Other']);
    expect(two.world!.composes[1]!.library).toBeNull();
  });

  it('holds its own properties, and `:remembers` beside them', () => {
    const { world, refusals } = readWorld(`world w: sprout.World {
  :a false
  :remembers [seen: false]
  visitors are P
  visitors arrive at y
}`);
    expect(refusals).toEqual([]);
    expect(membersOf(world!)).toEqual([
      'property',
      'remembers',
      'visitors-are',
      'visitors-arrive-at',
    ]);
  });

  it('spans from `world` to its closing brace', () => {
    const { world } = readWorld('world w: sprout.World { visitors are P\n visitors arrive at y }');
    expect(textOf(world!.at).startsWith('world w: sprout.World {')).toBe(true);
    expect(textOf(world!.at).endsWith('}')).toBe(true);
  });

  it('refuses a word of the language as the name, at the name', () => {
    const { statement, refusals } = readLet('let default = 1');
    expect(statement).toBeNull();
    expect(refusals).toHaveLength(1);
    expect(refusals[0]!.message).toBe(
      '`default` is a word of the language, so it cannot name a value.',
    );
    expect(refusals[0]!.remedy).toContain('Choose another name');
    expect(locationOf(refusals[0]!.at)).toBe('body.sprout:1:5');
  });

  it('refuses every reserved word there, and no ordinary word', () => {
    for (const word of ['text', 'true', 'string', 'each', 'let']) {
      const { statement, refusals } = readLet(`let ${word} = 1`);
      expect(statement, word).toBeNull();
      expect(refusals.map((d) => d.message).join(' '), word).toContain('word of the language');
    }
    expect(readLet('let textures = 1').refusals).toEqual([]);
  });

  it('says what is wrong with one that is not written out', () => {
    // What is wrong with the world ITSELF costs the world. What is wrong
    // with one member costs that member: the world is kept with the
    // members that read, so the ones after it are read too.
    const table: [string, string, 'lost' | 'kept'][] = [
      ['world { }', 'A world needs a name.', 'lost'],
      ['world w', 'has nothing in it', 'lost'],
      ['world w: sprout.World { visitors are P', 'is never closed', 'lost'],
      ['world w: 4 { }', 'is not the name of a kind', 'lost'],
      ['world w: victorian. { }', 'is not followed by the name of a kind', 'lost'],
      ['world w: sprout.World { visitors }', 'A world says two things about visitors', 'kept'],
      [
        'world w: sprout.World { visitors arrive y }',
        'A world says where visitors arrive AT.',
        'kept',
      ],
      ['world w: sprout.World { visitors are 4 }', 'is not the name of a kind', 'kept'],
      ['world w: sprout.World { visitors are creature }', 'is not the name of a kind', 'kept'],
      ['world w: sprout.World { nonsense }', 'A world is not made of', 'kept'],
      ['world w: sprout.World { 4 }', 'A world is not made of', 'kept'],
    ];
    for (const [text, said, fate] of table) {
      const { world, refusals } = readWorld(text);
      if (fate === 'lost') expect(world, text).toBeUndefined();
      else expect(membersOf(world!), text).toEqual([]);
      expect(refusals.map((d) => d.message).join(' '), text).toContain(said);
      for (const refusal of refusals) {
        expect(refusal.remedy ?? '', `${text}: no remedy`).not.toBe('');
      }
    }
  });

  it('reads on past a member it could not read, and names every one that is wrong', () => {
    const { world, refusals } = readWorld(`world w: sprout.World {
  visitors are Creature
  visitors arrive at hall
  :wear 4 min "x"
  :ward Ward.Iron
  :opens [Ward].brass
}`);
    expect(refusals.map((d) => [locationOf(d.at), d.message])).toEqual([
      ['w.sprout:4:15', 'A min is a whole number.'],
      ['w.sprout:5:14', '`Ward.` cannot name `Iron`, which starts with a capital.'],
      ['w.sprout:6:16', '`:opens` writes a dot after a type that has no options.'],
    ]);
    expect(membersOf(world!)).toEqual(['visitors-are', 'visitors-arrive-at']);
  });

  it('steps over a stretch of stray `[` after a bad member once, not once per bracket', () => {
    // Not a timing assertion — the test timeout is the guard, as it is
    // for the lexer's long lookahead. The size is chosen so that it
    // bites: probing each `[` afresh for its `]` took about 38 seconds
    // on this body against a default timeout of five, where walking the
    // stretch once took about 80 milliseconds. Thirty-two thousand
    // brackets took 3.5 seconds rescanned, which does not bite. Do not
    // lower the count, and do not raise the timeout.
    const count = 100_000;
    const { world, refusals } = readWorld(
      `world w: sprout.World {\n  :ward Ward.Iron\n  ${'['.repeat(count)}\n  :y 1\n}\n`,
    );
    expect(world!.members.map((m) => (m.kind === 'property' ? m.name.text : m.kind))).toEqual([
      'y',
    ]);
    expect(refusals).toHaveLength(1);
  });

  it('remembers what one probe found across the members that follow it', () => {
    // The same guard, where each stray `[` ends a bad member of its own
    // and so each is met by a different recovery. Rescanning took about
    // 22 seconds for this count and 5.6 for twenty thousand, which is
    // too close to the timeout to bite; walking once took about 150
    // milliseconds. Do not lower the count, and do not raise the timeout.
    const count = 40_000;
    const { world, refusals } = readWorld(
      `world w: sprout.World {\n${':a Ward.Iron [\n'.repeat(count)}  :y 1\n}\n`,
    );
    expect(world!.members.map((m) => (m.kind === 'property' ? m.name.text : m.kind))).toEqual([
      'y',
    ]);
    expect(refusals).toHaveLength(count);
  });

  it('keeps the member written after one it could not read', () => {
    /** A world's members by name, the way a reader of these tests would say them. */
    const named = (text: string) => {
      const { world, refusals } = readWorld(`world w: sprout.World {\n${text}\n}\n`);
      const members = world!.members.map((m) =>
        m.kind === 'property' ? m.name.text : m.kind === 'remembers' ? 'remembers' : m.kind,
      );
      return { members, said: refusals.map((d) => d.message) };
    };
    // A well-formed property, and a `:remembers`, after a bad property.
    expect(named(':wear 4 min "x"\n:ward 0')).toEqual({
      members: ['ward'],
      said: ['A min is a whole number.'],
    });
    expect(named(':wear 4 min "x"\n:remembers [visits: 0]')).toEqual({
      members: ['remembers'],
      said: ['A min is a whole number.'],
    });
    // A list is stepped over whole: `:wet` inside it is not a member.
    expect(named(':x Zeta [oak, :wet]\n:y 1')).toEqual({
      members: ['y'],
      said: ['`:x` has a type and no value to start at.'],
    });
    expect(named(':x [oak, Zeta silver]\n:y 1').members).toContain('y');
    // A `[` that never closes is not allowed to take the rest of the body.
    expect(named(':x Ward.Iron [\n:y 1').members).toEqual(['y']);
    // And one that never closes says nothing about a list after it that does.
    expect(named(':x Ward.Iron [ [:wet]\n:y 1')).toEqual({
      members: ['y'],
      said: ['`Ward.` cannot name `Iron`, which starts with a capital.'],
    });
    // Two bad members in a row are two problems, each said.
    expect(named('visitors are 4\nvisitors arrive y\n:y 1')).toEqual({
      members: ['y'],
      said: ['the number 4 is not the name of a kind.', 'A world says where visitors arrive AT.'],
    });
    expect(named('nonsense\n:wear 4 min "x"\n:y 1')).toEqual({
      members: ['y'],
      said: ['A world is not made of `nonsense`.', 'A min is a whole number.'],
    });
  });

  it('says ONE thing about a member it could not read', () => {
    // Whether a word is a member and whether reading it succeeded are
    // two questions. Answering them in one expression would report a
    // member that failed as a word nobody knows, and say both.
    for (const text of [
      'world w: sprout.World { visitors }',
      'world w: sprout.World { visitors arrive y }',
      'world w: sprout.World { visitors are 4 }',
    ]) {
      expect(readWorld(text).refusals, text).toHaveLength(1);
    }
  });

  it('does not swallow the declaration written after a broken one', () => {
    // A broken world, or a broken member of one, costs at most that
    // world and never the file.
    for (const broken of [
      'world { }',
      'world w: sprout.World { nonsense }',
      'world w: 4 { }',
      'world w: sprout.World { visitors are 4 }',
      'world w',
      'world w nonsense here',
    ]) {
      const { declarations, refusals } = readWorld(`${broken}\nenum Ward { oak }\n`);
      expect(
        declarations.map((d) => d.name.text),
        broken,
      ).toContain('Ward');
      // Exactly one, not merely at least one: a world that gives up
      // steps to the next declaration itself, so the file does not then
      // add "Sprout does not know what to do with X here" about the
      // wreckage it was left standing in.
      expect(
        refusals.map((d) => d.message),
        broken,
      ).toHaveLength(1);
    }
  });

  it('treats a word that starts a declaration as the end of it, not as a member', () => {
    // `world w: sprout.World { enum Ward { oak } }` is a world never closed,
    // and the enum is the file's. Saying "a world is not made of
    // `enum`" as well leaves its braces orphaned and says two things
    // about one mistake.
    for (const inner of ['enum Inner { oak }', 'message :stir', 'world inner: sprout.World { }']) {
      const { refusals, declarations } = readWorld(`world w: sprout.World {\n  ${inner}\n}\n`);
      expect(
        refusals.map((d) => d.message),
        inner,
      ).toContain('`w` is never closed.');
      expect(
        refusals.filter((d) => d.message.startsWith('A world is not made of')),
        inner,
      ).toHaveLength(0);
      // And what was written inside it is kept, as the file's own.
      expect(declarations.length, inner).toBeGreaterThan(0);
    }
  });

  it('does not let a member’s own recovery run past the declaration after it', () => {
    // A list hunting for its `]` must not run to the end of the file:
    // `file()` is still reading behind a property inside a world.
    for (const member of [':x [', ':remembers [a: 0']) {
      const { declarations, refusals } = readWorld(
        `world w: sprout.World { ${member}\n}\nenum Ward { oak }\n`,
      );
      expect(
        declarations.map((d) => d.name.text),
        member,
      ).toContain('Ward');
      expect(refusals.length, member).toBeGreaterThan(0);
    }
  });

  it('still reads a word that only spells a declaration, where one may stand', () => {
    // Nothing reserves an option's name, and what FOLLOWS the word is
    // what decides: `[oak, enum]` is a list of two options.
    for (const text of [':x [Ward] default [oak, enum]', ':x [Ward] default [oak, message]']) {
      expect(readProperty(text).declared, text).not.toBeNull();
      expect(readProperty(text).refusals, text).toEqual([]);
    }
  });

  it('says when a comma is missing between the kinds it composes', () => {
    // Every other comma-separated list in this file says so; letting
    // the brace complain instead would name the wrong problem.
    const { world, refusals } = readWorld(
      'world w: victorian.Voice other.Kind { visitors are P\n visitors arrive at y }',
    );
    expect(refusals.map((d) => d.message)).toEqual([
      'A world needs a comma between the kinds it composes.',
    ]);
    expect(world!.composes.map((c) => c.name.text)).toEqual(['Voice', 'Kind']);
  });

  it('reads `contains`, and `contains actors`', () => {
    // Containment is a declaration, never a kind the engine knows by
    // name. `contains` is the primitive; `contains actors` is the
    // capability beside it, and declaring the second is the whole of
    // what makes a place a place.
    for (const [written, actors] of [
      ['contains', false],
      ['contains actors', true],
    ] as const) {
      const { world, refusals } = readWorld(
        `world w: sprout.World {\n  ${written}\n  visitors are P\n  visitors arrive at y\n}`,
      );
      expect(refusals, written).toEqual([]);
      const held = world!.members.filter((m) => m.kind === 'contains');
      expect(
        held.map((m) => m.actors),
        written,
      ).toEqual([actors]);
      // And the span covers what was written, both words or one, so a
      // problem about it underlines the declaration and not the verb.
      expect(textOf(held[0]!.at), written).toBe(written);
    }
  });

  it('does not take the member after `contains` for the word `actors`', () => {
    const { world, refusals } = readWorld(
      'world w: sprout.World {\n  contains\n  visitors are P\n  visitors arrive at y\n}',
    );
    expect(refusals).toEqual([]);
    expect(world!.members.map((m) => m.kind)).toEqual([
      'contains',
      'visitors-are',
      'visitors-arrive-at',
    ]);
  });

  it('leaves a word after `contains` that is not `actors` where the author wrote it', () => {
    // `contains actor`, singular. Swallowing the word would point the
    // refusal at `contains`, which is the part they got right; leaving
    // it goes back to the member table, which names the word itself.
    const { refusals } = readWorld('world w: sprout.World {\n  contains actor\n}');
    expect(refusals.map((d) => d.message)).toContain('A world is not made of `actor`.');
  });

  it('says `contains` is one of the things a world is made of', () => {
    // Built from the member table, like the rest of that sentence, so
    // it cannot go stale when a member is added.
    const { refusals } = readWorld('world w: sprout.World { nonsense }');
    expect(refusals[0]!.remedy).toContain('`contains`');
  });

  it('is one of the words this compiler reads', () => {
    expect(DECLARATIONS).toContain('world');
    // And the message for a word it does not read names it, because
    // both come from the one table.
    const { refusals } = readWorld('nonsense\n');
    expect(refusals[0]!.remedy).toContain('world');
  });
});
