import { describe, expect, it } from 'vitest';

import { locationOf, textOf } from '../../source/source.js';
import { parserOver as over } from '../../fixtures/readers.js';
import { ARTICLE, composition, kindName, writtenKind } from './composition.js';

/** A parser over some text, for calling one reader directly. */
const parserOver = (text: string) => over(text, { name: 'b.sprout' });

/** A parser at `text` with the declaration's name taken, as its reader leaves it. */
function afterName(text: string) {
  const { p, diagnostics } = parserOver(text);
  return { p, diagnostics, name: p.next() };
}

describe('a kind as written, read directly', () => {
  it('is its name, or its library and its name', () => {
    const { p, diagnostics } = parserOver('Key sprout.Container');
    expect([writtenKind(kindName(p)!), writtenKind(kindName(p)!)]).toEqual([
      'Key',
      'sprout.Container',
    ]);
    expect(diagnostics.refusals).toEqual([]);
  });

  it('refuses a word that is not a kind, and a library with no kind after its dot', () => {
    const { p, diagnostics } = parserOver('crate sprout.');
    expect(kindName(p)).toBeNull();
    p.next();
    expect(kindName(p)).toBeNull();
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([
      '`crate` is not the name of a kind.',
      '`sprout.` is not followed by the name of a kind.',
    ]);
  });
});

describe('the kinds after `is`, read directly', () => {
  it('are none, and nothing is taken, where no `is` follows', () => {
    const { p, diagnostics, name } = afterName('K { }');
    expect(composition(p, 'kind', name)).toEqual([]);
    expect(p.peek().text).toBe('{');
    expect(diagnostics.refusals).toEqual([]);
  });

  it('are what was written, up to the first thing that is not one', () => {
    const { p, name } = afterName('o is Crate, sprout.Container {');
    const composes = composition(p, 'object', name);
    expect(composes?.map((c) => textOf(c.at))).toEqual(['Crate', 'sprout.Container']);
    expect(p.peek().text).toBe('{');
  });

  it('are null, having said why, where one cannot be read', () => {
    const { p, diagnostics, name } = afterName('K is Crate, 4 { }');
    expect(composition(p, 'kind', name)).toBeNull();
    expect(diagnostics.refusals.map((d) => d.message)).toEqual([
      'the number 4 is not the name of a kind.',
    ]);
  });

  it('name their owner when a comma is missing, and show how it is written', () => {
    for (const [owner, remedy] of [
      ['world', 'Write `world <name> is one.Kind, Another { … }`.'],
      ['kind', 'Write `kind <Name> is one.Kind, Another { … }`.'],
      ['object', 'Write `object <name> is one.Kind, Another { … }`.'],
    ] as const) {
      const { p, diagnostics, name } = afterName('x is Crate Heavy {');
      expect(composition(p, owner, name)?.length, owner).toBe(2);
      expect(diagnostics.refusals.map((d) => d.remedy)).toEqual([remedy]);
    }
  });

  it('are read after a colon in place of `is`, which is refused, and the line shown with `is`', () => {
    for (const [owner, text, kinds, remedy] of [
      [
        'world',
        'shop: sprout.World, victorian.Voice {',
        ['sprout.World', 'victorian.Voice'],
        'Write `world shop is sprout.World, victorian.Voice { … }`.',
      ],
      [
        'kind',
        'Crate: sprout.Container {',
        ['sprout.Container'],
        'Write `kind Crate is sprout.Container { … }`.',
      ],
      ['object', 'bench: Bench {', ['Bench'], 'Write `object bench is Bench { … }`.'],
    ] as const) {
      const { p, diagnostics, name } = afterName(text);
      expect(
        composition(p, owner, name)?.map((c) => textOf(c.at)),
        owner,
      ).toEqual(kinds);
      const article = ARTICLE[owner];
      expect(diagnostics.refusals.map((d) => [locationOf(d.at), d.message, d.remedy])).toEqual([
        [
          `b.sprout:1:${text.indexOf(':') + 1}`,
          `${article} composes its kinds with \`is\`, not a colon.`,
          remedy,
        ],
      ]);
      expect(p.peek().text).toBe('{');
    }
  });

  it('refuse the colon with a kind left to name where what follows it is not one', () => {
    const { p, diagnostics, name } = afterName('Crate: 4 { }');
    expect(composition(p, 'kind', name)).toBeNull();
    expect(diagnostics.refusals.map((d) => [d.message, d.remedy])).toEqual([
      [
        'the number 4 is not the name of a kind.',
        'A kind starts with a capital letter, as in `Creature` or `sprout.Container`.',
      ],
      ['A kind composes its kinds with `is`, not a colon.', 'Write `kind Crate is <Kind> { … }`.'],
    ]);
  });
});

describe('a kind as it was written, for a remedy', () => {
  it('keeps its library where one was written', () => {
    const { p, name } = afterName('K is sprout.Container, Crate {');
    expect(composition(p, 'kind', name)?.map(writtenKind)).toEqual(['sprout.Container', 'Crate']);
  });
});
