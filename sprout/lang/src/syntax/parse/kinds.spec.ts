import { describe, expect, it } from 'vitest';

import type { Declaration, KindDeclaration, ObjectDeclaration } from '../ast.js';
import { unspanned } from '../../source/nodes.js';
import { locationOf, textOf } from '../../source/source.js';
import { read } from '../../fixtures/parse.js';

/** The one kind a file declares, and what was said reading it. */
function readKind(text: string) {
  const { declarations, refusals } = read(text, 'k.sprout');
  const kind = declarations.find((d): d is KindDeclaration => d.kind === 'kind');
  return { kind, declarations, refusals };
}

/** The one object a file declares, and what was said reading it. */
function readObject(text: string) {
  const { declarations, refusals } = read(text, 'k.sprout');
  const object = declarations.find((d): d is ObjectDeclaration => d.kind === 'object');
  return { object, declarations, refusals };
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
  it('composes nothing where no colon follows its name', () => {
    // "a kind may compose any number of kinds, including none".
    const { kind, refusals } = readKind('kind Crate { }');
    expect(refusals).toEqual([]);
    expect(kind!.name.text).toBe('Crate');
    expect(kind!.composes).toEqual([]);
    expect(kind!.members).toEqual([]);
  });

  it('reads the spec’s own, as far as its members are syntax yet', () => {
    const { kind, refusals } = readKind('kind Crate: sprout.Container {\n  :capacity 20\n}');
    expect(refusals).toEqual([]);
    expect(composed(kind!)).toEqual(['sprout.Container']);
    expect(membersOf(kind!)).toEqual([':capacity']);
  });

  it('composes several, library-qualified or its own, in the order written', () => {
    const { kind, refusals } = readKind('kind Vessel: Crate, sprout.Container, Fragile { }');
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
    const { kind, declarations } = readKind('kind Crate: sprout.Container { contains }\n');
    expect(textOf(kind!.at)).toBe('kind Crate: sprout.Container { contains }');
    expect(textOf(kind!.composes[0]!.at)).toBe('sprout.Container');
    expect(unspanned(declarations)).toEqual([]);
  });
});

describe('an object declaration', () => {
  it('names its kinds and its container, and needs no body', () => {
    const { object, refusals } = readObject('object brass_key: Key in shelf');
    expect(refusals).toEqual([]);
    expect(object!.name.text).toBe('brass_key');
    expect(composed(object!)).toEqual(['Key']);
    expect(object!.container.kind).toBe('path');
    expect(object!.container.parts.map((part) => part.text)).toEqual(['shelf']);
    expect(object!.members).toEqual([]);
    expect(textOf(object!.at)).toBe('object brass_key: Key in shelf');
    expect(textOf(object!.container.at)).toBe('shelf');
  });

  it('names a container deeper than the world by its path, and spans all of it', () => {
    const { object, declarations, refusals } = readObject(
      'object key: Key in kiln.shelf.box {\n  :worn 0\n}',
    );
    expect(refusals).toEqual([]);
    expect(object!.container.parts.map((part) => part.text)).toEqual(['kiln', 'shelf', 'box']);
    expect(textOf(object!.container.at)).toBe('kiln.shelf.box');
    expect(object!.container.parts.map((part) => locationOf(part.at))).toEqual([
      'k.sprout:1:20',
      'k.sprout:1:25',
      'k.sprout:1:31',
    ]);
    expect(membersOf(object!)).toEqual([':worn']);
    expect(unspanned(declarations)).toEqual([]);
  });

  it('holds a body, which is an anonymous kind for that object alone', () => {
    const { object, declarations, refusals } = readObject(
      'object cabinet: sprout.Container, Heavy in composing_room {\n  :capacity 4\n  :remembers [opened: false]\n  contains\n}\n',
    );
    expect(refusals).toEqual([]);
    expect(composed(object!)).toEqual(['sprout.Container', 'Heavy']);
    expect(membersOf(object!)).toEqual([':capacity', 'remembers', 'contains']);
    expect(textOf(object!.at).endsWith('}')).toBe(true);
    expect(unspanned(declarations)).toEqual([]);
  });

  it('reads one after another, with a body or without', () => {
    const { declarations, refusals } = read(
      'object key: Key in shelf\nobject shelf: Shelf in hall { contains }\nobject lamp: Lamp in hall\n',
    );
    expect(refusals).toEqual([]);
    expect(names(declarations)).toEqual(['key', 'shelf', 'lamp']);
  });
});

describe('what is refused, where, and what the author is told to write', () => {
  /** Each refusal as its place, its words and its remedy. */
  const said = (text: string) =>
    read(text, 'k.sprout').refusals.map((d) => [locationOf(d.at), d.message, d.remedy]);

  it('a kind with no name, or one that does not start with a capital', () => {
    const remedy = 'A name for a kind starts with a capital: `kind Crate: sprout.Container { … }`.';
    expect(said('kind { }')).toEqual([['k.sprout:1:6', 'A kind needs a name.', remedy]]);
    expect(said('kind: Crate { }')).toEqual([['k.sprout:1:5', 'A kind needs a name.', remedy]]);
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
    expect(said('kind Crate: sprout.Container, Heavy')[0]![2]).toContain(
      '`kind Crate: sprout.Container, Heavy { }`',
    );
  });

  it('a composition with a comma missing, or something that is not a kind', () => {
    const { kind, refusals } = readKind('kind Crate: Heavy sprout.Container { }');
    expect(refusals.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'k.sprout:1:19',
        'A kind needs a comma between the kinds it composes.',
        'Write `kind <Name>: one.Kind, Another { … }`.',
      ],
    ]);
    expect(composed(kind!)).toEqual(['Heavy', 'sprout.Container']);
    expect(said('kind Crate: 4 { }')).toEqual([
      [
        'k.sprout:1:13',
        'the number 4 is not the name of a kind.',
        'A kind starts with a capital letter, as in `Creature` or `sprout.Container`.',
      ],
    ]);
  });

  it('a member no kind holds, which a world may', () => {
    const { kind, refusals } = readKind('kind Crate {\n  visitors are P\n  :open true\n}');
    expect(refusals.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
      [
        'k.sprout:2:3',
        'A kind is not made of `visitors`.',
        'It holds its properties, `contains` and `without`.',
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
    const remedy =
      "An object's name is a lower-case word: `object bench: Bench in composing_room { … }`.";
    expect(said('object: Bench in hall')).toEqual([
      ['k.sprout:1:7', 'An object needs a name.', remedy],
    ]);
    expect(said('object Bench: Bench in hall')).toEqual([
      ['k.sprout:1:8', 'An object needs a name.', remedy],
    ]);
  });

  it('an object that does not say what holds it', () => {
    const remedy =
      'Write `in` and the name of its container after its kinds: `object bench: Bench in composing_room { … }`.';
    expect(said('object bench: Bench { }')).toEqual([
      ['k.sprout:1:21', 'An object says what holds it.', remedy],
    ]);
    expect(said('object bench: Bench\n')).toEqual([
      ['k.sprout:2:1', 'An object says what holds it.', remedy],
    ]);
  });

  it('an object whose `in` names nothing, or names a kind', () => {
    const remedy =
      'A container is named as it was declared, in lower case: `object bench: Bench in composing_room { … }`.';
    expect(said('object bench: Bench in { }')).toEqual([
      ['k.sprout:1:24', 'After `in` comes the name of what holds `bench`.', remedy],
    ]);
    expect(said('object bench: Bench in Hall { }')).toEqual([
      ['k.sprout:1:24', 'After `in` comes the name of what holds `bench`.', remedy],
    ]);
  });

  it('a member no object holds, and an object never closed', () => {
    const { object, refusals } = readObject(
      'object bench: Bench in hall {\n  visitors are P\n  :worn 0\n}',
    );
    expect(refusals.map((d) => d.message)).toEqual(['An object is not made of `visitors`.']);
    expect(membersOf(object!)).toEqual([':worn']);
    expect(said('object bench: Bench in hall {\n  contains')).toEqual([
      ['k.sprout:2:11', '`bench` is never closed.', 'Add a } after what the object is made of.'],
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
      'kind Crate: 4 { }',
      'kind Crate { nonsense }',
      'object',
      'object Bench: Bench in hall',
      'object bench: 4 in hall',
      'object bench: Bench',
      'object bench: Bench { }',
      'object bench: Bench in { }',
      'object bench: Bench in hall { visitors are P }',
      'object bench: Bench in hall.',
      'object bench: Bench in hall..shelf',
      'object bench: Bench in hall.4 { }',
      'object bench: Bench in hall.Shelf',
      'object bench: Bench in hall . shelf',
    ]) {
      const { declarations, refusals } = read(`${broken}\nenum Ward { oak }\n`);
      expect(names(declarations), broken).toContain('Ward');
      expect(
        refusals.map((d) => d.message),
        broken,
      ).toHaveLength(1);
    }
  });

  it('reads the body of an object whose container is missing, so nothing in it is lost to the file', () => {
    // `enum:` inside the body would stop a plain skip, and the file would
    // then say an enum has no name; reading the body says what is wrong
    // with it instead, and nothing more.
    const { declarations, refusals } = read(
      'object bench: Bench {\n  :remembers [enum: 1]\n  nonsense\n}\nenum Ward { oak }\n',
    );
    expect(refusals.map((d) => d.message)).toEqual([
      'An object says what holds it.',
      'An object is not made of `nonsense`.',
    ]);
    expect(names(declarations)).toEqual(['Ward']);
  });

  it('ends a body at a declaration written inside it, and keeps that declaration', () => {
    for (const [text, owner] of [
      ['kind Crate {\n  enum Inner { oak }\n}\n', 'Crate'],
      ['object bench: Bench in hall {\n  kind Inner { }\n}\n', 'bench'],
      ['kind Crate {\n  object inner: Bench in hall\n}\n', 'Crate'],
    ] as const) {
      const { declarations, refusals } = read(text);
      expect(
        refusals.map((d) => d.message),
        text,
      ).toContain(`\`${owner}\` is never closed.`);
      expect(names(declarations), text).toContain(text.includes('inner') ? 'inner' : 'Inner');
    }
  });

  it('does not take the next declaration’s word for an object’s name', () => {
    const { declarations, refusals } = read('object\nenum Ward { oak }\n');
    expect(refusals.map((d) => [locationOf(d.at), d.message])).toEqual([
      ['ward.sprout:2:1', 'An object needs a name.'],
    ]);
    expect(names(declarations)).toEqual(['Ward']);
  });
});
