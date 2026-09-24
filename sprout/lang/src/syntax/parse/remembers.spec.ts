import { describe, expect, it } from 'vitest';

import { unspanned } from '../../source/nodes.js';
import { locationOf } from '../../source/source.js';
import { inKindBody, readWith, rest } from '../../fixtures/readers.js';
import { property } from './properties.js';
import { rememberedAsList, remembers } from './remembers.js';

/** One block read by `remembers` itself, outside any body. */
const remember = (text: string) => {
  const { read, refusals, p } = readWith((at) => remembers(at, () => false), text, {
    name: 'kiln.sprout',
  });
  return { declared: read, refusals, done: p.done };
};

/** The names of what a block remembers. */
const namesIn = (text: string): string[] =>
  remember(text).declared?.properties.map((p) => p.name.text) ?? [];

describe('a `remembers` block, as a world, a kind or an object writes one', () => {
  it('reads the spec’s own example, each entry as a property is read', () => {
    const { declared, refusals } = remember(
      'remembers {\n  :handled   false\n  :ward_seen Ward default oak\n  :visits    0 min 0 max 99\n}',
    );
    expect(refusals).toEqual([]);
    expect(declared!.properties.map((p) => p.name.text)).toEqual([
      'handled',
      'ward_seen',
      'visits',
    ]);
    expect(declared!.properties[1]!.type).toMatchObject({ name: { text: 'Ward' } });
    expect(declared!.properties[2]!.max).toMatchObject({ value: 99 });
    expect(locationOf(declared!.properties[2]!.name.at)).toBe('kiln.sprout:4:3');
  });

  it('reads one that remembers nothing, and one on a single line', () => {
    expect(remember('remembers { }').declared!.properties).toEqual([]);
    const { declared } = remember('remembers { :handled false :visits 0 min 0 max 99 }');
    expect(declared!.properties.map((p) => p.name.text)).toEqual(['handled', 'visits']);
  });

  it('keeps a span on every node it built, from its word to its brace', () => {
    const text = 'remembers { :visits 0 }';
    const { declared } = remember(text);
    expect(unspanned(declared)).toEqual([]);
    expect([declared!.at.start, declared!.at.end]).toEqual([0, text.length]);
  });

  it('refuses a word with no colon before it, keeping the entry after it', () => {
    for (const text of ['remembers { visits 0 :walks 1 }', 'remembers { visits: 0 :walks 1 }']) {
      const { declared, refusals } = remember(text);
      expect(
        refusals.map((d) => [d.message, d.remedy]),
        text,
      ).toEqual([
        [
          'A `remembers` block holds properties, and `visits` is not one.',
          'Write `:visits` and its value, as a property is written.',
        ],
      ]);
      expect(declared!.properties.map((p) => p.name.text)).toEqual(['walks']);
    }
  });

  it('refuses a comma between entries, and keeps both', () => {
    const { declared, refusals } = remember('remembers { :a 0, :b 1 }');
    expect(refusals.map((d) => [d.message, d.remedy])).toEqual([
      [
        'A `remembers` block does not put commas between what it remembers.',
        'Take out the comma, and write each property after the one before, as in `remembers { :handled false :visits 0 }`.',
      ],
    ]);
    expect(declared!.properties.map((p) => p.name.text)).toEqual(['a', 'b']);
  });

  it('refuses what is not a property, of any kind of token', () => {
    const { refusals } = remember('remembers { 4 :a 0 }');
    expect(refusals.map((d) => [d.message, d.remedy])).toEqual([
      [
        'A `remembers` block holds properties, and the number 4 is not one.',
        'Write each entry as a property is, with the colon before its name: `:visits 0`.',
      ],
    ]);
  });

  it('refuses a missing entry value before a declaration, not the declaration’s word as one', () => {
    const text = 'remembers { :visits message :x';
    const { refusals } = remember(text);
    expect(refusals[0]!.message).toBe('`:visits` has no value where one should be.');
    expect(refusals[0]!.at.start).toBe(text.indexOf('message'));
  });

  it('refuses braces left out, and a block never closed', () => {
    expect(remember('remembers :visits 0').refusals.map((d) => [d.message, d.remedy])).toEqual([
      [
        'What an object remembers goes in braces.',
        'Write `remembers { :visits 0 min 0 max 99 }`, each entry written as a property is.',
      ],
    ]);
    const open = remember('remembers { :a 0');
    expect(open.refusals.map((d) => [d.message, d.remedy])).toEqual([
      ['This `remembers` block is never closed.', 'Add a } after what it remembers.'],
    ]);
    expect(open.declared!.properties.map((p) => p.name.text)).toEqual(['a']);
  });

  it('steps over a refused entry through its own brackets and braces, so neither is the block’s', () => {
    for (const text of [
      'remembers { :faulty ) [[Ward]] default [[oak], [oak]] :alpha 1 }',
      'remembers { :faulty [Ward] [oak] :alpha 1 }',
      'remembers { :faulty {} :alpha 1 }',
    ]) {
      const { declared, refusals, done } = remember(text);
      expect(
        declared!.properties.map((p) => p.name.text),
        text,
      ).toEqual(['alpha']);
      expect(refusals, text).toHaveLength(1);
      expect(done, text).toBe(true);
    }
  });

  it('never throws, whatever it is given', () => {
    for (const text of ['remembers', 'remembers {', 'remembers { :a', 'remembers { a:', '{']) {
      expect(() => remember(text), text).not.toThrow();
    }
  });

  it('never loops on an entry it cannot read and cannot step over', () => {
    for (const text of [':x [Zeta]', ':x [Zeta Zeta Zeta]', 'remembers { Zeta }', ':x [,,,]']) {
      expect(() => remember(text), text).not.toThrow();
    }
  });
});

describe('an entry of a `remembers` block that could not be read', () => {
  it('reads a property’s enum and option written as one, as a kind’s property is read', () => {
    const { declared, refusals } = remember('remembers { :ward Ward.iron }');
    expect(refusals).toEqual([]);
    expect(declared!.properties[0]!.type).toMatchObject({ name: { text: 'Ward' } });
    expect(declared!.properties[0]!.default).toMatchObject({ name: { text: 'iron' } });
  });

  it('keeps the entry after one whose type it could not read, and says nothing else', () => {
    // A refused type takes the whole property with it: its brackets, so
    // no closer is left for the block to end early on, and its
    // default, so `default` and `oak` are not read as entries of their
    // own and answered for as if the author had written them that way.
    const { declared, refusals } = remember('remembers { :a [Ward, oak] default silver :b 3 }');
    expect(refusals.map((d) => d.message)).toEqual(['A list type names one element type.']);
    expect(declared!.properties.map((p) => p.name.text)).toEqual(['b']);
  });

  it('steps over however the default of such a property was written', () => {
    const tails = ['default oak', 'default -3', 'default 1.5', 'default "x"', 'default [oak]'];
    for (const tail of tails) {
      const { declared, refusals } = remember(`remembers { :a [Ward, oak] ${tail} :b 3 }`);
      expect(
        refusals.map((d) => d.message),
        tail,
      ).toEqual(['A list type names one element type.']);
      expect(
        declared!.properties.map((p) => p.name.text),
        tail,
      ).toEqual(['b']);
    }

    // And a property that ends where its default should have been takes
    // nothing with it: `b` is the next entry, not the missing value.
    expect(namesIn('remembers { :a [Ward, oak] default :b 3 }')).toEqual(['b']);
  });

  it('says Sprout has no fractions, rather than blaming the comma after one', () => {
    const { declared, refusals } = remember('remembers { :a 1.5 :b 2 }');
    expect(refusals.map((d) => d.message)).toEqual(['Sprout has no fractions.']);
    // And the entry after the broken one is still read.
    expect(declared!.properties.map((p) => p.name.text)).toEqual(['b']);
  });

  it('reads a property’s bounds in either order without its span going short', () => {
    // The span ends at whichever bound was written last; a span that
    // stopped short would suppress a real missing comma one level up.
    // The two readings have to agree.
    const read1 = remember('remembers { :a 0 max 1 min % 2 :b 3 }').refusals;
    const read2 = remember('remembers { :a 0 min 1 max % 2 :b 3 }').refusals;
    expect(read1.map((d) => d.message)).toEqual(read2.map((d) => d.message));
    expect(read1.map((d) => d.message)).toEqual(['Sprout does not use the character "%".']);
  });

  it('steps over the rest of a malformed entry rather than re-reading it as a new one', () => {
    // `b c: 1` is no property at all: recovery steps over all of it, up
    // to the next property or the block's close, and says one thing.
    const { declared, refusals } = remember('remembers { :a 0 b c: 1 }');
    expect(refusals).toHaveLength(1);
    expect(declared!.properties.map((p) => p.name.text)).toEqual(['a']);
  });

  it('steps over the rest of a property whose bound is refused, and says one thing', () => {
    for (const bad of ['min max 9', 'min oak max 9', 'min 0 min 1 max 2', 'max [1] min 0']) {
      const text = `remembers { :visits 0 ${bad} :walks 1 }`;
      const { declared, refusals } = remember(text);
      expect(
        declared?.properties.map((p) => p.name.text),
        text,
      ).toEqual(['walks']);
      expect(refusals, text).toHaveLength(1);
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
      const { declared, refusals } = remember(`remembers { :visits 0 min ${bad} :walks 1 }`);
      const kept = declared?.properties.map((p) => p.name.text) ?? [];
      const said = refusals.map((d) => d.message).join(' ');
      expect(kept.includes('walks') || said.includes('walks'), `${bad}: walks vanished`).toBe(true);
      expect(refusals.length, bad).toBeGreaterThan(0);
    }
  });

  it('keeps what was read before a bad bound, whatever the bound was', () => {
    for (const bad of [']', 'oak', '[1, 2]', '}', '-', '-[1]']) {
      expect(namesIn(`remembers { :handled false :visits 0 min ${bad} }`), bad).toEqual([
        'handled',
      ]);
    }
  });
});

describe('a `remembers` block in a body', () => {
  it('ends where the body’s next member starts when it is never closed, keeping both', () => {
    const { p, source, diagnostics, startsMember } = inKindBody(
      'remembers { :echo 0\n  contains actors\n  :bravo 1',
      'K',
    );
    const declared = remembers(p, startsMember);
    expect(diagnostics.refusals.map((d) => [d.message, d.at.start])).toEqual([
      ['This `remembers` block is never closed.', source.text.indexOf('contains')],
    ]);
    expect(declared!.properties.map((e) => e.name.text)).toEqual(['echo']);
    expect(rest(p)).toBe('contains actors\n  :bravo 1\n}\n');
  });

  it('is a word a list default stops at, as any block member is', () => {
    const { p, diagnostics, startsMember } = inKindBody(
      ':wards [Ward] default [oak]\n  remembers { :seen false }',
      'K',
    );
    expect(property(p)?.name.text).toBe('wards');
    expect(remembers(p, startsMember)!.properties.map((e) => e.name.text)).toEqual(['seen']);
    expect(diagnostics.refusals).toEqual([]);
    expect(rest(p)).toBe('}\n');
  });
});

describe('memory written as a list, `:remembers [ … ]`', () => {
  const refused = (text: string) => {
    const { read, refusals, p } = readWith((at) => rememberedAsList(at, () => false), text, {
      name: 'kiln.sprout',
    });
    expect(read).toBeNull();
    return { refusals: refusals.map((d) => [d.message, d.remedy]), rest: p.peek() };
  };
  const MESSAGE =
    'What an object remembers is written as a `remembers` block, with no colon before `remembers` and its properties in braces.';

  it('is refused with the block its entries make, and stepped over through its `]`', () => {
    for (const [text, block] of [
      [':remembers [visits: 0 min 0 max 99]', 'remembers { :visits 0 min 0 max 99 }'],
      [
        ':remembers [handled: false, ward_seen: Ward default oak,\n  visits: 0 min 0 max 99]',
        'remembers { :handled false :ward_seen Ward default oak :visits 0 min 0 max 99 }',
      ],
      [
        ':remembers [grid: [[Ward]] default [[oak], [silver, oak]]]',
        'remembers { :grid [[Ward]] default [[oak], [silver, oak]] }',
      ],
      [':remembers []', 'remembers { }'],
    ] as const) {
      const { refusals, rest } = refused(`${text} :after 1`);
      expect(refusals, text).toEqual([[MESSAGE, `Write \`${block}\`.`]]);
      expect(rest.text, text).toBe('after');
    }
  });

  it('shows the block written out in general where an entry is not written `name: …`', () => {
    for (const text of [
      ':remembers [visits 0]',
      ':remembers [:visits 0]',
      ':remembers visits: 0',
    ]) {
      expect(refused(text).refusals, text).toEqual([
        [
          MESSAGE,
          'Write `remembers { :visits 0 min 0 max 99 }`, each entry written as a property is.',
        ],
      ]);
    }
  });

  it('in a body, costs only itself: the members around it are kept', () => {
    for (const memory of [':remembers [a: 0, b: 1]', ':remembers [a: 0', ':remembers [a 0]']) {
      const { p, diagnostics, startsMember } = inKindBody(
        `:before 1\n  ${memory}\n  :after 2\n  contains`,
        'K',
      );
      expect(property(p)?.name.text, memory).toBe('before');
      expect(rememberedAsList(p, startsMember), memory).toBeNull();
      expect(
        diagnostics.refusals.map((d) => d.message),
        memory,
      ).toEqual([MESSAGE]);
      expect(rest(p), memory).toBe(':after 2\n  contains\n}\n');
    }
  });
});
