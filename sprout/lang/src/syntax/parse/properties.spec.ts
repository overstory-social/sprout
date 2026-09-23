import { describe, expect, it } from 'vitest';

import { Diagnostics } from '../../source/diagnostics.js';
import { unspanned } from '../../source/nodes.js';
import { DEEPEST, parseProperty, parseRemembers } from '../parse.js';
import { locationOf, SourceFile, textOf } from '../../source/source.js';
import { read, readProperty } from '../../fixtures/parse.js';

describe('a property declaration, as a kind or an object writes one', () => {
  const declare = (text: string) => {
    const diagnostics = new Diagnostics();
    const declared = parseProperty(new SourceFile('kiln.sprout', text), diagnostics);
    return { declared, diagnostics, refusals: diagnostics.refusals };
  };

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

  it('reads it the same way where an object remembers it', () => {
    const diagnostics = new Diagnostics();
    const declared = parseRemembers(
      new SourceFile('kiln.sprout', ':remembers [ward: Ward.iron]'),
      diagnostics,
    );
    expect(diagnostics.refusals).toEqual([]);
    expect(declared!.properties[0]!.type).toMatchObject({ name: { text: 'Ward' } });
    expect(declared!.properties[0]!.default).toMatchObject({ name: { text: 'iron' } });
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
});

describe('a :remembers, as an object writes one', () => {
  const remember = (text: string) => {
    const diagnostics = new Diagnostics();
    const declared = parseRemembers(new SourceFile('kiln.sprout', text), diagnostics);
    return { declared, refusals: diagnostics.refusals };
  };

  it('reads the spec’s own example', () => {
    const { declared, refusals } = remember(
      ':remembers [handled: false, ward_seen: Ward default oak, visits: 0 min 0 max 99]',
    );
    expect(refusals).toEqual([]);
    expect(declared!.properties.map((p) => p.name.text)).toEqual([
      'handled',
      'ward_seen',
      'visits',
    ]);
    expect(declared!.properties[2]!.max).toMatchObject({ value: 99 });
  });

  it('reads one that remembers nothing', () => {
    expect(remember(':remembers []').declared!.properties).toEqual([]);
  });

  it('keeps a span on every node it built', () => {
    expect(unspanned(remember(':remembers [visits: 0]').declared)).toEqual([]);
  });

  it('refuses a name with a colon before it, which is the other syntax', () => {
    expect(remember(':remembers [:visits 0]').refusals[0]!.message).toContain(
      'A remembered property starts with its name',
    );
  });

  it('refuses a missing entry value before a declaration, not the declaration’s word as one', () => {
    // The same reading, and the same refusal, as a property's own value:
    // `propertyBody` reads both through one path.
    const text = ':remembers [visits: message :x]';
    const { declared, refusals } = remember(text);
    expect(declared).toBeNull();
    expect(refusals[0]!.message).toBe('`:visits` has no value where one should be.');
    expect(refusals[0]!.at.start).toBe(text.indexOf('message'));
  });

  it('refuses a missing colon between a name and its value', () => {
    expect(remember(':remembers [visits 0]').refusals[0]!.message).toBe(
      '`visits` needs a colon between its name and its value.',
    );
  });

  it('refuses a missing comma, and one that is never closed', () => {
    expect(remember(':remembers [a: 0 b: 1]').refusals[0]!.message).toContain('needs a comma');
    expect(remember(':remembers [a: 0').refusals[0]!.message).toBe(
      'This `:remembers` is never closed.',
    );
  });

  it('refuses brackets left out altogether', () => {
    expect(remember(':remembers visits: 0').refusals[0]!.message).toBe(
      'What an object remembers goes in brackets.',
    );
  });

  it('names every entry written after a `]` that ended it too early', () => {
    for (const [text, said] of [
      [
        ':remembers [handled: false, visits: 0 min ], walks: 1]',
        '`walks` is written after the `]` that ends this `:remembers`.',
      ],
      [
        ':remembers [handled: false], walks: 1, runs: [1, [2]], hops: 0 min 0]',
        '`walks`, `runs` and `hops` are written after the `]` that ends this `:remembers`.',
      ],
    ] as const) {
      const { declared, refusals } = remember(text);
      expect(
        declared!.properties.map((p) => p.name.text),
        text,
      ).toEqual(['handled']);
      const named = refusals.find((d) => d.message === said);
      expect(named?.at.start, text).toBe(text.indexOf('walks'));
    }
    // A comma after the `]` with no entry in it is not an entry to name.
    expect(remember(':remembers [a: 0], 4]').refusals).toEqual([]);
  });

  it('steps over entries after an early `]` only through their own `]`', () => {
    // Closed: the world reads on as if the `]` had not been there.
    const closed = read('world w is sprout.World {\n  :remembers [a: 0 ], walks: 1]\n  :z 1\n}');
    expect(closed.refusals.map((d) => d.message)).toEqual([
      '`walks` is written after the `]` that ends this `:remembers`.',
    ]);
    // Not closed: nothing is taken past the next member, which is kept.
    const open = read('world w is sprout.World {\n  :remembers [a: 0 ], walks: 1\n  :z 1\n}');
    expect(open.refusals.map((d) => d.message)).toContain(
      '`walks` is written after the `]` that ends this `:remembers`.',
    );
    for (const { declarations } of [closed, open]) {
      const world = declarations.find((d) => d.kind === 'world');
      expect(world?.members.map((m) => (m.kind === 'property' ? m.name.text : m.kind))).toEqual([
        'remembers',
        'z',
      ]);
    }
  });

  it('never looks past a declaration for entries after its `]`', () => {
    // The world is never closed, so the next line is a declaration, and
    // its header is not entries of the `:remembers` above it, however
    // it reads.
    const text =
      'world w is sprout.World {\n  :remembers [a: 0]\nworld bar is sprout.World, name: 1] {\n  visitors are P\n  visitors arrive at y\n}\n';
    const { declarations, refusals } = read(text);
    expect(declarations).toEqual([]);
    expect(refusals.map((d) => [d.message, d.at.start])).toEqual([
      ['`w` is never closed.', text.indexOf('world bar')],
      ['`name` is not the name of a kind.', text.indexOf('name:')],
    ]);
  });

  it('still names an entry after its `]` that is spelled like a declaration', () => {
    const { declared, refusals } = remember(':remembers [a: 0], world: 1, enum: 2]');
    expect(declared!.properties.map((p) => p.name.text)).toEqual(['a']);
    expect(refusals.map((d) => d.message)).toEqual([
      '`world` and `enum` are written after the `]` that ends this `:remembers`.',
    ]);
  });

  it('never throws, whatever it is given', () => {
    for (const text of [':remembers', ':remembers [', ':remembers [a', ':remembers [a:', ':x []']) {
      expect(() => remember(text), text).not.toThrow();
    }
  });

  it('steps over a refused entry through its own brackets, so its `]` is never the list’s', () => {
    // The rest of an entry refused before it was read is stepped over
    // whole, a balanced `[`…`]` run at a time, the way a refused member
    // is: its own bracket never ends the `:remembers`, and the entry
    // after it is read normally.
    for (const text of [
      ':remembers [faulty: ) [[Ward]] default [[oak], [oak]], alpha: 1]',
      ':remembers [faulty: [Ward] [oak], alpha: 1]',
    ]) {
      const { declared, refusals } = remember(text);
      expect(
        declared!.properties.map((p) => p.name.text),
        text,
      ).toEqual(['alpha']);
      expect(declared!.properties[0]!.default, text).toMatchObject({ kind: 'integer', value: 1 });
      expect(refusals, text).toHaveLength(1);
      expect(refusals[0]!.message, text).not.toContain(']');
    }
  });
});

describe('a type that failed to parse is not mistaken for no type at all', () => {
  const declare = (text: string) => {
    const diagnostics = new Diagnostics();
    const declared = parseProperty(new SourceFile('kiln.sprout', text), diagnostics);
    return { declared, refusals: diagnostics.refusals };
  };

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

  it('steps over the rest of a property whose bound is refused, and says one thing', () => {
    for (const bad of ['min max 9', 'min oak max 9', 'min 0 min 1 max 2', 'max [1] min 0']) {
      const text = `:remembers [visits: 0 ${bad}, walks: 1]`;
      const diagnostics = new Diagnostics();
      const remembered = parseRemembers(new SourceFile('k.sprout', text), diagnostics);
      expect(
        remembered?.properties.map((p) => p.name.text),
        text,
      ).toEqual(['walks']);
      expect(diagnostics.refusals, text).toHaveLength(1);
    }
  });

  it('never loses the entry written after a bad bound in silence', () => {
    // Every shape either keeps `walks` or names it; none drops it
    // without saying so.
    for (const bad of [
      '[1, 2]',
      '[[1]]',
      'oak',
      '"9"',
      'true',
      'Ward',
      ':wet',
      'max 9',
      '1.5',
      '-[1]',
      '-[1, 2]',
      '-oak',
      '-"9"',
      '-',
      '- -',
    ]) {
      const diagnostics = new Diagnostics();
      const remembered = parseRemembers(
        new SourceFile('k.sprout', `:remembers [visits: 0 min ${bad}, walks: 1]`),
        diagnostics,
      );
      const kept = remembered?.properties.map((p) => p.name.text) ?? [];
      const said = diagnostics.refusals.map((d) => d.message).join(' ');
      expect(kept.includes('walks') || said.includes('walks'), `${bad}: walks vanished`).toBe(true);
      expect(diagnostics.refusals.length, bad).toBeGreaterThan(0);
    }
  });

  it('keeps what was read before a bad bound, whatever the bound was', () => {
    for (const bad of [']', 'oak', '[1, 2]', '}', '-', '-[1]']) {
      const diagnostics = new Diagnostics();
      const remembered = parseRemembers(
        new SourceFile('k.sprout', `:remembers [handled: false, visits: 0 min ${bad}]`),
        diagnostics,
      );
      expect(
        remembered?.properties.map((p) => p.name.text),
        bad,
      ).toEqual(['handled']);
    }
  });
});
