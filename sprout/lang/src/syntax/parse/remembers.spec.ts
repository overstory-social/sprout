import { describe, expect, it } from 'vitest';

import type { Declaration } from '../ast.js';
import { Diagnostics } from '../../source/diagnostics.js';
import { unspanned } from '../../source/nodes.js';
import { Parser } from './parser.js';
import { DECLARATION_READERS } from './declarations.js';
import { rememberedAsList, remembers } from './remembers.js';
import { locationOf, SourceFile } from '../../source/source.js';
import { read } from '../../fixtures/parse.js';

/** One block read by `remembers` itself, outside any body. */
const remember = (text: string) => {
  const diagnostics = new Diagnostics();
  const p = new Parser(new SourceFile('kiln.sprout', text), diagnostics, DECLARATION_READERS);
  const declared = remembers(p, () => false);
  return { declared, refusals: diagnostics.refusals, done: p.done };
};

/** What a kind's body kept: a property by its name, a block by each entry. */
const keptBy = (declarations: readonly Declaration[]): string[] => {
  const kind = declarations.find((d) => d.kind === 'kind');
  return (kind?.members ?? []).flatMap((m) =>
    m.kind === 'remembers'
      ? m.properties.map((p) => `remembers.${p.name.text}`)
      : m.kind === 'property'
        ? [m.name.text]
        : [m.kind],
  );
};

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
});

describe('a `remembers` block in a body', () => {
  it('ends where the body’s next member starts when it is never closed, keeping both', () => {
    const text = 'kind K {\n  remembers { :echo 0\n  contains actors\n  :bravo 1\n}';
    const { declarations, refusals } = read(text);
    expect(refusals.map((d) => [d.message, d.at.start])).toEqual([
      ['This `remembers` block is never closed.', text.indexOf('contains')],
    ]);
    expect(keptBy(declarations)).toEqual(['remembers.echo', 'contains', 'bravo']);
  });

  it('is a word a list default stops at, as any block member is', () => {
    const { declarations, refusals } = read(
      'kind K {\n  :wards [Ward] default [oak]\n  remembers { :seen false }\n}\nenum Ward { oak }',
    );
    expect(refusals).toEqual([]);
    expect(keptBy(declarations)).toEqual(['wards', 'remembers.seen']);
  });
});

describe('memory written as a list, `:remembers [ … ]`', () => {
  const refused = (text: string) => {
    const diagnostics = new Diagnostics();
    const p = new Parser(new SourceFile('kiln.sprout', text), diagnostics, DECLARATION_READERS);
    expect(rememberedAsList(p, () => false)).toBeNull();
    return { refusals: diagnostics.refusals.map((d) => [d.message, d.remedy]), rest: p.peek() };
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
      const text = `kind K {\n  :before 1\n  ${memory}\n  :after 2\n  contains\n}`;
      const { declarations, refusals } = read(text);
      expect(
        refusals.map((d) => d.message),
        memory,
      ).toEqual([MESSAGE]);
      expect(keptBy(declarations), memory).toEqual(['before', 'after', 'contains']);
    }
  });
});
