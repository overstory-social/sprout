import { positionOf } from '@overstory/sprout/lang';
import { describe, expect, it } from 'vitest';

import type { Declared } from './declarations.js';
import { indexOf } from './fixtures/worlds.js';
import { completionsAt, declarationsNamed, definitionsOf, hoverOf, wordAt } from './lookup.js';

const where = (one: Declared) => `${one.at.source.name}:${positionOf(one.at).line}`;

/** The word at the `|` in `text`, which is not part of it. */
const word = (text: string) => wordAt(text.replace('|', ''), text.indexOf('|'))!;

describe('wordAt', () => {
  it('reads the name around the offset, from anywhere in it', () => {
    expect(word('object box is Bo|x')).toMatchObject({
      text: 'Box',
      qualifier: null,
      symbol: false,
    });
    expect(word('object box is |Box')).toMatchObject({ text: 'Box', start: 14, end: 17 });
  });

  it('reads a namespace before a dot, and a colon before a symbol', () => {
    expect(word('is sprout.Pla|ce {')).toMatchObject({ text: 'Place', qualifier: 'sprout' });
    expect(word('self.get(:we|ar)')).toMatchObject({ text: 'wear', symbol: true });
  });

  it('reads nothing between names', () => {
    expect(wordAt('a  b', 2)).toBeNull();
  });
});

describe('declarationsNamed', () => {
  const imports = indexOf('imports');
  const shop = indexOf('printers_shop');

  it('follows an import under `as` to the declaration it names', () => {
    const found = declarationsNamed(imports, 'imports.sprout', word('object box is Bo|x'));
    expect(found.map(where)).toEqual(['things/chest.sprout:3']);
  });

  it('follows a namespace to the library it imports', () => {
    const found = declarationsNamed(imports, 'imports.sprout', word('is sprout.Pla|ce'));
    expect(found.map((one) => [one.name, one.library])).toEqual([['Place', 'sprout']]);
  });

  it('finds a name no import names among the world’s own before a library’s', () => {
    // `Container` is imported by name in the chest's file, and is the library's.
    expect(
      declarationsNamed(imports, 'things/chest.sprout', word('is Contai|ner')).map(
        (one) => one.library,
      ),
    ).toEqual(['sprout']);
    // `wear` is only the world's own, where a library declares no such property.
    expect(declarationsNamed(shop, 'key.sprout', word('self.get(:we|ar)')).map(where)).toEqual([
      'key.sprout:8',
    ]);
  });

  it('reads a symbol as a property, a memory, an option or a message, and nothing else', () => {
    const found = declarationsNamed(shop, 'printers_shop.sprout', word(':vis|its'));
    expect(new Set(found.map((one) => one.as))).toEqual(new Set(['memory']));
    expect(declarationsNamed(shop, 'printers_shop.sprout', word(':Ke|y'))).toEqual([]);
  });

  it('follows a message imported with its colon', () => {
    const chance = indexOf('chance');
    const found = declarationsNamed(chance, 'cat.sprout', word('send(:st|ir)'));
    expect(found.map((one) => [one.as, one.at.source.name])).toEqual([
      ['message', 'chance.sprout'],
    ]);
  });
});

describe('hoverOf and definitionsOf', () => {
  const imports = indexOf('imports');

  it('shows each declaration as its head is written, what it is, and where', () => {
    expect(hoverOf(imports, 'imports.sprout', word('object box is Bo|x'))).toBe(
      '```sprout\nkind Chest is Container\n```\nkind, things/chest.sprout:3',
    );
    expect(hoverOf(imports, 'imports.sprout', word('is sprout.Pla|ce'))).toContain(
      'in the `sprout` library',
    );
    expect(hoverOf(imports, 'imports.sprout', word('nothing_is_c|alled_this'))).toBeNull();
  });

  it('goes only to the world’s own files, since a library’s are not on disk', () => {
    expect(definitionsOf(imports, 'imports.sprout', word('object box is Bo|x')).map(where)).toEqual(
      ['things/chest.sprout:3'],
    );
    expect(definitionsOf(imports, 'imports.sprout', word('is sprout.Pla|ce'))).toEqual([]);
  });
});

describe('completionsAt', () => {
  const imports = indexOf('imports');
  const shop = indexOf('printers_shop');
  const labels = (index = imports, prefix: string, file = 'imports.sprout') =>
    completionsAt(index, file, prefix).map((one) => one.label);

  it('offers a namespace’s top-level names after its dot, and nothing else', () => {
    const offered = completionsAt(imports, 'imports.sprout', '  object hall is sprout.Pl');
    expect(offered.map((one) => one.label)).toContain('Place');
    expect(offered.every((one) => one.as !== 'keyword' && one.as !== 'property')).toBe(true);
  });

  it('offers properties, memories, options and messages after a colon', () => {
    const offered = completionsAt(shop, 'key.sprout', '  do { self.adjust(:');
    expect(offered.map((one) => one.label)).toEqual(expect.arrayContaining(['wear', 'brass']));
    expect(
      offered.every((one) => ['property', 'memory', 'option', 'message'].includes(one.as)),
    ).toBe(true);
  });

  it('offers the world’s names, each once, and the reserved words everywhere else', () => {
    const offered = labels(shop, '  object ', 'printers_shop.sprout');
    expect(offered).toEqual(expect.arrayContaining(['Key', 'composing_room', 'kind', 'passage']));
    expect(offered.filter((one) => one === 'visits')).toHaveLength(1);
  });
});
