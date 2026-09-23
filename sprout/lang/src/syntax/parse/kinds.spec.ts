import { describe, expect, it } from 'vitest';

import type { Declaration, KindDeclaration, ObjectDeclaration, WorldDeclaration } from '../ast.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf, SourceFile, textOf } from '../../source/source.js';
import { read } from '../../fixtures/parse.js';
import { DECLARATION_READERS } from './declarations.js';
import { kindDeclaration, objectDeclaration, topLevelObject } from './kinds.js';
import { Parser } from './parser.js';

/** A parser over `text`, for calling one reader directly. */
function parserOver(text: string) {
  const diagnostics = new Diagnostics();
  const p = new Parser(new SourceFile('k.sprout', text), diagnostics, DECLARATION_READERS);
  return { p, diagnostics };
}

/** The one kind a file declares, and what was said reading it. */
function readKind(text: string) {
  const { declarations, refusals } = read(text, 'k.sprout');
  const kind = declarations.find((d): d is KindDeclaration => d.kind === 'kind');
  return { kind, declarations, refusals };
}

/**
 * `text` written in the body of a world, where an object sits: the world
 * opens on line 1, so what `text` holds starts on line 2.
 */
const inWorld = (text: string): string => `world w is sprout.World {\n${text}\n}\n`;

/** The objects the world's body holds, and what was said reading them. */
function readObjects(text: string) {
  const { declarations, refusals } = read(inWorld(text), 'k.sprout');
  const world = declarations.find((d): d is WorldDeclaration => d.kind === 'world');
  return { objects: world?.objects ?? [], object: world?.objects[0], declarations, refusals };
}

/** What a declaration composes, as written. */
const composed = (declared: KindDeclaration | ObjectDeclaration): string[] =>
  declared.composes.map((c) =>
    c.library === null ? c.name.text : `${c.library.text}.${c.name.text}`,
  );

/** Its members as words: a property by its name, the rest by what they are. */
const membersOf = (declared: KindDeclaration | ObjectDeclaration): string[] =>
  declared.members.map((m) => (m.kind === 'property' ? `:${m.name.text}` : m.kind));

const names = (declarations: readonly Declaration[]): string[] =>
  declarations.map((d) => d.name.text);

describe('a kind declaration', () => {
  it('composes nothing where no `is` follows its name', () => {
    // "a kind may compose any number of kinds, including none".
    const { kind, refusals } = readKind('kind Crate { }');
    expect(refusals).toEqual([]);
    expect(kind!.name.text).toBe('Crate');
    expect(kind!.composes).toEqual([]);
    expect(kind!.members).toEqual([]);
    expect(kind!.objects).toEqual([]);
  });

  it('is read directly, from its word to its closing brace', () => {
    const { p, diagnostics } = parserOver('kind Crate is Heavy { contains } after');
    const kind = kindDeclaration(p);
    expect(diagnostics.refusals).toEqual([]);
    expect(composed(kind!)).toEqual(['Heavy']);
    expect(p.peek().text).toBe('after');
  });

  it('holds the objects its body writes apart from its members', () => {
    const { kind, refusals } = readKind('kind Lantern {\n  contains\n  object wick is Wick\n}');
    expect(refusals).toEqual([]);
    expect(membersOf(kind!)).toEqual(['contains']);
    expect(kind!.objects.map((o) => o.name.text)).toEqual(['wick']);
  });

  it('reads the spec’s own, as far as its members are syntax yet', () => {
    const { kind, refusals } = readKind('kind Crate is sprout.Container {\n  :capacity 20\n}');
    expect(refusals).toEqual([]);
    expect(composed(kind!)).toEqual(['sprout.Container']);
    expect(membersOf(kind!)).toEqual([':capacity']);
  });

  it('composes several, library-qualified or its own, in the order written', () => {
    const { kind, refusals } = readKind('kind Vessel is Crate, sprout.Container, Fragile { }');
    expect(refusals).toEqual([]);
    expect(composed(kind!)).toEqual(['Crate', 'sprout.Container', 'Fragile']);
    expect(kind!.composes[0]!.library).toBeNull();
  });

  it('holds properties, a `:remembers` and `contains`', () => {
    const { kind, refusals } = readKind(
      'kind Place {\n  contains actors\n  :lit true\n  :remembers [visits: 0 min 0 max 99]\n}',
    );
    expect(refusals).toEqual([]);
    expect(membersOf(kind!)).toEqual(['contains', ':lit', 'remembers']);
  });

  it('spans from `kind` to its closing brace, with every node spanned', () => {
    const { kind, declarations } = readKind('kind Crate is sprout.Container { contains }\n');
    expect(textOf(kind!.at)).toBe('kind Crate is sprout.Container { contains }');
    expect(textOf(kind!.composes[0]!.at)).toBe('sprout.Container');
    expect(unspanned(declarations)).toEqual([]);
  });
});

describe('an object declaration', () => {
  it('names its kinds after `is`, and needs no body', () => {
    const { object, refusals } = readObjects('object brass_key is Key');
    expect(refusals).toEqual([]);
    expect(object!.name.text).toBe('brass_key');
    expect(composed(object!)).toEqual(['Key']);
    expect(object!.members).toEqual([]);
    expect(object!.objects).toEqual([]);
    expect(textOf(object!.at)).toBe('object brass_key is Key');
  });

  it('holds a body, which is an anonymous kind for that object alone', () => {
    const { object, declarations, refusals } = readObjects(
      'object cabinet is sprout.Container, Heavy {\n  :capacity 4\n  :remembers [opened: false]\n  contains\n}',
    );
    expect(refusals).toEqual([]);
    expect(composed(object!)).toEqual(['sprout.Container', 'Heavy']);
    expect(membersOf(object!)).toEqual([':capacity', 'remembers', 'contains']);
    expect(textOf(object!.at).endsWith('}')).toBe(true);
    expect(unspanned(declarations)).toEqual([]);
  });

  it('holds the objects written in its body, which is their container', () => {
    const { object, refusals } = readObjects(
      'object cabinet is Chest {\n  :open false\n  object brass_key is Key {\n    object tag is Label\n  }\n  object rag is Cloth\n}',
    );
    expect(refusals).toEqual([]);
    expect(membersOf(object!)).toEqual([':open']);
    expect(object!.objects.map((o) => o.name.text)).toEqual(['brass_key', 'rag']);
    expect(object!.objects[0]!.objects.map((o) => o.name.text)).toEqual(['tag']);
    expect(locationOf(object!.objects[0]!.objects[0]!.name.at)).toBe('k.sprout:5:12');
  });

  it('reads one after another, with a body or without', () => {
    const { objects, refusals } = readObjects(
      'object key is Key\nobject shelf is Shelf { contains }\nobject lamp is Lamp',
    );
    expect(refusals).toEqual([]);
    expect(objects.map((o) => o.name.text)).toEqual(['key', 'shelf', 'lamp']);
  });

  it('is read directly as one written in a body, leaving what follows its `}` to that body', () => {
    const { p, diagnostics } = parserOver('object shelf is Shelf { contains }\n  :lit true');
    const object = objectDeclaration(p, true);
    expect(diagnostics.refusals).toEqual([]);
    expect(membersOf(object!)).toEqual(['contains']);
    expect(p.peek().text).toBe('lit');
  });

  it('counts each body it opens against the parser’s own depth', () => {
    const deep = 'object o is K { '.repeat(200) + '}'.repeat(200);
    const { refusals } = readObjects(deep);
    expect(refusals.map((d) => d.message)).toEqual(['This is nested too deep to read.']);
  });
});

describe('an object at a file’s top level', () => {
  it('is read whole, and refused at its word and name, and the file keeps nothing of it', () => {
    const { p, diagnostics } = parserOver(
      'object bench is Bench {\n  :worn 2\n}\nenum Ward { oak }',
    );
    expect(topLevelObject(p)).toBeNull();
    expect(p.peek().text).toBe('enum');
    expect(
      diagnostics.refusals.map((d) => [locationOf(d.at), textOf(d.at), d.message, d.remedy]),
    ).toEqual([
      [
        'k.sprout:1:1',
        'object bench',
        '`bench` is written outside the world, and an object is written inside what holds it.',
        'Move `object bench …` into the braces of the world, `world <name> is sprout.World { … }`, or of the object that holds it.',
      ],
    ]);
  });

  it('says what is wrong inside it too, and costs nothing after it', () => {
    const { declarations, refusals } = read(
      'object bench is Bench {\n  nonsense\n}\nenum Ward { oak }\n',
    );
    expect(refusals.map((d) => d.message)).toEqual([
      'An object is not made of `nonsense`.',
      '`bench` is written outside the world, and an object is written inside what holds it.',
    ]);
    expect(names(declarations)).toEqual(['Ward']);
  });

  it('is not refused as one where its name could not be read, which is said instead', () => {
    const { declarations, refusals } = read('object\nenum Ward { oak }\n');
    expect(refusals.map((d) => [locationOf(d.at), d.message])).toEqual([
      ['ward.sprout:2:1', 'An object needs a name.'],
    ]);
    expect(names(declarations)).toEqual(['Ward']);
  });
});

describe('what is refused, where, and what the author is told to write', () => {
  /** Each refusal as its place, its words and its remedy. */
  const said = (text: string) =>
    read(text, 'k.sprout').refusals.map((d) => [locationOf(d.at), d.message, d.remedy]);

  it('a kind with no name, or one that does not start with a capital', () => {
    const remedy =
      'A name for a kind starts with a capital: `kind Crate is sprout.Container { … }`.';
    expect(said('kind { }')).toEqual([['k.sprout:1:6', 'A kind needs a name.', remedy]]);
    expect(said('kind: Crate { }')).toEqual([['k.sprout:1:5', 'A kind needs a name.', remedy]]);
    expect(said('kind is Crate { }')).toEqual([['k.sprout:1:6', 'A kind needs a name.', remedy]]);
    expect(said('kind crate { }')).toEqual([['k.sprout:1:6', 'A kind needs a name.', remedy]]);
  });

  it('a kind with no braces, repeating what it composes in the remedy', () => {
    expect(said('kind Crate\n')).toEqual([
      [
        'k.sprout:2:1',
        '`Crate` has no braces.',
        'A kind holds what it is made of in braces, and writes them when they hold nothing: `kind Crate { }`.',
      ],
    ]);
    expect(said('kind Crate is sprout.Container, Heavy')[0]![2]).toContain(
      '`kind Crate is sprout.Container, Heavy { }`',
    );
  });

  it('a composition with a comma missing, or something that is not a kind', () => {
    const { kind, refusals } = readKind('kind Crate is Heavy sprout.Container { }');
    expect(refusals.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'k.sprout:1:21',
        'A kind needs a comma between the kinds it composes.',
        'Write `kind <Name> is one.Kind, Another { … }`.',
      ],
    ]);
    expect(composed(kind!)).toEqual(['Heavy', 'sprout.Container']);
    expect(said('kind Crate is 4 { }')).toEqual([
      [
        'k.sprout:1:15',
        'the number 4 is not the name of a kind.',
        'A kind starts with a capital letter, as in `Creature` or `sprout.Container`.',
      ],
    ]);
  });

  it('a composition written with the colon, kept and refused with `is` as the remedy', () => {
    const { kind, refusals } = readKind('kind Crate: sprout.Container { contains }');
    expect(refusals.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'k.sprout:1:11',
        'A kind composes its kinds with `is`, not a colon.',
        'Write `kind Crate is sprout.Container { … }`.',
      ],
    ]);
    expect(composed(kind!)).toEqual(['sprout.Container']);
    expect(membersOf(kind!)).toEqual(['contains']);
    expect(said(inWorld('object bench: Bench, Heavy'))).toEqual([
      [
        'k.sprout:2:13',
        'An object composes its kinds with `is`, not a colon.',
        'Write `object bench is Bench, Heavy { … }`.',
      ],
    ]);
  });

  it('a member no kind holds, which a world may', () => {
    const { kind, refusals } = readKind('kind Crate {\n  visitors are P\n  :open true\n}');
    expect(refusals.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'k.sprout:2:3',
        'A kind is not made of `visitors`.',
        'It holds its properties, `contains`, `passage`, `without`, `depart`, `release`, `accept`, `as`, `on`, `changed`, `pass` and `object`.',
      ],
    ]);
    expect(membersOf(kind!)).toEqual([':open']);
  });

  it('a kind never closed', () => {
    expect(said('kind Crate {\n  :open true\n')).toEqual([
      ['k.sprout:3:1', '`Crate` is never closed.', 'Add a } after what the kind is made of.'],
    ]);
  });

  it('an object with no name, or a capitalised one', () => {
    const remedy = "An object's name is a lower-case word: `object bench is Bench { … }`.";
    expect(said(inWorld('object is Bench'))).toEqual([
      ['k.sprout:2:8', 'An object needs a name.', remedy],
    ]);
    expect(said(inWorld('object Bench is Bench'))).toEqual([
      ['k.sprout:2:8', 'An object needs a name.', remedy],
    ]);
  });

  it('an object that names what holds it, which is read and refused at `in`', () => {
    const { object, refusals } = readObjects('object cushion is Bench in hall.bench { :worn 0 }');
    expect(refusals.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'k.sprout:2:25',
        'An object does not name what holds it: the body it is written in is its container.',
        'Take out `in hall.bench`, and write `object cushion …` inside the braces of `hall.bench`.',
      ],
    ]);
    expect(membersOf(object!)).toEqual([':worn']);
    expect(said(inWorld('object cushion is Bench in { }'))).toEqual([
      [
        'k.sprout:2:25',
        'An object does not name what holds it: the body it is written in is its container.',
        'Take out `in`, and write `object cushion …` inside the braces of what holds it.',
      ],
    ]);
  });

  it('a member no object holds, and an object never closed', () => {
    const { object, refusals } = readObjects(
      'object bench is Bench {\n  visitors are P\n  :worn 0\n}',
    );
    expect(refusals.map((d) => d.message)).toEqual(['An object is not made of `visitors`.']);
    expect(membersOf(object!)).toEqual([':worn']);
    expect(said('world w is sprout.World {\n  object bench is Bench {\n    contains')).toEqual([
      ['k.sprout:3:13', '`bench` is never closed.', 'Add a } after what the object is made of.'],
      ['k.sprout:3:13', '`w` is never closed.', 'Add a } after what the world is made of.'],
    ]);
  });
});

describe('a broken kind or object costs that declaration, not the file', () => {
  it('keeps the declaration written after it, and says one thing', () => {
    for (const broken of [
      'kind',
      'kind { }',
      'kind crate { }',
      'kind Crate',
      'kind Crate is 4 { }',
      'kind Crate { nonsense }',
    ]) {
      const { declarations, refusals } = read(`${broken}\nenum Ward { oak }\n`);
      expect(names(declarations), broken).toContain('Ward');
      expect(
        refusals.map((d) => d.message),
        broken,
      ).toHaveLength(1);
    }
  });

  it('keeps the object written after a broken one in the same body, and says what is wrong', () => {
    // A path after `in` that is itself malformed is refused as well as
    // the `in`: both are true, and the author fixes the second by
    // taking out the first.
    const IN = 'An object does not name what holds it: the body it is written in is its container.';
    for (const [broken, also] of [
      ['object', []],
      ['object Bench is Bench', []],
      ['object bench is 4', []],
      ['object bench is Bench { visitors are P }', []],
      ['object bench is Bench in hall', [IN]],
      ['object bench is Bench in hall.', ['This path ends in a dot.', IN]],
      ['object bench is Bench in hall..shelf', ['Two dots in a row leave a name out.', IN]],
      [
        'object bench is Bench in hall.4 { }',
        ['`4` is a number, not the name of anything in `hall`.', IN],
      ],
      [
        'object bench is Bench in hall . shelf',
        ['A path is written without spaces around its dots.', IN],
      ],
    ] as const) {
      const { objects, refusals } = readObjects(`${broken}\nobject lamp is Lamp`);
      expect(
        objects.map((o) => o.name.text),
        broken,
      ).toContain('lamp');
      const messages = refusals.map((d) => d.message);
      if (also.length === 0) expect(messages, broken).toHaveLength(1);
      else expect(messages, broken).toEqual(also);
    }
  });

  it('ends a body at a declaration written inside it, and keeps that declaration', () => {
    for (const [text, owner] of [
      ['kind Crate {\n  enum Inner { oak }\n}\n', 'Crate'],
      [inWorld('object bench is Bench {\n  kind Inner { }\n}'), 'bench'],
    ] as const) {
      const { declarations, refusals } = read(text);
      expect(
        refusals.map((d) => d.message),
        text,
      ).toContain(`\`${owner}\` is never closed.`);
      expect(names(declarations), text).toContain('Inner');
    }
  });
});
