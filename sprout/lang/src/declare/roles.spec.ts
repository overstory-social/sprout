import { describe, expect, it } from 'vitest';

import type { KindDeclaration, PlayDeclaration, VerbDeclaration } from '../syntax/ast.js';
import { Diagnostics } from '../source/diagnostics.js';
import { parseDeclarations } from '../syntax/parse.js';
import { locationOf, SourceFile } from '../source/source.js';
import { EnumTable } from './enums.js';
import { KindTable } from './kinds.js';
import { playKey, playsOf, VerbNames, type ResolvedPlay } from './roles.js';

/** The standard library's part: a verb of its own, and one the world may declare over. */
const SPROUT_TEXT = `verb take { role target  "take [target]" }
verb unlock { role target  "unlock [target]" }
verb look { "look" }
kind Actor { }
`;

/**
 * Every verb and kind in `text`, in the library `shop`, beside the
 * standard library's: the verbs' names read first, then every kind
 * composed. What was said, and the plays of each kind.
 */
function world(text: string, options: { onUnknownVerb?: boolean } = {}) {
  const read = new Diagnostics();
  const sprout = parseDeclarations(new SourceFile('sprout.sprout', SPROUT_TEXT), read);
  const shop = parseDeclarations(new SourceFile('shop.sprout', text), read);
  expect(
    read.refusals.map((d) => d.message),
    'the fixture parses',
  ).toEqual([]);
  const verbs = new VerbNames();
  verbs.add(
    'sprout',
    sprout.filter((d): d is VerbDeclaration => d.kind === 'verb'),
  );
  verbs.add(
    'shop',
    shop.filter((d): d is VerbDeclaration => d.kind === 'verb'),
  );
  const diagnostics = new Diagnostics();
  const kinds = new KindTable();
  kinds.add(
    'sprout',
    sprout.filter((d): d is KindDeclaration => d.kind === 'kind'),
    diagnostics,
  );
  kinds.add(
    'shop',
    shop.filter((d): d is KindDeclaration => d.kind === 'kind'),
    diagnostics,
  );
  const unknown: PlayDeclaration[] = [];
  kinds.resolve('shop', new EnumTable(), diagnostics, undefined, {
    verbs,
    ...(options.onUnknownVerb === true ? { onUnknownVerb: (play) => unknown.push(play) } : {}),
  });
  return {
    kinds,
    unknown,
    said: diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy] as const),
    plays: (name: string, library: string, verb: string, role: string): string[] =>
      playsOf(kinds.qualified('shop', name)!.plays, library, verb, role).map(
        (play: ResolvedPlay) => play.origin,
      ),
  };
}

const UNLOCK = `verb unlock { role target  role tool  "unlock [target] with [tool]"  "unlock [target]" }
verb ask { role target  role topic: symbol  "ask [target] about [topic]" }
`;

describe('which verbs a play may name', () => {
  it('reads a bare verb from the composer’s library first, then the standard library’s', () => {
    const verbs = new VerbNames();
    const read = (library: string, text: string) =>
      verbs.add(
        library,
        parseDeclarations(new SourceFile(`${library}.sprout`, text), new Diagnostics()).filter(
          (d): d is VerbDeclaration => d.kind === 'verb',
        ),
      );
    read('sprout', 'verb take { role target "take [target]" }\nverb look { "look" }');
    read(
      'shop',
      'verb take { role item "grab [item]" }\nverb pull { "pull" }\nverb look { "peer" }',
    );
    expect(verbs.unqualified('take', 'shop')!.library).toBe('shop');
    expect(verbs.unqualified('take', 'other')!.library).toBe('sprout');
    expect(verbs.unqualified('pull', 'other')).toBeNull();
    // An engine verb's name is the standard library's alone, as the verb table keeps it.
    expect(verbs.unqualified('look', 'shop')!.library).toBe('sprout');
    expect(verbs.named('shop').sort()).toEqual(['look', 'pull', 'take']);
  });

  it('keeps the first of two verbs of one name in one library', () => {
    const verbs = new VerbNames();
    verbs.add(
      'shop',
      parseDeclarations(
        new SourceFile(
          'shop.sprout',
          'verb pull { "pull" }\nverb pull { role target "yank [target]" }',
        ),
        new Diagnostics(),
      ).filter((d): d is VerbDeclaration => d.kind === 'verb'),
    );
    expect(verbs.unqualified('pull', 'shop')!.declaration.roles).toEqual([]);
  });
});

describe('a play is resolved against its verb', () => {
  it('holds a play under its role and the verb by its full identity', () => {
    const { said, kinds, plays } = world(`verb unlock { role target  "unlock [target]" }
kind Door { as target for unlock { do { } } }
kind Hand { as target for take { do { } } }`);
    expect(said).toEqual([]);
    expect(plays('Door', 'shop', 'unlock', 'target')).toEqual(['shop.Door']);
    // The world's own `unlock` is reached, not the library's.
    expect(playsOf(kinds.qualified('shop', 'Door')!.plays, 'sprout', 'unlock', 'target')).toEqual(
      [],
    );
    expect(plays('Hand', 'sprout', 'take', 'target')).toEqual(['shop.Hand']);
    expect([...kinds.qualified('shop', 'Hand')!.plays.keys()]).toEqual([
      playKey('sprout', 'take', 'target'),
    ]);
  });

  it('refuses a verb nothing declares, with the one it most likely meant', () => {
    const { said } = world(`${UNLOCK}kind Warded { as target for unlokc { do { } } }`);
    expect(said).toEqual([
      [
        'shop.sprout:3:29',
        '`Warded` plays `target` for `unlokc`, and nothing declares that verb. Did you mean `unlock`?',
        'Write `as target for unlock`, or declare `verb unlokc { … }`.',
      ],
    ]);
  });

  it('tells a load of a verb nothing declares, rather than refusing it, and drops the play', () => {
    const { said, unknown, kinds } = world('kind Warded { as target for wibble { do { } } }', {
      onUnknownVerb: true,
    });
    expect(said).toEqual([]);
    expect(unknown.map((play) => play.head.verb.text)).toEqual(['wibble']);
    expect(kinds.qualified('shop', 'Warded')!.plays.size).toBe(0);
  });

  it('refuses a role the verb does not declare, naming the ones it does', () => {
    const { said } = world(`${UNLOCK}kind Warded { as tool2 for unlock { do { } } }`);
    expect(said).toEqual([
      [
        'shop.sprout:3:18',
        '`unlock` has no role `tool2`. Its roles are `target` and `tool`.',
        'Write `as tool for unlock`, or `as actor for unlock` to play whoever is acting.',
      ],
    ]);
  });

  it('refuses any role but `actor` on a verb with none', () => {
    const { said } = world('kind Eye { as target for look { do { } } }');
    expect(said.map(([, message, remedy]) => [message, remedy])).toEqual([
      ['`look` has no roles, so only the actor plays it.', 'Write `as actor for look`.'],
    ]);
    expect(world('kind Eye { as actor for look { do { } } }').said).toEqual([]);
  });

  it('refuses a play of a value role, which the visitor names and nothing plays', () => {
    const { said } = world(`${UNLOCK}kind Guard { as topic for ask { do { } } }`);
    expect(said.map(([, message]) => message)).toEqual([
      '`topic` is filled by a value the visitor names, so nothing plays it.',
    ]);
  });

  it('refuses one kind playing one role twice, keeping the first', () => {
    const { said, plays } = world(
      `${UNLOCK}kind Warded { as target for unlock { do { } }\n  as target for unlock { permit { } } }`,
    );
    expect(said).toEqual([
      [
        'shop.sprout:4:3',
        '`Warded` plays `target` for `unlock` twice.',
        'Keep one, and write what both do in it.',
      ],
    ]);
    expect(plays('Warded', 'shop', 'unlock', 'target')).toEqual(['shop.Warded']);
  });
});

describe('a `from` narrows a value role by a property the role-player holds, or a range', () => {
  it('reads a property of its own or one it composes, and a range written out', () => {
    const { said, kinds } = world(`${UNLOCK}kind Knowing { :knows [integer] default [] }
kind Guard: Knowing { as target for ask { topic from :knows  do { } } }
kind Dial { as target for ask { topic from 1 to 12  do { } } }`);
    expect(said).toEqual([]);
    const guard = playsOf(kinds.qualified('shop', 'Guard')!.plays, 'shop', 'ask', 'target')[0]!;
    const narrowing = guard.narrows.get('topic')!;
    expect(narrowing.narrows === 'property' && narrowing.property.origin).toBe('shop.Knowing');
    const dial = playsOf(kinds.qualified('shop', 'Dial')!.plays, 'shop', 'ask', 'target')[0]!;
    expect(dial.narrows.get('topic')).toMatchObject({ narrows: 'range', min: 1, max: 12 });
  });

  it('refuses a role the verb lacks, a role narrowed twice, a property nobody holds, and a remembered one', () => {
    const { said } = world(`${UNLOCK}kind Guard {
  :knows [integer] default []
  :remembers [heard: [integer] default []]
  as target for ask { topc from :knows  do { } }
  as tool for unlock { tool from :knows  tool from :knows  do { } }
  as target for unlock { tool from :knws  do { } }
}
kind Clerk {
  :remembers [heard: [integer] default []]
  as target for ask { topic from :heard  do { } }
}`);
    expect(said.map(([at, message, remedy]) => [at, message, remedy])).toEqual([
      [
        'shop.sprout:6:23',
        '`ask` has no role `topc`. Its roles are `target` and `topic`.',
        'Write `topic from :<property>`.',
      ],
      [
        'shop.sprout:7:42',
        '`tool` is narrowed twice in `as tool for unlock`.',
        'Keep one `tool from …`.',
      ],
      [
        'shop.sprout:8:36',
        '`Guard` has no property `:knws`. Did you mean `:knows`?',
        'Write `tool from :knows`.',
      ],
      [
        'shop.sprout:12:34',
        '`:heard` is remembered about each actor, and `from` names what `Clerk` itself holds.',
        'Name a property declared without `:remembers`.',
      ],
    ]);
  });
});

describe('roles compose: every play of one role runs, in closure order, the composer’s own last', () => {
  const LOCKS = `${UNLOCK}kind Lock { as target for unlock { permit { } } }
kind Cursed { as target for unlock { permit { } } }
`;

  it('runs each composed kind’s play in the order its source appears, its own last', () => {
    const { said, plays } = world(
      `${LOCKS}kind Chest: Cursed, Lock { as target for unlock { do { } } }`,
    );
    expect(said).toEqual([]);
    expect(plays('Chest', 'shop', 'unlock', 'target')).toEqual([
      'shop.Cursed',
      'shop.Lock',
      'shop.Chest',
    ]);
  });

  it('runs one origin once, however many paths reach it', () => {
    const { plays } = world(`${LOCKS}kind Brass: Lock { }
kind Iron: Lock { }
kind Both: Brass, Iron { }`);
    expect(plays('Both', 'shop', 'unlock', 'target')).toEqual(['shop.Lock']);
  });

  it('leaves out what `without as <role> for <verb> from X` names, and nothing else', () => {
    const { said, plays } = world(`${LOCKS}kind Chest: Lock, Cursed {
  without as target for unlock from Lock
}`);
    expect(said).toEqual([]);
    expect(plays('Chest', 'shop', 'unlock', 'target')).toEqual(['shop.Cursed']);
  });

  it('keeps a play left out through one path when another path still reaches it', () => {
    const { said, plays } =
      world(`${LOCKS}kind Quiet: Lock { without as target for unlock from Lock }
kind Chest: Quiet, Lock { }`);
    expect(said).toEqual([]);
    expect(plays('Quiet', 'shop', 'unlock', 'target')).toEqual([]);
    expect(plays('Chest', 'shop', 'unlock', 'target')).toEqual(['shop.Lock']);
  });

  it('refuses to leave out a play the kind after `from` only composes, or does not write', () => {
    const { said } = world(`${LOCKS}kind Brass: Lock { }
kind Chest: Brass { without as target for unlock from Brass }
kind Box: Lock { without as tool for unlock from Lock }`);
    expect(said.map(([, message]) => message)).toEqual([
      '`Brass` has no `as target for unlock` to leave out.',
      '`Lock` has no `as tool for unlock` to leave out.',
    ]);
  });
});
