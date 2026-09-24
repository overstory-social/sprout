import { describe, expect, it } from 'vitest';

import { unspanned } from '../../source/nodes.js';
import { locationOf, textOf } from '../../source/source.js';
import { readWith, rest } from '../../fixtures/readers.js';
import { DEEPEST } from './parser.js';
import { property } from './properties.js';

/** One property, read by `property` from the start of `text`. */
const declare = (text: string) => {
  const { read, refusals, p } = readWith(property, text, { name: 'kiln.sprout' });
  return { declared: read, refusals, p };
};

describe('a property declaration, as a kind or an object writes one', () => {
  it('reads a literal with the type left out', () => {
    const { declared, refusals } = declare(':lit false');
    expect(refusals).toEqual([]);
    expect(declared!.name.text).toBe('lit');
    expect(declared!.type).toBeNull();
    expect(declared!.default).toMatchObject({ kind: 'boolean', value: false });
  });

  it('reads a written type and a default', () => {
    const { declared } = declare(':lit boolean default false');
    expect(declared!.type).toMatchObject({ kind: 'named-type', name: { text: 'boolean' } });
    expect(declared!.default).toMatchObject({ kind: 'boolean', value: false });
  });

  it('reads an integer with a range', () => {
    const { declared } = declare(':wear 0 min 0 max 99');
    expect(declared!.min).toMatchObject({ value: 0 });
    expect(declared!.max).toMatchObject({ value: 99 });
  });

  it('reads an enum and a bare option as its default', () => {
    const { declared } = declare(':state Drying default wet');
    expect(declared!.type).toMatchObject({ name: { text: 'Drying' } });
    expect(declared!.default).toMatchObject({ kind: 'option-literal', name: { text: 'wet' } });
  });

  it('reads a list type and a list default', () => {
    const { declared } = declare(':opens [Ward] default [oak, silver]');
    expect(declared!.type).toMatchObject({ kind: 'list-type' });
    const value = declared!.default!;
    expect(value.kind).toBe('list-literal');
    if (value.kind !== 'list-literal') expect.unreachable('just asserted it is one');
    else expect(value.elements.map((e) => e.kind)).toEqual(['option-literal', 'option-literal']);
  });

  it('reads an enum named with its library', () => {
    const { declared, refusals } = declare(':ward sprout.Ward default oak');
    expect(refusals).toEqual([]);
    expect(declared!.type).toMatchObject({ library: { text: 'sprout' }, name: { text: 'Ward' } });
  });

  it('reads an enum and the option it starts at written as one', () => {
    const { declared, refusals } = declare(':ward Ward.iron');
    expect(refusals).toEqual([]);
    expect(declared!.type).toMatchObject({
      kind: 'named-type',
      library: null,
      name: { text: 'Ward' },
    });
    expect(textOf(declared!.type!.at)).toBe('Ward');
    expect(declared!.default).toMatchObject({ kind: 'option-literal', name: { text: 'iron' } });
    // The option keeps its own span, so a problem with it points at the
    // word and not at the enum in front of it.
    expect(locationOf(declared!.default!.at)).toBe('kiln.sprout:1:12');
    expect(unspanned(declared)).toEqual([]);
  });

  it('reads the same form with the enum\u2019s library', () => {
    const { declared, refusals } = declare(':ward sprout.Ward.iron');
    expect(refusals).toEqual([]);
    expect(declared!.type).toMatchObject({ library: { text: 'sprout' }, name: { text: 'Ward' } });
    expect(declared!.default).toMatchObject({ kind: 'option-literal', name: { text: 'iron' } });
    expect(locationOf(declared!.default!.at)).toBe('kiln.sprout:1:19');
  });

  it('refuses a `default` after that form, which would say the default twice', () => {
    const { declared, refusals } = declare(':ward Ward.iron default oak');
    expect(declared).toBeNull();
    expect(refusals[0]!.message).toBe('`:ward` says its default twice.');
    expect(refusals[0]!.remedy).toBe(
      '`Ward.iron` already says what it starts at. Remove the `default` after it.',
    );
    expect(locationOf(refusals[0]!.at)).toBe('kiln.sprout:1:17');
  });

  it('refuses a dot after a type that has no options, at the dot', () => {
    for (const [text, message, at] of [
      [':n integer.3', '`:n` writes a dot after a type that has no options.', 'kiln.sprout:1:11'],
      [
        ':opens [Ward].oak',
        '`:opens` writes a dot after a type that has no options.',
        'kiln.sprout:1:14',
      ],
    ] as const) {
      const { declared, refusals } = declare(text);
      expect(declared, text).toBeNull();
      expect(refusals[0]!.message, text).toBe(message);
      expect(refusals[0]!.remedy, text).toContain('Write `default` and the value instead.');
      expect(locationOf(refusals[0]!.at), text).toBe(at);
    }
  });

  it('refuses a dot with no option after it, and says what an option looks like', () => {
    for (const [text, message] of [
      [':ward Ward.', '`Ward.` cannot name the end of the file.'],
      [':ward Ward.Iron', '`Ward.` cannot name `Iron`, which starts with a capital.'],
      [':ward sprout.Ward.4', '`sprout.Ward.` cannot name the number 4.'],
    ] as const) {
      const { declared, refusals } = declare(text);
      expect(declared, text).toBeNull();
      expect(refusals[0]!.message, text).toBe(message);
      expect(refusals[0]!.remedy, text).toBe(
        'An option is a lower-case word, as in `:ward Ward.iron`.',
      );
    }
    expect(locationOf(declare(':ward Ward.Iron').refusals[0]!.at)).toBe('kiln.sprout:1:12');
  });

  it('tells `[Ward]` the type from `[oak]` the value by the capital', () => {
    expect(declare(':a [Ward] default [oak]').declared!.type!.kind).toBe('list-type');
    expect(declare(':a [oak]').declared!.type).toBeNull();
  });

  it('reads a negative number', () => {
    expect(declare(':below -5').declared!.default).toMatchObject({ kind: 'integer', value: -5 });
  });

  it('keeps a span on every node it built', () => {
    expect(unspanned(declare(':opens [Ward] default [oak, silver]').declared)).toEqual([]);
  });

  it('refuses a written type with nothing to start at', () => {
    const { declared, refusals } = declare(':lit boolean');
    expect(declared).toBeNull();
    expect(refusals[0]!.message).toBe('`:lit` has a type and no value to start at.');
    expect(refusals[0]!.remedy).toContain('default');
  });

  it('refuses a name with no colon before it', () => {
    const { refusals } = declare('lit false');
    expect(refusals[0]!.message).toContain('A property starts with its name');
  });

  it('refuses a min that is not a whole number', () => {
    expect(declare(':wear 0 min "x"').refusals[0]!.message).toBe('A min is a whole number.');
  });

  it('refuses the same bound twice', () => {
    expect(declare(':wear 0 min 0 min 1').refusals[0]!.message).toBe('`:wear` says min twice.');
  });

  it('refuses a list that is never closed, and one missing a comma', () => {
    expect(declare(':a [Ward] default [oak').refusals[0]!.message).toBe(
      'This list is never closed.',
    );
    expect(declare(':a [Ward] default [oak silver]').refusals[0]!.message).toBe(
      'A list needs a comma between its elements.',
    );
  });

  it('refuses a minus sign with no number after it', () => {
    expect(declare(':a -').refusals[0]!.message).toBe('A minus sign needs a number after it.');
  });

  it('refuses a value missing before a declaration, not the declaration’s word as one', () => {
    // Reading `message`, the next declaration's own word, as a bare
    // option would take `message :x` with it and say nothing about the
    // loss. The declaration's own colon, `:x`, is what tells `message`
    // apart from an ordinary option: `[oak, message]` still reads
    // `message` as one, since nothing follows it there.
    for (const [text, name, at] of [
      [':faulty message :x', 'faulty', 'kiln.sprout:1:9'],
      [':lit boolean default message :x', 'lit', 'kiln.sprout:1:22'],
      [':ward Ward.\nmessage :x', 'ward', 'kiln.sprout:2:1'],
    ] as const) {
      const { declared, refusals } = declare(text);
      expect(declared, text).toBeNull();
      expect(refusals[0]!.message, text).toBe(`\`:${name}\` has no value where one should be.`);
      expect(refusals[0]!.remedy, text).toBe(
        'Write an option of the type, or a literal, before the next declaration.',
      );
      expect(locationOf(refusals[0]!.at), text).toBe(at);
    }
  });

  it('refuses a value missing before a `remembers` block, and keeps the block', () => {
    const { declared, refusals, p } = declare(':faulty\n  remembers { :visits 0 }\n}');
    expect(declared).toBeNull();
    expect(refusals.map((d) => [d.message, d.remedy])).toEqual([
      [
        '`:faulty` has no value where one should be.',
        'Write an option of the type, or a literal, before the next `remembers` block.',
      ],
    ]);
    expect(rest(p)).toBe('remembers { :visits 0 }\n}');
  });

  it('still reads `message` and `enum` as bare options where no declaration follows', () => {
    // What follows the word is what decides, as it does for a list
    // element: nothing reserves an option's name.
    expect(declare(':a message').declared!.default).toMatchObject({
      kind: 'option-literal',
      name: { text: 'message' },
    });
    expect(declare(':a enum').declared!.default).toMatchObject({
      kind: 'option-literal',
      name: { text: 'enum' },
    });
  });

  it('reads a word that only spells a declaration as an element of a list default', () => {
    // Nothing reserves an option's name, and what FOLLOWS the word is
    // what decides: `[oak, enum]` is a list of two options.
    for (const text of [':x [Ward] default [oak, enum]', ':x [Ward] default [oak, message]']) {
      expect(declare(text).declared, text).not.toBeNull();
      expect(declare(text).refusals, text).toEqual([]);
    }
  });

  it('never throws, whatever it is given', () => {
    for (const text of [
      ':a',
      ':a default',
      ':a [',
      ':a [Ward',
      ':a [] default',
      ':a min',
      ':',
      ':a sprout.',
      ':a boolean default',
    ]) {
      expect(() => declare(text), text).not.toThrow();
    }
  });

  it('never loops on an element it cannot read and cannot step over', () => {
    for (const text of [':x [Zeta]', ':x [Zeta Zeta Zeta]', 'remembers { Zeta }', ':x [,,,]']) {
      expect(() => declare(text), text).not.toThrow();
    }
  });
});

describe('one mistake in a property is said once, and said truly', () => {
  it('says a list type names one element type, rather than blaming the bracket', () => {
    expect(declare(':x [Ward, oak]').refusals.map((d) => d.message)).toEqual([
      'A list type names one element type.',
    ]);
  });

  it('reads a list past an element it could not read, as the enum does', () => {
    expect(declare(':x [Ward] default [oak silver brass]').refusals.map((d) => d.message)).toEqual([
      'A list needs a comma between its elements.',
      'A list needs a comma between its elements.',
    ]);
  });

  it('spans a property to its last bound, whichever order they came in', () => {
    expect(textOf(declare(':x 0 max 1 min 2').declared!.at)).toBe(':x 0 max 1 min 2');
  });

  it('keeps a well-formed element that follows one it could not read', () => {
    for (const text of [':x [oak, Zeta silver]', ':x [oak, Zeta, silver]']) {
      const { declared, refusals } = declare(text);
      expect(refusals, text).toHaveLength(1);
      const value = declared!.default!;
      expect(value.kind === 'list-literal' && value.elements.length, text).toBe(2);
    }
  });
});

describe('a type that failed to parse is not mistaken for no type at all', () => {
  it('gives back nothing, having already said what was wrong', () => {
    const { declared, refusals } = declare(':opens [Ward default oak');
    expect(declared).toBeNull();
    expect(refusals.map((d) => d.message)).toEqual(['A list type is never closed.']);
  });

  it('does not swallow the `default` keyword as a value', () => {
    const { declared, refusals } = declare(':x sprout.lower default true');
    expect(declared).toBeNull();
    expect(refusals.map((d) => d.message)).toEqual(['`sprout.` is not followed by a name.']);
  });

  it('still reads a property whose type is genuinely left out', () => {
    expect(declare(':lit false').declared!.type).toBeNull();
  });
});

describe('a `min` and a `max` are whole numbers', () => {
  const readProperty = declare;

  it('says so for anything written there that is not one', () => {
    for (const [text, said] of [
      [':x integer default 0 min [1, 2]', 'A min is a whole number.'],
      [':x integer default 0 max [1, 2]', 'A max is a whole number.'],
      [':x integer default 0 min oak', 'A min is a whole number.'],
      [':x integer default 0 max "9"', 'A max is a whole number.'],
      [':x integer default 0 min true', 'A min is a whole number.'],
    ] as const) {
      const { declared, refusals } = readProperty(text);
      expect(declared, text).toBeNull();
      expect(
        refusals.map((d) => d.message),
        text,
      ).toContain(said);
    }
  });

  it('still reads the bounds it should, including a negative one', () => {
    expect(readProperty(':x integer default 0 min -3 max 9').declared).toMatchObject({
      min: { value: -3 },
      max: { value: 9 },
    });
  });

  it('says a bound is a whole number, whatever is wrong inside what was written', () => {
    // Said at the token the bound starts with, once: a list too long for
    // the cap is still a list where a number goes, and taking elements
    // out of it would not help.
    const overCap = `[${Array.from({ length: 17 }, (_, i) => i).join(', ')}]`;
    for (const bad of ['[1]', '-[1]', '-oak', '-', '--3', overCap, `${'['.repeat(DEEPEST + 1)}1`]) {
      const text = `:x integer default 0 min ${bad}`;
      const { declared, refusals } = readProperty(text);
      expect(declared, text).toBeNull();
      expect(
        refusals.map((d) => [d.message, d.remedy, d.at.start]),
        text,
      ).toEqual([
        ['A min is a whole number.', 'Write `min 0`, or leave it out.', text.indexOf(bad)],
      ]);
    }
  });

  it('keeps the fraction sentence for a bound with a decimal point', () => {
    for (const bad of ['1.5', '-1.5']) {
      expect(
        readProperty(`:x integer default 0 max ${bad}`).refusals.map((d) => d.message),
        bad,
      ).toEqual(['Sprout has no fractions.']);
    }
  });
});
